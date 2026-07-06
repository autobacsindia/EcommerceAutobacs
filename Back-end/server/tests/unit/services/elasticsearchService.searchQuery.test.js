import { jest } from '@jest/globals';
import elasticsearchService from '../../../services/elasticsearchService.js';

// Regression guard for the search bug where any query returned nearly the whole
// catalog. The RETURNED set is decided solely by the bool `must` clause, so we
// assert its precision properties: all terms required, no fuzzy-explosion on
// short tokens, and the low-signal `description` field kept OUT of `must`.

const emptyEsResponse = {
  hits: { hits: [], total: { value: 0 } },
  aggregations: {
    categories: { buckets: [] },
    brands: { buckets: [] },
    vehicle_types: { buckets: [] },
    price_ranges: { buckets: [] },
    rating_ranges: { buckets: [] },
    availability: { buckets: [] },
  },
};

/** Run searchProducts against a mocked client and return the query body ES received. */
async function captureQuery(params) {
  const search = jest.fn().mockResolvedValue(emptyEsResponse);
  const prevClient = elasticsearchService.client;
  const prevEnabled = elasticsearchService.enabled;
  elasticsearchService.client = { search };
  elasticsearchService.enabled = true;
  try {
    await elasticsearchService.searchProducts(params);
  } finally {
    elasticsearchService.client = prevClient;
    elasticsearchService.enabled = prevEnabled;
  }
  return search.mock.calls[0][0].body;
}

describe('ElasticsearchService.searchProducts query shape', () => {
  it('requires all query terms and never matches on description (must clause)', async () => {
    const body = await captureQuery({ q: 'led' });
    const must = body.query.function_score.query.bool.must;
    const multi = must.find((c) => c.multi_match);

    expect(multi).toBeDefined();
    // All typed words must be present — prevents OR-explosion.
    expect(multi.multi_match.operator).toBe('and');
    // First two chars must be exact — stops "led"→"red"/"bed" fuzzy noise.
    expect(multi.multi_match.prefix_length).toBe(2);
    // description must NOT be part of the required match set.
    expect(multi.multi_match.fields.some((f) => f.startsWith('description'))).toBe(false);
    // high-signal fields stay in the match set.
    expect(multi.multi_match.fields).toEqual(
      expect.arrayContaining(['name^3', 'brand^2', 'sku^2', 'tags^1.5'])
    );
  });

  it('keeps description only as a ranking (should) signal', async () => {
    const body = await captureQuery({ q: 'thar bumper' });
    const should = body.query.function_score.query.bool.should || [];
    const hasDescriptionBoost = should.some(
      (c) => c.match && c.match.description
    );
    expect(hasDescriptionBoost).toBe(true);
  });

  it('falls back to match_all only when no query term is supplied', async () => {
    const body = await captureQuery({});
    const must = body.query.function_score.query.bool.must;
    expect(must.some((c) => c.match_all)).toBe(true);
  });
});
