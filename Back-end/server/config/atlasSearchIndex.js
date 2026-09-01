/**
 * MongoDB Atlas Search index definition for the `products` collection.
 *
 * Declared ONCE here and shared by scripts/create-atlas-search-index.js and the
 * live-definition audit (scripts/audit-atlas-search-index.js), for exactly the
 * reason PRODUCT_INDEX_MAPPING is kept out of Elasticsearch's createIndex():
 * "what we intend the index to be" has to be a value that can be compared
 * against the cluster, not a literal buried inside a call that only runs when
 * the index is absent.
 *
 * That comparison is not optional here. `createSearchIndex` NO-OPS when an index
 * of the same name already exists — the identical trap that let the Elasticsearch
 * brand-mapping fix sit in the repo for weeks without ever reaching production,
 * because createIndex() also no-ops on an existing index. A definition change in
 * this file does NOT reach Atlas without an explicit update; run the audit.
 *
 * ── Why this index looks nothing like PRODUCT_INDEX_MAPPING ────────────────────
 *
 * Elasticsearch indexed a FLATTENED, denormalized copy of each product that
 * services/elasticsearchService.js#indexProduct built by hand: category refs were
 * resolved to `{name, slug}` objects, and `compatibleVehicles` refs were expanded
 * into `vehicle_makes` / `vehicle_models` string arrays.
 *
 * Atlas Search indexes the REAL MongoDB document. There is no transform step and
 * no opportunity for one. So `categories` and `compatibleVehicles` are indexed as
 * what they actually are — arrays of ObjectIds — and every filter on them resolves
 * name/slug → ObjectId at QUERY time instead.
 *
 * That is a strict improvement, not a workaround. The ES filter compared a URL
 * slug against a category DISPLAY NAME, matched nothing ("exterior" is never
 * "Exterior"), dropped every category page onto the full-collection Mongo scan,
 * and drove the Atlas query-targeting alert. ObjectIds are the same identifiers
 * MongoDB itself filters on, so the two engines are now incapable of disagreeing
 * about what "this category" means. The drift bug is structurally gone, not fixed.
 */

/**
 * `token` fields are matched EXACTLY, so a case difference is a silent zero-hit —
 * the ES `brand.keyword` filter needed `case_insensitive: true` on every term for
 * this reason (see anyOfCaseInsensitive). Atlas has no per-query equivalent, so
 * case folding moves into the index via a lowercase normalizer, and the query side
 * lowercases its values to match. Keep the two in lockstep: lowercasing here
 * without lowercasing the query value matches nothing at all.
 */
const lowercaseToken = { type: 'token', normalizer: 'lowercase' };

export const ATLAS_SEARCH_INDEX_NAME =
  process.env.ATLAS_SEARCH_INDEX || 'products_search';

/** Name the query builder references. Must match the live index or Atlas rejects the query. */
export const ATLAS_SYNONYM_MAPPING_NAME = 'productSynonyms';

/** Collection the mapping reads from. Seeded by scripts/seed-search-synonyms.js. */
export const ATLAS_SYNONYM_SOURCE_COLLECTION = 'search_synonyms';

