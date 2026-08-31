/**
 * MongoDB Atlas Search adapter.
 *
 * Implements the exact contract services/searchService.js consumes from
 * elasticsearchService — isConnected, searchProducts, getIndexedDocumentCount,
 * getSearchSuggestions, logSearchQuery, getSearchAnalytics — so the engine can be
 * swapped behind SEARCH_ENGINE without touching a single caller. All of
 * searchService's fallback logic, category-subtree expansion, path metrics and
 * divergence warnings are engine-agnostic and stay exactly as they are; that code
 * is what keeps Mongo and the index answering the same URL identically, and this
 * migration deliberately does not go near it.
 *
 * ── What changes, and why it is safer ─────────────────────────────────────────
 *
 * Elasticsearch held a SEPARATE, hand-built copy of every product, written by
 * indexProduct() and kept current by a BullMQ job that every write path had to
 * remember to enqueue. `updateMany` and `bulkWrite` bypass Mongoose middleware, so
 * "remember to enqueue" was a rule enforced by code review and nothing else — and
 * it has failed in production more than once.
 *
 * Atlas Search indexes the products collection itself, driven by change streams.
 * There is no copy, no enqueue, and no way for a write path to forget. The entire
 * class of index-drift bug stops existing rather than being fixed.
 *
 * Two consequences follow from indexing the REAL document, and both are handled
 * below rather than papered over:
 *
 *  1. `categories` and `compatibleVehicles` are ObjectId refs, not the
 *     denormalized `{name, slug}` / `vehicle_makes` strings ES carried. Every
 *     name/slug the storefront sends is resolved to ObjectIds at QUERY time. This
 *     is why the ES category-slug drift cannot recur: the filter now compares the
 *     same identifiers MongoDB compares.
 *
 *  2. ES indexed ONLY active products, so "absent from the index" WAS the
 *     visibility rule. Atlas indexes drafts too, so that rule is now an explicit
 *     isActive filter applied to every public query. See buildFilters.
 */

import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Vehicle from '../models/Vehicle.js';
import categoryMappingService from './categoryMappingService.js';
import { expand as expandSynonyms, contentTokens } from '../config/searchSynonyms.js';
import { normalizeImages, sanitizeQuery } from '../utils/searchHelpers.js';
import { ATLAS_SEARCH_INDEX_NAME } from '../config/atlasSearchIndex.js';
import { getRedisClient } from './cacheService.js';

/**
 * Field weights for free-text recall, carried over verbatim from the
 * Elasticsearch HIGH_SIGNAL list (name^3, brand^2, sku^2, tags^1.5).
 *
 * `vehicle_models.text^3` and `vehicle_makes.text^2` are absent by design: those
 * fields only ever existed because indexProduct flattened the vehicle refs into
 * strings. Their job — "a search for 'hilux' should find products that fit a
 * Hilux" — is done by the vehicle recall lane, which resolves the token to
 * Vehicle ObjectIds and matches `compatibleVehicles` directly. Same intent,
 * matched against the authoritative reference rather than a copied-out string.
 */
export const HIGH_SIGNAL_FIELDS = [
  { path: 'name', boost: 3 },
  { path: 'brand', boost: 2 },
  { path: 'sku', boost: 2 },
  { path: 'tags', boost: 1.5 },
];

/**
 * Reproduce Elasticsearch's `fuzziness: 'AUTO:5,8'` with `prefix_length: 2`.
 *
 * AUTO:5,8 means: under 5 chars → NO edits, 5–8 chars → 1 edit, over 8 → 2 edits.
 * Atlas has no AUTO, so the bucketing is done explicitly — which is the only way
 * to preserve the two behaviours the ES comment calls out as load-bearing:
 * sub-5-char tokens stay exact so "thor" never matches "thar", and prefixLength 2
 * keeps the first two characters fixed so "led" cannot fuzzy into "red"/"bed".
 *
 * @returns {{maxEdits: number, prefixLength: number, maxExpansions: number}|null}
 *          null means "match this token exactly" — Atlas rejects maxEdits: 0.
 */
export function fuzzyFor(token) {
  const len = String(token || '').length;
  if (len < 5) return null;
  return { maxEdits: len <= 8 ? 1 : 2, prefixLength: 2, maxExpansions: 50 };
}

/**
 * How many of the query's tokens a document must contain.
 *
 * Elasticsearch expressed this as `minimum_should_match: '2<70%'` — at most 2
 * tokens, all are required; more than 2, 70% are required (tolerating one
 * missing or typo'd word on longer queries). Atlas's `minimumShouldMatch` is an
 * integer, so the percentage is resolved here. Making it explicit is a small win:
 * the rounding is now visible and testable instead of living inside ES.
 */
export function minimumTokensRequired(tokenCount) {
  if (tokenCount <= 2) return tokenCount;
  // ROUNDS DOWN, matching Elasticsearch: "the number computed from the percentage
  // is rounded down and used as the minimum". Rounding up instead would require
  // all 3 tokens of a 3-token query (ceil(2.1) = 3) and destroy the very tolerance
  // this rule exists for — "tolerates one missing/typo'd word on longer queries".
  // Floored at 1 so a percentage can never demand zero clauses.
  return Math.max(1, Math.floor(tokenCount * 0.7));
}

/**
 * One token, matched across the weighted high-signal fields.
 *
 * The nesting matters. Atlas counts `minimumShouldMatch` in CLAUSES, so a flat
 * list of (token × field) clauses would let a single token matching three fields
 * satisfy a requirement of three tokens — quietly restoring the OR-explosion the
 * precision work removed. Wrapping each token's per-field alternatives in their
 * own compound makes one token count as exactly one clause, while still scoring
 * as the sum of the fields it hit.
 */
