import { jest } from '@jest/globals';

/**
 * The vehicle make facet counts DISTINCT PRODUCTS, not fitment slots.
 *
 * `compatibleVehicles` is an array, so the facet aggregation unwinds it and
 * groups per vehicle id. Rolling those per-vehicle numbers up to a make by
 * SUMMING them counts a product once per model it fits: on prod the sidebar
 * offered "BMW (59)" beside a grid of 39, "Toyota (284)" beside 255, and the
 * model counts summed exactly to the inflated make figure (21+20+12+6 = 59).
 *
 * The category dimension had already solved this — rollUpCategoryCounts unions
 * distinct id sets for precisely this reason — and the vehicle branch simply
 * never got the same treatment.
 *
 * Two related defects are pinned here too: models keyed by name alone merged
 * across makes, and the model list was never scoped to the selected make (which
 * is how a shopper reached the impossible pair BMW + Fortuner).
 */

const VEHICLES = [
  { _id: 'v-bmw-5', make: 'BMW', model: '5 Series' },
  { _id: 'v-bmw-3', make: 'BMW', model: '3 Series' },
  { _id: 'v-bmw-x', make: 'BMW', model: 'X Series' },
  { _id: 'v-toy-f', make: 'Toyota', model: 'Fortuner' },
  { _id: 'v-gone', make: 'Ghost', model: 'Retired' }, // deactivated: absent from the lookup
];

// Mirrors the real query: `{ _id: { $in }, isActive: true }` must exclude v-gone.
// A plain function, not jest.fn: jest.config sets `resetMocks`, which strips
// jest.fn implementations between tests and would make find() return undefined.
const findCalls = [];
const vehicleFind = (filter) => {
  findCalls.push(filter);
  const ids = new Set((filter?._id?.$in || []).map(String));
  const rows = VEHICLES
    .filter((v) => ids.has(String(v._id)))
    .filter((v) => (filter?.isActive === true ? v._id !== 'v-gone' : true));
  const chain = { lean: () => chain, maxTimeMS: async () => rows };
  return { select: () => chain };
};

jest.unstable_mockModule('../../../models/Vehicle.js', () => ({
  default: { find: vehicleFind },
}));

