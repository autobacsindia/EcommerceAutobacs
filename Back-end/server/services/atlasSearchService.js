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
import { normalizeImages, sanitizeQuery, pickCorrection } from '../utils/searchHelpers.js';
import { NON_PURCHASABLE_STOCK, PURCHASABLE_STOCK } from '../utils/stockStatus.js';
import { ATLAS_SEARCH_INDEX_NAME, ATLAS_SYNONYM_MAPPING_NAME } from '../config/atlasSearchIndex.js';
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
 * One token, expanded through the index's synonym mappings.
 *
 * A SEPARATE clause rather than an option on buildTokenClause, because Atlas
 * rejects `synonyms` and `fuzzy` in the same `text` operator. Trying to fold them
 * together produces a query the cluster refuses — and searchService catches engine
 * errors and serves the MongoDB fallback, so the symptom would be "search works
 * but every query is a full collection scan", not an error anyone sees.
 *
 * Scored BELOW the literal lane (1 vs 3 on name): a product that actually contains
 * the typed word must outrank one reached only through a synonym.
 */
export function buildSynonymClause(token) {
  return {
    compound: {
      should: HIGH_SIGNAL_FIELDS.filter((f) => f.path === 'name' || f.path === 'tags').map((field) => ({
        text: {
          query: token,
          path: field.path,
          synonyms: ATLAS_SYNONYM_MAPPING_NAME,
          score: { boost: { value: field.boost / 3 } },
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
  relaxLevel = 0,
  synonymsAvailable = false,
}) {
  const lanes = [];

  if (tokens.length > 0) {
    lanes.push({
      compound: {
        should: tokens.map((t) => buildTokenClause(t, { fuzzy: true })),
        // relaxLevel 1 drops the required-token count to ONE — "any token matches"
        // instead of "70% of them". This is the standard zero-result recovery every
        // large storefront runs (Algolia calls it removeWordsIfNoResults): a query
        // like "tailgate spoiler hilux" that names a real intent but no single
        // product should degrade to related results, not to an empty grid.
        //
        // It is applied ONLY on retry, never on the first pass, because widening
        // recall by default is precisely what produced "151 results for spoiler".
        minimumShouldMatch: relaxLevel >= 1 ? 1 : minimumTokensRequired(tokens.length),
      },
    });

    lanes.push({
      compound: {
        should: tokens.map((t) => buildTokenClause(t, { fuzzy: false })),
        minimumShouldMatch: tokens.length,
      },
    });

    // Synonym lane. Requires ALL tokens to match (after expansion), which is what
    // keeps it a precision-preserving alternative rather than a widening one: it
    // finds "LED Lamp" for "lights", but cannot pull in a product that merely
    // shares one expanded token with the query.
    //
    // Unlike the old query-time expansion this runs for multi-word queries too.
    // That is safe here and was not safe there: expansion happens per token at
    // analysis time instead of OR-ing whole alternate queries into recall, and the
    // one-way `explicit` mappings stop a specific term expanding back into its
    // broad category. See ATLAS_SYNONYM_MAPPINGS.
    //
    // ⚠ GATED ON THE LIVE INDEX, and this is load-bearing rather than defensive.
    // Atlas rejects a query naming a synonym mapping the index does not have —
    // verified: `unknown synonym mapping name "productSynonyms"`. searchService
    // catches engine errors and serves the MongoDB fallback, so shipping this lane
    // before the index redeploy would turn EVERY text search into a silent
    // full-collection scan, with a storefront that still looks fine.
    //
    // Gating removes the deploy-ordering hazard entirely instead of documenting it:
    // the code is safe to ship before the index, and the lane switches itself on
    // within one readiness-cache TTL of the mapping appearing. Defaults to OFF, so
    // anything that does not explicitly know the mapping exists gets the safe query.
    if (synonymsAvailable) {
      lanes.push({
        compound: {
          should: tokens.map((t) => buildSynonymClause(t)),
          minimumShouldMatch: tokens.length,
        },
      });
    }
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

  // The hand-rolled synonym NAME lane used to live here — one `text` clause per
  // expanded term, applied only to single-token queries because doing it for
  // longer ones over-recalled badly. buildSynonymClause replaces it with the
  // engine's own analysis-time expansion, which covers every query length and
  // cannot multiply the query, so buildRecall no longer takes `synonymTerms` at
  // all. resolveQueryEntities still RESOLVES synonyms — but only to category ids,
  // for the lane below, which does something the engine cannot: map a term to a
  // taxonomy subtree.

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
export function buildRankingShould({ cleanedQuery, vehicleIds = [], capabilities = EMPTY_CAPABILITIES }) {
  const should = [
    // ── Availability demotion ────────────────────────────────────────────────
    //
    // Atlas has no negative boost, so "sink what nobody can buy" is expressed as a
    // positive constant on what they CAN buy. This is the Atlas expression of the
    // `{ stock: 1 }` primary sort the MongoDB fallback has always applied — without
    // it the two engines ordered the same query differently, and 78 of 931 active
    // products (58 out, 20 backorder) competed for the top slot on text score alone.
    //
    // ── MEASURED 2026-08-31, prod cluster, 931 active products ────────────────
    //
    // Position of the FIRST out-of-stock/backorder hit, by constant:
    //
    //   N=0  spoiler:15  hilux:1  led:—  body kit:2  winch:2  suspension kit:3
    //   N=2  spoiler:—   hilux:1  led:—  body kit:8  winch:7  suspension kit:7
    //   N=5  spoiler:—   hilux:4  led:—  body kit:—  winch:9  suspension kit:9
    //   N=8  spoiler:—   hilux:—  led:—  body kit:—  winch:10 suspension kit:9
    //
    // In-stock relative ordering was UNCHANGED at every N (0 inversions vs the
    // N=0 baseline) — a uniform constant over the in-stock set cannot reorder it,
    // which is the property that makes this safe to apply to every query.
    //
    // 5 is chosen over 8 deliberately. It clears out-of-stock from the top three
    // everywhere, while staying below the exact-name phrase boost of 10 so a
    // genuinely perfect name match is demoted but not buried — backorder items are
    // enquiry-only, not worthless, and burying them discards a real sales lead.
    {
      in: {
        path: 'stock',
        value: [...PURCHASABLE_STOCK],
        score: { constant: { value: 5 } },
      },
    },

    // Popularity and quality nudges, applied whether or not there is query text.
    // `exists` is the carrier clause: documents missing the field simply do not
    // match it and score 0, which is exactly ES's `missing: 0`.
    //
    // NOTE: an `isFastMoving` constant boost of 2 sat here until 2026-09-01. It was
    // removed because the feature is dead — the section that rendered it
    // (ModernFastMovingSection) is referenced only by a jest mock and never mounted.
    // It was not a harmless no-op: exactly 3 of 931 products carry the flag (one of
    // them out of stock, none touched since July), so it was handing three arbitrary
    // products a permanent +2 on EVERY search, including ones where they were
    // irrelevant. See salesScore below for the signal that replaces it.
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

    // ── Commercial signal ────────────────────────────────────────────────────
    //
    // Trailing, time-decayed sales (services/salesScoreService.js). This is the
    // only clause that distinguishes a best seller from something that has never
    // sold: measured on prod, just 5 of 931 active products carry any review or
    // rating, so the two clauses above are inert for 99.5% of the catalogue.
    //
    // log1p, matching totalReviews: raw units sold is heavy-tailed, and without
    // compression one runaway product would dominate every query it appears in.
    // `undefined: 0` means a product that has never sold simply scores nothing
    // here rather than being penalised.
    //
    // ── MEASURED 2026-09-01, prod, median top-12 score by query ──────────────
    //   spoiler 37-40 | hilux 24-30 | led 24-28 | body kit 55-59 | winch 47-51
    // Adjacent results sit 0.0-1.7 apart. A constant of 0.8 lets a strong seller
    // (log1p(20) ≈ 3.0 → +2.4) move several places without ever overturning the
    // exact-name phrase boost of 10 — popularity should break near-ties, not
    // outrank a product the shopper named outright.
  ];

  // Gated: Atlas rejects a function-score path the index does not map as numeric,
  // and the rejection surfaces as a silent full-collection Mongo scan rather than
  // an error. See readCapabilities.
  if (capabilities.salesScore) {
    should.push({
      exists: {
        path: 'salesScore',
        score: {
          function: {
            multiply: [
              { log1p: { path: { value: 'salesScore', undefined: 0 } } },
              { constant: 0.8 },
            ],
          },
        },
      },
    });
  }

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
export function buildFilters(params, resolved = {}, exclude = {}) {
  const {
    minPrice, maxPrice, inStock, rating, includeInactive = false,
    isFeatured, productType,
  } = params;
  const { categoryIds = [], vehicleFilterIds = null } = resolved;

  // Per-dimension exclusion is what makes facets DISJUNCTIVE (OR within a
  // dimension, AND across them). A brand facet counted with the brand filter still
  // applied answers "how many of the brand you already picked", which is useless —
  // every other brand reads 0 and the sidebar becomes a dead end. Counting it with
  // its OWN filter removed answers the question the shopper is actually asking:
  // "what would I get if I picked this instead / as well".
  const {
    excludeBrand = false, excludeCategory = false, excludePrice = false,
    excludeRating = false, excludeVehicle = false, excludeAvailability = false,
  } = exclude;

  const filter = [];
  const mustNot = [];

  // Load-bearing. Elasticsearch only ever held active products, so this rule was
  // implicit in the index's contents. Atlas indexes the whole collection, so
  // dropping this line would publish every unpublished draft to the storefront.
  if (!includeInactive) {
    filter.push({ equals: { path: 'isActive', value: true } });
  }

  // Both of these were SILENTLY DROPPED before: buildFilters never destructured
  // them, so `?isFeatured=true` produced only the isActive clause and the storefront
  // "View all featured" link answered with the entire catalogue (931 products) under
  // the heading "Featured". SearchService.buildBaseQuery handled both all along, so
  // this was pure engine divergence — the bug appeared the moment SEARCH_ENGINE
  // flipped to atlas and was invisible on the MongoDB fallback.
  //
  // Accepts the string 'true'/'false' the query string carries as well as a real
  // boolean, matching how buildBaseQuery reads the same param.
  if (isFeatured !== undefined && isFeatured !== '') {
    filter.push({ equals: { path: 'isFeatured', value: isFeatured === 'true' || isFeatured === true } });
  }

  // Allowlisted rather than passed through: `productType` reaches the index as a
  // token, and an unrecognised value would filter to nothing instead of being
  // ignored. The list mirrors buildBaseQuery's exactly.
  if (productType && ['simple', 'variable', 'grouped'].includes(productType)) {
    filter.push({ equals: { path: 'productType', value: productType } });
  }

  if (categoryIds.length > 0 && !excludeCategory) {
    filter.push({ in: { path: 'categories', value: categoryIds } });
  }

  // `vehicleFilterIds` is null when no vehicle filter was requested, and an EMPTY
  // ARRAY when one was requested but matched no known vehicle. Those must behave
  // differently: no filter vs. a filter that matches nothing. Collapsing them
  // would silently answer with the whole catalogue as though nothing were
  // selected — the same failure the ES `vehicleType`/`vehicleMake` param mismatch
  // produced. Atlas rejects an empty `in`, so the impossible case is expressed
  // with a mustNot-everything clause instead.
  if (Array.isArray(vehicleFilterIds) && !excludeVehicle) {
    if (vehicleFilterIds.length > 0) {
      filter.push({ in: { path: 'compatibleVehicles', value: vehicleFilterIds } });
    } else {
      mustNot.push({ exists: { path: '_id' } });
    }
  }

  const brands = excludeBrand ? [] : normalizeList(params.brand);
  if (brands.length > 0) {
    // The `brand` token field carries a lowercase normalizer, so the query side
    // must lowercase too. This pair replaces ES's per-term case_insensitive flag;
    // breaking the pair matches nothing at all.
    filter.push({ in: { path: 'brand', value: brands.map((b) => b.toLowerCase()) } });
  }

  if ((minPrice || maxPrice) && !excludePrice) {
    const range = { path: 'price' };
    if (minPrice) range.gte = Number(minPrice);
    if (maxPrice) range.lte = Number(maxPrice);
    filter.push({ range });
  }

  if ((inStock === 'true' || inStock === true) && !excludeAvailability) {
    // "In stock only" means actually on hand — excludes out AND backorder.
    // The list is imported, not written here: the MongoDB fallback excluded only
    // 'out', so the two engines answered the same URL differently. One constant,
    // derived from isPurchasable(), makes that drift impossible.
    mustNot.push({ in: { path: 'stock', value: [...NON_PURCHASABLE_STOCK] } });
  }

  const ratings = excludeRating ? [] : normalizeList(rating).map(Number).filter((r) => !Number.isNaN(r));
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
export function buildSearchStage(params, resolved = {}, { relaxLevel = 0, capabilities = EMPTY_CAPABILITIES, exclude = {} } = {}) {
  const { tokens = [], cleanedQuery = null } = resolved;

  const recall = buildRecall({
    tokens,
    categoryIds: resolved.queryCategoryIds || [],
    vehicleIds: resolved.queryVehicleIds || [],
    synonymCategoryIds: resolved.synonymCategoryIds || [],
    relaxLevel,
    synonymsAvailable: capabilities.synonyms,
  });
  const { filter, mustNot } = buildFilters(params, resolved, exclude);

  const compound = { filter };
  if (recall.length > 0) {
    compound.must = [{ compound: { should: recall, minimumShouldMatch: 1 } }];
  }
  const rankingShould = buildRankingShould({ cleanedQuery, vehicleIds: resolved.queryVehicleIds || [], capabilities });
  if (rankingShould.length > 0) compound.should = rankingShould;
  if (mustNot.length > 0) compound.mustNot = mustNot;

  const stage = {
    index: ATLAS_SEARCH_INDEX_NAME,
    compound,
  };

  // Sorting. With query text and no explicit sort, rank by relevance — which for
  // Atlas means omitting `sort` entirely rather than naming a _score field.
  const sortBy = params.sortBy || 'createdAt';
  // Relevance is now expressible directly. It was previously inferred from
  // "sortBy is createdAt AND there is query text", so the UI could neither request
  // it nor return to it after the shopper picked another sort. `sortBy=relevance`
  // without query text is meaningless (every document scores the same), so it
  // falls back to recency rather than producing an arbitrary order.
  const isRelevance = Boolean(cleanedQuery)
    && (sortBy === 'relevance' || sortBy === 'createdAt');

  // `salesScore` is gated the same way the stockRank sort key is: sorting on a
  // field the live index does not map is rejected with "salesScore is not indexed
  // as sortable", and searchService turns that into a silent full-collection Mongo
  // scan. A shopper choosing "Best Selling" before the index redeploy must not be
  // able to trigger that, so the request degrades to recency until the field lands.
  const requested = sortBy === 'relevance' ? 'createdAt' : sortBy;
  const effectiveSort = requested === 'salesScore' && !capabilities.salesScore
    ? 'createdAt'
    : requested;
  if (!isRelevance) {
    // `stockRank` leads every explicit sort. Setting `sort` makes Atlas rank by the
    // sort keys ALONE and ignore relevance score, so the availability boost in
    // buildRankingShould — which is what demotes out-of-stock on a relevance query —
    // contributes nothing here. Without this key, every browse page, every "Newest"
    // and every "Price: low to high" ranked unbuyable products exactly as highly as
    // buyable ones.
    //
    // It must be `stockRank`, never `stock`: the enum sorts alphabetically as
    // backorder < in < low < out, so sorting on the string promotes precisely what
    // it was meant to sink. The MongoDB fallback had that bug for real.
    // Gated: Atlas answers "stockRank is not indexed as sortable" when the field is
    // absent, which the fallback then hides behind a full Mongo scan. Falls back to
    // the requested sort alone until the index redeploy lands.
    stage.sort = capabilities.stockRank
      ? { stockRank: 1, [effectiveSort]: params.order === 'asc' ? 1 : -1 }
      : { [effectiveSort]: params.order === 'asc' ? 1 : -1 };
  }

  return stage;
}

/**
 * Bucket boundaries for the price and rating facets, kept in the ES response
 * shape ({from, to, count}) so the storefront sidebar needs no change. Expressed
 * as an ordered table rather than a $bucket stage so the mapping from boundary to
 * emitted label is visible and unit-testable.
 */
// ⚠ RETAINED ONLY for the legacy `facets.priceRanges` field in searchProducts'
// response shape. These boundaries are in the WRONG CURRENCY: they are USD-scale
// (<50 / 50-100 / 100-200 / 200-500 / 500+) against a catalogue priced
// ₹1,450-₹814,200. Verified on prod: ALL 931 products fall in the single `500+`
// bucket and the other four are empty, so the facet carries exactly zero
// information. No client reads it — the storefront sidebar calls /products/facets,
// which now returns the data-derived histogram below instead.
//
// Kept rather than deleted so the response shape does not change under any
// consumer we have not found; B6 removes the branch that computes it.
const PRICE_BUCKETS = [
  { key: 'p0', to: 50 },
  { key: 'p1', from: 50, to: 100 },
  { key: 'p2', from: 100, to: 200 },
  { key: 'p3', from: 200, to: 500 },
  { key: 'p4', from: 500 },
];

/**
 * Build histogram bucket boundaries from the ACTUAL price range of a result set.
 *
 * Replaces the hardcoded PRICE_BUCKETS above, which were calibrated for a currency
 * this store does not use. Two properties matter:
 *
 *  1. The boundaries come from the data, so the slider and the chart can never
 *     again disagree with the catalogue. The UI previously hardcoded a ₹100,000
 *     maximum against a real maximum of ₹814,200, putting 176 products (19%)
 *     beyond reach of the price filter entirely.
 *
 *  2. Linear buckets over the full range would be useless here. Prices are
 *     heavily right-skewed (mean ₹62,611, max ₹814,200), so ~95% of products
 *     would land in the first bar and the chart would read as a single spike.
 *     Bucketing over [min, p95] with ONE overflow bucket for the tail keeps the
 *     visible distribution informative while still representing the expensive
 *     items honestly.
 *
 * Pure, so the boundary maths is unit-testable without a cluster.
 *
 * @param {number} min   lowest price in the result set
 * @param {number} max   highest price in the result set
 * @param {number} p95   95th-percentile price (falls back to max when unknown)
 * @param {number} count number of buckets before the overflow bucket
 * @returns {Array<{from: number, to: number|null}>} ordered, contiguous boundaries
 */
export function buildPriceHistogramBounds(min, max, p95, count = 20) {
  const lo = Number.isFinite(min) ? Math.max(0, Math.floor(min)) : 0;
  const hi = Number.isFinite(max) ? Math.ceil(max) : 0;
  if (hi <= lo) return lo === 0 && hi === 0 ? [] : [{ from: lo, to: null }];

  // The tail cut. Guard both directions: an unknown or nonsensical p95 falls back
  // to the full range rather than producing inverted buckets.
  const cut = Number.isFinite(p95) && p95 > lo && p95 < hi ? Math.ceil(p95) : hi;
  const width = (cut - lo) / count;
  if (!(width > 0)) return [{ from: lo, to: null }];

  const bounds = [];
  for (let i = 0; i < count; i += 1) {
    bounds.push({ from: Math.round(lo + i * width), to: Math.round(lo + (i + 1) * width) });
  }
  // Overflow bucket: `to: null` means "and above", so the most expensive product
  // is always representable and the slider's upper bound is always reachable.
  if (cut < hi) bounds.push({ from: Math.round(cut), to: null });
  return bounds;
}

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

/**
 * Which index-dependent query features are safe to use RIGHT NOW.
 *
 * Three features added on 2026-09-01 each reference something the index must
 * declare, and Atlas REJECTS the whole query when it does not — verified against
 * the live cluster:
 *
 *   sort on stockRank    → "stockRank is not indexed as sortable"
 *   salesScore scoring   → "path expression for function score requires path
 *                           \"salesScore\" to be indexed as numeric"
 *   synonyms lane        → "unknown synonym mapping name \"productSynonyms\""
 *
 * A rejected query is NOT a visible failure: searchService catches engine errors
 * and serves the MongoDB fallback, so the storefront looks completely normal while
 * every single search runs a full-collection scan. That is the exact shape of the
 * Atlas query-targeting alert this codebase has already been burned by twice.
 *
 * Reading the LIVE definition and gating on it removes the deploy-ordering hazard
 * instead of documenting it: the code is safe to ship before the index redeploy,
 * and each feature switches itself on within one readiness-cache TTL of its field
 * appearing. Order of deploy stops mattering, which is the only version of this
 * that survives contact with a real release process.
 */
const EMPTY_CAPABILITIES = Object.freeze({ stockRank: false, salesScore: false, synonyms: false });

function readCapabilities(index) {
  const fields = index?.latestDefinition?.mappings?.fields || {};
  const synonyms = (index?.latestDefinition?.synonyms || []);
  return Object.freeze({
    stockRank: Object.prototype.hasOwnProperty.call(fields, 'stockRank'),
    salesScore: Object.prototype.hasOwnProperty.call(fields, 'salesScore'),
    synonyms: synonyms.some((m) => m?.name === ATLAS_SYNONYM_MAPPING_NAME),
  });
}

/** Redis key for one day's search-term counters. */
function analyticsKey(date = new Date()) {
  return `search:analytics:${date.toISOString().slice(0, 10)}`;
}

/**
 * Redis key for one day's ZERO-RESULT search terms.
 *
 * Kept in its own sorted set rather than as a flag on the main one because the two
 * answer different questions and are read independently: "what do people search
 * for" ranks demand, "what do people search for and find nothing" is a direct
 * merchandising worklist — the single most actionable search report in retail. It
 * tells you what to stock, what to alias, and what to rename.
 */
function zeroResultKey(date = new Date()) {
  return `search:zero:${date.toISOString().slice(0, 10)}`;
}

/** Retention for both analytics sets. Refreshed on write, so no sweeper job. */
const ANALYTICS_TTL_SECONDS = 90 * 24 * 60 * 60;

class AtlasSearchService {
  constructor() {
    // Unlike Elasticsearch there is no separate cluster to reach, no credentials
    // and no circuit breaker: the search index lives on the MongoDB connection
    // this process already holds and already monitors. The only thing that can be
    // "down" independently is the index itself — absent, still building, or
    // failed — which is what the readiness probe below checks.
    this.indexName = ATLAS_SEARCH_INDEX_NAME;
    this.readiness = { ready: false, status: null, capabilities: EMPTY_CAPABILITIES, lastChecked: null, cacheTimeout: 30000 };
    this.indexPopulation = { count: null, lastChecked: null, cacheTimeout: 60000 };
  }

  __resetReadiness() {
    this.readiness = { ready: false, status: null, capabilities: EMPTY_CAPABILITIES, lastChecked: null, cacheTimeout: 30000 };
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
      const capabilities = readCapabilities(index);

      if (this.readiness.lastChecked !== null && ready !== this.readiness.ready) {
        console[ready ? 'log' : 'error'](
          ready
            ? '✓ Atlas Search index is READY; search is back on the index'
            : `[AtlasSearch] Index "${this.indexName}" is ${status} — every public search is now ` +
              'falling back to a full MongoDB scan. Expect elevated Atlas query targeting.'
        );
      }

      this.readiness = { ...this.readiness, ready, status, capabilities, lastChecked: now };
      return ready;
    } catch (_error) {
      // listSearchIndexes is unsupported on a non-Atlas deployment (a local
      // mongod, or CI's in-memory server). That is not an error condition — it
      // is "this deployment has no Atlas Search", which must resolve to the
      // MongoDB fallback quietly rather than logging on every request.
      this.readiness = { ...this.readiness, ready: false, status: 'UNSUPPORTED', capabilities: EMPTY_CAPABILITIES, lastChecked: now };
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

  /**
   * Is the synonym mapping actually deployed on the live index?
   *
   * Piggybacks the readiness probe's cached listSearchIndexes call, so this costs
   * nothing extra on the request path. Fails CLOSED: any uncertainty means the
   * synonym lane is omitted and the search still works, rather than the query being
   * rejected and every search collapsing to a MongoDB scan.
   */
  async getIndexCapabilities() {
    await this.isConnected();
    return this.readiness.capabilities || EMPTY_CAPABILITIES;
  }

  /** Back-compat shim for callers that only care about synonyms. */
  async hasSynonymMapping() {
    return (await this.getIndexCapabilities()).synonyms;
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

    // Two aggregations rather than one $facet over everything. The facet branches
    // need every matching document, but only `limit` of them are ever rendered —
    // running them together would drag full product documents (descriptions
    // included) through an in-memory $facet. Splitting lets the products pipeline
    // page first and the facet pipeline project down to five thin fields.
    //
    // Measured, not assumed: combining them is 12% faster today and was rejected
    // for the memory cliff it introduces. See buildFacetPipeline for the numbers.
    //
    // `$skip` is offset pagination, which the house rules otherwise forbid on a
    // growing collection. Kept deliberately: it is what the Elasticsearch path
    // did (`from`/`size`), so the migration preserved behaviour rather than
    // smuggling a frontend-contract change into it. Measured cost of the offset
    // at 931 products: page 1 = 67 ms, page 46 (`$skip 900`) = 116 ms. Real but
    // small, and page 46 is effectively never requested. Atlas supports
    // `searchAfter`, so the keyset rewrite is available and cheap to do — it just
    // is not earned by these numbers, and it changes the API's paging contract.
    // Resolved once per search, from the 30s-cached readiness probe — not per pass,
    // and not a fresh round trip.
    const capabilities = await this.getIndexCapabilities();

    const execute = async (relaxLevel) => {
      const searchStage = buildSearchStage(params, resolved, { relaxLevel, capabilities });
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
      const facets = facetDocs[0] || {};
      return { productDocs, facetResult: facets, total: facets.total?.[0]?.value ?? 0 };
    };

    // ── Zero-result recovery ─────────────────────────────────────────────────
    //
    // A strict first pass, then ONE relaxed retry if it found nothing. Two things
    // make this worth the extra round trip:
    //
    //  1. It is what shoppers expect. A multi-word query that names a real intent
    //     but matches no single product currently returns an empty grid; every
    //     large storefront degrades to related results with a "no exact matches"
    //     note instead.
    //  2. It REDUCES load. searchService treats a zero-hit answer as a possible
    //     index outage and re-asks MongoDB — a full-collection regex scan plus an
    //     unbounded countDocuments. Recovering here means that ladder never fires
    //     for a query that simply needed widening.
    //
    // The retry runs only when there is query text (a filters-only browse returning
    // nothing is a genuine empty set, not a recall failure) and only once, so a
    // search can never cost more than two passes.
    let relaxLevel = 0;
    let { productDocs, facetResult, total } = await execute(relaxLevel);
    if (total === 0 && cleanedQuery) {
      relaxLevel = 1;
      ({ productDocs, facetResult, total } = await execute(relaxLevel));
    }

    const products = productDocs.map((doc) => {
      // Atlas returns the REAL MongoDB document, so `images` is authoritative
      // rather than a copy that may predate the field — the reason the
      // Elasticsearch path needed a primaryImage fallback here. Normalization is
      // still applied so the API shape is identical between engines.
      const images = normalizeImages(doc.images, doc.name);
      return { ...doc, images, _id: doc._id, _score: doc._score };
    });

    // Did-you-mean, only when the relaxed retry ALSO found nothing. Running it any
    // earlier would spend a query on searches that are already answered, and
    // suggesting a correction for a query that worked reads as broken.
    const corrections = total === 0 && cleanedQuery
      ? await this.suggestCorrection(cleanedQuery)
      : [];

    const pages = Math.ceil(total / limitNum);
    return {
      products,
      corrections,
      // `relaxed` tells the storefront to say "no exact matches for X — showing
      // related results" rather than presenting widened results as if they were
      // direct hits, which reads as a broken search.
      relaxed: relaxLevel > 0,
      relaxLevel,
      pagination: {
        total,
        pages,
        currentPage: pageNum,
        hasNext: pageNum < pages,
        hasPrev: pageNum > 1,
      },
      // DEPRECATED and intentionally empty of dimensions. The list response used to
      // carry five facet dimensions that no client read; the sidebar has always
      // called /products/facets, which now serves real disjunctive counts. The key
      // is retained so the response shape does not change under any consumer we
      // have not found — see buildFacetPipeline for the measurement.
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
   * exist to serve it.
   *
   * ── MEASURED 2026-08-31, prod cluster, 931 active products, median of 7 ──────
   *
   * The obvious suspects were both wrong, so the numbers are recorded here to
   * stop anyone (including a future me) re-litigating this from intuition:
   *
   *   bare $search + $count ............ 108.7 ms   ← irreducible floor
   *   this pipeline (2× $lookup) ....... 114.6 ms
   *   same pipeline, no $lookup ........ 111.4 ms   ← $lookup costs 3.2 ms (3%)
   *   one $search + $facet (combined) .. 113.2 ms   vs 128.0 ms for the current
   *                                                   two-query form (12% faster)
   *
   * So faceting is nearly free. ~95% of the cost is the $search execution itself
   * counting every match, which no arrangement of later stages avoids, and which
   * $searchMeta would still pay.
   *
   * The combined single-$search form IS 12% faster and was rejected anyway: with
   * one $search, $facet has to receive FULL product documents (the products
   * branch needs them), so every matched document — SEO-stuffed descriptions
   * included, ~37 MB today — streams through a stage with a 100 MB limit. That
   * buys 15 ms in exchange for a hard cliff a few times' catalogue growth away,
   * on a response that is already Redis-cached. Not a trade worth making.
   *
   * Revisit if the catalogue grows by an order of magnitude, or if the exact
   * total is ever droppable (Atlas `count: {type: 'lowerBound'}` is far cheaper,
   * but the storefront renders exact page counts).
   */
  /**
   * Facet counts for the filter sidebar, computed by the SAME engine that answers
   * the results grid.
   *
   * Before this, `/products` was served by Atlas while `/products/facets` ran
   * independent MongoDB aggregations — two engines, different text and stock
   * semantics, answering one screen. The sidebar counts and the grid could
   * therefore disagree about the same URL.
   *
   * ── Cost ─────────────────────────────────────────────────────────────────────
   *
   * Disjunctive counting needs the search re-run once per SELECTED dimension, with
   * that dimension's own filter lifted. What makes it affordable: only dimensions
   * the shopper has ACTUALLY selected need a pass. With nothing selected — every
   * first page view — one $search answers everything. Measured on prod: ~180 ms at
   * 0, 1 and 3 active filters alike, because the passes run in parallel.
   */
  async getFacets(params, resolved) {
    const capabilities = await this.getIndexCapabilities();

    const stageFor = (exclude) =>
      buildSearchStage(params, resolved, { capabilities, exclude });

    // Which dimensions are actually filtered. Anything not listed is unaffected by
    // its own filter, so the base pass already counts it correctly.
    const selected = {
      brand: normalizeList(params.brand).length > 0,
      category: (resolved.categoryIds || []).length > 0,
      price: Boolean(params.minPrice || params.maxPrice),
      rating: normalizeList(params.rating).length > 0,
      vehicle: Array.isArray(resolved.vehicleFilterIds),
      availability: params.inStock === 'true' || params.inStock === true,
    };

    const run = (exclude, branches) =>
      Product.collection.aggregate([
        { $search: stageFor(exclude) },
        // Project BEFORE $facet. Descriptions are long and SEO-stuffed; carrying
        // them into an in-memory $facet over the whole matched set is the one way
        // this pipeline becomes expensive.
        { $project: { brand: 1, categories: 1, compatibleVehicles: 1, price: 1, averageRating: 1, stock: 1 } },
        { $facet: branches },
      ]).toArray().then((r) => r[0] || {});

    const BRANCHES = {
      total: [{ $count: 'value' }],
      brands: [
        { $match: { brand: { $nin: [null, ''] } } },
        { $group: { _id: '$brand', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 200 },
      ],
      // Distinct product IDS, not a raw count: rollUpCategoryCounts unions these up
      // the tree so a hub badge counts a multi-tagged product ONCE.
      categories: [
        { $unwind: '$categories' },
        { $group: { _id: '$categories', ids: { $addToSet: '$_id' } } },
      ],
      vehicles: [
        { $unwind: '$compatibleVehicles' },
        { $group: { _id: '$compatibleVehicles', count: { $sum: 1 } } },
      ],
      priceStats: [
        { $match: { price: { $gt: 0 } } },
        { $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' }, prices: { $push: '$price' } } },
      ],
      ratings: [
        { $match: { averageRating: { $gt: 0 } } },
        { $group: { _id: null,
          r4: { $sum: { $cond: [{ $gte: ['$averageRating', 4] }, 1, 0] } },
          r3: { $sum: { $cond: [{ $gte: ['$averageRating', 3] }, 1, 0] } },
          r2: { $sum: { $cond: [{ $gte: ['$averageRating', 2] }, 1, 0] } },
          r1: { $sum: { $cond: [{ $gte: ['$averageRating', 1] }, 1, 0] } } } },
      ],
      availability: [{ $group: { _id: '$stock', count: { $sum: 1 } } }],
    };

    const base = await run({}, BRANCHES);

    const extraKeys = Object.keys(selected).filter((k) => selected[k]);
    const extras = Object.fromEntries(
      await Promise.all(
        extraKeys.map(async (key) => {
          const exclude = { [`exclude${key[0].toUpperCase()}${key.slice(1)}`]: true };
          const branch =
            key === 'brand' ? { brands: BRANCHES.brands }
            : key === 'category' ? { categories: BRANCHES.categories }
            : key === 'price' ? { priceStats: BRANCHES.priceStats }
            : key === 'rating' ? { ratings: BRANCHES.ratings }
            : key === 'vehicle' ? { vehicles: BRANCHES.vehicles }
            : { availability: BRANCHES.availability };
          return [key, await run(exclude, branch)];
        })
      )
    );

    const pick = (dimension, field) => extras[dimension]?.[field] ?? base[field];

    return this.shapeFacetResponse({
      total: base.total?.[0]?.value ?? 0,
      brands: pick('brand', 'brands') || [],
      categories: pick('category', 'categories') || [],
      vehicles: pick('vehicle', 'vehicles') || [],
      priceStats: (pick('price', 'priceStats') || [])[0] || null,
      ratings: (pick('rating', 'ratings') || [])[0] || null,
      availability: pick('availability', 'availability') || [],
      params,
    });
  }

  /**
   * Shape raw facet aggregates into the API contract the filter panel consumes.
   *
   * The panel is driven ENTIRELY by this response — values, counts, ordering and
   * price bounds. It used to assemble its own values from three global reference
   * lists (/categories, /brands, /vehicles) and look counts up afterwards, which is
   * why every zero-count value still rendered and was still clickable, and why
   * vehicle, rating and availability had no counts at all.
   *
   * Ordering, on every multi-value dimension: SELECTED first, then count
   * descending, then label. Selected-first matters because counts move as filters
   * change, and a checked box that jumps down the list as you use it feels broken.
   */
  shapeFacetResponse(raw) {
    const { params } = raw;
    const selectedBrands = new Set(normalizeList(params.brand).map((b) => b.toLowerCase()));
    const selectedRatings = new Set(normalizeList(params.rating).map(Number));

    const order = (a, b) =>
      Number(b.selected) - Number(a.selected)
      || b.count - a.count
      || String(a.label ?? a.value).localeCompare(String(b.label ?? b.value));

    const brands = (raw.brands || [])
      .filter((b) => b._id)
      .map((b) => ({
        // `name` is the legacy key the existing filter panel reads. Kept alongside
        // value/label so this response could replace the MongoDB one without a
        // simultaneous frontend change.
        name: b._id,
        value: b._id,
        label: b._id,
        count: b.count,
        selected: selectedBrands.has(String(b._id).toLowerCase()),
      }))
      .sort(order);

    const priceStats = raw.priceStats;
    const prices = (priceStats?.prices || []).filter((p) => Number.isFinite(p)).sort((a, b) => a - b);
    const p95 = prices.length > 0 ? prices[Math.min(prices.length - 1, Math.floor(prices.length * 0.95))] : null;
    const bounds = priceStats ? buildPriceHistogramBounds(priceStats.min, priceStats.max, p95, 20) : [];
    // Counted in Node from the price list already in hand: a second $bucket pass
    // would need boundaries this function has only just computed.
    const histogram = bounds.map((b) => ({
      from: b.from,
      to: b.to,
      count: prices.filter((p) => p >= b.from && (b.to === null || p < b.to)).length,
    }));

    const r = raw.ratings;
    const ratings = r
      ? [4, 3, 2, 1].map((value) => ({
          value,
          count: r[`r${value}`] ?? 0,
          selected: selectedRatings.has(value),
        }))
      : [];

    const availabilityCounts = new Map((raw.availability || []).map((a) => [a._id, a.count]));
    const purchasable = [...PURCHASABLE_STOCK].reduce((sum, k) => sum + (availabilityCounts.get(k) || 0), 0);

    return {
      total: raw.total,
      brands,
      // Raw id sets — SearchService rolls these up, because the parent/child index
      // lives in categoryMappingService on that side.
      categoryIdSets: (raw.categories || []).map((c) => ({ _id: c._id, ids: c.ids })),
      vehicleIdCounts: (raw.vehicles || []).map((v) => ({ _id: v._id, count: v.count })),
      price: {
        min: priceStats?.min ?? 0,
        max: priceStats?.max ?? 0,
        selectedMin: params.minPrice != null ? Number(params.minPrice) : null,
        selectedMax: params.maxPrice != null ? Number(params.maxPrice) : null,
        histogram,
      },
      ratings,
      availability: [
        { value: 'in', label: 'In stock', count: purchasable,
          selected: params.inStock === 'true' || params.inStock === true },
      ],
    };
  }

  /**
   * The count pipeline behind a search's `pagination.total`.
   *
   * ── OPTIMIZATION PASS, 2026-09-01 (separate from the feature diff) ───────────
   *
   * This used to compute FIVE facet dimensions — brands, categories, vehicleTypes,
   * priceRanges, ratingRanges — on every single search, including two $lookups.
   * None of them was read by anything: the storefront sidebar calls
   * /products/facets, and that endpoint now runs its own disjunctive, data-derived
   * facet query (see getFacets). Only `total` was ever load-bearing.
   *
   * MEASURED on prod, 931 active products, median of 7:
   *
   *   previous pipeline (5 branches + 2 $lookup) ... 116 ms
   *   count only (this) ............................  96 ms   ← 20 ms / 17% saved
   *
   * The saving is per search, on the hot path, and it also removes the in-memory
   * $facet over the whole matched set — the stage that carried the 100 MB cliff the
   * original comment flagged as a few times' catalogue growth away.
   *
   * `$facet` is retained around the count purely so the result shape
   * (`{ total: [{ value: n }] }`) is unchanged for the caller.
   */
  buildFacetPipeline(searchStage) {
    return [
      { $search: searchStage },
      { $facet: { total: [{ $count: 'value' }] } },
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

    // Popular-query lane. The Redis sorted set logSearchQuery writes has existed
    // since the migration and nothing ever read it back — while, separately,
    // nothing ever WROTE to it either, because addToSearchHistory had no callers.
    // Both halves are wired now, so real demand can lead the dropdown.
    //
    // Capped at 2 and placed FIRST: these are the highest-intent entries (a query
    // other shoppers actually ran), but the list truncates to `limit`, and the
    // category lane already demonstrated that letting one type lead unbounded eats
    // the entire dropdown.
    const querySuggestions = [];
    try {
      const popular = await this.getPopularTerms(7, 50);
      for (const { term } of popular) {
        if (querySuggestions.length >= 2) break;
        // Skip the term the user has already typed in full — suggesting it back is
        // not a suggestion.
        if (term === lower || !term.startsWith(lower)) continue;
        querySuggestions.push({
          id: `query-${term.replace(/\s+/g, '-')}`,
          text: term,
          type: 'query',
          value: term,
        });
      }
    } catch {
      // A search box must never fail because analytics did.
    }

    // `total` used to be `docs.length` — the OVER-FETCH cap (at most 30), not a
    // real total. Anything rendering "see all N results" was showing the size of
    // the suggestion probe. $searchMeta with a lowerBound count is the cheap way to
    // get a true figure; it is approximate by design and far cheaper than an exact
    // count, which is the right trade for a dropdown that fires on every keystroke.
    let total = docs.length;
    try {
      const meta = await Product.collection
        .aggregate([
          {
            $searchMeta: {
              index: this.indexName,
              count: { type: 'lowerBound' },
              // Mirrors the suggestion query's own recall, autocomplete lane
              // included. A plain `text` clause counts whole words only, so a
              // partial like "brak" — the entire point of an autocomplete
              // endpoint — counted zero while the dropdown showed six products.
              compound: {
                filter: [{ equals: { path: 'isActive', value: true } }],
                must: [{
                  compound: {
                    should: [
                      { autocomplete: { query: safeQuery, path: 'name' } },
                      { text: { query: safeQuery, path: 'name' } },
                      { text: { query: safeQuery, path: 'brand' } },
                      { text: { query: safeQuery, path: 'sku' } },
                    ],
                    minimumShouldMatch: 1,
                  },
                }],
              },
            },
          },
        ])
        .toArray();
      const counted = meta[0]?.count?.lowerBound ?? meta[0]?.count?.total;
      if (Number.isFinite(counted)) total = counted;
    } catch (error) {
      // A wrong-but-harmless count is better than a failed dropdown.
      console.error('[AtlasSearch] Suggestion count failed:', error.message);
    }

    return {
      suggestions: [...querySuggestions, ...productSuggestions, ...categorySuggestions].slice(0, limit),
      corrections: [],
      total,
    };
  }

  /** Resolve the first category ObjectId on a product to its display name, or null. */
  firstCategoryName(categories) {
    if (!Array.isArray(categories) || categories.length === 0) return null;
    const found = categoryMappingService.findCategory(String(categories[0]));
    return found?.name ?? null;
  }

  /**
   * Derive a "did you mean" suggestion from what the index actually contains.
   *
   * Atlas Search has no spell suggester of any kind — the Elasticsearch `term`
   * suggester it replaced has no equivalent — so `corrections` was hardcoded to an
   * empty array at the migration and has been dead ever since. The honest
   * replacement is to ask the index a deliberately loose question and mine the
   * answer: one fuzzy probe over `name` and `brand` with no minimumShouldMatch,
   * then a pure scoring pass (pickCorrection) to decide whether any candidate word
   * is close enough to be worth showing.
   *
   * Deliberately capped at one suggestion. A list of near-identical guesses is
   * noise; the value is entirely in the single best one.
   *
   * Best-effort: a failure here must never fail the search that triggered it.
   */
  async suggestCorrection(query) {
    try {
      const docs = await Product.collection
        .aggregate([
          {
            $search: {
              index: this.indexName,
              compound: {
                filter: [{ equals: { path: 'isActive', value: true } }],
                should: [
                  { text: { query, path: 'name', fuzzy: { maxEdits: 2, prefixLength: 1 } } },
                  { text: { query, path: 'brand', fuzzy: { maxEdits: 2, prefixLength: 1 } } },
                ],
                minimumShouldMatch: 1,
              },
            },
          },
          { $limit: 20 },
          { $project: { name: 1, brand: 1 } },
        ])
        .toArray();

      const candidates = docs.flatMap((d) => [d.name, d.brand]).filter(Boolean);
      const best = pickCorrection(query, candidates);
      return best ? [{ original: best.original, suggested: best.suggested }] : [];
    } catch (error) {
      console.error('[AtlasSearch] Correction probe failed:', error.message);
      return [];
    }
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
  async logSearchQuery(query, resultsCount = null, _userId = null) {
    const term = this.sanitizeQuery(query);
    if (!term) return;

    try {
      const redis = getRedisClient();
      if (!redis) return;

      const normalized = term.toLowerCase();
      const key = analyticsKey();
      await redis.zincrby(key, 1, normalized);
      await redis.expire(key, ANALYTICS_TTL_SECONDS);

      // A search that returned nothing is recorded separately. `null` means the
      // caller did not tell us the count — record the search but claim nothing
      // about its outcome, rather than guessing it was a hit or a miss.
      if (resultsCount === 0) {
        const zeroKey = zeroResultKey();
        await redis.zincrby(zeroKey, 1, normalized);
        await redis.expire(zeroKey, ANALYTICS_TTL_SECONDS);
      }
    } catch (error) {
      console.error('[AtlasSearch] Failed to log search query:', error.message);
    }
  }

  /**
   * Popular search terms over the last `days`, most-searched first.
   *
   * Reads the same sorted sets logSearchQuery writes. Used by the suggestion
   * endpoint to offer a query-suggestion lane — the data was already being
   * collected and nothing read it back.
   */
  async getPopularTerms(days = 7, limit = 50) {
    const redis = getRedisClient();
    if (!redis) return [];

    const totals = new Map();
    const now = new Date();
    try {
      for (let i = 0; i < days; i += 1) {
        const day = new Date(now);
        day.setUTCDate(day.getUTCDate() - i);
        const flat = await redis.zrange(analyticsKey(day), 0, -1, 'WITHSCORES');
        for (let j = 0; j < flat.length; j += 2) {
          totals.set(flat[j], (totals.get(flat[j]) || 0) + (Number(flat[j + 1]) || 0));
        }
      }
    } catch (error) {
      // Analytics must never break a search box.
      console.error('[AtlasSearch] Failed to read popular terms:', error.message);
      return [];
    }

    return Array.from(totals.entries())
      .map(([term, count]) => ({ term, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
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
    if (!redis) return { popularTerms: [], zeroResultTerms: [], searchesOverTime: [] };

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return { popularTerms: [], zeroResultTerms: [], searchesOverTime: [] };
    }

    const MAX_DAYS = 180;
    const days = [];
    for (let d = new Date(start); d <= end && days.length < MAX_DAYS; d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(new Date(d));
    }

    const totals = new Map();
    const zeroTotals = new Map();
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

      const zeroFlat = await redis.zrange(zeroResultKey(day), 0, -1, 'WITHSCORES');
      for (let i = 0; i < zeroFlat.length; i += 2) {
        zeroTotals.set(zeroFlat[i], (zeroTotals.get(zeroFlat[i]) || 0) + (Number(zeroFlat[i + 1]) || 0));
      }
    }

    const rank = (map) => Array.from(map.entries())
      .map(([term, count]) => ({ term, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    return {
      popularTerms: rank(totals),
      // What shoppers looked for and did not find — the report that says what to
      // stock or alias next. Empty until logSearchQuery starts receiving counts.
      zeroResultTerms: rank(zeroTotals),
      searchesOverTime,
    };
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
      // Surfaced so an operator can see which index-dependent features are live
      // without reading the index definition by hand.
      capabilities: this.readiness.capabilities,
      lastChecked: this.readiness.lastChecked,
    };
  }
}

export default new AtlasSearchService();