export function buildTokenClause(token, { fuzzy = true } = {}) {
  const fuzziness = fuzzy ? fuzzyFor(token) : null;
  return {
    compound: {
      should: HIGH_SIGNAL_FIELDS.map((field) => ({
        text: {
          query: token,
          path: field.path,
          ...(fuzziness ? { fuzzy: fuzziness } : {}),
          score: { boost: { value: field.boost } },
        },
      })),
      minimumShouldMatch: 1,
    },
  };
}

/**
 * The recall lanes — the clauses that decide WHICH documents come back.
 *
 * A product qualifies via ANY lane (the lanes are OR'd with
 * minimumShouldMatch: 1), mirroring the Elasticsearch structure exactly:
 *
 *  1. Fuzzy, partial — most tokens present in a single high-signal field.
 *  2. Exact, complete — every token present somewhere across those fields.
 *     Redundant for ≤2 tokens (lane 1 already requires all of them) but it
 *     scores a complete exact match above a 70% fuzzy one, which is the point.
 *  3. Category — the query names a category; its whole subtree qualifies.
 *  4. Vehicle — the query names a make or model; products fitting it qualify.
 *
 * Lanes 3 and 4 are the ObjectId re-expression of what ES did with denormalized
 * strings, and they are strictly more accurate: a category matches because it IS
 * that category, not because its display name happened to tokenize the same way.
 */
export function buildRecall({
  tokens,
  categoryIds = [],
  vehicleIds = [],
  synonymCategoryIds = [],
  synonymTerms = [],
}) {
  const lanes = [];

  if (tokens.length > 0) {
    lanes.push({
      compound: {
        should: tokens.map((t) => buildTokenClause(t, { fuzzy: true })),
        minimumShouldMatch: minimumTokensRequired(tokens.length),
      },
    });

    lanes.push({
      compound: {
        should: tokens.map((t) => buildTokenClause(t, { fuzzy: false })),
        minimumShouldMatch: tokens.length,
      },
    });
  }

  if (categoryIds.length > 0) {
    lanes.push({
      in: { path: 'categories', value: categoryIds, score: { boost: { value: 2 } } },
    });
  }

  // Synonym expansion is applied ONLY to single-token, category-style queries.
  // For a specific multi-word query synonyms are the bug, not the feature:
  // expanding "spoiler" into every bumper is what returned 151 results. There,
  // literal intent has to win.
  if (synonymCategoryIds.length > 0) {
    lanes.push({
      in: { path: 'categories', value: synonymCategoryIds, score: { boost: { value: 1.5 } } },
    });
  }

  // The synonym's NAME lane. ES paired every synonym category match with a
  // `match: {name: {query: s, operator: 'and'}}`, because a synonym often names a
  // product directly ("lamp" → "LED Lamp") without any category being involved.
  // Dropping it would quietly narrow single-token category searches.
  for (const term of synonymTerms) {
    lanes.push({ text: { query: term, path: 'name' } });
  }

  if (vehicleIds.length > 0) {
    lanes.push({
      in: { path: 'compatibleVehicles', value: vehicleIds, score: { boost: { value: 2 } } },
    });
  }

  return lanes;
}

/**
 * Ranking-only clauses. These must never widen the match set — they sit in the
 * outer `should` with no minimumShouldMatch, so they contribute score to
 * documents the recall lanes already admitted and nothing else.
 *
 * This is also where function_score is re-expressed. Elasticsearch used
 * score_mode: sum / boost_mode: sum — ADDITIVE, because the multiplicative
 * default annihilated text relevance for the many migrated products with no
 * reviews and a 0 rating, flattening ranking so the exact-name match never
 * surfaced. An Atlas compound scores as the SUM of its matching clauses, so
 * modelling each popularity signal as its own scored `should` reproduces the
 * additive behaviour natively — there is no multiplicative default to defuse.
 */
export function buildRankingShould({ cleanedQuery, vehicleIds = [] }) {
  const should = [
    // Popularity and quality nudges, applied whether or not there is query text.
    // `exists` is the carrier clause: documents missing the field simply do not
    // match it and score 0, which is exactly ES's `missing: 0`.
    {
      equals: { path: 'isFastMoving', value: true, score: { constant: { value: 2 } } },
    },
    {
      exists: {
        path: 'totalReviews',
        score: {
          function: {
            multiply: [
              { log1p: { path: { value: 'totalReviews', undefined: 0 } } },
              { constant: 0.1 },
            ],
          },
        },
      },
    },
    {
      exists: {
        path: 'averageRating',
        score: {
          function: {
            multiply: [
              { path: { value: 'averageRating', undefined: 0 } },
              { constant: 0.5 },
            ],
          },
        },
      },
    },
  ];

  if (cleanedQuery) {
    // A product literally named like the query must rank first. slop: 2 and
    // boost: 10 are carried over unchanged — this is the clause that fixed
    // exact-name matches ranking below noise.
    should.push({
      phrase: { query: cleanedQuery, path: 'name', slop: 2, score: { boost: { value: 10 } } },
    });
    // Replaces ES `match_phrase_prefix` on name. The autocomplete field type is
    // the edgeGram-backed equivalent and is the same field the suggestion
    // endpoint uses, so partial words rank consistently in both places.
    should.push({
      autocomplete: { query: cleanedQuery, path: 'name', score: { boost: { value: 1 } } },
    });
    // Weak recall only. See the index definition: description is excluded from
    // every recall lane because SEO-stuffed descriptions share common words
    // across the whole catalogue.
    should.push({
      text: { query: cleanedQuery, path: 'description', score: { boost: { value: 0.3 } } },
    });
  }

  if (vehicleIds.length > 0) {
    should.push({
      in: { path: 'compatibleVehicles', value: vehicleIds, score: { boost: { value: 2 } } },
    });
  }

  return should;
}

