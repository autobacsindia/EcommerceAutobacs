import { jest } from '@jest/globals';

/**
 * The relaxation ladder, end to end through searchProducts.
 *
 * The pure-builder tests in atlasSearchService.queryBuilder.test.js prove each
 * RUNG builds the right query. These prove the ladder is actually CLIMBED: that a
 * hit stops it, that a miss advances it, and — the part that costs real money in
 * latency — that it never runs a rung whose query duplicates the one before it.
 */

const aggregate = jest.fn();

jest.unstable_mockModule('../../../models/Product.js', () => ({
  default: { collection: { aggregate } },
}));

const BMW_ID = 'bmw-vehicle-id';

jest.unstable_mockModule('../../../models/Vehicle.js', () => ({
  default: {
    find: () => ({
      select: () => ({ lean: async () => [{ _id: BMW_ID, make: 'BMW', model: 'X5' }] }),
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

/** One Atlas pass = two aggregates (the paged products, and the facets). */
const PIPELINES_PER_PASS = 2;

/** Queue up `hits` per pass, in order, so a pass can be made to return nothing. */
function respondWith(...totalsPerPass) {
  aggregate.mockReset();
  // Anything beyond the scripted passes (the did-you-mean probe) gets an empty
  // result rather than an undefined cursor, so an unscripted call fails the
  // assertion it belongs to instead of throwing somewhere unrelated.
  aggregate.mockReturnValue({ toArray: async () => [] });
  for (const total of totalsPerPass) {
    const docs = total > 0 ? [{ _id: 'p1', name: 'a product', images: [] }] : [];
    // products pipeline, then facet pipeline
    aggregate.mockReturnValueOnce({ toArray: async () => docs });
    aggregate.mockReturnValueOnce({
      toArray: async () => [{ total: [{ value: total }], brands: [], categories: [] }],
    });
  }
}

/** The relax level each executed pass used, read back off the built $search stage. */
function levelsExecuted() {
  return aggregate.mock.calls
    .map((call) => call[0])
    // Identify the paged products pipeline by its $skip stage. Selecting "every
    // other call" instead would silently absorb the did-you-mean probe, which
    // runs only on a total miss and would show up as a phantom fourth rung.
    .filter((pipeline) => Array.isArray(pipeline) && pipeline.some((stage) => '$skip' in stage))
    .map((pipeline) => {
      const tokenLane = pipeline[0].$search.compound.must?.[0]?.compound?.should?.[0];
      return tokenLane?.compound?.minimumShouldMatch ?? null;
    });
}

beforeEach(() => {
  aggregate.mockReset();
  atlasSearchService.__resetReadiness();
  jest.spyOn(atlasSearchService, 'getIndexCapabilities').mockResolvedValue({
    stockRank: false,
    salesScore: false,
    synonyms: false,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the ladder stops at the first rung that returns results', () => {
  it('runs exactly ONE pass when the strict query finds something', async () => {
    // "bmw steering wheel" now resolves on the strict rung, so the common case
    // costs no more than it did before the change.
    respondWith(1);
    const result = await atlasSearchService.searchProducts({ q: 'bmw steering wheel' });

    expect(aggregate).toHaveBeenCalledTimes(1 * PIPELINES_PER_PASS);
    expect(levelsExecuted()).toEqual([3]); // all three tokens required
    expect(result.relaxed).toBe(false);
    expect(result.relaxLevel).toBe(0);
  });

  it('does not widen a query that returned results, however few', async () => {
    respondWith(1);
    await atlasSearchService.searchProducts({ q: 'bmw steering wheel purple neon' });
    expect(aggregate).toHaveBeenCalledTimes(1 * PIPELINES_PER_PASS);
  });
});

describe('the ladder advances only on a genuine zero', () => {
  it('falls to the 70% rung, then stops, for a 3-token query', async () => {
    respondWith(0, 4);
    const result = await atlasSearchService.searchProducts({ q: 'bmw steering wheel' });

    expect(levelsExecuted()).toEqual([3, 2]); // all tokens → 70% of 3, floored
    expect(result.relaxed).toBe(true);
    expect(result.relaxLevel).toBe(1);
  });

  it('falls all the way to any-one-token when both narrower rungs miss', async () => {
    respondWith(0, 0, 7);
    const result = await atlasSearchService.searchProducts({ q: 'bmw steering wheel' });

    expect(levelsExecuted()).toEqual([3, 2, 1]);
    expect(result.relaxLevel).toBe(2);
    expect(result.relaxed).toBe(true);
  });

  it('never exceeds three passes, even when nothing matches at any rung', async () => {
    respondWith(0, 0, 0);
    const result = await atlasSearchService.searchProducts({ q: 'bmw steering wheel purple neon' });

    // Five tokens: all → 70% (floor(5 * 0.7) = 3) → any one.
    expect(levelsExecuted()).toEqual([5, 3, 1]);
    expect(result.pagination.total).toBe(0);
  });

  it('pays exactly one extra probe — the did-you-mean — on a total miss', async () => {
    // The worst case in the whole system, pinned so it cannot grow silently:
    // three search passes plus the spell-correction probe that only runs once
    // every rung has come back empty.
    respondWith(0, 0, 0);
    await atlasSearchService.searchProducts({ q: 'bmw steering wheel purple neon' });

    expect(aggregate).toHaveBeenCalledTimes(3 * PIPELINES_PER_PASS + 1);
  });
});

describe('rungs that would rebuild an identical query are skipped', () => {
  it('a 2-token miss goes straight from strict to last-resort, skipping 70%', async () => {
    // minimumTokensRequired(2) === 2 === strict, so the middle rung is a byte
    // identical query. Running it would be a wasted ~110ms Atlas round trip on a
    // result set already known to be empty.
    respondWith(0, 3);
    const result = await atlasSearchService.searchProducts({ q: 'bmw steering' });

    expect(aggregate).toHaveBeenCalledTimes(2 * PIPELINES_PER_PASS);
    expect(levelsExecuted()).toEqual([2, 1]); // both tokens → any one token
    expect(result.relaxLevel).toBe(2);
  });

  it('a 1-token miss costs exactly ONE pass — there is nothing to relax', async () => {
    // This asserted two passes until 2026-09-16, pinning a waste rather than a
    // behaviour: every rung builds an identical query for a single token, so the
    // second pass re-asked a question already answered. Single-word searches are
    // 44.2% of measured prod traffic, so the wasted round trip was not marginal.
    respondWith(0);
    const result = await atlasSearchService.searchProducts({ q: 'bmw' });

    // Exactly one pass, and no did-you-mean probe either: suggestCorrection
    // skips tokens too short to correct, and "bmw" is three characters.
    expect(aggregate).toHaveBeenCalledTimes(1 * PIPELINES_PER_PASS);
    expect(levelsExecuted()).toEqual([1]);
    expect(result.relaxLevel).toBe(0);
    expect(result.relaxed).toBe(false);
  });
});

describe('a filters-only browse never ladders', () => {
  it('runs a single pass and reports an honest empty set', async () => {
    // Widening recall cannot conjure a product that passes the filters, so the
    // retries would be pure latency. An empty filtered browse is a real answer.
    respondWith(0);
    const result = await atlasSearchService.searchProducts({ minPrice: 999999 });

    expect(aggregate).toHaveBeenCalledTimes(1 * PIPELINES_PER_PASS);
    expect(result.relaxed).toBe(false);
    expect(result.pagination.total).toBe(0);
  });
});

describe('pagination stays on one rung', () => {
  it('page 2 resolves to the same rung as page 1 for the same query', async () => {
    // If page 1 answered strictly and page 2 answered relaxed, the result set
    // would change under the shopper mid-scroll. The ladder is a pure function of
    // the query and the hit counts, so this must hold by construction.
    respondWith(0, 5);
    const p1 = await atlasSearchService.searchProducts({ q: 'bmw steering wheel', page: 1 });

    respondWith(0, 5);
    const p2 = await atlasSearchService.searchProducts({ q: 'bmw steering wheel', page: 2 });

    expect(p2.relaxLevel).toBe(p1.relaxLevel);
  });
});


describe('a vehicle word narrows a longer query instead of widening it', () => {
  // The second over-recall leak, end to end. "BMW X5 M Sport Conversion Kit", a
  // roof spoiler and a crystal gear knob all carry the BMW X5 fitment id and none
  // contains "steering" or "wheel" anywhere in name, brand, sku or tags. They
  // reached the "bmw steering wheel" results through the vehicle lane, which
  // carries no token requirement at all — so tightening minimumShouldMatch could
  // never have excluded them.
  const stageOf = (callIndex = 0) => {
    const pipeline = aggregate.mock.calls
      .map((c) => c[0])
      .filter((pl) => Array.isArray(pl) && pl.some((st) => '$skip' in st))[callIndex];
    return pipeline[0].$search;
  };
  const recallVehicleLane = (stage) =>
    stage.compound.must[0].compound.should.find((l) => l.in?.path === 'compatibleVehicles');
  const rankingVehicleBoost = (stage) =>
    (stage.compound.should || []).find((l) => l.in?.path === 'compatibleVehicles');

  it('keeps a buried vehicle token OUT of recall but still scores fitment', async () => {
    respondWith(1);
    await atlasSearchService.searchProducts({ q: 'bmw steering wheel' });
    const stage = stageOf();

    expect(recallVehicleLane(stage)).toBeUndefined();
    expect(rankingVehicleBoost(stage).in.value).toEqual([BMW_ID]);
  });

  it('still recalls by fitment when the vehicle IS the whole query', async () => {
    // The valuable half: a universal part that fits a BMW but never says "BMW" in
    // its name is findable only through fitment. Searching the vehicle alone must
    // keep returning it.
    respondWith(1);
    await atlasSearchService.searchProducts({ q: 'bmw' });
    expect(recallVehicleLane(stageOf()).in.value).toEqual([BMW_ID]);
  });

  it('restores the buried vehicle to recall on the last rung', async () => {
    respondWith(0, 0, 3);
    await atlasSearchService.searchProducts({ q: 'bmw steering wheel' });

    expect(recallVehicleLane(stageOf(0))).toBeUndefined(); // rung 0
    expect(recallVehicleLane(stageOf(1))).toBeUndefined(); // rung 1
    expect(recallVehicleLane(stageOf(2)).in.value).toEqual([BMW_ID]); // rung 2
  });
});
