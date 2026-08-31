import {
  ATLAS_SEARCH_INDEX_DEFINITION,
  flattenDefinition,
  diffDefinition,
} from '../config/atlasSearchIndex.js';
import {
  buildSearchStage,
  HIGH_SIGNAL_FIELDS,
} from '../services/atlasSearchService.js';

/**
 * Guards the gap between "the query names a field" and "the index declares it".
 *
 * This is the Atlas counterpart of tests/elasticsearchMappingDrift.test.js, and
 * it exists because BOTH engines fail this case silently and identically: a query
 * against an undeclared field matches nothing and facets to nothing, no error is
 * raised, and searchService deliberately TRUSTS a zero-hit answer from a
 * populated index — so there is not even a MongoDB fallback to soften it. It
 * looks exactly like "we don't stock that."
 *
 * That is not hypothetical. `brand` was created as a bare keyword, the code was
 * corrected to text + keyword, merged and deployed, and the live index kept the
 * old shape — so `?brand=Auxbeam` matched 0 of 44 products and the brand facet
 * returned 0 buckets across all 930.
 *
 * These tests only ever see CODE. They cannot detect that the LIVE index differs
 * from the declaration — `createSearchIndex` no-ops on an existing index, so that
 * remains possible and is the job of `npm run audit-atlas-search-index` against
 * the real cluster.
 */

const declared = flattenDefinition(ATLAS_SEARCH_INDEX_DEFINITION.mappings.fields);

/** Every `path` value anywhere in a query object, at any depth. */
function collectPaths(node, found = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectPaths(item, found);
    return found;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'path') {
        // `path` is a string, or {value: 'field'} in a score function.
        if (typeof value === 'string') found.add(value);
        else if (value && typeof value.value === 'string') found.add(value.value);
      }
      collectPaths(value, found);
    }
  }
  return found;
}

/** A query exercising every lane, filter and ranking clause at once. */
function maximalStage() {
  return buildSearchStage(
    {
      brand: 'Auxbeam',
      minPrice: 50,
      maxPrice: 500,
      inStock: 'true',
      rating: '4',
      sortBy: 'createdAt',
    },
    {
      tokens: ['tailgate', 'spoiler', 'hilux'],
      cleanedQuery: 'tailgate spoiler hilux',
      queryCategoryIds: ['aaaaaaaaaaaaaaaaaaaaaaaa'],
      queryVehicleIds: ['bbbbbbbbbbbbbbbbbbbbbbbb'],
      synonymCategoryIds: ['cccccccccccccccccccccccc'],
      synonymTerms: ['bumper'],
      categoryIds: ['dddddddddddddddddddddddd'],
      vehicleFilterIds: ['eeeeeeeeeeeeeeeeeeeeeeee'],
    }
  );
}

describe('Atlas Search index drift — query fields vs declared definition', () => {
  it('declares every field the query builder references', () => {
    const used = collectPaths(maximalStage());
    // `_id` is the match-nothing sentinel for an unmatched vehicle filter; it is
    // always present on a document and needs no mapping entry.
    used.delete('_id');

    const undeclared = [...used].filter((path) => !declared.has(path));
    expect(undeclared).toEqual([]);
  });

  it('declares every high-signal recall field', () => {
    for (const field of HIGH_SIGNAL_FIELDS) {
      expect(declared.has(field.path)).toBe(true);
    }
  });

  it('indexes `name` as autocomplete, which the suggestion and ranking clauses require', () => {
    // The `autocomplete` operator errors outright against a path with no
    // autocomplete type — this is the one drift that fails loudly rather than
    // silently, and it would take the whole search box down.
    expect(declared.get('name')).toContain('autocomplete');
  });

  it('indexes the ObjectId reference arrays as objectId, not string', () => {
    // `in` against these carries ObjectIds. Declaring them as `string` would
    // match nothing and silently empty every category and vehicle filter.
    expect(declared.get('categories')).toEqual(['objectId']);
    expect(declared.get('compatibleVehicles')).toEqual(['objectId']);
  });

  it('indexes exact-match filter fields as token', () => {
    // `in`/`equals` need token, not the analyzed string. `brand` needs BOTH:
    // analyzed for recall ("roav" must match "Roav 4x4"), token for the filter
    // and the facet. Declaring it as one or the other broke both at once before.
    expect(declared.get('brand')).toEqual(expect.arrayContaining(['token', 'string']));
    expect(declared.get('stock')).toContain('token');
  });

  it('indexes every sortable field with a sortable type', () => {
    // A $search sort against an undeclared field is not honoured, so a shopper
    // choosing "price: low to high" would silently get relevance order.
    const SORTABLE = ['createdAt', 'updatedAt', 'price', 'averageRating', 'totalReviews', 'name'];
    for (const field of SORTABLE) {
      expect(declared.has(field)).toBe(true);
      expect(declared.get(field).some((t) => ['number', 'date', 'token'].includes(t))).toBe(true);
    }
  });

  it('indexes the numeric fields the score functions read', () => {
    for (const field of ['totalReviews', 'averageRating']) {
      expect(declared.get(field)).toContain('number');
    }
  });

  it('keeps dynamic mapping OFF so a field cannot be inferred into existence', () => {
    // Dynamic mapping is what made the Elasticsearch category fields exist "only
    // because ES happened to infer text+keyword on first index" — one indexing
    // order away from silently emptying the facet sidebar.
    expect(ATLAS_SEARCH_INDEX_DEFINITION.mappings.dynamic).toBe(false);
  });
});

describe('diffDefinition', () => {
  const fields = ATLAS_SEARCH_INDEX_DEFINITION.mappings.fields;

  it('reports no drift against itself', () => {
    const { ok, drift } = diffDefinition(fields, fields);
    expect(ok).toBe(true);
    expect(drift).toEqual([]);
  });

  it('flags a field the live index is missing', () => {
    const live = { ...fields };
    delete live.brand;
    const { ok, drift } = diffDefinition(fields, live);
    expect(ok).toBe(false);
    expect(drift).toContainEqual(expect.objectContaining({ path: 'brand', issue: 'missing' }));
  });

  it('flags the exact brand regression that shipped undetected', () => {
    // Declared text+token, live holds a bare token — the real shape of the
    // incident: the analyzed field vanished, so "roav" stopped matching.
    const live = { ...fields, brand: { type: 'token' } };
    const { drift } = diffDefinition(fields, live);
    expect(drift).toContainEqual(
      expect.objectContaining({
        path: 'brand',
        issue: 'mismatch',
        declared: ['string', 'token'],
        live: ['token'],
      })
    );
  });

  it('does not fail the audit for a lingering extra field', () => {
    // A field can legitimately outlive its declaration between an index update
    // and a cleanup; only missing and mismatched break queries.
    const live = { ...fields, legacyField: { type: 'string' } };
    const { ok, drift } = diffDefinition(fields, live);
    expect(ok).toBe(true);
    expect(drift).toContainEqual(expect.objectContaining({ path: 'legacyField', issue: 'extra' }));
  });

  it('ignores the order of a multi-type declaration', () => {
    const live = { ...fields, brand: [{ type: 'token', normalizer: 'lowercase' }, { type: 'string' }] };
    const { drift } = diffDefinition(fields, live);
    expect(drift.filter((d) => d.path === 'brand')).toEqual([]);
  });
});
