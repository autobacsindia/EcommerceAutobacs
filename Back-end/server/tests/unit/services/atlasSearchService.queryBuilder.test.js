import {
  fuzzyFor,
  minimumTokensRequired,
  requiredTokensForLevel,
  relaxationLadder,
  buildTokenClause,
  buildRecall,
  buildFilters,
  buildSearchStage,
  normalizeList,
  bucketSwitch,
  PRICE_BUCKETS,
  RATING_BUCKETS,
  HIGH_SIGNAL_FIELDS,
  buildRankingShould,
  buildSynonymClause,
} from '../../../services/atlasSearchService.js';
import SearchService from '../../../services/searchService.js';
import { NON_PURCHASABLE_STOCK, PURCHASABLE_STOCK } from '../../../utils/stockStatus.js';

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

describe('requiredTokensForLevel — the relaxation ladder', () => {
  it('rung 0 requires EVERY token — the fix for "bmw steering wheel"', () => {
    // The bug: at 3 tokens the old default required only 2, so steering+wheel
    // alone admitted every steering wheel in the catalogue and the brand the
    // shopper typed became optional. Measured on prod before the fix:
    //   "bmw steering"       (2 tokens, all required) → 10 results
    //   "bmw steering wheel" (3 tokens, 2 required)   → 38 results
    // A MORE specific query returning a 4x LARGER set is the signature.
    expect(requiredTokensForLevel(3, 0)).toBe(3);
    expect(requiredTokensForLevel(5, 0)).toBe(5);
    expect(requiredTokensForLevel(10, 0)).toBe(10);
  });

  it('rung 1 is the old Elasticsearch 2<70% rule, demoted to a fallback', () => {
    expect(requiredTokensForLevel(3, 1)).toBe(minimumTokensRequired(3));
    expect(requiredTokensForLevel(5, 1)).toBe(minimumTokensRequired(5));
    expect(requiredTokensForLevel(10, 1)).toBe(minimumTokensRequired(10));
  });

  it('rung 2 accepts any single token — the last resort', () => {
    expect(requiredTokensForLevel(3, 2)).toBe(1);
    expect(requiredTokensForLevel(10, 2)).toBe(1);
  });

  it('defaults to the STRICT rung when no level is supplied', () => {
    // Anything that forgets to pass a level must get the safe, narrow query —
    // never the widened one.
    expect(requiredTokensForLevel(4)).toBe(4);
  });

  it('asks for nothing when there are no tokens', () => {
    expect(requiredTokensForLevel(0, 0)).toBe(0);
    expect(requiredTokensForLevel(0, 2)).toBe(0);
  });

  it('widens MONOTONICALLY, which is what guarantees no new empty pages', () => {
    // The safety property: rung 1 IS the pre-2026-09-16 default and rung 2 is
    // wider still, so every query that returned results before still returns
    // them at some rung. Tightening rung 0 can only reorder WHEN they appear,
    // never remove them.
    for (let n = 1; n <= 20; n += 1) {
      expect(requiredTokensForLevel(n, 1)).toBeLessThanOrEqual(requiredTokensForLevel(n, 0));
      expect(requiredTokensForLevel(n, 2)).toBeLessThanOrEqual(requiredTokensForLevel(n, 1));
      expect(requiredTokensForLevel(n, 2)).toBeGreaterThanOrEqual(1);
    }
  });

  it('treats an unknown high level as the widest rung rather than widening further', () => {
    expect(requiredTokensForLevel(6, 99)).toBe(1);
  });
});

