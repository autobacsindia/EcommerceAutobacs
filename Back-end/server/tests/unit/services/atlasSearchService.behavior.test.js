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
  /**
   * Each day now reads TWO sorted sets — `search:analytics:*` for volume and
   * `search:zero:*` for terms that found nothing. The mock dispatches on the key
   * rather than on call order, so these stay readable and do not silently
   * mis-assert if another read is ever added.
   */
  const byKey = (perDay) => {
    mockRedis.zrange.mockImplementation(async (key) => {
      const date = key.slice(key.lastIndexOf(':') + 1);
      const entry = perDay[date] || {};
      return key.startsWith('search:zero:') ? (entry.zero || []) : (entry.terms || []);
    });
  };

  it('sums a term across days and ranks by total', async () => {
    byKey({
      '2026-08-01': { terms: ['brake', '3', 'spoiler', '10'] },
      '2026-08-02': { terms: ['brake', '9'] },
    });

    const result = await atlasSearchService.getSearchAnalytics('2026-08-01', '2026-08-02');
    expect(result.popularTerms).toEqual([
      { term: 'brake', count: 12 },
      { term: 'spoiler', count: 10 },
    ]);
  });

  it('reports per-day volume for the histogram', async () => {
    byKey({
      '2026-08-01': { terms: ['brake', '3', 'spoiler', '10'] },
      '2026-08-02': { terms: ['brake', '9'] },
    });

    const result = await atlasSearchService.getSearchAnalytics('2026-08-01', '2026-08-02');
    expect(result.searchesOverTime).toEqual([
      { date: '2026-08-01', count: 13 },
      { date: '2026-08-02', count: 9 },
    ]);
  });

  it('ranks zero-result terms separately from popular ones', async () => {
    // The merchandising worklist: what people searched for and did not find. It
    // must NOT be mixed into popularTerms, which ranks demand regardless of outcome.
    byKey({
      '2026-08-01': { terms: ['roof tent', '5'], zero: ['roof tent', '5'] },
      '2026-08-02': { terms: ['brake', '8'], zero: ['roof tent', '2'] },
    });

    const result = await atlasSearchService.getSearchAnalytics('2026-08-01', '2026-08-02');
    expect(result.zeroResultTerms).toEqual([{ term: 'roof tent', count: 7 }]);
    expect(result.popularTerms).toEqual([
      { term: 'brake', count: 8 },
      { term: 'roof tent', count: 5 },
    ]);
  });

  it('caps the fan-out so an unbounded admin date range cannot storm Redis', async () => {
    await atlasSearchService.getSearchAnalytics('2000-01-01', '2030-01-01');
    // MAX_DAYS (180) days × 2 sorted sets. The bound that matters is the day cap;
    // without it an admin date range fans out to thousands of round trips.
    const days = new Set(mockRedis.zrange.mock.calls.map(([key]) => key.slice(key.lastIndexOf(':') + 1)));
    expect(days.size).toBeLessThanOrEqual(180);
    expect(mockRedis.zrange.mock.calls.length).toBeLessThanOrEqual(360);
  });

  it('returns empty rather than throwing on an invalid or inverted range', async () => {
    await expect(atlasSearchService.getSearchAnalytics('nonsense', 'also-nonsense'))
      .resolves.toEqual({ popularTerms: [], zeroResultTerms: [], searchesOverTime: [] });
    await expect(atlasSearchService.getSearchAnalytics('2026-08-05', '2026-08-01'))
      .resolves.toEqual({ popularTerms: [], zeroResultTerms: [], searchesOverTime: [] });
  });

  it('returns empty when Redis is not configured', async () => {
    redisAvailable = false;
    await expect(atlasSearchService.getSearchAnalytics('2026-08-01', '2026-08-02'))
      .resolves.toEqual({ popularTerms: [], zeroResultTerms: [], searchesOverTime: [] });
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

describe('zero-result relaxation', () => {
  /**
   * The retry ladder is worth exactly one extra round trip and no more, so what
   * matters is the CALL COUNT, not just the flag. These stub the aggregation
   * pipeline directly: mongodb-memory-server has no $search, and the point here is
   * the control flow around the engine, not the query shape (that is covered by
   * the query-builder tests).
   */
  const Product = mongoose.model('Product');
  let aggregateSpy;
  let searchStages;

  const stubResults = (totalsPerPass) => {
    let pass = 0;
    searchStages = [];
    aggregateSpy = jest.spyOn(Product.collection, 'aggregate').mockImplementation((pipeline) => {
      const stage = pipeline.find((p) => p.$search);
      if (stage) searchStages.push(stage.$search);
      // Each pass issues two aggregates (products + facets); the facet one carries
      // $facet. Pair them up so a pass yields one total.
      const isFacet = pipeline.some((p) => p.$facet);
      const total = totalsPerPass[Math.min(pass, totalsPerPass.length - 1)];
      if (isFacet) pass += 1;
      return { toArray: async () => (isFacet ? [{ total: total > 0 ? [{ value: total }] : [] }] : []) };
    });
  };

  afterEach(() => aggregateSpy?.mockRestore());

  it('retries ONCE with relaxed recall when a text query finds nothing', async () => {
    stubResults([0, 7]);
    const result = await atlasSearchService.searchProducts({ q: 'spoiler ferrari' });

    expect(result.relaxed).toBe(true);
    expect(result.relaxLevel).toBe(1);
    expect(result.pagination.total).toBe(7);
    // Two passes, two aggregates each.
    expect(aggregateSpy).toHaveBeenCalledTimes(4);
    // And the retry genuinely widened recall rather than re-running the same query.
    const minShould = searchStages.map((st) => st.compound.must[0].compound.should[0].compound.minimumShouldMatch);
    expect(minShould[0]).toBe(2);
    expect(minShould[minShould.length - 1]).toBe(1);
  });

  it('does NOT retry when the first pass already found results', async () => {
    // The guard that stops this feature silently doubling the cost of every search.
    stubResults([12]);
    const result = await atlasSearchService.searchProducts({ q: 'spoiler' });

    expect(result.relaxed).toBe(false);
    expect(result.relaxLevel).toBe(0);
    expect(aggregateSpy).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a filters-only browse that legitimately matches nothing', async () => {
    // No query text means an empty result is a real empty set, not a recall
    // failure — widening would return products the filters excluded.
    stubResults([0]);
    const result = await atlasSearchService.searchProducts({ brand: 'NoSuchBrand' });

    expect(result.relaxed).toBe(false);
    expect(aggregateSpy).toHaveBeenCalledTimes(2);
  });

  it('reports relaxed even when the retry also finds nothing', async () => {
    // An honest signal: the search was widened and there is still nothing, which is
    // what lets the UI show "no results" rather than "showing related results".
    stubResults([0, 0]);
    const result = await atlasSearchService.searchProducts({ q: 'zzzznonexistent' });

    expect(result.relaxed).toBe(true);
    expect(result.pagination.total).toBe(0);
    // 2 passes × 2 aggregates, PLUS the did-you-mean probe — which runs only after
    // relaxation has also failed, so it costs nothing on a search that worked.
    expect(aggregateSpy).toHaveBeenCalledTimes(5);
  });

  it('runs the correction probe ONLY after relaxation has also failed', async () => {
    // The probe is the third query a single search can trigger, so the guard that
    // it never runs on a successful search is worth pinning explicitly.
    stubResults([9]);
    const hit = await atlasSearchService.searchProducts({ q: 'winch' });
    expect(hit.corrections).toEqual([]);
    expect(aggregateSpy).toHaveBeenCalledTimes(2);

    aggregateSpy.mockRestore();
    stubResults([0, 0]);
    await atlasSearchService.searchProducts({ q: 'wnich' });
    expect(aggregateSpy).toHaveBeenCalledTimes(5);
  });
});

describe('logSearchQuery — the write half of search analytics', () => {
  /**
   * Context: SearchService.addToSearchHistory had NO callers anywhere in the
   * codebase, so nothing ever wrote these counters and the admin analytics screen
   * had always been empty while its read endpoints were fully wired. The caller
   * exists now (productController.getProducts), so these pin the contract it
   * depends on.
   */
  it('counts the term, lowercased, with bounded retention', async () => {
    await atlasSearchService.logSearchQuery('Brake Pads', 12);
    expect(mockRedis.zincrby).toHaveBeenCalledWith(expect.stringMatching(/^search:analytics:/), 1, 'brake pads');
    // 90 days, refreshed on write — bounded retention with no sweeper job.
    expect(mockRedis.expire).toHaveBeenCalledWith(expect.stringMatching(/^search:analytics:/), 90 * 24 * 60 * 60);
  });

  it('records a zero-result search in its OWN set', async () => {
    await atlasSearchService.logSearchQuery('roof tent', 0);
    const keys = mockRedis.zincrby.mock.calls.map(([key]) => key);
    expect(keys.some((k) => k.startsWith('search:analytics:'))).toBe(true);
    // Separate set: "what people search for" and "what they search for and do not
    // find" answer different questions and are read independently.
    expect(keys.some((k) => k.startsWith('search:zero:'))).toBe(true);
  });

  it('does NOT mark a search with results as a zero-result', async () => {
    await atlasSearchService.logSearchQuery('winch', 42);
    expect(mockRedis.zincrby.mock.calls.some(([key]) => key.startsWith('search:zero:'))).toBe(false);
  });

  it('claims nothing about the outcome when the count is unknown', async () => {
    // `null` means the caller did not tell us. Recording that as a zero-result
    // would invent a merchandising signal that nobody measured.
    await atlasSearchService.logSearchQuery('winch', null);
    expect(mockRedis.zincrby.mock.calls.some(([key]) => key.startsWith('search:zero:'))).toBe(false);
    expect(mockRedis.zincrby).toHaveBeenCalledWith(expect.stringMatching(/^search:analytics:/), 1, 'winch');
  });

  it('ignores an empty or whitespace-only term', async () => {
    await atlasSearchService.logSearchQuery('   ', 0);
    await atlasSearchService.logSearchQuery('', 0);
    expect(mockRedis.zincrby).not.toHaveBeenCalled();
  });

  it('never throws when Redis is unavailable — analytics must not fail a search', async () => {
    redisAvailable = false;
    await expect(atlasSearchService.logSearchQuery('winch', 0)).resolves.toBeUndefined();
  });

  it('swallows a Redis error rather than propagating it into the request', async () => {
    mockRedis.zincrby.mockRejectedValueOnce(new Error('READONLY'));
    await expect(atlasSearchService.logSearchQuery('winch', 0)).resolves.toBeUndefined();
  });
});

describe('getPopularTerms — feeds the autocomplete query lane', () => {
  it('sums a term across the requested window and ranks it', async () => {
    mockRedis.zrange.mockResolvedValue(['winch', '4']);
    const terms = await atlasSearchService.getPopularTerms(3, 10);
    // Same term on each of 3 days.
    expect(terms).toEqual([{ term: 'winch', count: 12 }]);
    expect(mockRedis.zrange).toHaveBeenCalledTimes(3);
  });

  it('returns empty rather than throwing when Redis is down', async () => {
    redisAvailable = false;
    await expect(atlasSearchService.getPopularTerms()).resolves.toEqual([]);
  });
});

describe('engine contract — the surface searchService depends on', () => {
  /**
   * Added after an optimization pass silently deleted getFacets and
   * shapeFacetResponse along with the dead facet branches it was meant to remove,
   * and the ENTIRE 2,629-test suite still passed — because every facet test
   * targeted the pure helper functions rather than the service surface. Only the
   * live verification script caught it, as "engine.getFacets is not a function".
   *
   * The lesson is the one this codebase is built around: pure-function tests do not
   * prove the thing they belong to still exists. This is the cheap structural guard.
   */
  const REQUIRED = [
    'isConnected',
    'searchProducts',
    'getFacets',
    'shapeFacetResponse',
    'getIndexedDocumentCount',
    'getSearchSuggestions',
    'suggestCorrection',
    'logSearchQuery',
    'getPopularTerms',
    'getSearchAnalytics',
    'getIndexCapabilities',
    'buildFacetPipeline',
    'sanitizeQuery',
    'shutdown',
    'getConnectionStatus',
  ];

  it.each(REQUIRED)('exposes %s()', (method) => {
    expect(typeof atlasSearchService[method]).toBe('function');
  });

  it('returns the full facet contract shape from shapeFacetResponse', () => {
    // The filter panel renders values, counts, ordering AND price bounds from this
    // one response, so a missing key is a silently empty sidebar group.
    const shaped = atlasSearchService.shapeFacetResponse({
      total: 3,
      brands: [{ _id: 'Auxbeam', count: 2 }],
      categories: [],
      vehicles: [],
      priceStats: { min: 100, max: 5000, prices: [100, 2000, 5000] },
      ratings: { r4: 1, r3: 2, r2: 2, r1: 3 },
      availability: [{ _id: 'in', count: 2 }, { _id: 'out', count: 1 }],
      params: {},
    });

    expect(shaped).toMatchObject({
      total: 3,
      brands: [{ name: 'Auxbeam', value: 'Auxbeam', label: 'Auxbeam', count: 2, selected: false }],
      price: { min: 100, max: 5000 },
    });
    expect(shaped.price.histogram.length).toBeGreaterThan(1);
    expect(shaped.ratings).toHaveLength(4);
    // Availability counts only what is purchasable — `out` is excluded.
    expect(shaped.availability[0].count).toBe(2);
  });

  it('marks the selected brand and sorts it first', () => {
    const shaped = atlasSearchService.shapeFacetResponse({
      total: 10,
      brands: [{ _id: 'Popular', count: 50 }, { _id: 'Chosen', count: 2 }],
      categories: [], vehicles: [], priceStats: null, ratings: null, availability: [],
      params: { brand: 'chosen' },
    });
    // Selected-first: a checked box must not jump down the list as counts change.
    expect(shaped.brands[0]).toMatchObject({ label: 'Chosen', selected: true });
  });
});

describe('did-you-mean lives on the RESULTS path, not the keystroke path', () => {
  /**
   * Two regressions are pinned here.
   *
   * (1) The correction logic was originally wired only into searchProducts while
   *     the search page fetched corrections from /products/suggestions — so the
   *     feature worked in the service, was verified in the service, and reached
   *     the user as a permanently empty array.
   *
   * (2) The first fix moved the probe INTO the suggestions endpoint, gated on
   *     `suggestions.length === 0`. That gate is not a search signal: the
   *     popular-query lane pads the list from logged search terms, and
   *     logSearchQuery records misspellings too. So once one shopper searched
   *     "wnich rope", every later "wnich" would have a non-empty suggestion list
   *     and the correction would be suppressed — the more a typo was searched, the
   *     more reliably its correction vanished.
   *
   * The resolution is structural: corrections come from the results path, gated on
   * the real hit count, and the per-keystroke endpoint returns none.
   */
  const Product = mongoose.model('Product');
  let aggregateSpy;
  afterEach(() => aggregateSpy?.mockRestore());

  it('never probes for corrections on the suggestions endpoint', async () => {
    // Even with an empty dropdown on a long query — the case that used to trigger
    // it — the keystroke path must issue no correction probe.
    aggregateSpy = jest.spyOn(Product.collection, 'aggregate').mockImplementation((pipeline) => {
      if (pipeline.some((p) => p.$searchMeta)) return { toArray: async () => [{ count: { lowerBound: 0 } }] };
      return { toArray: async () => [] };
    });

    const result = await atlasSearchService.getSearchSuggestions('wnich', 6);
    expect(result.corrections).toEqual([]);
    // Exactly one $search (the suggestion query) — no second probe.
    const searchCalls = aggregateSpy.mock.calls.filter(([p]) => p.some((st) => st.$search));
    expect(searchCalls).toHaveLength(1);
  });

  it('is immune to popular-term pollution, because it no longer gates on suggestions', async () => {
    // The self-reinforcing bug: a logged misspelling padding the dropdown must not
    // be able to influence whether a correction is offered.
    mockRedis.zrange.mockResolvedValue(['wnich rope', '9']);
    aggregateSpy = jest.spyOn(Product.collection, 'aggregate').mockImplementation((pipeline) => {
      if (pipeline.some((p) => p.$searchMeta)) return { toArray: async () => [{ count: { lowerBound: 0 } }] };
      return { toArray: async () => [] };
    });

    const result = await atlasSearchService.getSearchSuggestions('wnich', 6);
    // The popular term still surfaces as a query suggestion...
    expect(result.suggestions.some((x) => x.type === 'query')).toBe(true);
    // ...and corrections are unaffected either way, because they are not computed here.
    expect(result.corrections).toEqual([]);
  });
});

describe('suggestCorrection — probe preconditions', () => {
  it('does not query at all when no token is long enough to correct', async () => {
    // "h4 blb" is six characters, but pickCorrection only considers tokens of 4+,
    // so a whole-string length check would fire a maxEdits:2 fuzzy query that
    // structurally cannot return a result.
    const spy = jest.spyOn(mongoose.model('Product').collection, 'aggregate');
    await expect(atlasSearchService.suggestCorrection('h4 blb')).resolves.toEqual([]);
    await expect(atlasSearchService.suggestCorrection('a b c')).resolves.toEqual([]);
    await expect(atlasSearchService.suggestCorrection('')).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('swallows a probe failure rather than failing the search that triggered it', async () => {
    const spy = jest.spyOn(mongoose.model('Product').collection, 'aggregate')
      .mockImplementation(() => ({ toArray: async () => { throw new Error('atlas exploded'); } }));
    await expect(atlasSearchService.suggestCorrection('wnich')).resolves.toEqual([]);
    spy.mockRestore();
  });
});
