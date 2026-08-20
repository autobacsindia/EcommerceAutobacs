import { CACHE_VERSION } from '../services/cache/config.js';

/**
 * Query parameters that CANNOT change facet counts.
 *
 * Facets are the filter sidebar's per-brand / per-category totals for the whole
 * result set. Which slice of that set you are looking at, how it is ordered, and
 * how many rows you asked for are all irrelevant to the totals — page 2 of a
 * filter has exactly the same facet counts as page 1.
 *
 * This is deliberately a DENYLIST rather than an allowlist of filter params, and
 * the direction matters. With an allowlist, adding a new filter to
 * SearchService.buildBaseQuery and forgetting to register it here would make two
 * genuinely different filters share one cache entry — serving WRONG counts. With a
 * denylist, an unrecognised parameter is simply included in the key: the worst case
 * is a cache entry that could have been shared, never an incorrect one.
 */
export const FACET_IRRELEVANT_PARAMS = new Set(['page', 'limit', 'sortBy', 'order', 'sort']);

/**
 * Canonical cache key for the facets endpoint.
 *
 * Fixes two cardinality leaks that between them made the facet cache nearly useless
 * in production, where real keys looked like:
 *
 *   v3:products:facets:{"vehicleMake":"Toyota","vehicleModel":"Fortuner","page":"2"}
 *   v3:products:facets:{"vehicleMake":"Toyota","vehicleModel":"Fortuner"}
 *
 *  1. `page` (and friends) were part of the key, so every page of every filter
 *     recomputed the same two MongoDB aggregations.
 *  2. The key was `JSON.stringify(req.query)`, whose property order follows the
 *     order the parameters arrived in — so `?a=1&b=2` and `?b=2&a=1` produced
 *     different keys for an identical result.
 *
 * Entries are sorted by name and array values are normalised, so one logical filter
 * set maps to exactly one key.
 *
 * @param {object} query  req.query
 * @returns {string} `${CACHE_VERSION}:products:facets:<canonical>`
 */
export function canonicalizeQuery(query = {}, { omit = null } = {}) {
  return Object.entries(query || {})
    .filter(([k, v]) => (!omit || !omit.has(k)) && v !== undefined && v !== '')
    // Sort by key so parameter arrival order cannot fork the key.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => {
      // `?brand=a&brand=b` arrives as an array; sort it so the two orderings agree.
      const value = Array.isArray(v) ? [...v].map(String).sort().join(',') : String(v);
      return `${k}=${value}`;
    })
    .join('&');
}

export function buildFacetCacheKey(query = {}) {
  const canonical = canonicalizeQuery(query, { omit: FACET_IRRELEVANT_PARAMS });
  return `${CACHE_VERSION}:products:facets:${canonical || 'all'}`;
}

export default buildFacetCacheKey;
