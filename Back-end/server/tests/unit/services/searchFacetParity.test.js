import { jest } from '@jest/globals';

/**
 * The results grid and the filter sidebar must answer the SAME question.
 *
 * They are two endpoints (`/products` and `/products/facets`) built from two
 * call sites, and until 2026-09-16 only one of them was told what the customer
 * typed. `getFacets` was handed a hand-built context — `{ categoryIds,
 * vehicleFilterIds: null }` — with no tokens, so buildSearchStage produced no
 * recall lanes and the sidebar counted every active product: `winch` returned 42
 * results beside a panel reading "930 products" and offering Auxbeam (44), a
 * lighting brand with zero winches whose filter chip led to an empty grid.
 *
 * These tests compare the two $search stages directly. A count-based test could
 * pass by coincidence on a small fixture; an identical recall structure cannot.
 */

const aggregate = jest.fn();

jest.unstable_mockModule('../../../models/Product.js', () => ({
  default: { collection: { aggregate } },
}));

const BMW_ID = 'bmw-vehicle-id';
jest.unstable_mockModule('../../../models/Vehicle.js', () => ({
  default: {
    find: () => ({
      select: () => ({
        lean: async () => [{ _id: BMW_ID, make: 'BMW', model: 'X5' }],
        maxTimeMS: async () => [{ _id: BMW_ID, make: 'BMW', model: 'X5' }],
      }),
    }),
  },
}));

jest.unstable_mockModule('../../../services/categoryMappingService.js', () => ({
  default: {
    initialized: true,
    initialize: async () => {},
    findCategory: () => null,
    getAllCategoryIdsIncludingChildren: async () => [],
  },
}));

jest.unstable_mockModule('../../../services/cacheService.js', () => ({
  getRedisClient: () => null,
  default: {},
  CACHE_VERSION: 1,
  CACHE_CONFIG: {},
  TTL: {},
}));

const { default: atlasSearchService } = await import('../../../services/atlasSearchService.js');

/** Every $search stage built during the last call, in order. */
const stages = () =>
  aggregate.mock.calls
    .map((c) => c[0])
    .filter((pl) => Array.isArray(pl) && pl[0]?.$search)
    .map((pl) => pl[0].$search);

/** The recall half of a stage — what decides WHICH documents match. */
const recallOf = (stage) => stage.compound.must ?? null;

function stubTotal(total) {
  aggregate.mockReset();
  aggregate.mockImplementation((pipeline) => {
    const isFacet = pipeline.some((st) => st.$facet);
    if (isFacet) {
      return { toArray: async () => [{ total: total > 0 ? [{ value: total }] : [], brands: [], categories: [], vehicles: [], priceStats: [], ratings: [], availability: [] }] };
    }
    return { toArray: async () => [] };
  });
}

beforeEach(() => {
  stubTotal(5);
  atlasSearchService.__resetReadiness();
  jest.spyOn(atlasSearchService, 'getIndexCapabilities').mockResolvedValue({
    stockRank: false, salesScore: false, synonyms: false,
  });
});

afterEach(() => jest.restoreAllMocks());

describe('grid and sidebar build the SAME recall', () => {
  const cases = [
    ['text only',            { q: 'bmw steering wheel' }],
    ['text + brand',         { q: 'winch', brand: 'Bushranger' }],
    ['text + price',         { q: 'winch', minPrice: 1000, maxPrice: 9000 }],
    ['text + availability',  { q: 'winch', inStock: 'true' }],
    ['text + vehicle',       { q: 'roof rails', vehicleMake: 'BMW' }],
    ['vehicle-only query',   { q: 'bmw' }],
    ['single token',         { q: 'spoiler' }],
    ['filters only',         { minPrice: 1000 }],
  ];

  it.each(cases)('%s → identical recall clauses', async (_label, params) => {
    stubTotal(5);
    await atlasSearchService.searchProducts({ ...params, limit: 1 });
    const gridRecall = recallOf(stages()[0]);

    stubTotal(5);
    await atlasSearchService.getFacets({ ...params });
    const facetRecall = recallOf(stages()[0]);

    expect(facetRecall).toEqual(gridRecall);
  });

  it('a text search produces recall lanes on the FACET stage — the actual bug', async () => {
    // Before the fix this was null: no tokens reached buildSearchStage, so the
    // facet query had no `must` at all and matched the entire active catalogue.
    stubTotal(5);
    await atlasSearchService.getFacets({ q: 'bmw steering wheel' });
    const recall = recallOf(stages()[0]);

    expect(recall).not.toBeNull();
    const tokenLane = recall[0].compound.should[0];
    expect(tokenLane.compound.minimumShouldMatch).toBe(3); // all three words required
  });

  it('a filters-only browse still has NO recall, which is correct', async () => {
    stubTotal(5);
    await atlasSearchService.getFacets({ minPrice: 1000 });
    expect(recallOf(stages()[0])).toBeNull();
  });

  it('?q= and ?search= build identical facet stages', async () => {
    stubTotal(5);
    await atlasSearchService.getFacets({ q: 'winch' });
    const viaQ = stages()[0];

    stubTotal(5);
    await atlasSearchService.getFacets({ search: 'winch' });
    expect(stages()[0]).toEqual(viaQ);
  });
});

