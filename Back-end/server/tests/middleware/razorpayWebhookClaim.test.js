/**
 * Razorpay webhook replay protection — the claim must survive a FAILED run.
 *
 * Regression: the event key was written as "processed" before handleWebhook ran, so
 * when processing threw we answered 500 and Razorpay's retry was 200'd as a duplicate
 * — the payment was never recorded. Now: claim → process → mark done on success,
 * release on failure. Covered for Redis and for the MongoDB fallback.
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

// Plain functions, not jest.fn: jest.config's resetMocks wipes jest.fn implementations.
const store = new Map();
let redisMode = 'up'; // 'up' | 'none' (not configured) | 'down' (every call throws)
const fakeRedis = {
  async set(key, value, ...args) {
    if (args.includes('NX') && store.has(key)) return null;
    store.set(key, value);
    return 'OK';
  },
  async get(key) { return store.has(key) ? store.get(key) : null; },
  async del(key) { return store.delete(key) ? 1 : 0; },
};
const downRedis = {
  set: async () => { throw new Error('ECONNREFUSED'); },
  get: async () => { throw new Error('ECONNREFUSED'); },
  del: async () => { throw new Error('ECONNREFUSED'); },
};

let handlerImpl = async () => ({ message: 'processed' });
let handlerCalls = 0;

jest.unstable_mockModule('../../services/redisClient.js', () => ({
  getRedisClient: () => (redisMode === 'none' ? null : redisMode === 'down' ? downRedis : fakeRedis),
}));
jest.unstable_mockModule('../../services/razorpayService.js', () => ({
  default: {
    handleWebhook: async (...args) => { handlerCalls += 1; return handlerImpl(...args); },
  },
}));
jest.unstable_mockModule('../../services/paymentReconciliationService.js', () => ({
  WEBHOOK_LAST_SEEN_KEY: 'razorpay:webhook:last_seen',
}));
jest.unstable_mockModule('../../middleware/errorMiddleware.js', () => ({
  asyncHandler: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
}));

const { default: webhookRouter } = await import('../../middleware/razorpayWebhook.js');
const { default: WebhookEvent } = await import('../../models/WebhookEvent.js');

const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? 'test-webhook-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;

const app = express();
app.use('/webhook', express.raw({ type: 'application/json' }), webhookRouter);

let seq = 0;
function makeEvent() {
  seq += 1;
  const eventId = `evt_claim_${Date.now()}_${seq}`;
  const body = JSON.stringify({
    event: 'payment.captured',
    created_at: Math.floor(Date.now() / 1000),
    payload: { payment: { entity: { id: `pay_${seq}`, notes: { orderId: 'o1' } } } },
  });
  return { eventId, body };
}

const deliver = ({ eventId, body }) =>
  request(app)
    .post('/webhook')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-signature', crypto.createHmac('sha256', SECRET).update(body).digest('hex'))
    .set('x-razorpay-event-id', eventId)
    .send(body);

// The Mongo fallback relies on the unique eventId index — build it explicitly
// instead of racing Mongoose's background autoIndex.
beforeAll(async () => { await WebhookEvent.syncIndexes(); });

beforeEach(async () => {
  store.clear();
  redisMode = 'up';
  handlerCalls = 0;
  handlerImpl = async () => ({ message: 'processed' });
  await WebhookEvent.deleteMany({});
});

describe.each([
  ['Redis', 'up'],
  ['MongoDB fallback (Redis not configured)', 'none'],
  ['MongoDB fallback (Redis down)', 'down'],
])('webhook claim — %s', (_label, mode) => {
  beforeEach(() => { redisMode = mode; });

  it('same event delivered twice → processed exactly once', async () => {
    const evt = makeEvent();
    const first = await deliver(evt);
    const second = await deliver(evt);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(handlerCalls).toBe(1);
  });

  it('processing throws → 500, and Razorpay’s retry is processed (not dropped as a duplicate)', async () => {
    const evt = makeEvent();
    handlerImpl = async () => { throw new Error('Mongo blip'); };
    const failed = await deliver(evt);
    expect(failed.status).toBe(500);

    handlerImpl = async () => ({ message: 'processed' });
    const retry = await deliver(evt);
    expect(retry.status).toBe(200);
    expect(handlerCalls).toBe(2);

    // …and once that succeeds, a further replay is a duplicate again.
    const replay = await deliver(evt);
    expect(replay.status).toBe(200);
    expect(handlerCalls).toBe(2);
  });

  it('a delivery that arrives while the same event is mid-processing is not 200’d (so it can be retried)', async () => {
    const evt = makeEvent();
    let release;
    handlerImpl = () => new Promise((resolve) => { release = () => resolve({ message: 'ok' }); });

    const firstP = deliver(evt).then((r) => r); // starts processing and parks
    // Wait until the first delivery is inside the handler.
    // (The Mongo claim is a real insert, so poll on a timer rather than a tick count.)
    for (let i = 0; i < 500 && handlerCalls === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
    expect(handlerCalls).toBe(1);

    const concurrent = await deliver(evt);
    expect(concurrent.status).toBe(409);

    release();
    expect((await firstP).status).toBe(200);
    expect(handlerCalls).toBe(1);
  });
});

describe('webhook claim — store details', () => {
  it('Redis: marks done with a 24h key on success and deletes the key on failure', async () => {
    const ok = makeEvent();
    await deliver(ok);
    expect(store.get(`razorpay:event:${ok.eventId}`)).toBe('done');

    const bad = makeEvent();
    handlerImpl = async () => { throw new Error('boom'); };
    await deliver(bad);
    expect(store.has(`razorpay:event:${bad.eventId}`)).toBe(false);
  });

  it('Redis: a key written by the old code ("1") still counts as already processed', async () => {
    const evt = makeEvent();
    store.set(`razorpay:event:${evt.eventId}`, '1');
    const res = await deliver(evt);
    expect(res.status).toBe(200);
    expect(handlerCalls).toBe(0);
  });

  it('MongoDB: marks the WebhookEvent done on success, removes it on failure', async () => {
    redisMode = 'none';
    const ok = makeEvent();
    await deliver(ok);
    expect((await WebhookEvent.findOne({ eventId: ok.eventId }).lean()).status).toBe('done');

    const bad = makeEvent();
    handlerImpl = async () => { throw new Error('boom'); };
    await deliver(bad);
    expect(await WebhookEvent.countDocuments({ eventId: bad.eventId })).toBe(0);
  });

  it('MongoDB: a stale "processing" claim (crashed run) is cleared so the next retry processes', async () => {
    redisMode = 'none';
    const evt = makeEvent();
    await WebhookEvent.create({
      eventId: evt.eventId, eventType: 'payment.captured', status: 'processing',
      processedAt: new Date(Date.now() - 11 * 60 * 1000),
    });

    const backoff = await deliver(evt);
    expect(backoff.status).toBe(409);
    expect(handlerCalls).toBe(0);

    const retry = await deliver(evt);
    expect(retry.status).toBe(200);
    expect(handlerCalls).toBe(1);
  });

  it('MongoDB: a legacy row without a status counts as already processed', async () => {
    redisMode = 'none';
    const evt = makeEvent();
    await WebhookEvent.collection.insertOne({ eventId: evt.eventId, eventType: 'payment.captured', processedAt: new Date() });
    const res = await deliver(evt);
    expect(res.status).toBe(200);
    expect(handlerCalls).toBe(0);
  });

  it('an unknown event type is ignored without leaving a claim behind', async () => {
    const evt = makeEvent();
    evt.body = evt.body.replace('payment.captured', 'payment.authorized');
    const res = await deliver(evt);
    expect(res.status).toBe(200);
    expect(handlerCalls).toBe(0);
    expect(store.size).toBe(0);
  });
});
