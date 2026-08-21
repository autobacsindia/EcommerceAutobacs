import { jest } from '@jest/globals';
import elasticsearchService from '../../../services/elasticsearchService.js';

/**
 * `getIndexedDocumentCount` is the signal that lets search TRUST a zero-hit result.
 *
 * Elasticsearch does not throw on a missing or wiped index — it returns zero hits,
 * indistinguishable from "we genuinely don't stock this". Search used to resolve
 * that ambiguity by re-asking MongoDB on EVERY empty result, costing a full regex
 * collection scan plus an unbounded countDocuments (Atlas inefficiency score 930).
 *
 * Now the index's own document count decides. That makes this function's failure
 * modes load-bearing: reporting "populated" when it is not would surface an empty
 * catalogue to every shopper, so an unknown answer MUST be null, never a number.
 */
describe('getIndexedDocumentCount', () => {
  let originalClient;
  let originalEnabled;

  beforeEach(() => {
    originalClient = elasticsearchService.client;
    originalEnabled = elasticsearchService.enabled;
    elasticsearchService.enabled = true;
    elasticsearchService.__resetIndexPopulation();
  });

  afterEach(() => {
    elasticsearchService.client = originalClient;
    elasticsearchService.enabled = originalEnabled;
    elasticsearchService.__resetIndexPopulation();
    jest.restoreAllMocks();
  });

  it('returns the count from the client', async () => {
    elasticsearchService.client = { count: jest.fn().mockResolvedValue({ count: 930 }) };
    expect(await elasticsearchService.getIndexedDocumentCount()).toBe(930);
  });

  it('caches so an empty search does not add a round trip each time', async () => {
    const count = jest.fn().mockResolvedValue({ count: 930 });
    elasticsearchService.client = { count };

    await elasticsearchService.getIndexedDocumentCount();
    await elasticsearchService.getIndexedDocumentCount();
    await elasticsearchService.getIndexedDocumentCount();

    expect(count).toHaveBeenCalledTimes(1);
  });

  it('force:true bypasses the cache', async () => {
    const count = jest.fn().mockResolvedValue({ count: 930 });
    elasticsearchService.client = { count };

    await elasticsearchService.getIndexedDocumentCount();
    await elasticsearchService.getIndexedDocumentCount({ force: true });

    expect(count).toHaveBeenCalledTimes(2);
  });

  it('re-reads once the cache window has passed', async () => {
    const count = jest.fn().mockResolvedValue({ count: 930 });
    elasticsearchService.client = { count };
    await elasticsearchService.getIndexedDocumentCount();

    // Age the reading past its TTL rather than waiting a real minute.
    elasticsearchService.indexPopulation.lastChecked = Date.now() - 61_000;
    await elasticsearchService.getIndexedDocumentCount();

    expect(count).toHaveBeenCalledTimes(2);
  });

  // A wiped index throws index_not_found_exception. That is exactly the outage the
  // fallback exists for, so it must read as null (unknown), never as a live count.
  it('returns null when the count throws (missing index)', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    elasticsearchService.client = {
      count: jest.fn().mockRejectedValue(new Error('index_not_found_exception')),
    };
    expect(await elasticsearchService.getIndexedDocumentCount()).toBeNull();
  });

  it('returns null when ES is disabled or has no client', async () => {
    elasticsearchService.enabled = false;
    elasticsearchService.client = { count: jest.fn() };
    expect(await elasticsearchService.getIndexedDocumentCount()).toBeNull();

    elasticsearchService.enabled = true;
    elasticsearchService.client = null;
    expect(await elasticsearchService.getIndexedDocumentCount()).toBeNull();
  });

  // A genuinely empty index reports 0 — that is a real reading, not "unknown", and
  // callers rely on `> 0` so both land on the fallback anyway.
  it('reports a real zero as 0, not null', async () => {
    elasticsearchService.client = { count: jest.fn().mockResolvedValue({ count: 0 }) };
    expect(await elasticsearchService.getIndexedDocumentCount()).toBe(0);
  });

  it('reads the legacy body.count response shape', async () => {
    elasticsearchService.client = { count: jest.fn().mockResolvedValue({ body: { count: 42 } }) };
    expect(await elasticsearchService.getIndexedDocumentCount()).toBe(42);
  });
});
