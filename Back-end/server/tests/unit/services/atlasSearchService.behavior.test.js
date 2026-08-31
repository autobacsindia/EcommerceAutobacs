import { jest } from '@jest/globals';
import mongoose from 'mongoose';

/**
 * Behaviour of the Atlas adapter's non-query surface: the readiness signal
 * searchService's fallback ladder depends on, and the Redis-backed analytics that
 * replace the Elasticsearch `search_analytics` index.
 */

const mockRedis = {
  zincrby: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  zrange: jest.fn().mockResolvedValue([]),
};
let redisAvailable = true;

jest.unstable_mockModule('../../../services/cacheService.js', () => ({
  getRedisClient: () => (redisAvailable ? mockRedis : null),
  default: {},
  CACHE_VERSION: 1,
  CACHE_CONFIG: {},
  TTL: {},
}));

const { default: atlasSearchService } = await import('../../../services/atlasSearchService.js');

beforeEach(() => {
  redisAvailable = true;
  mockRedis.zincrby.mockClear().mockResolvedValue(1);
  mockRedis.expire.mockClear().mockResolvedValue(1);
  mockRedis.zrange.mockClear().mockResolvedValue([]);
  atlasSearchService.__resetReadiness();
});

describe('readiness — what searchService fallback depends on', () => {
  it('reports unavailable, and does NOT throw, on a deployment without Atlas Search', () => {
    // mongodb-memory-server has no $search. listSearchIndexes is unsupported
    // there, which must resolve quietly to "use the MongoDB fallback" rather
    // than logging an error on every single request.
    return expect(atlasSearchService.isConnected()).resolves.toBe(false);
  });

  it('records the unsupported status rather than pretending the index is missing', async () => {
    await atlasSearchService.isConnected();
    expect(atlasSearchService.getConnectionStatus()).toMatchObject({
      engine: 'atlas',
      available: false,
      status: 'UNSUPPORTED',
    });
  });

  it('reports unavailable when the Mongo connection itself is down', async () => {
    // Assignment, not defineProperty: mongoose exposes readyState through a
    // prototype setter, and redefining it as a data property leaves it read-only
    // so mongoose's own teardown (`conn.readyState = disconnected`) then throws.
    const original = mongoose.connection.readyState;
    try {
      mongoose.connection.readyState = 0;
      await expect(atlasSearchService.isConnected()).resolves.toBe(false);
    } finally {
      mongoose.connection.readyState = original;
    }
  });

  it('returns a NULL document count when the index is unavailable', async () => {
    // Load-bearing. searchService treats null as "unknown", which fails TOWARDS
    // the expensive-but-correct MongoDB scan rather than towards showing an
    // empty catalogue to a shopper.
    await expect(atlasSearchService.getIndexedDocumentCount()).resolves.toBeNull();
  });
});