/**
 * Non-scoring filters. Everything here narrows the set without touching relevance.
 *
 * @param {object} params        the storefront query params
 * @param {object} resolved      ids resolved from names/slugs by the caller
 */
export function buildFilters(params, resolved = {}) {
  const {
    minPrice, maxPrice, inStock, rating, includeInactive = false,
  } = params;
  const { categoryIds = [], vehicleFilterIds = null } = resolved;

  const filter = [];
  const mustNot = [];

  // Load-bearing. Elasticsearch only ever held active products, so this rule was
  // implicit in the index's contents. Atlas indexes the whole collection, so
  // dropping this line would publish every unpublished draft to the storefront.
  if (!includeInactive) {
    filter.push({ equals: { path: 'isActive', value: true } });
  }

  if (categoryIds.length > 0) {
    filter.push({ in: { path: 'categories', value: categoryIds } });
  }

  // `vehicleFilterIds` is null when no vehicle filter was requested, and an EMPTY
  // ARRAY when one was requested but matched no known vehicle. Those must behave
  // differently: no filter vs. a filter that matches nothing. Collapsing them
  // would silently answer with the whole catalogue as though nothing were
  // selected — the same failure the ES `vehicleType`/`vehicleMake` param mismatch
  // produced. Atlas rejects an empty `in`, so the impossible case is expressed
  // with a mustNot-everything clause instead.
  if (Array.isArray(vehicleFilterIds)) {
    if (vehicleFilterIds.length > 0) {
      filter.push({ in: { path: 'compatibleVehicles', value: vehicleFilterIds } });
    } else {
      mustNot.push({ exists: { path: '_id' } });
    }
  }

  const brands = normalizeList(params.brand);
  if (brands.length > 0) {
    // The `brand` token field carries a lowercase normalizer, so the query side
    // must lowercase too. This pair replaces ES's per-term case_insensitive flag;
    // breaking the pair matches nothing at all.
    filter.push({ in: { path: 'brand', value: brands.map((b) => b.toLowerCase()) } });
  }

  if (minPrice || maxPrice) {
    const range = { path: 'price' };
    if (minPrice) range.gte = Number(minPrice);
    if (maxPrice) range.lte = Number(maxPrice);
    filter.push({ range });
  }

  if (inStock === 'true' || inStock === true) {
    // "In stock only" means actually on hand — excludes out AND backorder.
    mustNot.push({ in: { path: 'stock', value: ['out', 'backorder'] } });
  }

  const ratings = normalizeList(rating).map(Number).filter((r) => !Number.isNaN(r));
  if (ratings.length > 0) {
    filter.push({ range: { path: 'averageRating', gte: Math.max(...ratings) } });
  }

  return { filter, mustNot };
}

/** Accept a value, an array, or a comma-separated list — as every filter param may arrive. */
export function normalizeList(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : String(value).split(','))
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
}

/**
 * Assemble the complete $search stage.
 *
 * Note there is no `match_all` branch. Atlas requires a compound to carry at
 * least one clause, and the isActive filter is always present on a public query,
 * so a query-less browse is naturally "all active products" with a constant
 * score — which is what match_all meant.
 */
export function buildSearchStage(params, resolved = {}) {
  const { tokens = [], cleanedQuery = null } = resolved;

  const recall = buildRecall({
    tokens,
    categoryIds: resolved.queryCategoryIds || [],
    vehicleIds: resolved.queryVehicleIds || [],
    synonymCategoryIds: resolved.synonymCategoryIds || [],
    synonymTerms: resolved.synonymTerms || [],
  });
  const { filter, mustNot } = buildFilters(params, resolved);

  const compound = { filter };
  if (recall.length > 0) {
    compound.must = [{ compound: { should: recall, minimumShouldMatch: 1 } }];
  }
  const rankingShould = buildRankingShould({ cleanedQuery, vehicleIds: resolved.queryVehicleIds || [] });
  if (rankingShould.length > 0) compound.should = rankingShould;
  if (mustNot.length > 0) compound.mustNot = mustNot;

  const stage = {
    index: ATLAS_SEARCH_INDEX_NAME,
    compound,
  };

  // Sorting. With query text and no explicit sort, rank by relevance — which for
  // Atlas means omitting `sort` entirely rather than naming a _score field.
  const sortBy = params.sortBy || 'createdAt';
  const isRelevance = Boolean(cleanedQuery) && sortBy === 'createdAt';
  if (!isRelevance) {
    stage.sort = { [sortBy]: params.order === 'asc' ? 1 : -1 };
  }

  return stage;
}

/**
 * Bucket boundaries for the price and rating facets, kept in the ES response
 * shape ({from, to, count}) so the storefront sidebar needs no change. Expressed
 * as an ordered table rather than a $bucket stage so the mapping from boundary to
 * emitted label is visible and unit-testable.
 */
const PRICE_BUCKETS = [
  { key: 'p0', to: 50 },
  { key: 'p1', from: 50, to: 100 },
  { key: 'p2', from: 100, to: 200 },
  { key: 'p3', from: 200, to: 500 },
  { key: 'p4', from: 500 },
];