describe('relaxationLadder — which rungs are worth a round trip', () => {
  it('never ladders a query with no text', () => {
    // A filters-only browse that returns nothing is a genuine empty set, not a
    // recall failure. Widening cannot conjure a product that passes the filters,
    // so the extra ~110ms round trips would buy exactly nothing.
    expect(relaxationLadder(0)).toEqual([0]);
  });

  it('does not ladder a ONE-token query at all — every rung is identical', () => {
    // requiredTokensForLevel(1, ·) is 1 at every rung, and tokenVehicleIds is
    // always empty for a single token (the whole query IS the token, so the
    // phrase match claims the ids and the per-token set dedupes to nothing).
    // There is nothing left to relax. Returning [0, 2] here spent a wasted Atlas
    // round trip on every single-word miss — 44.2% of measured prod traffic.
    expect(relaxationLadder(1)).toEqual([0]);
  });

  it('SKIPS the 70% rung for a 2-token query, where it is a duplicate', () => {
    // minimumTokensRequired(2) === 2 === requiredTokensForLevel(2, 0), so rung 1
    // would rebuild a byte-identical query and pay a full Atlas round trip for a
    // result set already known to be empty.
    expect(relaxationLadder(2)).toEqual([0, 2]);
  });

  it('proves the skipped rungs really are duplicates, rather than assuming it', () => {
    // The skip is only safe while the skipped rung builds an identical stage. Pin
    // that directly, so moving any rung threshold (the token count OR the vehicle
    // demotion) fails here instead of silently dropping a real rung.
    const stage = (tokens, relaxLevel, extra = {}) =>
      buildSearchStage({}, { tokens, cleanedQuery: tokens.join(' '), ...extra }, { relaxLevel });

    // One token: rungs 0, 1 and 2 are all the same query.
    expect(stage(['bmw'], 1)).toEqual(stage(['bmw'], 0));
    expect(stage(['bmw'], 2)).toEqual(stage(['bmw'], 0));

    // Two tokens: rung 1 duplicates rung 0, but rung 2 genuinely differs.
    expect(stage(['bmw', 'steering'], 1)).toEqual(stage(['bmw', 'steering'], 0));
    expect(stage(['bmw', 'steering'], 2)).not.toEqual(stage(['bmw', 'steering'], 0));
  });

  it('uses all three rungs from 3 tokens up, where 70% actually differs', () => {
    expect(relaxationLadder(3)).toEqual([0, 1, 2]);
    expect(relaxationLadder(7)).toEqual([0, 1, 2]);
  });

  it('caps at three passes for any query length', () => {
    for (let n = 0; n <= 30; n += 1) {
      expect(relaxationLadder(n).length).toBeLessThanOrEqual(3);
    }
  });

  it('only ever lists rungs that requiredTokensForLevel understands', () => {
    for (let n = 0; n <= 30; n += 1) {
      for (const level of relaxationLadder(n)) {
        expect([0, 1, 2]).toContain(level);
      }
    }
  });
});

describe('short queries are BYTE-IDENTICAL to the pre-ladder behaviour', () => {
  // The blast radius claim, enforced rather than asserted in prose: 1- and
  // 2-token searches already required every token before this change, so they
  // must be untouched by it. Only 3+ tokens — the searches that were actually
  // wrong — may differ.
  const stageFor = (tokens, relaxLevel) =>
    buildSearchStage({}, { tokens, cleanedQuery: tokens.join(' ') }, { relaxLevel });

  it('a one-token query builds the same stage at rung 0 as at the old 70% rung', () => {
    expect(stageFor(['bmw'], 0)).toEqual(stageFor(['bmw'], 1));
  });

  it('a two-token query builds the same stage at rung 0 as at the old 70% rung', () => {
    expect(stageFor(['bmw', 'steering'], 0)).toEqual(stageFor(['bmw', 'steering'], 1));
  });

  it('stays identical at rung 0 and 1 even with a vehicle token, which is what justifies the skip', () => {
    // relaxationLadder skips rung 1 for 1-2 token queries on the grounds that it
    // rebuilds an identical query. Phase 2 added a second thing that varies by
    // rung — whether a buried vehicle token counts as recall — so the skip is only
    // still safe if BOTH stay the same between rung 0 and rung 1. They do: the
    // vehicle demotion flips at rung 2, not rung 1. If someone later moves that
    // threshold, this test fails and tells them to revisit relaxationLadder.
    const resolved = {
      tokens: ['bmw', 'steering'],
      cleanedQuery: 'bmw steering',
      queryVehicleIds: [],
      tokenVehicleIds: ['bmw-id'],
    };
    expect(buildSearchStage({}, resolved, { relaxLevel: 0 }))
      .toEqual(buildSearchStage({}, resolved, { relaxLevel: 1 }));
  });

  it('a THREE-token query is where the stages diverge — 3 required, not 2', () => {
    const strict = stageFor(['bmw', 'steering', 'wheel'], 0);
    const relaxed = stageFor(['bmw', 'steering', 'wheel'], 1);
    expect(strict).not.toEqual(relaxed);
    expect(strict.compound.must[0].compound.should[0].compound.minimumShouldMatch).toBe(3);
    expect(relaxed.compound.must[0].compound.should[0].compound.minimumShouldMatch).toBe(2);
  });
});

