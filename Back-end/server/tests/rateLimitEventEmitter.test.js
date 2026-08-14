import { jest } from '@jest/globals';

/**
 * Verifies the persistence policy is actually wired into the emitter's write
 * path (config/rateLimitTelemetry.js only proves the decision, not that anyone
 * consults it), and that the in-memory ring buffer still receives every event so
 * the realtime dashboard is unaffected by throttling durable writes.
 */

const createMock = jest.fn();

jest.unstable_mockModule('../repositories/rateLimitEventRepository.js', () => ({
  default: { create: createMock },
}));

const { RateLimitEventEmitter } = await import('../services/rateLimitEventEmitter.js');

/** The listener is async; let its microtasks drain before asserting. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('RateLimitEventEmitter persistence', () => {
  const ORIGINAL_ENV = { ...process.env };
  let emitter;

  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({});
    emitter = new RateLimitEventEmitter();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    emitter.removeAllListeners();
  });

  const blockPayload = {
    endpoint: '/api/v1/auth/login',
    method: 'POST',
    ipAddress: '203.0.113.9',
    limitType: 'window',
    currentLimit: 10,
    attemptCount: 11,
    retryAfter: 60,
  };

  const hitPayload = {
    endpoint: '/api/v1/products',
    method: 'GET',
    ipAddress: '203.0.113.9',
    limitType: 'window',
    currentLimit: 300,
    attemptCount: 1,
  };

  it('does not write hit events to MongoDB by default', async () => {
    delete process.env.RATE_LIMIT_EVENT_PERSIST;
    emitter.emitHit(hitPayload);
    await flush();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('still writes block events by default', async () => {
    delete process.env.RATE_LIMIT_EVENT_PERSIST;
    emitter.emitBlock(blockPayload);
    await flush();
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'block', endpoint: '/api/v1/auth/login' })
    );
  });

  it('writes hit events when explicitly set to all', async () => {
    process.env.RATE_LIMIT_EVENT_PERSIST = 'all';
    emitter.emitHit(hitPayload);
    await flush();
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'hit' }));
  });

  it('keeps every event in the ring buffer even when not persisted', async () => {
    delete process.env.RATE_LIMIT_EVENT_PERSIST;
    emitter.emitHit(hitPayload);
    emitter.emitHit(hitPayload);
    emitter.emitBlock(blockPayload);
    await flush();

    // 3 in memory for the realtime dashboard, 1 durable write.
    expect(emitter.getRecentEvents()).toHaveLength(3);
    expect(emitter.getRecentEventsByType('hit')).toHaveLength(2);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('never stores deviceInfo (it duplicated userAgent on every row)', async () => {
    process.env.RATE_LIMIT_EVENT_PERSIST = 'all';
    emitter.emitHit({ ...hitPayload, userAgent: 'Mozilla/5.0' });
    await flush();
    expect(createMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ deviceInfo: expect.anything() })
    );
  });

  it('does not throw when the durable write fails', async () => {
    process.env.RATE_LIMIT_EVENT_PERSIST = 'all';
    createMock.mockRejectedValue(new Error('mongo down'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => emitter.emitBlock(blockPayload)).not.toThrow();
    await flush();

    // The request path must survive a telemetry outage.
    expect(emitter.getRecentEvents()).toHaveLength(1);
    errorSpy.mockRestore();
  });

  it('caps the ring buffer so it cannot grow without bound', async () => {
    delete process.env.RATE_LIMIT_EVENT_PERSIST;
    for (let i = 0; i < emitter.maxInMemoryEvents + 50; i += 1) {
      emitter.emitHit(hitPayload);
    }
    await flush();
    expect(emitter.getRecentEvents(Number.MAX_SAFE_INTEGER))
      .toHaveLength(emitter.maxInMemoryEvents);
  });
});