const RATING_BUCKETS = [
  { key: 'r4', from: 4 },
  { key: 'r3', from: 3, to: 4 },
  { key: 'r2', from: 2, to: 3 },
  { key: 'r1', from: 1, to: 2 },
  { key: 'r0', to: 1 },
];

/**
 * $switch evaluates branches IN ORDER and takes the first match, so every branch
 * must be tested smallest-boundary-first regardless of how the table above reads.
 * RATING_BUCKETS is declared best-first (4+ at the top, as the sidebar shows it);
 * without this sort, the first branch tested would be `$lt 4` and a 0.5-star
 * product would be counted in the 3–4 bucket. Sorting here means the display
 * order of the tables stays free to change without silently corrupting counts.
 */
function bucketSwitch(field, buckets) {
  const bounded = buckets
    .filter((b) => b.to !== undefined)
    .sort((a, b) => a.to - b.to);

  return {
    $switch: {
      branches: bounded.map((b) => ({ case: { $lt: [field, b.to] }, then: b.key })),
      // The one open-ended bucket (no `to`) catches everything above the last
      // boundary — ES's `{from: 500}` / `{from: 4}` tail.
      default: buckets.find((b) => b.to === undefined).key,
    },
  };
}

export { PRICE_BUCKETS, RATING_BUCKETS, bucketSwitch };

/**
 * Vehicle name → ObjectId index.
 *
 * The storefront filters by make/model NAME ("Toyota", "Hilux") but products
 * reference Vehicle documents by id, so every vehicle-flavoured query needs this
 * translation. Elasticsearch avoided it by denormalizing the names into the
 * product document at index time — which is precisely the copied-out state this
 * migration removes, so the translation moves to query time instead.
 *
 * Cached because it is consulted on most searches and the collection is tiny and
 * near-static (a few hundred rows). The TTL bounds how long a newly added vehicle
 * stays invisible to search; it does not affect correctness of anything already
 * indexed.
 */
const VEHICLE_INDEX_TTL_MS = 5 * 60 * 1000;
const vehicleIndexCache = { value: null, builtAt: 0 };

export function __resetVehicleIndexCache() {
  vehicleIndexCache.value = null;
  vehicleIndexCache.builtAt = 0;
}

async function getVehicleIndex() {
  const now = Date.now();
  if (vehicleIndexCache.value && now - vehicleIndexCache.builtAt < VEHICLE_INDEX_TTL_MS) {
    return vehicleIndexCache.value;
  }

  const vehicles = await Vehicle.find({ isActive: true })
    .select('_id make model')
    .lean();

  const byMake = new Map();
  const byModel = new Map();
  const byAny = new Map();
  const push = (map, key, id) => {
    if (!key) return;
    const k = String(key).toLowerCase().trim();
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(id);
  };

  for (const v of vehicles) {
    push(byMake, v.make, v._id);
    push(byModel, v.model, v._id);
    push(byAny, v.make, v._id);
    push(byAny, v.model, v._id);
  }

  vehicleIndexCache.value = { byMake, byModel, byAny };
  vehicleIndexCache.builtAt = now;
  return vehicleIndexCache.value;
}

/** Deduplicate ObjectIds by string value — the same vehicle can be hit by both make and model. */
function uniqueIds(ids) {
  const seen = new Map();
  for (const id of ids) seen.set(String(id), id);
  return Array.from(seen.values());
}

/**
 * Resolve the explicit vehicle FILTER params to ObjectIds.
 *
 * `vehicleType` is the legacy param name and `vehicleMake` is what the storefront
 * sidebar actually sends. Both mean the same thing and both must filter, or the
 * sidebar's selection is silently dropped and the whole catalogue comes back as
 * though nothing were selected — a bug this codebase has already shipped once.
 *
 * Returns null when no vehicle filter was requested. Returns an EMPTY ARRAY when
 * one was requested but names nothing known; buildFilters turns that into a
 * match-nothing clause rather than treating it as "no filter".
 */
async function resolveVehicleFilter({ vehicleMake, vehicleType, vehicleModel }) {
  const makes = normalizeList(vehicleMake || vehicleType);
  const models = normalizeList(vehicleModel);
  if (makes.length === 0 && models.length === 0) return null;

  const { byMake, byModel } = await getVehicleIndex();
  const dimensions = [];
  if (makes.length > 0) {
    dimensions.push(makes.flatMap((m) => byMake.get(m.toLowerCase()) || []));
  }
  if (models.length > 0) {
    dimensions.push(models.flatMap((m) => byModel.get(m.toLowerCase()) || []));
  }

  // Make AND model together must narrow, not widen — selecting Toyota + Hilux
  // means vehicles that are both, so the dimensions intersect.
  const intersected = dimensions.reduce((acc, cur) => {
    if (acc === null) return cur;
    const curSet = new Set(cur.map(String));
    return acc.filter((id) => curSet.has(String(id)));
  }, null);

  return uniqueIds(intersected || []);
}

/**
 * Resolve free-text query terms to category and vehicle ObjectIds, so the recall
 * lanes can match on references instead of on denormalized name strings.
 */
