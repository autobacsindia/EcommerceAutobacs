/**
 * Facet cache key canonicalisation.
 *
 * Production keys looked like this — two entries for one logical answer:
 *   v3:products:facets:{"vehicleMake":"Toyota","vehicleModel":"Fortuner","page":"2"}
 *   v3:products:facets:{"vehicleMake":"Toyota","vehicleModel":"Fortuner"}
 *
 * Facets are whole-result-set totals, so pagination and ordering cannot change
 * them. Folding them into the key meant nearly every request recomputed two Mongo
 * aggregations, which is a large part of why the cache hit rate sat near 11%.
 */
import { buildFacetCacheKey, canonicalizeQuery, FACET_IRRELEVANT_PARAMS } from '../../../utils/facetCacheKey.js';

describe('buildFacetCacheKey', () => {
  it('ignores the page number — the regression', () => {
    const a = buildFacetCacheKey({ vehicleMake: 'Toyota', vehicleModel: 'Fortuner', page: '2' });
    const b = buildFacetCacheKey({ vehicleMake: 'Toyota', vehicleModel: 'Fortuner' });
    expect(a).toBe(b);
  });

  it('ignores limit and sort, which cannot change a total', () => {
    const base = buildFacetCacheKey({ brand: 'Bosch' });
    expect(buildFacetCacheKey({ brand: 'Bosch', limit: '48' })).toBe(base);
    expect(buildFacetCacheKey({ brand: 'Bosch', sortBy: 'price', order: 'asc' })).toBe(base);
  });

  it('is independent of parameter order', () => {
    // JSON.stringify(req.query) followed arrival order, so these used to differ.
    expect(buildFacetCacheKey({ a: '1', b: '2' })).toBe(buildFacetCacheKey({ b: '2', a: '1' }));
  });

  it('normalises repeated params regardless of their order', () => {
    expect(buildFacetCacheKey({ brand: ['b', 'a'] })).toBe(buildFacetCacheKey({ brand: ['a', 'b'] }));
  });

  it('STILL separates genuinely different filters', () => {
    // The property that must never be traded away for a better hit rate.
    expect(buildFacetCacheKey({ brand: 'Bosch' })).not.toBe(buildFacetCacheKey({ brand: 'Denso' }));
    expect(buildFacetCacheKey({ category: 'exterior' }))
      .not.toBe(buildFacetCacheKey({ category: 'interior' }));
    expect(buildFacetCacheKey({ minPrice: '100' })).not.toBe(buildFacetCacheKey({ minPrice: '200' }));
  });

  it('includes UNKNOWN params, so a new filter can never collide', () => {
    // The denylist direction is load-bearing: an unrecognised parameter must widen
    // the key, never be silently dropped into a shared entry.
    expect(buildFacetCacheKey({ someNewFilter: 'x' })).not.toBe(buildFacetCacheKey({}));
    expect(FACET_IRRELEVANT_PARAMS.has('someNewFilter')).toBe(false);
  });

  it('drops empty values so ?brand= behaves like no brand at all', () => {
    expect(buildFacetCacheKey({ brand: '' })).toBe(buildFacetCacheKey({}));
  });

  it('yields a stable, versioned, readable key', () => {
    expect(buildFacetCacheKey({ category: 'exterior', brand: 'Bosch' }))
      .toMatch(/^v\d+:products:facets:brand=Bosch&category=exterior$/);
    expect(buildFacetCacheKey({})).toMatch(/:products:facets:all$/);
  });
});

describe('canonicalizeQuery (shared with the response cache key)', () => {
  it('is order-independent', () => {
    expect(canonicalizeQuery({ b: '2', a: '1' })).toBe(canonicalizeQuery({ a: '1', b: '2' }));
  });

  it('keeps page/sort when no denylist is supplied', () => {
    // The response cache DOES vary by page — only facets may ignore it. Sharing the
    // canonicaliser must not leak the facet denylist into the response key.
    expect(canonicalizeQuery({ page: '2' })).not.toBe(canonicalizeQuery({ page: '3' }));
    expect(canonicalizeQuery({ page: '2' })).toContain('page=2');
  });

  it('returns an empty string for an empty query', () => {
    expect(canonicalizeQuery({})).toBe('');
  });
});
