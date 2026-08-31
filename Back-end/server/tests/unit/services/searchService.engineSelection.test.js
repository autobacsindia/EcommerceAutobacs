import { getSearchEngine } from '../../../services/searchService.js';
import elasticsearchService from '../../../services/elasticsearchService.js';
import atlasSearchService from '../../../services/atlasSearchService.js';

/**
 * The engine switch is the rollback plan, so it is tested as one.
 *
 * If Atlas Search misbehaves in production the remedy must be a Railway variable
 * change plus a restart — not a revert, a PR, two CI runs and a redeploy. That
 * only holds if the engine is resolved per call rather than captured at import
 * time, which is exactly what these assertions pin.
 */
describe('getSearchEngine', () => {
  const original = process.env.SEARCH_ENGINE;
  afterEach(() => {
    if (original === undefined) delete process.env.SEARCH_ENGINE;
    else process.env.SEARCH_ENGINE = original;
  });

  it('defaults to Elasticsearch when unset, so the migration ships dormant', () => {
    delete process.env.SEARCH_ENGINE;
    expect(getSearchEngine()).toBe(elasticsearchService);
  });

  it('selects Atlas Search only on an exact opt-in', () => {
    process.env.SEARCH_ENGINE = 'atlas';
    expect(getSearchEngine()).toBe(atlasSearchService);
  });

  it('falls back to Elasticsearch for any unrecognised value', () => {
    // A typo in a dashboard variable must not silently disable search.
    for (const value of ['Atlas', 'ATLAS', 'atlas-search', 'mongodb', '']) {
      process.env.SEARCH_ENGINE = value;
      expect(getSearchEngine()).toBe(elasticsearchService);
    }
  });

  it('re-reads the variable on every call, so a flip needs no redeploy', () => {
    process.env.SEARCH_ENGINE = 'atlas';
    expect(getSearchEngine()).toBe(atlasSearchService);
    process.env.SEARCH_ENGINE = 'elastic';
    expect(getSearchEngine()).toBe(elasticsearchService);
  });

  it('exposes the same six-method contract from both engines', () => {
    // searchService calls exactly these. A missing method on either engine is a
    // runtime TypeError on a live storefront, so it is asserted structurally.
    const CONTRACT = [
      'isConnected',
      'searchProducts',
      'getIndexedDocumentCount',
      'getSearchSuggestions',
      'getSearchAnalytics',
      'logSearchQuery',
    ];
    for (const method of CONTRACT) {
      expect(typeof elasticsearchService[method]).toBe('function');
      expect(typeof atlasSearchService[method]).toBe('function');
    }
  });
});