async function resolveQueryEntities(cleanedQuery, tokens) {
  const result = { queryCategoryIds: [], queryVehicleIds: [], synonymCategoryIds: [], synonymTerms: [] };
  if (!cleanedQuery) return result;

  if (!categoryMappingService.initialized) await categoryMappingService.initialize();

  // Whole-query category match, subtree-expanded. ES matched `categories.name`
  // with operator:'and' against the whole query, so a broad "brakes" returns the
  // Brakes members; the subtree expansion additionally makes a hub query return
  // its descendants, which ES could not do at all (it had no notion of hierarchy
  // and had to be handed a flat slug list from the caller).
  const direct = categoryMappingService.findCategory(cleanedQuery);
  if (direct) {
    const ids = await categoryMappingService.getAllCategoryIdsIncludingChildren(direct._id.toString());
    result.queryCategoryIds = ids.map(toObjectId).filter(Boolean);
  }

  // Vehicle recall. Try the whole query first so two-word models ("land cruiser")
  // resolve as one vehicle, then fall back to individual tokens.
  const { byAny } = await getVehicleIndex();
  const vehicleIds = [...(byAny.get(cleanedQuery.toLowerCase()) || [])];
  for (const token of tokens) {
    vehicleIds.push(...(byAny.get(token.toLowerCase()) || []));
  }
  result.queryVehicleIds = uniqueIds(vehicleIds);

  // Synonyms broaden ONLY single-token, category-style queries. For a specific
  // multi-word query they are the bug: expanding "spoiler" pulled in every bumper
  // and returned 151 results, so literal intent has to win there.
  if (tokens.length <= 1) {
    const synonyms = expandSynonyms(cleanedQuery).slice(1); // drop the literal
    result.synonymTerms = synonyms;
    const synonymIds = [];
    for (const synonym of synonyms) {
      const cat = categoryMappingService.findCategory(synonym);
      if (!cat) continue;
      const ids = await categoryMappingService.getAllCategoryIdsIncludingChildren(cat._id.toString());
      synonymIds.push(...ids.map(toObjectId).filter(Boolean));
    }
    result.synonymCategoryIds = uniqueIds(synonymIds);
  }

  return result;
}