describe('disjunctive exclusion must not drop the search text', () => {
  it('keeps recall on EVERY per-dimension pass, not just the base pass', async () => {
    // Excluding "brand" answers "what would the brand counts be without the brand
    // filter" — it must never also mean "without the search". If it did, the brand
    // list would be catalogue-wide again while the total beside it was correct.
    stubTotal(5);
    await atlasSearchService.getFacets({ q: 'winch', brand: 'Bushranger', inStock: 'true' });

    const all = stages();
    expect(all.length).toBeGreaterThan(1); // base + at least one exclusion pass
    const base = recallOf(all[0]);
    for (const stage of all) {
      expect(recallOf(stage)).toEqual(base);
    }
  });

  it('still drops the excluded FILTER while keeping recall', async () => {
    stubTotal(5);
    await atlasSearchService.getFacets({ q: 'winch', brand: 'Bushranger' });
    const all = stages();
    const brandClauseOf = (s) => (s.compound.filter || []).find((f) => f.in?.path === 'brand');

    expect(brandClauseOf(all[0])).toBeDefined();               // base applies it
    expect(all.some((s) => brandClauseOf(s) === undefined)).toBe(true); // one pass drops it
  });
});

describe('the sidebar climbs the same relaxation ladder as the grid', () => {
  it('widens when the strict pass counts zero, so the panel matches a relaxed grid', async () => {
    // Without this the grid could show 40 relaxed results beside a sidebar reading
    // "0" — the same disagreement as the 930 bug, inverted.
    aggregate.mockReset();
    let call = 0;
    aggregate.mockImplementation((pipeline) => {
      if (!pipeline.some((st) => st.$facet)) return { toArray: async () => [] };
      call += 1;
      const total = call === 1 ? 0 : 9; // strict pass empty, next rung finds some
      return { toArray: async () => [{ total: total > 0 ? [{ value: total }] : [], brands: [], categories: [], vehicles: [], priceStats: [], ratings: [], availability: [] }] };
    });

    const facets = await atlasSearchService.getFacets({ q: 'bmw steering wheel' });

    const required = stages().map((s) => s.compound.must[0].compound.should[0].compound.minimumShouldMatch);
    expect(required).toEqual([3, 2]); // all tokens → 70% of 3, floored
    expect(facets.total).toBe(9);
  });

  it('does NOT widen when the strict pass already counted something', async () => {
    stubTotal(4);
    await atlasSearchService.getFacets({ q: 'bmw steering wheel' });
    const required = stages().map((s) => s.compound.must[0].compound.should[0].compound.minimumShouldMatch);
    expect(required).toEqual([3]);
  });

  it('never ladders a filters-only browse, even when it counts zero', async () => {
    // Widening recall cannot conjure a product that passes the filters, so an empty
    // filtered browse is a real answer, not a recall failure.
    //
    // Counting STAGES would be wrong here: `minPrice` is a selected dimension, so
    // the price-exclusion pass legitimately adds a second stage. What must not
    // happen is the BASE pass running twice — so count the stages that still carry
    // the price filter, which is exactly the base ones.
    stubTotal(0);
    await atlasSearchService.getFacets({ minPrice: 999999 });

    const basePasses = stages().filter((s) =>
      (s.compound.filter || []).some((f) => f.range?.path === 'price')
    );
    expect(basePasses).toHaveLength(1);
  });
});

