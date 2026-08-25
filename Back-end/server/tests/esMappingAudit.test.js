/**
 * Guards the LIVE half of Elasticsearch mapping drift.
 *
 * tests/elasticsearchMappingDrift.test.js already checks that every field a
 * query names exists in the mapping createIndex() would build. That is a
 * code-vs-code check, and it passed for the whole time production was broken:
 * the declared mapping was correct, but createIndex() no-ops on an existing
 * index, so the live `brand` field stayed a bare `keyword` and every brand
 * filter matched 0 of 44 products. These tests cover the comparison that would
 * have caught it — declared vs. what the cluster actually holds.
 */
import { jest } from '@jest/globals';
import elasticsearchService, {
  PRODUCT_INDEX_MAPPING,
  flattenMapping,
  diffMapping,
} from '../services/elasticsearchService.js';

/** The live mapping as production actually held it: brand as a bare keyword. */
const LIVE_WITH_BRAND_DRIFT = {
  ...PRODUCT_INDEX_MAPPING.properties,
  brand: { type: 'keyword' },
};

describe('flattenMapping', () => {
  it('flattens nested properties to dotted leaf paths', () => {
    const flat = flattenMapping({
      brand: { type: 'text', fields: { keyword: { type: 'keyword' } } },
      categories: { properties: { slug: { type: 'text', fields: { keyword: { type: 'keyword' } } } } },
    });

    expect(flat.get('brand')).toEqual({ type: 'text', fields: { keyword: 'keyword' } });
    expect(flat.get('categories.slug')).toEqual({ type: 'text', fields: { keyword: 'keyword' } });
    expect(flat.has('categories')).toBe(false); // containers are not leaves
  });
});

describe('diffMapping', () => {
  it('reports no drift when the live mapping matches', () => {
    expect(diffMapping(PRODUCT_INDEX_MAPPING.properties, PRODUCT_INDEX_MAPPING.properties))
      .toEqual({ ok: true, drift: [] });
  });

  it('catches the production brand bug: bare keyword, no .keyword sub-field', () => {
    const { ok, drift } = diffMapping(PRODUCT_INDEX_MAPPING.properties, LIVE_WITH_BRAND_DRIFT);

    expect(ok).toBe(false);
    expect(drift).toEqual(expect.arrayContaining([
      { path: 'brand', issue: 'type', declared: 'text', live: 'keyword' },
      { path: 'brand.keyword', issue: 'subfield', declared: 'keyword', live: '(absent)' },
    ]));
  });

  it('reports a declared field the live index lacks entirely', () => {
    const live = { ...PRODUCT_INDEX_MAPPING.properties };
    delete live.slug;

    const { ok, drift } = diffMapping(PRODUCT_INDEX_MAPPING.properties, live);
    expect(ok).toBe(false);
    expect(drift).toContainEqual({ path: 'slug', issue: 'missing', declared: 'keyword', live: '(absent)' });
  });

  it('catches drift inside a nested object (categories.slug.keyword)', () => {
    const live = JSON.parse(JSON.stringify(PRODUCT_INDEX_MAPPING.properties));
    live.categories.properties.slug = { type: 'text' }; // sub-field dropped

    const { ok, drift } = diffMapping(PRODUCT_INDEX_MAPPING.properties, live);
    expect(ok).toBe(false);
    expect(drift).toContainEqual({
      path: 'categories.slug.keyword', issue: 'subfield', declared: 'keyword', live: '(absent)',
    });
  });

  it('tolerates EXTRA live fields — dynamic mapping legitimately adds them', () => {
    const live = {
      ...PRODUCT_INDEX_MAPPING.properties,
      priceMin: { type: 'long' },
      productType: { type: 'text', fields: { keyword: { type: 'keyword' } } },
    };

    expect(diffMapping(PRODUCT_INDEX_MAPPING.properties, live).ok).toBe(true);
  });

  it('ignores cosmetic options like ignore_above, which cannot empty a facet', () => {
    const live = JSON.parse(JSON.stringify(PRODUCT_INDEX_MAPPING.properties));
    live.brand.fields.keyword.ignore_above = 256;

    expect(diffMapping(PRODUCT_INDEX_MAPPING.properties, live).ok).toBe(true);
  });
});

describe('verifyMapping', () => {
  const originalClient = elasticsearchService.client;
  afterEach(() => { elasticsearchService.client = originalClient; });

  const clientReturning = (exists, properties) => ({
    indices: {
      exists: jest.fn().mockResolvedValue(exists),
      getMapping: jest.fn().mockResolvedValue({
        // Keyed by CONCRETE index name, which differs from indexName behind an alias.
        'products-000001': { mappings: { properties } },
      }),
    },
  });

  it('reads the live mapping and reports drift', async () => {
    elasticsearchService.client = clientReturning(true, LIVE_WITH_BRAND_DRIFT);

    const result = await elasticsearchService.verifyMapping();
    expect(result.indexExists).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.drift.map((d) => d.path)).toEqual(expect.arrayContaining(['brand', 'brand.keyword']));
  });

  it('passes when the live mapping matches the declared one', async () => {
    elasticsearchService.client = clientReturning(true, PRODUCT_INDEX_MAPPING.properties);

    await expect(elasticsearchService.verifyMapping())
      .resolves.toEqual({ ok: true, indexExists: true, drift: [] });
  });

  it('reports a missing index rather than treating it as clean', async () => {
    elasticsearchService.client = clientReturning(false, {});

    await expect(elasticsearchService.verifyMapping())
      .resolves.toEqual({ ok: false, indexExists: false, drift: [] });
  });
});