describe('buildRecall — the token lane honours the rung', () => {
  const tokens = ['bmw', 'steering', 'wheel'];

  it('demands all three tokens on the first pass', () => {
    const [fuzzyLane] = buildRecall({ tokens, relaxLevel: 0 });
    expect(fuzzyLane.compound.minimumShouldMatch).toBe(3);
  });

  it('drops to the 70% rule on the first retry', () => {
    const [fuzzyLane] = buildRecall({ tokens, relaxLevel: 1 });
    expect(fuzzyLane.compound.minimumShouldMatch).toBe(2);
  });

  it('drops to any-one-token on the last retry', () => {
    const [fuzzyLane] = buildRecall({ tokens, relaxLevel: 2 });
    expect(fuzzyLane.compound.minimumShouldMatch).toBe(1);
  });

  it('keeps the exact-complete lane strict at EVERY rung', () => {
    // Lane 2 exists to score a complete exact match above a partial fuzzy one.
    // Relaxing it would delete that signal precisely when ranking matters most —
    // on the widened passes, where the result set is at its loosest.
    for (const relaxLevel of [0, 1, 2]) {
      const [, exactLane] = buildRecall({ tokens, relaxLevel });
      expect(exactLane.compound.minimumShouldMatch).toBe(tokens.length);
    }
  });

  it('still counts one token as exactly one clause at every rung', () => {
    // The OR-explosion guard: a flat (token x field) list would let one token
    // matching name+brand+tags satisfy a requirement of three tokens.
    for (const relaxLevel of [0, 1, 2]) {
      const [fuzzyLane] = buildRecall({ tokens, relaxLevel });
      expect(fuzzyLane.compound.should).toHaveLength(tokens.length);
      for (const clause of fuzzyLane.compound.should) {
        expect(clause.compound.minimumShouldMatch).toBe(1);
      }
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
    // Both lanes require ALL tokens on the default (strict) rung. This asserted 2
    // — the 70% rule — until 2026-09-16, when 70% stopped being the first pass and
    // became rung 1 of the relaxation ladder. The lanes still differ: lane 1 is
    // fuzzy (tolerates typos), lane 2 is exact and scores a literal match higher.
    expect(compoundLanes[0].compound.minimumShouldMatch).toBe(3); // all tokens, fuzzy
    expect(compoundLanes[1].compound.minimumShouldMatch).toBe(3); // all tokens, exact
  });

  it('matches categories and vehicles by ObjectId, never by denormalized name', () => {
    // This is what makes the ES category-slug drift structurally impossible:
    // the filter now compares the identifiers MongoDB itself compares.
    const lanes = buildRecall({ tokens: [], categoryIds: ['a'], vehicleIds: ['b'] });
    const paths = lanes.filter((l) => l.in).map((l) => l.in.path);
    expect(paths).toEqual(expect.arrayContaining(['categories', 'compatibleVehicles']));
  });

  it('no longer hand-rolls a name lane per synonym term', () => {
    // ES paired every synonym category match with a name match, because a synonym
    // often names a product directly ("lamp" -> "LED Lamp"). That job moved to the
    // engine: buildSynonymClause expands at ANALYSIS time, per token, which covers
    // multi-word queries too and cannot multiply the query the way OR-ing whole
    // alternate queries did. `synonymTerms` is still resolved, but only to feed the
    // CATEGORY lane — mapping a term to a taxonomy subtree is something the engine
    // cannot do.
    const lanes = buildRecall({ tokens: ['lights'], synonymTerms: ['lamp', 'lamps'] });
    expect(lanes.filter((l) => l.text && l.text.path === 'name')).toEqual([]);
  });

  it('still routes synonym CATEGORY ids into their own lane', () => {
    const lanes = buildRecall({ tokens: ['lights'], synonymCategoryIds: ['aaaaaaaaaaaaaaaaaaaaaaaa'] });
    const categoryLanes = lanes.filter((l) => l.in?.path === 'categories');
    expect(categoryLanes.length).toBeGreaterThan(0);
  });

  it('produces no lanes at all for an empty query, leaving filters to define the set', () => {
    expect(buildRecall({ tokens: [] })).toEqual([]);
  });
});

describe('a vehicle word inside a longer query narrows instead of widening', () => {
  const BMW = 'bmw-x5-id';
  const tokens = ['bmw', 'steering', 'wheel'];
  const vehicleLaneOf = (lanes) => lanes.find((l) => l.in?.path === 'compatibleVehicles');

  it('never lets fitment ALONE admit a product on the strict rung', () => {
    // The exact prod bug this closes. "BMW X5 M Sport Conversion Kit", a roof
    // spoiler and a crystal gear knob all carry the BMW X5 fitment id and none
    // contains "steering" or "wheel" in name, brand, sku or tags. They arrived on
    // an UNCONSTRAINED vehicle lane, which has no token requirement at all — so
    // they were immune to tightening minimumShouldMatch and had to be dealt with
    // here. The lane survives, but only ANDed with the remaining words.
    const lanes = buildRecall({ tokens, tokenVehicleIds: [BMW], vehicleTokens: ['bmw'], relaxLevel: 0 });
    expect(vehicleLaneOf(lanes)).toBeUndefined();
  });

  it('keeps it constrained on the 70% rung too', () => {
    const lanes = buildRecall({ tokens, tokenVehicleIds: [BMW], vehicleTokens: ['bmw'], relaxLevel: 1 });
    expect(vehicleLaneOf(lanes)).toBeUndefined();
    expect(lanes.find((l) => l.compound?.must)).toBeDefined();
  });

  it('drops the constraint on the last rung, where widening is the point', () => {
    const lanes = buildRecall({ tokens, tokenVehicleIds: [BMW], vehicleTokens: ['bmw'], relaxLevel: 2 });
    expect(vehicleLaneOf(lanes).in.value).toEqual([BMW]);
  });

  it('NEVER demotes a whole-query vehicle match — "bmw" alone still finds BMW parts', () => {
    // The valuable half of vehicle recall: a universal part that fits a BMW but
    // never says "BMW" in its name is findable only through fitment. Searching
    // the vehicle and nothing else must keep returning it, at every rung.
    for (const relaxLevel of [0, 1, 2]) {
      const lanes = buildRecall({ tokens: ['bmw'], vehicleIds: [BMW], relaxLevel });
      expect(vehicleLaneOf(lanes).in.value).toEqual([BMW]);
    }
  });

  it('covers both id sets on the last rung', () => {
    // Expressed as two OR'd lanes (whole-query fitment, token fitment) rather
    // than one merged clause. Same matched set — the outer compound is a
    // minimumShouldMatch: 1 should — while keeping the two signals separable if
    // they ever need different boosts.
    const lanes = buildRecall({
      tokens,
      vehicleIds: [BMW],
      tokenVehicleIds: ['other-id'],
      vehicleTokens: ['bmw'],
      relaxLevel: 2,
    });
    const covered = lanes.filter((l) => l.in?.path === 'compatibleVehicles').flatMap((l) => l.in.value);
    expect(covered).toEqual(expect.arrayContaining([BMW, 'other-id']));
  });

  it('ADMITS a fitment-only match: fits the vehicle AND carries the other words', () => {
    // The case a ranking-only boost silently drops, and the reason the lane is
    // constrained rather than deleted. Ranking reorders the recalled set; it
    // cannot add to it. A steering wheel catalogued as fitting the BMW X5 whose
    // name never says "BMW" is exactly what the shopper wants, and it is
    // reachable ONLY through fitment.
    const lanes = buildRecall({ tokens, tokenVehicleIds: [BMW], vehicleTokens: ['bmw'], relaxLevel: 0 });
    const fitmentLane = lanes.find((l) => l.compound?.must);

    expect(fitmentLane).toBeDefined();
    const [fitment, residualClause] = fitmentLane.compound.must;

    // Fitment is REQUIRED, not merely scored.
    expect(fitment.in.path).toBe('compatibleVehicles');
    expect(fitment.in.value).toEqual([BMW]);

    // …AND the words the vehicle token did not account for are required too.
    // "bmw" is consumed by the fitment clause; "steering" and "wheel" remain.
    expect(residualClause.compound.should).toHaveLength(2);
    expect(residualClause.compound.minimumShouldMatch).toBe(2);
  });

  it('EXCLUDES the BMW gear knob — fitment alone is never enough', () => {
    // The original bug, from the other direction. The gear knob, roof spoiler and
    // X5 body kit all carry the BMW fitment id and none carries "steering" or
    // "wheel". Requiring the residual tokens alongside fitment keeps them out
    // while the fitment-only steering wheel above gets in.
    const lanes = buildRecall({ tokens, tokenVehicleIds: [BMW], vehicleTokens: ['bmw'], relaxLevel: 0 });
    const bareFitmentLane = lanes.find((l) => l.in?.path === 'compatibleVehicles');
    expect(bareFitmentLane).toBeUndefined();
  });

  it('relaxes the residual requirement with the rung, not independently of it', () => {
    const fourTokens = ['bmw', 'carbon', 'steering', 'wheel'];
    const residualFor = (relaxLevel) => buildRecall({
      tokens: fourTokens, tokenVehicleIds: [BMW], vehicleTokens: ['bmw'], relaxLevel,
    }).find((l) => l.compound?.must).compound.must[1].compound.minimumShouldMatch;

    expect(residualFor(0)).toBe(3);                        // all 3 residual tokens
    expect(residualFor(1)).toBe(minimumTokensRequired(3)); // 70% of the residual
  });

  it('falls back to bare fitment when the query is ONLY vehicle words', () => {
    // "bmw toyota" leaves no residual to AND against, so fitment alone is the
    // entire intent. ANDing against an empty clause list would match nothing.
    const lanes = buildRecall({
      tokens: ['bmw', 'toyota'], tokenVehicleIds: [BMW], vehicleTokens: ['bmw', 'toyota'], relaxLevel: 0,
    });
    const bare = lanes.find((l) => l.in?.path === 'compatibleVehicles');
    expect(bare.in.value).toEqual([BMW]);
    expect(lanes.find((l) => l.compound?.must)).toBeUndefined();
  });

  it('keeps score INSIDE the operator on the constrained lane', () => {
    // The shape that silently disables Atlas entirely: a sibling `score` is
    // rejected with `unrecognized field "score"`, searchService catches it, and
    // every search becomes a full Mongo scan behind a normal-looking storefront.
    const lanes = buildRecall({ tokens, tokenVehicleIds: [BMW], vehicleTokens: ['bmw'], relaxLevel: 0 });
    const fitment = lanes.find((l) => l.compound?.must).compound.must[0];
    expect(fitment.score).toBeUndefined();
    expect(fitment.in.score).toEqual({ boost: { value: 2 } });
  });

  it('also SCORES fitment at every rung, on top of the constrained recall lane', () => {
    // Recall decides who is in; ranking decides the order. buildSearchStage hands
    // both id sets to ranking, so among the steering wheels that qualify, the
    // BMW-fitted ones come first — the ordering a shopper wants, which the old
    // unconstrained lane only achieved by admitting junk alongside it.
    const stage = buildSearchStage(
      {},
      { tokens, cleanedQuery: tokens.join(' '), queryVehicleIds: [], tokenVehicleIds: [BMW] },
      { relaxLevel: 0 },
    );
    const boost = stage.compound.should.find((c) => c.in?.path === 'compatibleVehicles');
    expect(boost).toBeDefined();
    expect(boost.in.value).toEqual([BMW]);
    // …and the score stays INSIDE the operator. Beside it, Atlas rejects the whole
    // query with `unrecognized field "score"` and searchService silently serves a
    // full-collection Mongo scan instead.
    expect(boost.score).toBeUndefined();
    expect(boost.in.score).toEqual({ boost: { value: 2 } });
  });

  it('end to end: no unconstrained fitment lane survives on the strict rung', () => {
    const stage = buildSearchStage(
      {},
      {
        tokens,
        cleanedQuery: tokens.join(' '),
        queryVehicleIds: [],
        tokenVehicleIds: [BMW],
        vehicleTokens: ['bmw'],
      },
      { relaxLevel: 0 },
    );
    const recallLanes = stage.compound.must[0].compound.should;
    expect(recallLanes.every((lane) => lane.in?.path !== 'compatibleVehicles')).toBe(true);
    expect(recallLanes[0].compound.minimumShouldMatch).toBe(3);
    // The constrained lane IS present — this is not lane removal.
    expect(recallLanes.some((lane) => lane.compound?.must)).toBe(true);
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

  it('reads the non-purchasable set from the SHARED constant, not a local literal', () => {
    // Regression: Atlas excluded ['out','backorder'] while the MongoDB fallback
    // excluded only 'out', so ?inStock=true hid 20 backorder products on one path
    // and showed them on the other. Asserting against the imported constant is
    // what stops the two drifting again.
    const { mustNot } = buildFilters({ inStock: 'true' });
    const clause = mustNot.find((m) => m.in?.path === 'stock');
    expect(clause.in.value).toEqual([...NON_PURCHASABLE_STOCK]);
  });

  it('applies the isFeatured filter — it was silently dropped', () => {
    // The storefront "View all featured" link (/products?isFeatured=true) answered
    // with the entire 931-product catalogue because buildFilters never destructured
    // this param, while SearchService.buildBaseQuery did. Pure engine divergence.
    expect(buildFilters({ isFeatured: 'true' }).filter)
      .toContainEqual({ equals: { path: 'isFeatured', value: true } });
    expect(buildFilters({ isFeatured: true }).filter)
      .toContainEqual({ equals: { path: 'isFeatured', value: true } });
    expect(buildFilters({ isFeatured: 'false' }).filter)
      .toContainEqual({ equals: { path: 'isFeatured', value: false } });
  });

  it('applies an allowlisted productType and ignores an unknown one', () => {
    expect(buildFilters({ productType: 'variable' }).filter)
      .toContainEqual({ equals: { path: 'productType', value: 'variable' } });
    // An unknown value must be IGNORED, not passed through — a bogus token would
    // filter the result set to nothing instead of being treated as "no filter".
    expect(buildFilters({ productType: 'bogus' }).filter.some((f) => f.equals?.path === 'productType'))
      .toBe(false);
  });

  it('leaves isFeatured and productType unfiltered when absent', () => {
    const { filter } = buildFilters({});
    expect(filter.some((f) => f.equals?.path === 'isFeatured')).toBe(false);
    expect(filter.some((f) => f.equals?.path === 'productType')).toBe(false);
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
    const stage = buildSearchStage(
      { sortBy: 'price', order: 'asc' },
      { tokens: ['brake'], cleanedQuery: 'brake' },
      { capabilities: { stockRank: true } }
    );
    // stockRank leads every explicit sort — see the dedicated describe below.
    expect(stage.sort).toEqual({ stockRank: 1, price: 1 });
  });

  it('sorts by recency when browsing without a query', () => {
    const stage = buildSearchStage({ sortBy: 'createdAt' }, { tokens: [], cleanedQuery: null }, { capabilities: { stockRank: true } });
    expect(stage.sort).toEqual({ stockRank: 1, createdAt: -1 });
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
    //
    // NOTE the shape: `score` lives INSIDE the operator. This assertion
    // originally required it as a sibling — `{ equals: {...}, score: {...} }` —
    // which Atlas rejects with "unrecognized field score". The test passed, the
    // production query did not. Asserting the wrong structure in detail is worse
    // than not asserting it, so the shape is now pinned exactly.
    //
    // This used to pin the `isFastMoving` clause as the constant-scored example.
    // That clause was removed on 2026-09-01 (dead feature, 3 products), so the
    // availability boost is now the constant-scored signal — same structural
    // property, a signal that actually applies to the whole catalogue.
    const stage = buildSearchStage({}, { tokens: ['brake'], cleanedQuery: 'brake' });
    expect(stage.compound.should).toContainEqual({
      in: { path: 'stock', value: ['in', 'low'], score: { constant: { value: 5 } } },
    });

    const scored = stage.compound.should.filter(
      (clause) => Object.values(clause)[0]?.score?.function
    );
    expect(scored.length).toBeGreaterThanOrEqual(2);

    // And nothing may carry `score` beside its operator.
    expect(stage.compound.should.filter((c) => 'score' in c)).toEqual([]);
  });
});

describe('index capability gating — the silent-fallback guard', () => {
  /**
   * Three query features added on 2026-09-01 each reference something the index
   * must declare, and Atlas REJECTS the entire query when it does not. Verified
   * against the live cluster:
   *
   *   stockRank sort  → "stockRank is not indexed as sortable"
   *   salesScore      → "path expression for function score requires path
   *                      \"salesScore\" to be indexed as numeric"
   *   synonyms        → "unknown synonym mapping name \"productSynonyms\""
   *
   * None of those surface as an error to anyone: searchService catches engine
   * failures and serves the MongoDB fallback, so the storefront looks completely
   * normal while every search runs a full-collection scan. Defaulting every gate
   * to OFF is what makes the code safe to deploy before the index redeploy.
   */
  it('omits salesScore scoring until the index maps it', () => {
    expect(JSON.stringify(buildRankingShould({ cleanedQuery: 'brake' }))).not.toContain('salesScore');
    expect(JSON.stringify(buildRankingShould({ cleanedQuery: 'brake', capabilities: { salesScore: true } })))
      .toContain('salesScore');
  });

  it('degrades a salesScore sort to recency until the index maps it', () => {
    // Verified live: "salesScore is not indexed as sortable". A shopper picking
    // "Best Selling" must not be able to knock every search onto the Mongo
    // fallback just because the index redeploy has not happened yet.
    expect(buildSearchStage({ sortBy: 'salesScore', order: 'desc' }, {}).sort)
      .toEqual({ createdAt: -1 });
    expect(buildSearchStage({ sortBy: 'salesScore', order: 'desc' }, {}, { capabilities: { salesScore: true } }).sort)
      .toEqual({ salesScore: -1 });
  });

  it('produces a query with NO ungated new fields by default', () => {
    // The single assertion that matters for a pre-index deploy: nothing in a
    // default-built stage references a field the live index does not have.
    const json = JSON.stringify(buildSearchStage({ sortBy: 'price' }, { tokens: ['brake'], cleanedQuery: 'brake' }));
    expect(json).not.toContain('stockRank');
    expect(json).not.toContain('salesScore');
    expect(json).not.toContain('productSynonyms');
  });

  it('keeps the availability BOOST ungated — it needs no new index field', () => {
    // `stock` has always been mapped, so the relevance-path demotion works
    // immediately, without waiting for the redeploy.
    expect(buildRankingShould({ cleanedQuery: null }).some((c) => c.in?.path === 'stock')).toBe(true);
  });
});

describe('synonym lane', () => {
  it('is OMITTED unless the live index actually declares the mapping', () => {
    // Not defensive — load-bearing. Atlas rejects a query naming a synonym mapping
    // the index does not have ("unknown synonym mapping name"), searchService
    // catches engine errors and serves the MongoDB fallback, so an ungated lane
    // would turn every text search into a silent full-collection scan while the
    // storefront still looked fine. Default OFF means shipping the code before the
    // index redeploy is safe.
    const off = buildRecall({ tokens: ['lights'] });
    expect(JSON.stringify(off)).not.toContain('synonyms');

    const on = buildRecall({ tokens: ['lights'], synonymsAvailable: true });
    expect(JSON.stringify(on)).toContain('productSynonyms');
  });

  it('NEVER combines synonyms with fuzzy in one operator', () => {
    // Atlas forbids it outright, and the rejection is silent in production because
    // the fallback swallows it.
    const lanes = buildRecall({ tokens: ['lights', 'led'], synonymsAvailable: true });
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.text && 'synonyms' in node.text) expect(node.text.fuzzy).toBeUndefined();
      Object.values(node).forEach(walk);
    };
    walk(lanes);
  });

  it('requires every token to match, so it cannot widen recall', () => {
    // The old query-time expansion OR'd whole alternate queries in, which is what
    // returned 151 results for "spoiler". This lane is an alternative route to a
    // full match, not a looser one.
    const lanes = buildRecall({ tokens: ['a', 'b', 'c'], synonymsAvailable: true });
    const synonymLane = lanes.find((l) => JSON.stringify(l).includes('productSynonyms'));
    expect(synonymLane.compound.minimumShouldMatch).toBe(3);
  });

  it('scores below the literal lane so a real match still wins', () => {
    const clause = buildSynonymClause('lights');
    const nameBoost = clause.compound.should.find((c) => c.text.path === 'name').text.score.boost.value;
    const literalNameBoost = HIGH_SIGNAL_FIELDS.find((f) => f.path === 'name').boost;
    expect(nameBoost).toBeLessThan(literalNameBoost);
  });

  it('adds exactly one lane and leaves the others intact', () => {
    const without = buildRecall({ tokens: ['lights'] }).length;
    const with_ = buildRecall({ tokens: ['lights'], synonymsAvailable: true }).length;
    expect(with_).toBe(without + 1);
  });
});

describe('buildSearchStage — availability on the SORTED path', () => {
  const withStockRank = { capabilities: { stockRank: true } };

  it('leads every explicit sort with stockRank', () => {
    // Setting `sort` makes Atlas rank by the sort keys alone and ignore relevance
    // score, so the availability BOOST cannot reach browse pages. Without this key
    // every browse / "Newest" / "Price" view ranked unbuyable products as highly as
    // buyable ones.
    expect(buildSearchStage({}, {}, withStockRank).sort).toEqual({ stockRank: 1, createdAt: -1 });
    expect(buildSearchStage({ sortBy: 'price', order: 'asc' }, {}, withStockRank).sort)
      .toEqual({ stockRank: 1, price: 1 });
  });

  it('sorts on stockRank, NEVER on the stock enum', () => {
    // The enum orders alphabetically as backorder < in < low < out, so sorting the
    // string promotes exactly what it was meant to sink. That shipped.
    const sort = buildSearchStage({ sortBy: 'price', order: 'desc' }, {}, withStockRank).sort;
    expect(sort.stock).toBeUndefined();
    expect(Object.keys(sort)[0]).toBe('stockRank');
  });

  it('OMITS stockRank until the live index maps it', () => {
    // Verified against the cluster: sorting on an unmapped field is rejected with
    // "stockRank is not indexed as sortable", and searchService turns that
    // rejection into a silent full-collection Mongo scan. Defaulting to OFF is what
    // makes this code safe to deploy before the index redeploy.
    expect(buildSearchStage({ sortBy: 'price', order: 'asc' }, {}).sort).toEqual({ price: 1 });
  });

  it('treats sortBy=relevance as relevance when there is query text', () => {
    // Explicit relevance: previously it was inferred from "createdAt + query text",
    // so the UI could neither request it nor return to it.
    expect(buildSearchStage({ sortBy: 'relevance' }, { tokens: ['x'], cleanedQuery: 'x' }).sort)
      .toBeUndefined();
  });

  it('falls back to recency for sortBy=relevance with no query text', () => {
    // Every document scores identically without a query, so "relevance" would be an
    // arbitrary order. Recency is the honest answer.
    expect(buildSearchStage({ sortBy: 'relevance' }, {}, withStockRank).sort)
      .toEqual({ stockRank: 1, createdAt: -1 });
  });

  it('still omits sort entirely for a relevance query', () => {
    // Relevance ranking is where the availability BOOST applies; adding a sort here
    // would disable scoring and undo it.
    expect(buildSearchStage({}, { tokens: ['brake'], cleanedQuery: 'brake' }).sort)
      .toBeUndefined();
  });
});

describe('buildRankingShould — availability demotion', () => {
  it('boosts purchasable stock so out-of-stock sinks, with score INSIDE the operator', () => {
    // Atlas has no negative boost, so demotion is a positive constant on the
    // complement. `score` beside the operator instead of inside it is rejected by
    // Atlas with `unrecognized field "score"` — and the failure is SILENT, because
    // searchService catches the engine error and serves the full-scan Mongo
    // fallback. That is why this asserts the nesting explicitly.
    const clause = buildRankingShould({ cleanedQuery: null })
      .find((c) => c.in?.path === 'stock');
    expect(clause).toBeDefined();
    expect(clause.in.value).toEqual([...PURCHASABLE_STOCK]);
    expect(clause.in.score).toEqual({ constant: { value: 5 } });
    expect(clause.score).toBeUndefined();
  });

  it('keeps the demotion below the exact-name phrase boost', () => {
    // A perfect name match must still be able to outrank the availability nudge —
    // backorder items are enquiry-only, not worthless. Phrase boost is 10.
    const should = buildRankingShould({ cleanedQuery: 'brake pads' });
    const stock = should.find((c) => c.in?.path === 'stock');
    const phrase = should.find((c) => c.phrase);
    expect(stock.in.score.constant.value).toBeLessThan(phrase.phrase.score.boost.value);
  });

  it('no longer boosts the dead isFastMoving flag', () => {
    // 3 of 931 products carry it and the section that rendered them is never
    // mounted, so the clause was a permanent thumb on the scale for three
    // arbitrary products on every search.
    expect(JSON.stringify(buildRankingShould({ cleanedQuery: 'brake' })))
      .not.toContain('isFastMoving');
  });

  it('applies the availability boost even with no query text', () => {
    // Browse pages (category, brand, /products) have no query but must still not
    // lead with something nobody can buy.
    expect(buildRankingShould({ cleanedQuery: null }).some((c) => c.in?.path === 'stock')).toBe(true);
  });
});

describe('engine parity — Atlas and MongoDB agree on stock', () => {
  it('builds the same non-purchasable set on both paths', async () => {
    const mongoQuery = await SearchService.buildBaseQuery({ inStock: 'true' });
    const { mustNot } = buildFilters({ inStock: 'true' });
    const atlasExcluded = mustNot.find((m) => m.in?.path === 'stock').in.value;
    expect(mongoQuery.stock.$nin).toEqual(atlasExcluded);
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