export const ATLAS_SEARCH_INDEX_DEFINITION = {
  // Engine-native synonyms, replacing the hand-rolled query-time expansion.
  //
  // The old approach OR'd whole alternate queries into recall, which over-recalled
  // so badly ("spoiler" pulled in every bumper — 151 results) that it had to be
  // switched off for any query longer than one token. Atlas applies synonyms at
  // ANALYSIS time, per token, so a multi-word query expands each word in place
  // instead of multiplying the query — which is why it does not have that failure
  // mode and can stay on for every query.
  //
  // ⚠ Atlas forbids `synonyms` and `fuzzy` in the SAME text operator, so the
  // synonym lane in buildRecall is a separate clause, not a flag on the existing
  // token clause.
  synonyms: [
    {
      name: ATLAS_SYNONYM_MAPPING_NAME,
      // Must be a standard/language analyzer — Atlas rejects a synonym mapping
      // whose analyzer is `keyword`, and the recall lane analyses with
      // lucene.standard, so the two must agree.
      analyzer: 'lucene.standard',
      source: { collection: ATLAS_SYNONYM_SOURCE_COLLECTION },
    },
  ],
  mappings: {
    // Explicit, not dynamic. Dynamic mapping is what made the Elasticsearch
    // `categories` fields "exist only because ES happened to infer text+keyword
    // on first index" — one indexing order away from silently emptying the
    // facet sidebar. Every field the query layer touches is declared below.
    dynamic: false,
    fields: {
      // Multi-type. `string` powers relevance; `autocomplete` (edgeGram) powers
      // the suggestion endpoint's partial-word matching — the capability that
      // replaces the ES term suggester. `token` exists ONLY so `sortBy=name`
      // has a sortable field; the lowercase normalizer makes that sort
      // case-insensitive, which is what a shopper expects anyway.
      name: [
        { type: 'string', analyzer: 'lucene.standard' },
        {
          type: 'autocomplete',
          tokenization: 'edgeGram',
          minGrams: 2,
          maxGrams: 15,
          foldDiacritics: true,
        },
        lowercaseToken,
      ],

      // Indexed for RANKING only. `description` is deliberately excluded from
      // every recall lane in the query builder: long, SEO-stuffed descriptions
      // share common words across nearly the whole catalogue, so letting them
      // widen the match set is what produced the "151 results for spoiler"
      // over-recall. It survives as a weak `should` boost and nothing more.
      description: { type: 'string', analyzer: 'lucene.standard' },
      shortDescription: { type: 'string', analyzer: 'lucene.standard' },

      // `brand` is a plain String on the Product document (the display name;
      // `brandSlug` holds the canonical slug), so unlike categories it needs no
      // id resolution. Analyzed for recall — a search for "roav" has to match
      // the brand "Roav 4x4" — and tokenized for the exact filter and facet.
      brand: [{ type: 'string', analyzer: 'lucene.standard' }, lowercaseToken],
      brandSlug: lowercaseToken,

      sku: [{ type: 'string', analyzer: 'lucene.standard' }, lowercaseToken],
      tags: [{ type: 'string', analyzer: 'lucene.standard' }, lowercaseToken],
      slug: { type: 'token' },

      // The two ref arrays. See the header: filters resolve to these ObjectIds
      // rather than to denormalized names, which is what makes ES/Mongo drift
      // impossible rather than merely fixed.
      categories: { type: 'objectId' },
      compatibleVehicles: { type: 'objectId' },

      price: { type: 'number' },
      originalPrice: { type: 'number' },
      // Variable products price as a range; both equal `price` when simple.
      priceMin: { type: 'number' },
      priceMax: { type: 'number' },
      averageRating: { type: 'number' },
      totalReviews: { type: 'number' },
      // Time-decayed trailing sales. The commercial ranking signal that replaces
      // the dead isFastMoving flag — see models/Product.js and salesScoreService.
      salesScore: { type: 'number' },

      // Coarse availability enum (in / low / out / backorder) — a status, never
      // a quantity. Tokenized because the only operation on it is exact
      // set-membership ("exclude out and backorder").
      stock: { type: 'token' },
      // Numeric availability rank (0 = buyable, 1 = out/backorder), derived from
      // `stock`. Sortable — which `stock` is not, because the enum sorts
      // alphabetically and puts `backorder` first. This is the key that lets a
      // browse page (where an explicit sort makes Atlas ignore relevance score
      // entirely) still sink what nobody can buy.
      stockRank: { type: 'number' },
      productType: { type: 'token' },

      // `isActive` carries a load-bearing responsibility here. Elasticsearch
      // indexed ONLY active products (indexAllProducts filters isActive:true),
      // so "not indexed" was itself the visibility rule. Atlas Search indexes
      // the whole collection, inactive drafts included — so that rule has to be
      // re-stated as an explicit query filter. Omitting it would publish every
      // unpublished draft to the storefront.
      isActive: { type: 'boolean' },
      isFeatured: { type: 'boolean' },
      // `isFastMoving` was dropped 2026-09-01. The feature is dead (its section is
      // never mounted) and only 3 products carry the flag, so the ranking clause it
      // fed was handing three arbitrary products a permanent boost on every search.
      // Removing the mapping is what makes the audit report drift until the index is
      // actually redeployed.

      createdAt: { type: 'date' },
      updatedAt: { type: 'date' },
    },
  },
};

