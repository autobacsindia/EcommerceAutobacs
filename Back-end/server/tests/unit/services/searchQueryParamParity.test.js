import { jest } from '@jest/globals';

/**
 * `?q=` and `?search=` must mean the same thing on EVERY path.
 *
 * The storefront sends `q`. `buildBaseQuery` — the shared filter builder behind
 * both the MongoDB grid fallback and the MongoDB facet fallback — read `search`
 * only, so `?q=winch` built the filter `{ isActive: true }` and matched the entire
 * catalogue. Two user-visible surfaces, one missing alias.
 *
 * These assert on the BUILT FILTER rather than on results, so they need no data
 * and cannot be satisfied by a coincidence in the fixtures.
 */

jest.unstable_mockModule('../../../services/elasticsearchService.js', () => ({
  default: { isConnected: jest.fn(), searchProducts: jest.fn(), getIndexedDocumentCount: jest.fn() },
}));

jest.unstable_mockModule('../../../services/categoryMappingService.js', () => ({
  default: {
    initialized: true,
    initialize: jest.fn(),
    findCategory: jest.fn(() => null),
    getAllCategoryIdsIncludingChildren: jest.fn(async () => []),
    getAllCategorySlugsIncludingChildren: jest.fn(async () => []),
    buildChildIndex: jest.fn(() => new Map()),
  },
}));

jest.unstable_mockModule('../../../models/Product.js', () => ({
  default: { find: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn() },
}));

jest.unstable_mockModule('../../../models/Vehicle.js', () => ({
  default: { find: jest.fn(() => ({ select: () => ({ lean: () => ({ maxTimeMS: async () => [] }) }) })) },
}));

const { default: SearchService } = await import('../../../services/searchService.js');

describe('buildBaseQuery — the storefront\'s `q` is honoured, not just `search`', () => {
  it('builds an IDENTICAL filter for ?q= and ?search=', async () => {
    // The regression test. Before 2026-09-16 the `q` form produced `{isActive:true}`
    // — no text clause at all — so this assertion failed with the whole catalogue on
    // one side and a real query on the other.
    const [viaQ, viaSearch] = await Promise.all([
      SearchService.buildBaseQuery({ q: 'winch' }),
      SearchService.buildBaseQuery({ search: 'winch' }),
    ]);
    expect(viaQ).toEqual(viaSearch);
  });

  it('actually applies a text clause for ?q=, rather than matching everything', async () => {
    // Guards against the above passing vacuously if BOTH forms ever regress to
    // "no text clause" — equal, but equally wrong.
    const query = await SearchService.buildBaseQuery({ q: 'winch' });
    expect(query.$or).toBeDefined();
    expect(query.$or.length).toBeGreaterThan(0);
    expect(query.isActive).toBe(true);
  });

  it('keeps a filters-only browse free of any text clause', async () => {
    const query = await SearchService.buildBaseQuery({ minPrice: 1000 });
    expect(query.$or).toBeUndefined();
    expect(query.price).toEqual({ $gte: 1000 });
  });

  it('prefers `q` when a caller passes both', async () => {
    const both = await SearchService.buildBaseQuery({ q: 'winch', search: 'spoiler' });
    const qOnly = await SearchService.buildBaseQuery({ q: 'winch' });
    expect(both).toEqual(qOnly);
  });

  it('treats an ARRAY `q` as absent instead of feeding it to the regex builder', async () => {
    // `?q=a&q=b` arrives as an array. escapeRegex calls .replace on it, so passing it
    // through would throw a TypeError on a public endpoint.
    await expect(SearchService.buildBaseQuery({ q: ['a', 'b'] })).resolves.toBeDefined();
    const query = await SearchService.buildBaseQuery({ q: ['a', 'b'] });
    expect(query.$or).toBeUndefined();
  });

  it('never lifts the active filter, whichever parameter carried the term', async () => {
    for (const params of [{ q: 'winch' }, { search: 'winch' }, {}]) {
      // eslint-disable-next-line no-await-in-loop
      const query = await SearchService.buildBaseQuery(params);
      expect(query.isActive).toBe(true);
    }
  });
});
