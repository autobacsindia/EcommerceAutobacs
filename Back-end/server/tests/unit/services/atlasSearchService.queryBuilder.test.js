import {
  fuzzyFor,
  minimumTokensRequired,
  buildTokenClause,
  buildRecall,
  buildFilters,
  buildSearchStage,
  normalizeList,
  bucketSwitch,
  PRICE_BUCKETS,
  RATING_BUCKETS,
  HIGH_SIGNAL_FIELDS,
} from '../../../services/atlasSearchService.js';

/**
 * Parity guards for the Elasticsearch → Atlas Search port.
 *
 * These assert the PRECISION properties the Elasticsearch query was painstakingly
 * tuned for — the ones whose loss produced "151 results for spoiler" and
 * "?brand=Auxbeam matches 0 of 44". They are written against the query BUILDERS
 * rather than a live cluster on purpose: the builders are pure, so a regression
 * is caught in CI instead of on a storefront.
 */

describe('fuzzyFor — Elasticsearch AUTO:5,8 parity', () => {
  it('keeps sub-5-character tokens EXACT so "thor" never fuzzes into "thar"', () => {
    expect(fuzzyFor('thor')).toBeNull();
    expect(fuzzyFor('led')).toBeNull();
    expect(fuzzyFor('abcd')).toBeNull();
  });

  it('allows one edit for 5-8 characters and two beyond that', () => {
    expect(fuzzyFor('brake')).toMatchObject({ maxEdits: 1 });
    expect(fuzzyFor('bumpers8')).toMatchObject({ maxEdits: 1 });
    expect(fuzzyFor('floorliner')).toMatchObject({ maxEdits: 2 });
  });

  it('pins the first two characters so short tokens cannot drift across words', () => {
    expect(fuzzyFor('brake').prefixLength).toBe(2);
    expect(fuzzyFor('floorliner').prefixLength).toBe(2);
  });

  it('never emits maxEdits: 0, which Atlas rejects outright', () => {
    for (const word of ['a', 'ab', 'abc', 'abcd', 'brake', 'floorliner']) {
      const fuzzy = fuzzyFor(word);
      if (fuzzy !== null) expect(fuzzy.maxEdits).toBeGreaterThan(0);
    }
  });
});