function toObjectId(id) {
  if (id instanceof mongoose.Types.ObjectId) return id;
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

/** Redis key for one day's search-term counters. */
function analyticsKey(date = new Date()) {
  return `search:analytics:${date.toISOString().slice(0, 10)}`;
}

class AtlasSearchService {
  constructor() {
    // Unlike Elasticsearch there is no separate cluster to reach, no credentials
    // and no circuit breaker: the search index lives on the MongoDB connection
    // this process already holds and already monitors. The only thing that can be
    // "down" independently is the index itself — absent, still building, or
    // failed — which is what the readiness probe below checks.
    this.indexName = ATLAS_SEARCH_INDEX_NAME;
    this.readiness = { ready: false, status: null, lastChecked: null, cacheTimeout: 30000 };
    this.indexPopulation = { count: null, lastChecked: null, cacheTimeout: 60000 };
  }

  __resetReadiness() {
    this.readiness = { ready: false, status: null, lastChecked: null, cacheTimeout: 30000 };
    this.indexPopulation = { count: null, lastChecked: null, cacheTimeout: 60000 };
  }

  /**
   * Is the search index queryable?
   *
   * A search index that exists but is still building answers queries with ZERO
   * hits rather than an error — the same trap as a missing Elasticsearch index,
   * and the reason searchService distinguishes "no results" from "no index" at
   * all. So readiness is resolved from the index STATUS, not from whether a query
   * threw. Anything other than READY reports unavailable, which routes searches
   * to the MongoDB fallback: expensive, but correct.
   */
  async isConnected() {
    if (mongoose.connection?.readyState !== 1) return false;

    const now = Date.now();
    if (this.readiness.lastChecked && now - this.readiness.lastChecked < this.readiness.cacheTimeout) {
      return this.readiness.ready;
    }

    try {
      const indexes = await Product.collection.listSearchIndexes(this.indexName).toArray();
      const index = indexes.find((i) => i.name === this.indexName);
      const status = index?.status ?? 'MISSING';
      const ready = status === 'READY';

      if (this.readiness.lastChecked !== null && ready !== this.readiness.ready) {
        console[ready ? 'log' : 'error'](
          ready
            ? '✓ Atlas Search index is READY; search is back on the index'
            : `[AtlasSearch] Index "${this.indexName}" is ${status} — every public search is now ` +
              'falling back to a full MongoDB scan. Expect elevated Atlas query targeting.'
        );
      }

      this.readiness = { ...this.readiness, ready, status, lastChecked: now };
      return ready;
    } catch (_error) {
      // listSearchIndexes is unsupported on a non-Atlas deployment (a local
      // mongod, or CI's in-memory server). That is not an error condition — it
      // is "this deployment has no Atlas Search", which must resolve to the
      // MongoDB fallback quietly rather than logging on every request.
      this.readiness = { ...this.readiness, ready: false, status: 'UNSUPPORTED', lastChecked: now };
      return false;
    }
  }

  /**
   * How many documents the index can actually serve.
   *
   * searchService uses this to decide whether a zero-hit answer is trustworthy:
   * a populated index returning nothing means "we genuinely don't stock this",
   * while an empty or unknown one means the index is broken and MongoDB must be
   * consulted. `null` (unknown) therefore has to fail TOWARDS the expensive scan
   * rather than towards showing an empty catalogue.
   *
   * With Atlas the index mirrors the collection, so the count is the number of
   * active products. Cached, because it would otherwise add a round trip to every
   * empty search.
   */
  async getIndexedDocumentCount({ force = false } = {}) {
    const now = Date.now();
    if (
      !force &&
      this.indexPopulation.lastChecked &&
      now - this.indexPopulation.lastChecked < this.indexPopulation.cacheTimeout
    ) {
      return this.indexPopulation.count;
    }

    if (!(await this.isConnected())) {
      this.indexPopulation = { ...this.indexPopulation, count: null, lastChecked: now };
      return null;
    }

    try {
      // Bounded by the isActive index; this is a count over a ~1k-document
      // collection behind a 60s cache, not a scan on the request path.
      const count = await Product.countDocuments({ isActive: true });
      this.indexPopulation = { ...this.indexPopulation, count, lastChecked: now };
      return count;
    } catch (error) {
      console.error('[AtlasSearch] Failed to read indexed document count:', error.message);
      this.indexPopulation = { ...this.indexPopulation, count: null, lastChecked: now };
      return null;
    }
  }

  /** Clamp and clean free-text input. Shared helper so every engine accepts the same queries. */
  sanitizeQuery(input, maxLength = 200) {
    return sanitizeQuery(input, maxLength);
  }

  async searchProducts(params) {
    const { page = 1, limit = 20 } = params;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 20);

    const rawQuery = params.q || params.search || null;
    const safeQ = rawQuery ? this.sanitizeQuery(rawQuery) : null;
    const tokens = safeQ ? contentTokens(safeQ) : [];
    const cleanedQuery = safeQ ? (tokens.length ? tokens.join(' ') : safeQ) : null;

    const entities = await resolveQueryEntities(cleanedQuery, tokens);
    const vehicleFilterIds = await resolveVehicleFilter(params);

    // `categoryIds` is the subtree-expanded ObjectId list resolved ONCE by
    // SearchService.resolveCategorySubtree and handed to both engines. Using the
    // ids (not the slugs Elasticsearch needed) is what makes this filter and the
    // MongoDB filter structurally incapable of disagreeing.
    const categoryIds = (params.categoryIds || []).map(toObjectId).filter(Boolean);

    const resolved = { ...entities, tokens, cleanedQuery, categoryIds, vehicleFilterIds };
    const searchStage = buildSearchStage(params, resolved);

    // Two aggregations rather than one $facet over everything. The facet branches
    // need every matching document, but only `limit` of them are ever rendered —
    // running them together would drag full product documents (descriptions
    // included) through an in-memory $facet. Splitting lets the products pipeline
    // page first and the facet pipeline project down to five thin fields.
    const [productDocs, facetDocs] = await Promise.all([
      Product.collection
        .aggregate([
          { $search: searchStage },
          { $addFields: { _score: { $meta: 'searchScore' } } },
          { $skip: (pageNum - 1) * limitNum },
          { $limit: limitNum },
        ])
        .toArray(),
      Product.collection.aggregate(this.buildFacetPipeline(searchStage)).toArray(),
    ]);

    const facetResult = facetDocs[0] || {};
    const total = facetResult.total?.[0]?.value ?? 0;

    const products = productDocs.map((doc) => {
      // Atlas returns the REAL MongoDB document, so `images` is authoritative
      // rather than a copy that may predate the field — the reason the
      // Elasticsearch path needed a primaryImage fallback here. Normalization is
      // still applied so the API shape is identical between engines.
      const images = normalizeImages(doc.images, doc.name);
      return { ...doc, images, _id: doc._id, _score: doc._score };
    });

    const pages = Math.ceil(total / limitNum);
    return {
      products,
      pagination: {
        total,
        pages,
        currentPage: pageNum,
        hasNext: pageNum < pages,
        hasPrev: pageNum > 1,
      },
      facets: this.shapeFacets(facetResult, total, params),
    };
  }

  /**
   * Facet counts over the full matched set.
   *
   * Deliberately computed with the aggregation framework rather than Atlas's
   * $searchMeta facet collector. Two reasons: the category and vehicle facets
   * need ObjectId → name resolution that $searchMeta cannot do, and $searchMeta
   * would require the facet fields to carry stringFacet token types that only
   * exist to serve it. Which of the two is FASTER on this catalogue is an open
   * question and an explicit follow-up — it is a measurement, not a guess, and it
   * belongs in the optimization pass rather than in this diff.
   */
  buildFacetPipeline(searchStage) {
    const categoryCollection = mongoose.model('Category').collection.name;
    const vehicleCollection = Vehicle.collection.name;

    return [
      { $search: searchStage },
      // Project BEFORE $facet. Descriptions are long and SEO-stuffed; carrying
      // them into an in-memory $facet over the whole matched set is the one way
      // this pipeline could get expensive.
      { $project: { brand: 1, categories: 1, compatibleVehicles: 1, price: 1, averageRating: 1 } },
      {
        $facet: {
          total: [{ $count: 'value' }],
          brands: [
            { $match: { brand: { $nin: [null, ''] } } },
            { $group: { _id: '$brand', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: 100 },
          ],
          categories: [
            { $unwind: '$categories' },
            { $group: { _id: '$categories', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 100 },
            {
              $lookup: {
                from: categoryCollection,
                localField: '_id',
                foreignField: '_id',
                as: 'category',
              },
            },
            { $unwind: '$category' },
            { $project: { _id: '$category.name', count: 1 } },
          ],
          vehicleTypes: [
            { $unwind: '$compatibleVehicles' },
            { $group: { _id: '$compatibleVehicles', count: { $sum: 1 } } },
            {
              $lookup: {
                from: vehicleCollection,
                localField: '_id',
                foreignField: '_id',
                as: 'vehicle',
              },
            },
            { $unwind: '$vehicle' },
            // Roll models up to their make — the ES `vehicle_types` aggregation
            // bucketed on vehicle_makes, so the sidebar expects makes here.
            { $group: { _id: '$vehicle.make', count: { $sum: '$count' } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: 100 },
          ],
          priceRanges: [
            { $match: { price: { $ne: null } } },
            { $group: { _id: bucketSwitch('$price', PRICE_BUCKETS), count: { $sum: 1 } } },
          ],
          ratingRanges: [
            { $match: { averageRating: { $ne: null } } },
            { $group: { _id: bucketSwitch('$averageRating', RATING_BUCKETS), count: { $sum: 1 } } },
          ],
        },
      },
    ];
  }

  /** Map raw facet buckets into the exact response shape the storefront sidebar already consumes. */
  shapeFacets(facetResult, total, params) {
    const countByKey = (rows) => new Map((rows || []).map((r) => [r._id, r.count]));
    const priceCounts = countByKey(facetResult.priceRanges);
    const ratingCounts = countByKey(facetResult.ratingRanges);

    const rangeFacet = (buckets, counts) =>
      buckets.map(({ key, from, to }) => ({ from, to, count: counts.get(key) || 0 }));

    return {
      categories: (facetResult.categories || []).map((b) => ({ name: b._id, count: b.count })),
      brands: (facetResult.brands || []).map((b) => ({ name: b._id, count: b.count })),
      vehicleTypes: (facetResult.vehicleTypes || []).map((b) => ({ name: b._id, count: b.count })),
      priceRanges: rangeFacet(PRICE_BUCKETS, priceCounts),
      ratingRanges: rangeFacet(RATING_BUCKETS, ratingCounts),
      // ES aggregated `isActive` here. Public search filters to active products,
      // so this was always a single bucket; it is reproduced rather than dropped
      // because the sidebar reads the shape.
      availability: [{ name: !params.includeInactive, count: total }],
    };
  }

  /**
   * Autocomplete suggestions for the search box.
   *
   * Returns the same {suggestions, corrections, total} envelope Elasticsearch
   * returned, so the frontend needs no change.
   *
   * ⚠ `corrections` is now ALWAYS EMPTY, by an explicit product decision. ES
   * populated it from `term` suggesters (suggest_mode: 'always') which proposed a
   * respelling of a badly mistyped word — "brkae" → "brake". Atlas Search has no
   * suggester of any kind, and the honest replacement is nothing rather than a
   * worse thing wearing the same name. The array is still returned so the
   * frontend contract holds and the feature can be restored without a redeploy of
   * the client.
   *
   * What survives is the part shoppers actually use: partial words. The
   * `autocomplete` field type (edgeGram, 2–15 grams) matches "brak" → "Brake
   * Pads" from the second character, and `fuzzy` on the text lane still absorbs a
   * single typo in a long word.
   */
  async getSearchSuggestions(query, limit = 10) {
    const safeQuery = this.sanitizeQuery(query);
    if (!safeQuery) return { suggestions: [], corrections: [], total: 0 };

    const lower = safeQuery.toLowerCase();

    const docs = await Product.collection
      .aggregate([
        {
          $search: {
            index: this.indexName,
            compound: {
              filter: [{ equals: { path: 'isActive', value: true } }],
              must: [
                {
                  compound: {
                    should: [
                      { autocomplete: { query: safeQuery, path: 'name', score: { boost: { value: 3 } } } },
                      {
                        text: {
                          query: safeQuery,
                          path: 'name',
                          // Spread, never `fuzzy: undefined`. The MongoDB driver
                          // does not ignore undefined by default — it serializes
                          // it as null, and Atlas rejects a null fuzzy option
                          // outright. A short query legitimately has no fuzzy
                          // clause, so the key must be absent, not empty.
                          ...(fuzzyFor(safeQuery) ? { fuzzy: fuzzyFor(safeQuery) } : {}),
                          score: { boost: { value: 2 } },
                        },
                      },
                      { text: { query: safeQuery, path: 'brand', score: { boost: { value: 2 } } } },
                      { text: { query: safeQuery, path: 'sku' } },
                    ],
                    minimumShouldMatch: 1,
                  },
                },
              ],
            },
          },
        },
        // Over-fetch relative to `limit`: one product contributes at most one name
        // suggestion but many products share a brand, so the dedupe below can
        // collapse a page of hits into very few entries.
        { $limit: Math.max(limit * 3, 30) },
        { $project: { name: 1, slug: 1, brand: 1, images: 1, categories: 1 } },
      ])
      .toArray();

    // Collected into TWO lists so the final order is products/brands first and
    // categories after — the order Elasticsearch produced, because it processed
    // the product+brand hits before the category hits.
    //
    // Order is not cosmetic here: the list is truncated to `limit`. Emitting
    // categories first let them consume the entire dropdown, so typing "brak"
    // returned five categories and not one product. Whoever is typing a product
    // name needs to see products.
    const productSuggestions = [];
    const categorySuggestions = [];
    const seenNames = new Set();
    const seenBrands = new Set();

    for (const doc of docs) {
      if (doc.name && !seenNames.has(doc.name.toLowerCase())) {
        seenNames.add(doc.name.toLowerCase());
        const images = normalizeImages(doc.images, doc.name);
        const primary = images.find((img) => img.isPrimary) || images[0];
        productSuggestions.push({
          id: `product-${doc._id}`,
          slug: doc.slug || undefined,
          text: doc.name,
          type: 'product',
          // ES read the first category's NAME off the denormalized document.
          // Here `categories` is an array of ObjectIds, so the name is looked up
          // in the taxonomy cache — no extra query, and null when unresolvable
          // exactly as before.
          category: this.firstCategoryName(doc.categories),
          imageUrl: primary?.url || null,
          value: doc.slug || doc._id,
        });
      }

      if (doc.brand && !seenBrands.has(doc.brand.toLowerCase())) {
        seenBrands.add(doc.brand.toLowerCase());
        productSuggestions.push({
          id: `brand-${doc.brand.toLowerCase().replace(/\s+/g, '-')}`,
          text: doc.brand,
          type: 'brand',
          value: doc.brand,
        });
      }
    }

    // Category names come from the in-memory taxonomy cache rather than from
    // product documents. ES had to read them off indexed products because its
    // documents carried denormalized category names; here the categories are a
    // small, already-loaded map, so matching them directly is both cheaper and
    // complete — a category with no matching product still suggests.
    if (!categoryMappingService.initialized) await categoryMappingService.initialize();
    const seenCategories = new Set();
    for (const category of categoryMappingService.getCategoryMap().values()) {
      const name = category?.name;
      if (!name) continue;
      const key = name.toLowerCase();
      if (seenCategories.has(key) || !key.includes(lower)) continue;
      seenCategories.add(key);
      categorySuggestions.push({
        id: `category-${key.replace(/\s+/g, '-')}`,
        text: name,
        type: 'category',
        value: name,
      });
    }

    return {
      suggestions: [...productSuggestions, ...categorySuggestions].slice(0, limit),
      corrections: [],
      total: docs.length,
    };
  }

  /** Resolve the first category ObjectId on a product to its display name, or null. */
  firstCategoryName(categories) {
    if (!Array.isArray(categories) || categories.length === 0) return null;
    const found = categoryMappingService.findCategory(String(categories[0]));
    return found?.name ?? null;
  }

  /**
   * Record one search term.
   *
   * Redis, NOT MongoDB — and that is a deliberate, expensive lesson rather than a
   * preference. Elasticsearch stored one document per search in a `search_analytics`
   * index; the obvious port is one document per search in a Mongo collection, which
   * is exactly the shape that made `rate_limit_events` 95% of the database and
   * forced an Atlas tier upgrade. Per-request telemetry belongs in Redis counters.
   *
   * A sorted set per day gives popular-terms ranking for free and collapses N
   * searches of the same term into ONE member instead of N documents. The key
   * expires on its own, so retention needs no sweeper job.
   *
   * Best-effort by design: analytics must never fail a search. Every error is
   * swallowed after logging, matching the ES implementation's contract.
   *
   * `_userId` is accepted but deliberately UNUSED. Elasticsearch stored it on
   * every search document, and nothing ever read it back — getSearchAnalytics
   * only ever aggregated popular terms and daily volume. Keying counters per user
   * would multiply the cardinality of a telemetry store for a report that does
   * not exist. The parameter stays in the signature so the two engines remain
   * call-compatible and the capability can be restored deliberately.
   */
  async logSearchQuery(query, _userId = null) {
    const term = this.sanitizeQuery(query);
    if (!term) return;

    try {
      const redis = getRedisClient();
      if (!redis) return;

      const key = analyticsKey();
      await redis.zincrby(key, 1, term.toLowerCase());
      // 90 days, refreshed on write. Bounded retention without a cleanup job.
      await redis.expire(key, 90 * 24 * 60 * 60);
    } catch (error) {
      console.error('[AtlasSearch] Failed to log search query:', error.message);
    }
  }

  /**
   * Popular terms and per-day volume for the admin analytics screen.
   *
   * Reproduces the two ES aggregations (`popular_terms` over 20 buckets and a
   * daily `date_histogram`) by walking one sorted set per day in the range. The
   * range is capped because each day is one Redis round trip — an unbounded date
   * range from the admin UI would otherwise fan out to hundreds of calls.
   */
  async getSearchAnalytics(startDate, endDate) {
    const redis = getRedisClient();
    if (!redis) return { popularTerms: [], searchesOverTime: [] };

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return { popularTerms: [], searchesOverTime: [] };
    }

    const MAX_DAYS = 180;
    const days = [];
    for (let d = new Date(start); d <= end && days.length < MAX_DAYS; d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(new Date(d));
    }

    const totals = new Map();
    const searchesOverTime = [];

    for (const day of days) {
      const key = analyticsKey(day);
      // withscores returns a flat [member, score, member, score, …] array.
      const flat = await redis.zrange(key, 0, -1, 'WITHSCORES');
      let dayTotal = 0;
      for (let i = 0; i < flat.length; i += 2) {
        const term = flat[i];
        const count = Number(flat[i + 1]) || 0;
        dayTotal += count;
        totals.set(term, (totals.get(term) || 0) + count);
      }
      searchesOverTime.push({ date: day.toISOString().slice(0, 10), count: dayTotal });
    }

    const popularTerms = Array.from(totals.entries())
      .map(([term, count]) => ({ term, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    return { popularTerms, searchesOverTime };
  }

  /**
   * Interface parity with the Elasticsearch service, which had a client holding
   * sockets to close. Atlas Search runs over the shared Mongoose connection, which
   * server.js owns and closes; tearing it down here would disconnect the whole app.
   */
  async shutdown() {
    this.__resetReadiness();
  }

  getConnectionStatus() {
    return {
      engine: 'atlas',
      index: this.indexName,
      available: this.readiness.ready,
      status: this.readiness.status,
      lastChecked: this.readiness.lastChecked,
    };
  }
}

export default new AtlasSearchService();