/**
 * Flatten a definition's `fields` into leaf path → sorted type list, so the
 * declared definition and the live one can be compared field by field.
 *
 * Multi-type fields are arrays in the Atlas definition and their ORDER is not
 * meaningful, so types are sorted before comparison — otherwise the audit would
 * report drift every time someone reordered two equivalent entries.
 *
 * @returns {Map<string, string[]>} path → sorted type names
 */
export function flattenDefinition(fields, prefix = '', out = new Map()) {
  for (const [key, def] of Object.entries(fields || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    const entries = Array.isArray(def) ? def : [def];

    // A `document`/`embeddedDocuments` field nests its own `fields` map. The
    // product index does not currently use one, but the audit must not silently
    // skip a subtree if someone adds one later.
    const nested = entries.find((e) => e && e.fields);
    if (nested) {
      flattenDefinition(nested.fields, path, out);
      continue;
    }

    out.set(
      path,
      entries.map((e) => e?.type).filter(Boolean).sort()
    );
  }
  return out;
}

/**
 * Compare a declared definition against the live one from $listSearchIndexes.
 *
 * Reports MISSING and MISMATCHED fields. An EXTRA live field is reported too but
 * is not, on its own, a failure: a field can legitimately linger after being
 * dropped from the declaration and before the index is updated. Missing and
 * mismatched are the ones that make queries silently return nothing.
 *
 * @returns {{ok: boolean, drift: Array<{path: string, issue: string, declared?: string[], live?: string[]}>}}
 */
export function diffDefinition(declaredFields, liveFields) {
  const declared = flattenDefinition(declaredFields);
  const live = flattenDefinition(liveFields);
  const drift = [];

  for (const [path, declaredTypes] of declared) {
    const liveTypes = live.get(path);
    if (!liveTypes) {
      drift.push({ path, issue: 'missing', declared: declaredTypes });
      continue;
    }
    if (declaredTypes.join(',') !== liveTypes.join(',')) {
      drift.push({ path, issue: 'mismatch', declared: declaredTypes, live: liveTypes });
    }
  }

  for (const path of live.keys()) {
    if (!declared.has(path)) {
      drift.push({ path, issue: 'extra', live: live.get(path) });
    }
  }

  return { ok: drift.every((d) => d.issue === 'extra'), drift };
}

/**
 * Compare the declared top-level `synonyms` array against the live one.
 *
 * This exists because diffDefinition walks `mappings.fields` and NOTHING ELSE, so
 * a synonyms declaration was structurally invisible to the audit: adding synonyms
 * to the definition would leave `npm run audit-atlas-search-index` reporting a
 * clean index while the mappings never reached Atlas and every synonym silently
 * did nothing. That is the exact shape of the Elasticsearch brand-mapping failure
 * — a definition change sitting in the repo, believed shipped, for weeks.
 *
 * Compared by NAME and source collection rather than deep-equality, because those
 * are the two properties that decide whether a query referencing
 * `synonyms: 'productSynonyms'` resolves at all. A query naming a synonym mapping
 * the index does not have is rejected outright.
 *
 * @returns {{ok: boolean, drift: Array<{path: string, issue: string, declared?: any, live?: any}>}}
 */
export function diffSynonyms(declared = [], live = []) {
  const key = (m) => `${m?.name}:${m?.source?.collection ?? ''}`;
  const declaredMap = new Map((declared || []).map((m) => [m?.name, m]));
  const liveMap = new Map((live || []).map((m) => [m?.name, m]));
  const drift = [];

  for (const [name, mapping] of declaredMap) {
    const liveMapping = liveMap.get(name);
    if (!liveMapping) {
      drift.push({ path: `synonyms.${name}`, issue: 'missing', declared: mapping });
      continue;
    }
    if (key(mapping) !== key(liveMapping)) {
      drift.push({ path: `synonyms.${name}`, issue: 'mismatch', declared: mapping, live: liveMapping });
    }
  }

  for (const name of liveMap.keys()) {
    if (!declaredMap.has(name)) {
      drift.push({ path: `synonyms.${name}`, issue: 'extra', live: liveMap.get(name) });
    }
  }

  return { ok: drift.every((d) => d.issue === 'extra'), drift };
}