describe('minimumTokensRequired — Elasticsearch "2<70%" parity', () => {
  it('requires ALL tokens when there are at most two', () => {
    expect(minimumTokensRequired(1)).toBe(1);
    expect(minimumTokensRequired(2)).toBe(2);
  });

  it('ROUNDS DOWN beyond two tokens, as Elasticsearch does', () => {
    // The regression this pins: Math.ceil(3 * 0.7) === 3 would require every
    // token of a 3-word query, removing the one-missing-word tolerance the rule
    // exists to provide. Elasticsearch rounds percentages down.
    expect(minimumTokensRequired(3)).toBe(2);
    expect(minimumTokensRequired(4)).toBe(2);
    expect(minimumTokensRequired(5)).toBe(3);
    expect(minimumTokensRequired(10)).toBe(7);
  });

  it('tolerates exactly one missing word on a three-token query', () => {
    expect(minimumTokensRequired(3)).toBe(3 - 1);
  });

  it('never demands zero clauses', () => {
    for (let n = 1; n <= 20; n += 1) {
      expect(minimumTokensRequired(n)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('buildTokenClause — one token counts as exactly one clause', () => {
  it('nests per-field alternatives so a single token cannot satisfy a multi-token minimum', () => {
    // The OR-explosion guard. A FLAT list of (token × field) clauses would let
    // one token matching name+brand+sku satisfy minimumShouldMatch: 3.
    const clause = buildTokenClause('brake');
    expect(clause.compound.minimumShouldMatch).toBe(1);
    expect(clause.compound.should).toHaveLength(HIGH_SIGNAL_FIELDS.length);
    expect(Object.keys(clause)).toEqual(['compound']);
  });

  it('carries the Elasticsearch field weights through unchanged', () => {
    const boosts = Object.fromEntries(
      buildTokenClause('brake').compound.should.map((c) => [c.text.path, c.text.score.boost.value])
    );
    expect(boosts).toEqual({ name: 3, brand: 2, sku: 2, tags: 1.5 });
  });

  it('omits the fuzzy key entirely for short tokens rather than sending null', () => {
    // The driver serializes undefined as null and Atlas rejects a null fuzzy.
    const clause = buildTokenClause('led');
    for (const c of clause.compound.should) {
      expect(c.text).not.toHaveProperty('fuzzy');
    }
  });

  it('can be built without fuzziness for the exact-match recall lane', () => {
    const clause = buildTokenClause('floorliner', { fuzzy: false });
    for (const c of clause.compound.should) {
      expect(c.text).not.toHaveProperty('fuzzy');
    }
  });

  it('excludes `description` from every recall field — it is ranking-only', () => {
    // Long SEO-stuffed descriptions share common words across nearly the whole
    // catalogue; letting them widen the match set is the over-recall bug.
    const paths = buildTokenClause('brake').compound.should.map((c) => c.text.path);
    expect(paths).not.toContain('description');
  });
});

describe('buildRecall — lane structure', () => {
  it('emits a fuzzy-partial lane and an exact-complete lane for text queries', () => {
    const lanes = buildRecall({ tokens: ['tailgate', 'spoiler', 'hilux'] });
    const compoundLanes = lanes.filter((l) => l.compound);
    expect(compoundLanes).toHaveLength(2);
    expect(compoundLanes[0].compound.minimumShouldMatch).toBe(2); // 70% of 3, floored
    expect(compoundLanes[1].compound.minimumShouldMatch).toBe(3); // all tokens, exact
  });

  it('matches categories and vehicles by ObjectId, never by denormalized name', () => {
    // This is what makes the ES category-slug drift structurally impossible:
    // the filter now compares the identifiers MongoDB itself compares.
    const lanes = buildRecall({ tokens: [], categoryIds: ['a'], vehicleIds: ['b'] });
    const paths = lanes.filter((l) => l.in).map((l) => l.in.path);
    expect(paths).toEqual(expect.arrayContaining(['categories', 'compatibleVehicles']));
  });

  it('adds a name lane for each synonym, not just a category lane', () => {
    // ES paired every synonym category match with a name match, because a synonym
    // often names a product directly ("lamp" -> "LED Lamp").
    const lanes = buildRecall({ tokens: ['lights'], synonymTerms: ['lamp', 'lamps'] });
    const nameLanes = lanes.filter((l) => l.text && l.text.path === 'name');
    expect(nameLanes.map((l) => l.text.query)).toEqual(['lamp', 'lamps']);
  });

  it('produces no lanes at all for an empty query, leaving filters to define the set', () => {
    expect(buildRecall({ tokens: [] })).toEqual([]);
  });
});

describe('buildFilters — visibility and narrowing', () => {
  it('ALWAYS filters to active products on a public query', () => {
    // Load-bearing. Elasticsearch only ever indexed active products, so "absent
    // from the index" WAS the visibility rule. Atlas indexes drafts too, so
    // dropping this publishes every unpublished draft to the storefront.
    const { filter } = buildFilters({});
    expect(filter).toContainEqual({ equals: { path: 'isActive', value: true } });
  });

  it('lifts the active filter only for an explicit admin listing', () => {
    const { filter } = buildFilters({ includeInactive: true });
    expect(filter).not.toContainEqual({ equals: { path: 'isActive', value: true } });
  });

  it('lowercases brand values to match the index normalizer', () => {
    // The token field carries a lowercase normalizer; breaking the pair matches
    // nothing at all, which is how "?brand=Auxbeam matched 0 of 44" happened.
    const { filter } = buildFilters({ brand: 'Auxbeam,Roav 4x4' });
    const brandFilter = filter.find((f) => f.in?.path === 'brand');
    expect(brandFilter.in.value).toEqual(['auxbeam', 'roav 4x4']);
  });

  it('distinguishes "no vehicle filter" from "a vehicle filter that matched nothing"', () => {
    // Collapsing these would answer with the WHOLE catalogue as though nothing
    // were selected — the exact failure the vehicleType/vehicleMake param
    // mismatch produced.
    const none = buildFilters({}, { vehicleFilterIds: null });
    expect(none.filter.some((f) => f.in?.path === 'compatibleVehicles')).toBe(false);
    expect(none.mustNot).toEqual([]);

    const unmatched = buildFilters({}, { vehicleFilterIds: [] });
    expect(unmatched.mustNot).toContainEqual({ exists: { path: '_id' } });
  });

  it('excludes both out AND backorder for "in stock only"', () => {
    const { mustNot } = buildFilters({ inStock: 'true' });
    expect(mustNot).toContainEqual({ in: { path: 'stock', value: ['out', 'backorder'] } });
  });

  it('treats a rating filter as a floor at the highest selected value', () => {
    const { filter } = buildFilters({ rating: '2,4,3' });
    expect(filter).toContainEqual({ range: { path: 'averageRating', gte: 4 } });
  });

  it('applies price bounds independently', () => {
    expect(buildFilters({ minPrice: 50 }).filter).toContainEqual({ range: { path: 'price', gte: 50 } });
    expect(buildFilters({ maxPrice: 500 }).filter).toContainEqual({ range: { path: 'price', lte: 500 } });
  });

  it('ignores empty and whitespace-only filter values', () => {
    const { filter } = buildFilters({ brand: ' , ,' });
    expect(filter.some((f) => f.in?.path === 'brand')).toBe(false);
  });
});

describe('buildSearchStage', () => {
  it('omits sort for a relevance query so Atlas ranks by score', () => {
    const stage = buildSearchStage({ sortBy: 'createdAt' }, { tokens: ['brake'], cleanedQuery: 'brake' });
    expect(stage).not.toHaveProperty('sort');
  });

  it('sorts explicitly when a non-default sort is requested', () => {
    const stage = buildSearchStage({ sortBy: 'price', order: 'asc' }, { tokens: ['brake'], cleanedQuery: 'brake' });
    expect(stage.sort).toEqual({ price: 1 });
  });

  it('sorts by recency when browsing without a query', () => {
    const stage = buildSearchStage({ sortBy: 'createdAt' }, { tokens: [], cleanedQuery: null });
    expect(stage.sort).toEqual({ createdAt: -1 });
  });

  it('always produces a non-empty compound, which Atlas requires', () => {
    // A query-less, filter-less browse still carries the isActive filter, so the
    // compound can never be empty.
    const stage = buildSearchStage({}, { tokens: [], cleanedQuery: null });
    const clauseCount = Object.values(stage.compound).flat().length;
    expect(clauseCount).toBeGreaterThan(0);
    expect(stage.compound.filter.length).toBeGreaterThan(0);
  });

  it('keeps ranking clauses OUT of must so they cannot widen the match set', () => {
    const stage = buildSearchStage({}, { tokens: ['brake'], cleanedQuery: 'brake' });
    const mustJson = JSON.stringify(stage.compound.must);
    expect(mustJson).not.toContain('description');
    expect(stage.compound.should.some((c) => c.text?.path === 'description')).toBe(true);
  });

  it('models popularity additively, never multiplicatively', () => {
    // ES needed boost_mode:'sum' because the multiplicative default annihilated
    // text relevance for products with no reviews and a 0 rating. An Atlas
    // compound sums its matching clauses, so each signal is its own should.
    const stage = buildSearchStage({}, { tokens: ['brake'], cleanedQuery: 'brake' });
    expect(stage.compound.should).toContainEqual(
      expect.objectContaining({ equals: { path: 'isFastMoving', value: true } })
    );
    const scored = stage.compound.should.filter((c) => c.score?.function);
    expect(scored.length).toBeGreaterThanOrEqual(2);
  });
});

describe('bucketSwitch — facet boundaries', () => {
  it('tests boundaries smallest-first regardless of table display order', () => {
    // RATING_BUCKETS is declared best-first (4+ at the top, as the sidebar shows
    // it). Without an ascending sort the first branch tested would be `$lt 4`,
    // and every 0.5-star product would be counted in the 3-4 bucket.
    const branches = bucketSwitch('$averageRating', RATING_BUCKETS).$switch.branches;
    const boundaries = branches.map((b) => b.case.$lt[1]);
    expect(boundaries).toEqual([...boundaries].sort((a, b) => a - b));
    expect(branches[0].then).toBe('r0');
  });

  it('routes a low rating to the lowest bucket, not the first-declared one', () => {
    const branches = bucketSwitch('$averageRating', RATING_BUCKETS).$switch.branches;
    const firstMatch = branches.find((b) => 0.5 < b.case.$lt[1]);
    expect(firstMatch.then).toBe('r0');
  });

  it('sends everything above the last boundary to the open-ended bucket', () => {
    expect(bucketSwitch('$price', PRICE_BUCKETS).$switch.default).toBe('p4');
    expect(bucketSwitch('$averageRating', RATING_BUCKETS).$switch.default).toBe('r4');
  });

  it('keeps price boundaries matching the Elasticsearch range aggregation', () => {
    expect(PRICE_BUCKETS.map((b) => [b.from, b.to])).toEqual([
      [undefined, 50], [50, 100], [100, 200], [200, 500], [500, undefined],
    ]);
  });
});

describe('normalizeList', () => {
  it('accepts a scalar, an array, or a comma-separated list', () => {
    expect(normalizeList('a')).toEqual(['a']);
    expect(normalizeList(['a', 'b'])).toEqual(['a', 'b']);
    expect(normalizeList('a, b ,c')).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty list for absent or blank input', () => {
    expect(normalizeList(undefined)).toEqual([]);
    expect(normalizeList(null)).toEqual([]);
    expect(normalizeList('')).toEqual([]);
    expect(normalizeList('  ,  ')).toEqual([]);
  });
});
