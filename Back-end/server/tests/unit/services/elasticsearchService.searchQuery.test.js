import { jest } from '@jest/globals';
import elasticsearchService from '../../../services/elasticsearchService.js';

// Regression guard for the search bug where any query returned nearly the whole
// catalog. The RETURNED set is decided solely by the bool `must` clause, so we
// assert its precision properties: all terms required, no fuzzy-explosion on
// short tokens, and the low-signal `description` field kept OUT of `must`.
//
// The `must` now holds a single `bool { should: [...recall lanes], minimum_should_match: 1 }`
// mirroring the MongoDB path: a precise literal multi_match, category-name recall,
// and synonym name-matches. Helper below digs the literal multi_match out of that
// nested shape so the precision assertions stay stable across the refactor.

/** Return the required recall bool ({ should, minimum_should_match }) from a captured body. */
function recallBool(body) {
  const must = body.query.function_score.query.bool.must;
  const wrapper = must.find((c) => c.bool && Array.isArray(c.bool.should));
  return wrapper ? wrapper.bool : null;
}

/** Return the literal multi_match recall lane (the precise, high-signal one). */
function literalMultiMatch(body) {
  const bool = recallBool(body);
  return bool ? bool.should.find((c) => c.multi_match) : undefined;
}

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
    const bool = recallBool(body);
    const multi = literalMultiMatch(body);

    // Recall is a single required bool with at-least-one matching lane.
    expect(bool).not.toBeNull();
    expect(bool.minimum_should_match).toBe(1);

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
    // No recall lane may match on description.
    const matchesDescription = bool.should.some(
      (c) =>
        (c.match && c.match.description) ||
        (c.multi_match && c.multi_match.fields.some((f) => f.startsWith('description')))
    );
    expect(matchesDescription).toBe(false);
  });

  it('adds a category-name recall lane keyed on the LITERAL query (no synonym over-recall)', async () => {
    const body = await captureQuery({ q: 'floor mat' });
    const bool = recallBool(body);
    const categoryLane = bool.should.find(
      (c) => c.match && c.match['categories.name']
    );
    expect(categoryLane).toBeDefined();
    // Literal only + all words required — so "floor mat" recalls a Floor Mats
    // category, NOT the whole Interior tree its synonyms expand to.
    expect(categoryLane.match['categories.name'].operator).toBe('and');
    expect(categoryLane.match['categories.name'].query).toBe('floor mat');
  });

  it('expands synonyms and scopes them to the name field only', async () => {
    const body = await captureQuery({ q: 'lights' });
    const bool = recallBool(body);
    // "lights" expands (e.g. led/lamp/headlight); each synonym is a name-only match.
    const nameSynonymLanes = bool.should.filter(
      (c) => c.match && c.match.name && typeof c.match.name === 'object'
    );
    expect(nameSynonymLanes.length).toBeGreaterThan(0);
    // Synonyms must never leak into tags/description — name-scoped only.
    for (const lane of nameSynonymLanes) {
      expect(lane.match.name.operator).toBe('and');
    }
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

describe('ElasticsearchService.getSearchSuggestions corrections', () => {
  // The name and brand phrase-suggesters routinely emit the SAME correction, so
  // the "did you mean?" list used to show duplicates (e.g. profender ×2). The
  // response now dedupes by suggested text, keeps the highest confidence, drops
  // echoes of the query, and sorts by confidence.
  function suggestResponse({ nameOptions = [], brandOptions = [] } = {}) {
    return {
      hits: { hits: [], total: { value: 0 } },
      suggest: {
        name_suggest: [{ options: nameOptions }],
        brand_suggest: [{ options: brandOptions }],
      },
    };
  }

  async function captureSuggestions(query, response) {
    const search = jest.fn().mockResolvedValue(response);
    const prevClient = elasticsearchService.client;
    const prevEnabled = elasticsearchService.enabled;
    elasticsearchService.client = { search };
    elasticsearchService.enabled = true;
    try {
      return await elasticsearchService.getSearchSuggestions(query, 8);
    } finally {
      elasticsearchService.client = prevClient;
      elasticsearchService.enabled = prevEnabled;
    }
  }

  it('dedupes the same correction from name + brand suggesters, keeping the higher score', async () => {
    const { corrections } = await captureSuggestions(
      'profendor',
      suggestResponse({
        nameOptions: [{ text: 'profender', score: 0.07 }],
        brandOptions: [{ text: 'profender', score: 0.11 }],
      })
    );
    const profender = corrections.filter((c) => c.suggested === 'profender');
    expect(profender).toHaveLength(1);
    expect(profender[0].confidence).toBeCloseTo(0.11); // higher score wins
  });

  it('drops corrections that merely echo the query and sorts by confidence', async () => {
    const { corrections } = await captureSuggestions(
      'bumper',
      suggestResponse({
        nameOptions: [
          { text: 'bumper', score: 0.9 }, // echoes query → dropped
          { text: 'bumpers', score: 0.2 },
          { text: 'jumper', score: 0.5 },
        ],
      })
    );
    expect(corrections.map((c) => c.suggested)).not.toContain('bumper');
    // sorted by confidence desc
    expect(corrections.map((c) => c.suggested)).toEqual(['jumper', 'bumpers']);
  });
});