jest.unstable_mockModule('../../../services/categoryMappingService.js', () => ({
  default: {
    initialized: true,
    initialize: async () => {},
    findCategory: () => null,
    buildChildIndex: () => new Map(),
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

const { default: SearchService } = await import('../../../services/searchService.js');

/**
 * Products p1..p4 as the aggregation would report them.
 *
 * p1 fits THREE BMW models and p2 fits two — the multi-fitment shape that the
 * old sum double-counted. Four distinct products carry BMW fitment; the fitment
 * slots number seven.
 */
const engineWith = (vehicleIdSets) => ({
  getFacets: async () => ({
    total: 5,
    brands: [],
    categoryIdSets: [],
    vehicleIdSets,
    price: { min: 0, max: 0, selectedMin: null, selectedMax: null, histogram: [] },
    ratings: [],
    availability: [],
  }),
});

const BMW_SPREAD = [
  { _id: 'v-bmw-5', ids: ['p1', 'p2', 'p3'] },
  { _id: 'v-bmw-3', ids: ['p1', 'p2'] },
  { _id: 'v-bmw-x', ids: ['p1', 'p4'] },
  { _id: 'v-toy-f', ids: ['p5'] },
];

const makeCount = (facets, value) =>
  facets.vehicleMakes.find((m) => m.value === value)?.count;

describe('getAtlasFacets — vehicle make roll-up', () => {
  it('counts a multi-fitment product ONCE per make', async () => {
    const facets = await SearchService.getAtlasFacets({}, engineWith(BMW_SPREAD));

    // 7 fitment slots across 4 distinct products. The sum-based roll-up said 7.
    expect(makeCount(facets, 'BMW')).toBe(4);
    expect(makeCount(facets, 'Toyota')).toBe(1);
  });

  it('never reports a make count above the result total', async () => {
    // The shape the user reported: a facet larger than the headline is always
    // wrong, whatever the catalogue looks like.
    const facets = await SearchService.getAtlasFacets({}, engineWith(BMW_SPREAD));
    for (const m of facets.vehicleMakes) {
      expect(m.count).toBeLessThanOrEqual(facets.total);
    }
  });

  it('keeps two makes that share a model name in separate buckets', async () => {
    // modelCounts was keyed on the model name alone, so same-named models merged
    // AND the later make overwrote the earlier, mislabelling the surviving row.
    const collide = [
      { _id: 'v-bmw-5', ids: ['p1'] },
      { _id: 'v-toy-f', ids: ['p2'] },
    ];
    const facets = await SearchService.getAtlasFacets(
      {},
      {
        getFacets: async () => ({
          ...(await engineWith(collide).getFacets()),
          vehicleIdSets: collide,
        }),
      }
    );

    const labels = facets.vehicleModels.map((m) => `${m.make}/${m.value}`);
    expect(labels).toContain('BMW/5 Series');
    expect(labels).toContain('Toyota/Fortuner');
  });

  it('scopes the model list to the selected make', async () => {
    // Unscoped, picking BMW still offered Fortuner — and that impossible pair
    // resolved to no vehicle ids at all, which prod served as the whole catalogue.
    const facets = await SearchService.getAtlasFacets(
      { vehicleMake: 'BMW' },
      engineWith(BMW_SPREAD)
    );

    expect(facets.vehicleModels.every((m) => m.make === 'BMW')).toBe(true);
    expect(facets.vehicleModels.map((m) => m.value)).not.toContain('Fortuner');
  });

  it('still lists every make when one is selected — the switcher stays usable', () => {
    // Disjunctive counting is deliberate: the dropdown is a single-select
    // switcher, so the OTHER makes must keep the count they would yield if
    // chosen. This is the behaviour that reads as a bug and is not one.
    return SearchService.getAtlasFacets({ vehicleMake: 'BMW' }, engineWith(BMW_SPREAD))
      .then((facets) => {
        expect(facets.vehicleMakes.map((m) => m.value)).toEqual(
          expect.arrayContaining(['BMW', 'Toyota'])
        );
        expect(facets.vehicleMakes.find((m) => m.value === 'BMW').selected).toBe(true);
      });
  });

  it('matches the selected make case-INSENSITIVELY, like the filter does', async () => {
    // resolveVehicleFilter keys the vehicle index on lowercase, so
    // ?vehicleMake=toyota really does filter the grid (255 products on prod). An
    // exact === here left the make unhighlighted AND — since models are scoped by
    // it — handed back an empty, disabled model dropdown for a working filter.
    const facets = await SearchService.getAtlasFacets(
      { vehicleMake: 'bmw' },
      engineWith(BMW_SPREAD)
    );

    expect(facets.vehicleModels.length).toBeGreaterThan(0);
    expect(facets.vehicleModels.every((m) => m.make === 'BMW')).toBe(true);
    expect(facets.vehicleMakes.find((m) => m.value === 'BMW').selected).toBe(true);
  });

  it('keeps every selected make when several are given as a comma list', async () => {
    // normalizeList accepts a CSV, and the grid honours it (BMW,Toyota = 294 on
    // prod). Scoping to a single string would have dropped one make's models.
    const facets = await SearchService.getAtlasFacets(
      { vehicleMake: 'BMW,Toyota' },
      engineWith(BMW_SPREAD)
    );

    const makes = new Set(facets.vehicleModels.map((m) => m.make));
    expect(makes).toEqual(new Set(['BMW', 'Toyota']));
    expect(facets.vehicleMakes.filter((m) => m.selected).map((m) => m.value).sort())
      .toEqual(['BMW', 'Toyota']);
  });

  it('marks the selected model case-insensitively too', async () => {
    const facets = await SearchService.getAtlasFacets(
      { vehicleMake: 'BMW', vehicleModel: '5 series' },
      engineWith(BMW_SPREAD)
    );
    expect(facets.vehicleModels.find((m) => m.value === '5 Series').selected).toBe(true);
  });

  it('omits makes whose vehicles are deactivated, rather than offering a dead end', async () => {
    // getVehicleIndex (which resolves the FILTER) only indexes isActive vehicles.
    // A make sourced from a deactivated row therefore showed a live count that
    // matched nothing when clicked.
    const facets = await SearchService.getAtlasFacets(
      {},
      engineWith([...BMW_SPREAD, { _id: 'v-gone', ids: ['p9'] }])
    );

    expect(makeCount(facets, 'Ghost')).toBeUndefined();
    expect(findCalls.at(-1)).toEqual(expect.objectContaining({ isActive: true }));
  });
});