describe('each facet pass picks its OWN rung', () => {
  /** Drive each aggregation call's total individually, in call order. */
  const scriptTotals = (totals) => {
    aggregate.mockReset();
    let i = 0;
    aggregate.mockImplementation((pipeline) => {
      if (!pipeline.some((st) => st.$facet)) return { toArray: async () => [] };
      const total = totals[Math.min(i, totals.length - 1)];
      i += 1;
      return { toArray: async () => [{ total: total > 0 ? [{ value: total }] : [], brands: [], categories: [], vehicles: [], priceStats: [], ratings: [], availability: [] }] };
    });
  };

  it('does not widen a brand pass just because the BRAND FILTER zeroed the base', async () => {
    // The scenario: "bmw steering wheel" matches 7 products, none of them Auxbeam.
    // The base pass counts 0 — caused by the FILTER, not by recall — and ladders.
    // A brand pass inheriting that rung would count brands over the any-one-token
    // set and offer "Bushranger (300)", while clicking it lands on a rung-0 grid
    // of 12. The brand pass drops the brand filter, so it finds products at rung 0
    // and must stop there.
    //
    // Call order: base rung0 (0) → base rung1 (0) → base rung2 (5) → brand pass (12).
    scriptTotals([0, 0, 5, 12]);
    await atlasSearchService.getFacets({ q: 'bmw steering wheel', brand: 'Auxbeam' });

    const required = stages().map((s) => s.compound.must[0].compound.should[0].compound.minimumShouldMatch);
    // Base climbed 3 → 2 → 1; the brand pass started over at 3 and stopped.
    expect(required).toEqual([3, 2, 1, 3]);
  });

  it('requests a total on single-dimension passes, or the ladder cannot see emptiness', async () => {
    // Without `total` on an exclusion pass, totalOf reads undefined as zero and
    // widens every such pass unconditionally — turning a free optimisation into
    // two extra Atlas round trips per selected dimension.
    scriptTotals([5, 5]);
    await atlasSearchService.getFacets({ q: 'winch', brand: 'Bushranger' });

    const facetBranches = aggregate.mock.calls
      .map((c) => c[0])
      .filter((pl) => Array.isArray(pl) && pl.some((st) => st.$facet))
      .map((pl) => pl.find((st) => st.$facet).$facet);

    expect(facetBranches.length).toBeGreaterThan(1);
    for (const branches of facetBranches) {
      expect(branches.total).toBeDefined();
    }
  });

  it('costs no extra pass in the common case, because exclusions are supersets', async () => {
    // Dropping a filter can only ADD matches, so a non-empty base guarantees every
    // exclusion pass is non-empty at the same rung.
    scriptTotals([9, 9, 9, 9]);
    await atlasSearchService.getFacets({ q: 'winch', brand: 'Bushranger', inStock: 'true' });

    const required = stages().map((s) => s.compound.must[0].compound.should[0].compound.minimumShouldMatch);
    expect(required.every((r) => r === 1)).toBe(true); // single token, strict rung throughout
    expect(stages()).toHaveLength(3); // base + brand + availability, one pass each
  });
});

describe('invariants that survive the rewiring', () => {
  it('never lifts isActive on a public facet query', async () => {
    stubTotal(5);
    await atlasSearchService.getFacets({ q: 'winch' });
    for (const stage of stages()) {
      expect(stage.compound.filter).toEqual(
        expect.arrayContaining([{ equals: { path: 'isActive', value: true } }])
      );
    }
  });

  it('applies a vehicle MAKE filter, which the caller used to null out', async () => {
    // Named for what it actually passes. It said "?vehicle=" until 2026-09-16 while
    // testing `vehicleMake` — a different parameter down a different code path, so
    // the name implied coverage the assertion did not provide.
    stubTotal(5);
    await atlasSearchService.getFacets({ vehicleMake: 'BMW' });
    const filters = stages()[0].compound.filter;
    expect(filters.some((f) => f.in?.path === 'compatibleVehicles')).toBe(true);
  });

  it('applies an explicit ?vehicle= id list, which Atlas ignored entirely', async () => {
    // Real engine divergence: buildBaseQuery filtered on `vehicle`, Atlas never
    // read it, so the same URL returned a fitment-filtered set on MongoDB and the
    // whole catalogue on Atlas.
    stubTotal(5);
    await atlasSearchService.getFacets({ vehicle: '6a38d617504f8ef0309ed0ff' });
    const clause = stages()[0].compound.filter.find((f) => f.in?.path === 'compatibleVehicles');
    expect(clause).toBeDefined();
    expect(clause.in.value).toHaveLength(1);
  });

  it('lets an explicit ?vehicle= win over make/model, as buildBaseQuery does', async () => {
    stubTotal(5);
    await atlasSearchService.getFacets({ vehicle: '6a38d617504f8ef0309ed0ff', vehicleMake: 'BMW' });
    const clause = stages()[0].compound.filter.find((f) => f.in?.path === 'compatibleVehicles');
    expect(clause.in.value).toHaveLength(1); // the explicit id, not the make expansion
  });
});