describe('logSearchQuery — Redis counters, never Mongo documents', () => {
  it('increments a per-day sorted set instead of inserting a document', async () => {
    await atlasSearchService.logSearchQuery('Brake Pads');
    expect(mockRedis.zincrby).toHaveBeenCalledTimes(1);
    const [key, increment, member] = mockRedis.zincrby.mock.calls[0];
    expect(key).toMatch(/^search:analytics:\d{4}-\d{2}-\d{2}$/);
    expect(increment).toBe(1);
    expect(member).toBe('brake pads');
  });

  it('collapses repeat searches onto ONE member rather than N rows', async () => {
    // This is the whole point. One document per search is the shape that made
    // rate_limit_events 95% of the database and forced an Atlas tier upgrade.
    await atlasSearchService.logSearchQuery('brake');
    await atlasSearchService.logSearchQuery('BRAKE');
    await atlasSearchService.logSearchQuery('brake');
    const members = new Set(mockRedis.zincrby.mock.calls.map((c) => c[2]));
    expect(members).toEqual(new Set(['brake']));
  });

  it('creates no MongoDB collection for search telemetry', async () => {
    await atlasSearchService.logSearchQuery('brake pads');
    const names = (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name);
    expect(names.filter((n) => /search.*analytic|analytic.*search/i.test(n))).toEqual([]);
  });

  it('bounds retention on the key so no sweeper job is needed', async () => {
    await atlasSearchService.logSearchQuery('brake');
    const [, ttl] = mockRedis.expire.mock.calls[0];
    expect(ttl).toBe(90 * 24 * 60 * 60);
  });

  it('ignores empty and whitespace-only queries', async () => {
    await atlasSearchService.logSearchQuery('');
    await atlasSearchService.logSearchQuery('   ');
    await atlasSearchService.logSearchQuery(null);
    expect(mockRedis.zincrby).not.toHaveBeenCalled();
  });

  it('never fails a search because analytics failed', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockRedis.zincrby.mockRejectedValue(new Error('redis down'));
    await expect(atlasSearchService.logSearchQuery('brake')).resolves.toBeUndefined();
    // Swallowed, but never silently — a dead counter should still be diagnosable.
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('is a no-op when Redis is not configured', async () => {
    redisAvailable = false;
    await expect(atlasSearchService.logSearchQuery('brake')).resolves.toBeUndefined();
  });
});

describe('getSearchAnalytics', () => {
  it('sums a term across days and ranks by total', async () => {
    mockRedis.zrange
      .mockResolvedValueOnce(['brake', '3', 'spoiler', '10'])
      .mockResolvedValueOnce(['brake', '9']);

    const result = await atlasSearchService.getSearchAnalytics('2026-08-01', '2026-08-02');
    expect(result.popularTerms).toEqual([
      { term: 'brake', count: 12 },
      { term: 'spoiler', count: 10 },
    ]);
  });

  it('reports per-day volume for the histogram', async () => {
    mockRedis.zrange
      .mockResolvedValueOnce(['brake', '3', 'spoiler', '10'])
      .mockResolvedValueOnce(['brake', '9']);

    const result = await atlasSearchService.getSearchAnalytics('2026-08-01', '2026-08-02');
    expect(result.searchesOverTime).toEqual([
      { date: '2026-08-01', count: 13 },
      { date: '2026-08-02', count: 9 },
    ]);
  });

  it('caps the fan-out so an unbounded admin date range cannot storm Redis', async () => {
    await atlasSearchService.getSearchAnalytics('2000-01-01', '2030-01-01');
    expect(mockRedis.zrange.mock.calls.length).toBeLessThanOrEqual(180);
  });

  it('returns empty rather than throwing on an invalid or inverted range', async () => {
    await expect(atlasSearchService.getSearchAnalytics('nonsense', 'also-nonsense'))
      .resolves.toEqual({ popularTerms: [], searchesOverTime: [] });
    await expect(atlasSearchService.getSearchAnalytics('2026-08-05', '2026-08-01'))
      .resolves.toEqual({ popularTerms: [], searchesOverTime: [] });
  });

  it('returns empty when Redis is not configured', async () => {
    redisAvailable = false;
    await expect(atlasSearchService.getSearchAnalytics('2026-08-01', '2026-08-02'))
      .resolves.toEqual({ popularTerms: [], searchesOverTime: [] });
  });

  it('limits popular terms to 20, as the Elasticsearch aggregation did', async () => {
    const flat = [];
    for (let i = 0; i < 50; i += 1) flat.push(`term${i}`, String(i));
    mockRedis.zrange.mockResolvedValue(flat);
    const result = await atlasSearchService.getSearchAnalytics('2026-08-01', '2026-08-01');
    expect(result.popularTerms).toHaveLength(20);
  });
});

describe('shapeFacets — response parity with the Elasticsearch aggregations', () => {
  it('maps buckets into the shape the storefront sidebar already consumes', () => {
    const facets = atlasSearchService.shapeFacets(
      {
        categories: [{ _id: 'Brakes', count: 4 }],
        brands: [{ _id: 'Auxbeam', count: 7 }],
        vehicleTypes: [{ _id: 'Toyota', count: 3 }],
        priceRanges: [{ _id: 'p1', count: 2 }],
        ratingRanges: [{ _id: 'r4', count: 5 }],
      },
      9,
      {}
    );

    expect(facets.categories).toEqual([{ name: 'Brakes', count: 4 }]);
    expect(facets.brands).toEqual([{ name: 'Auxbeam', count: 7 }]);
    expect(facets.vehicleTypes).toEqual([{ name: 'Toyota', count: 3 }]);
    expect(facets.availability).toEqual([{ name: true, count: 9 }]);
  });

  it('zero-fills range buckets that matched nothing instead of dropping them', () => {
    // A missing bucket would make the sidebar's rows shift between searches.
    const facets = atlasSearchService.shapeFacets({ priceRanges: [{ _id: 'p1', count: 2 }] }, 2, {});
    expect(facets.priceRanges).toEqual([
      { from: undefined, to: 50, count: 0 },
      { from: 50, to: 100, count: 2 },
      { from: 100, to: 200, count: 0 },
      { from: 200, to: 500, count: 0 },
      { from: 500, to: undefined, count: 0 },
    ]);
  });

  it('survives an entirely empty facet result', () => {
    const facets = atlasSearchService.shapeFacets({}, 0, {});
    expect(facets.categories).toEqual([]);
    expect(facets.ratingRanges).toHaveLength(5);
    expect(facets.ratingRanges.every((b) => b.count === 0)).toBe(true);
  });
});
