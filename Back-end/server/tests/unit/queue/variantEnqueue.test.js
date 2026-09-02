/**
 * Unit tests — enqueueVariantGeneration (queue/queues.js)
 *
 * The whole point of raising this job from the SIGNATURE endpoint is that it is
 * the one place every public direct upload passes through. That makes the
 * enqueue itself load-bearing: if it silently stops happening, nothing breaks —
 * images just quietly start serving at full size forever, and the only symptom
 * is a bandwidth bill months later.
 */
import { jest } from '@jest/globals';

const add = jest.fn();
jest.unstable_mockModule('bullmq', () => ({
  Queue: class { constructor(name) { this.name = name; } add(...a) { return add(...a); } async close() {} },
}));
jest.unstable_mockModule('../../../queue/connection.js', () => ({ createConnection: () => ({}) }));

const { enqueueVariantGeneration, getMediaQueue } = await import('../../../queue/queues.js');

beforeEach(() => {
  jest.clearAllMocks();
  add.mockResolvedValue({ id: '1' });
  process.env.REDIS_URL = 'redis://localhost:6379';
});

describe('enqueueVariantGeneration', () => {
  test('raises a generate-variants job carrying the key', async () => {
    enqueueVariantGeneration('autobacs/products/a/photo.jpg');
    expect(add).toHaveBeenCalledWith(
      'generate-variants',
      { key: 'autobacs/products/a/photo.jpg' },
      expect.objectContaining({ delay: expect.any(Number) }),
    );
  });

  /*
    Delayed on purpose: the job is raised when the presigned URL is ISSUED, so
    the object does not exist yet. Firing immediately would burn the first
    attempt on a certainty.
  */
  test('is delayed so the browser has time to finish its PUT', () => {
    enqueueVariantGeneration('autobacs/products/a/photo.jpg');
    expect(add.mock.calls[0][2].delay).toBeGreaterThanOrEqual(10_000);
  });

  /*
    A retried signature request or a double-clicked save must not encode the same
    ladder twice — that is ~14 sharp encodes and 14 PUTs of pure waste.
  */
  test('collapses duplicates onto one job id', () => {
    enqueueVariantGeneration('autobacs/products/a/photo.jpg');
    enqueueVariantGeneration('autobacs/products/a/photo.jpg');
    const [first, second] = add.mock.calls;
    expect(first[2].jobId).toBe(second[2].jobId);
    expect(first[2].jobId).toContain('autobacs/products/a/photo.jpg');
  });

  test('uses the dedicated media queue, not notifications', () => {
    expect(getMediaQueue().name).toBe('media');
  });

  /*
    Variants are an OPTIMISATION and the image Worker serves the original when
    one is missing — so a queue problem must degrade to "larger images", never
    to a failed upload for the admin who is waiting on it.
  */
  test('a queue failure is swallowed rather than thrown at the caller', () => {
    add.mockRejectedValue(new Error('redis down'));
    expect(() => enqueueVariantGeneration('autobacs/products/a/photo.jpg')).not.toThrow();
  });

  test('is a no-op with no queue Redis configured', () => {
    delete process.env.REDIS_URL;
    delete process.env.QUEUE_REDIS_URL;
    enqueueVariantGeneration('autobacs/products/a/photo.jpg');
    expect(add).not.toHaveBeenCalled();
  });

  test('ignores an empty key', () => {
    enqueueVariantGeneration('');
    enqueueVariantGeneration(undefined);
    expect(add).not.toHaveBeenCalled();
  });
});
