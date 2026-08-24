/**
 * Drift guard: every field an Elasticsearch query or aggregation names must
 * actually exist in the index mapping we create.
 *
 * This bug family has now shipped three times, and every instance was silent:
 *
 *   - `category.name.keyword`  — the document has `categories` (plural). Every
 *                                category hub returned 0 and fell through to a
 *                                full Mongo scan (the Atlas targeting alert).
 *   - `brand.keyword`          — `brand` was mapped as a bare `keyword`, which has
 *                                no `.keyword` sub-field. Every brand filter
 *                                returned 0 and the brand facet returned 0 buckets
 *                                across all 930 products.
 *   - `vehicle_makes.keyword`  — same shape: `vehicle_makes` IS the keyword field.
 *
 * Elasticsearch does not error on an unmapped field. A filter on one matches
 * nothing and an aggregation on one returns an empty bucket list, so the failure
 * reaches production looking exactly like "we don't stock that" — and
 * SearchService deliberately TRUSTS a zero from a populated index, so there is
 * not even a Mongo fallback to mask it.
 *
 * Rather than hardcode a field list (which drifts on its own), this captures the
 * real mapping from createIndex() and the real query body from searchProducts(),
 * then resolves one against the other.
 */

import { jest } from '@jest/globals';
import elasticsearchService from '../services/elasticsearchService.js';

/** Capture the mappings body createIndex() sends to Elasticsearch. */
async function captureMapping() {
  let captured = null;
  elasticsearchService.client = {
    indices: {
      exists: jest.fn().mockResolvedValue(false),
      create: jest.fn(async (req) => { captured = req.body.mappings.properties; return {}; }),
    },
  };
  await elasticsearchService.createIndex();
  expect(captured).toBeTruthy();
  return captured;
}

/** Minimal response shaped like a real one, so searchProducts() completes. */
function emptyEsResponse() {
  const agg = { buckets: [] };
  return {
    hits: { hits: [], total: { value: 0 } },
    aggregations: {
      categories: agg, brands: agg, vehicle_types: agg,
      price_ranges: agg, rating_ranges: agg, availability: agg,
    },
  };
}

/** Capture the query body searchProducts() sends, for a given set of params. */
async function captureQuery(params) {
  let captured = null;
  elasticsearchService.client = {
    search: jest.fn(async (req) => { captured = req.body; return emptyEsResponse(); }),
  };
  await elasticsearchService.searchProducts(params);
  expect(captured).toBeTruthy();
  return captured;
}

/**
 * Resolve a dotted field path against a mapping `properties` object.
 * Understands nested `properties` and multi-field `fields`.
 */
function fieldExists(properties, path) {
  const parts = path.split('.');
  let level = properties;

  for (let i = 0; i < parts.length; i++) {
    const node = level?.[parts[i]];
    if (!node) return false;

    const rest = parts.slice(i + 1);
    if (rest.length === 0) return true;

    if (node.properties) { level = node.properties; continue; }
    // A multi-field can only be one level deep.
    if (node.fields) return rest.length === 1 && Boolean(node.fields[rest[0]]);
    return false;
  }
  return true;
}

/**
 * Walk a query/agg body and collect every field name it references.
 * `terms` is deliberately handled twice: as an aggregation it is
 * `{ field: 'x' }`, as a query it is `{ x: [...] }`.
 */
function collectFields(node, found = new Set()) {
  if (!node || typeof node !== 'object') return found;

  if (Array.isArray(node)) {
    node.forEach(child => collectFields(child, found));
    return found;
  }

  for (const [key, value] of Object.entries(node)) {
    if ((key === 'field' || key === 'default_field') && typeof value === 'string') {
      found.add(value);
    } else if (key === 'fields' && Array.isArray(value)) {
      // multi_match: strip the ^boost suffix
      value.forEach(f => found.add(String(f).split('^')[0]));
    } else if (['term', 'terms', 'match', 'match_phrase', 'match_phrase_prefix', 'range', 'prefix', 'wildcard'].includes(key)
               && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const inner of Object.keys(value)) {
        // agg form ({ field, ranges, size, ... }) — not a field name
        if (['field', 'ranges', 'size', 'order', 'missing', 'boost', 'keyed'].includes(inner)) continue;
        found.add(inner);
      }
      collectFields(value, found);
    } else {
      collectFields(value, found);
    }
  }
  return found;
}

describe('Elasticsearch mapping drift', () => {
  const originalClient = elasticsearchService.client;
  const originalEnabled = elasticsearchService.enabled;

  beforeAll(() => { elasticsearchService.enabled = true; });
  afterAll(() => {
    elasticsearchService.client = originalClient;
    elasticsearchService.enabled = originalEnabled;
  });

  it('maps every field referenced by the search query and its facets', async () => {
    const properties = await captureMapping();

    // Exercise every filter branch at once so no clause is left uncaptured.
    const body = await captureQuery({
      q: 'roav 4x4',
      brand: 'Roav 4x4',
      vehicleMake: 'Toyota',
      vehicleModel: 'Hilux',
      categorySlugs: ['exterior'],
      // Express query params always arrive as strings — keep them that way so
      // this exercises the same branches production does.
      minPrice: '100',
      maxPrice: '50000',
      rating: '4',
      inStock: 'true',
    });

    const referenced = [...collectFields(body)]
      // `sort` may name `_score`, which is never in a mapping.
      .filter(f => !f.startsWith('_'));

    const unmapped = referenced.filter(f => !fieldExists(properties, f));

    expect(unmapped).toEqual([]);
  });

  it('keeps brand searchable as text AND filterable as a keyword', async () => {
    const properties = await captureMapping();

    // Free-text recall: "roav" must reach the brand "Roav 4x4". A bare keyword
    // mapping only matches the whole exact string, which is what limited a
    // brand search to the single product with ROAV in its NAME.
    expect(properties.brand.type).toBe('text');
    // Exact filter + facet aggregation.
    expect(properties.brand.fields.keyword.type).toBe('keyword');
  });

  it('filters on brand case-insensitively, matching the MongoDB filter', async () => {
    const body = await captureQuery({ brand: 'roav 4x4' });
    const filters = body.query.function_score.query.bool.filter;

    const brandClause = filters.find(f => JSON.stringify(f).includes('brand.keyword'));
    expect(brandClause).toBeTruthy();
    expect(brandClause.bool.should[0].term['brand.keyword']).toEqual({
      value: 'roav 4x4',
      case_insensitive: true,
    });
  });

  it('applies the vehicleMake/vehicleModel params the storefront actually sends', async () => {
    const body = await captureQuery({ vehicleMake: 'Toyota', vehicleModel: 'Hilux' });
    const serialized = JSON.stringify(body.query.function_score.query.bool.filter);

    // Previously only `vehicleType` was read, so a sidebar selection was dropped
    // and ES answered with the entire catalogue as if nothing were selected.
    expect(serialized).toContain('vehicle_makes');
    expect(serialized).toContain('vehicle_models');
  });

  it('still honours the legacy vehicleType param', async () => {
    const body = await captureQuery({ vehicleType: 'Toyota' });
    expect(JSON.stringify(body.query.function_score.query.bool.filter)).toContain('vehicle_makes');
  });

  it('ignores blank and whitespace-only filter values', async () => {
    const body = await captureQuery({ brand: ' , ,' });
    expect(JSON.stringify(body.query.function_score.query.bool.filter)).not.toContain('brand.keyword');
  });
});
