/**
 * Unit tests for Product.enqueueProductSync — the explicit ES-sync enqueue used
 * by bulk `Product.updateMany` writes (brand rename/mapping, vehicle fitment
 * mapping) that BYPASS the schema's document hooks. Verifies the env guard, that
 * one job is enqueued per id with jobId = id (so rapid re-writes dedup), and
 * that both single ids and arrays (incl. empty/null) are handled.
 */

import { jest } from '@jest/globals';

const mockSearchSyncAdd = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../../queue/queues.js', () => ({
  getSearchSyncQueue: () => ({ add: mockSearchSyncAdd }),
}));

// The enqueue is gated on REDIS_URL + ELASTICSEARCH_ENABLED, checked at call time.
const ORIGINAL_REDIS_URL = process.env.REDIS_URL;
const ORIGINAL_ES_ENABLED = process.env.ELASTICSEARCH_ENABLED;

const { enqueueProductSync } = await import('../../../models/Product.js');

const enable = () => {
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.ELASTICSEARCH_ENABLED = 'true';
};

beforeEach(() => {
  mockSearchSyncAdd.mockReset().mockResolvedValue(undefined);
  enable();
});

afterAll(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL;
  if (ORIGINAL_ES_ENABLED === undefined) delete process.env.ELASTICSEARCH_ENABLED;
  else process.env.ELASTICSEARCH_ENABLED = ORIGINAL_ES_ENABLED;
});

describe('enqueueProductSync', () => {
  test('enqueues one es-sync-product job per id, with jobId = id (dedup key)', () => {
    enqueueProductSync(['a1', 'b2', 'c3']);
    expect(mockSearchSyncAdd).toHaveBeenCalledTimes(3);
    expect(mockSearchSyncAdd).toHaveBeenCalledWith(
      'es-sync-product',
      { productId: 'a1' },
      { jobId: 'a1' },
    );
  });

  test('accepts a single (non-array) id', () => {
    enqueueProductSync('solo');
    expect(mockSearchSyncAdd).toHaveBeenCalledTimes(1);
    expect(mockSearchSyncAdd).toHaveBeenCalledWith(
      'es-sync-product',
      { productId: 'solo' },
      { jobId: 'solo' },
    );
  });

  test('coerces ObjectId-like ids to string', () => {
    enqueueProductSync([{ toString: () => 'oid123' }]);
    expect(mockSearchSyncAdd).toHaveBeenCalledWith(
      'es-sync-product',
      { productId: 'oid123' },
      { jobId: 'oid123' },
    );
  });

  test('no-ops on empty array, null, and undefined', () => {
    enqueueProductSync([]);
    enqueueProductSync(null);
    enqueueProductSync(undefined);
    expect(mockSearchSyncAdd).not.toHaveBeenCalled();
  });

  test('skips null/undefined entries inside the array', () => {
    enqueueProductSync(['ok', null, undefined]);
    expect(mockSearchSyncAdd).toHaveBeenCalledTimes(1);
    expect(mockSearchSyncAdd).toHaveBeenCalledWith(
      'es-sync-product',
      { productId: 'ok' },
      { jobId: 'ok' },
    );
  });

  test('is a no-op when ELASTICSEARCH_ENABLED is not set (dev/ES-disabled)', () => {
    delete process.env.ELASTICSEARCH_ENABLED;
    enqueueProductSync(['a1', 'b2']);
    expect(mockSearchSyncAdd).not.toHaveBeenCalled();
  });

  test('is a no-op when REDIS_URL is not set', () => {
    delete process.env.REDIS_URL;
    enqueueProductSync(['a1', 'b2']);
    expect(mockSearchSyncAdd).not.toHaveBeenCalled();
  });
});
