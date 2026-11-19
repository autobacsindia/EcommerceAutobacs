/**
 * /api/v1/webhooks/whatsapp — through the REAL app, so the mount order is proved too
 * (raw body before the JSON parser, and before CSRF, which would 403 every event).
 *
 *   GET  handshake: right token → the challenge echoed; wrong/missing → 403.
 *   POST: missing or bad signature → 401, secret unset → 503 — never 200;
 *         a good signature → the log row's delivery status moves forward;
 *         statuses out of order or repeated never move it backwards.
 */

import crypto from 'crypto';
import request from 'supertest';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

const { app } = await import('../app.js');
const { default: NotificationLog } = await import('../models/NotificationLog.js');

const URL = '/api/v1/webhooks/whatsapp';
const SECRET = 'test-app-secret';
const ENV_KEYS = ['WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'];
const savedEnv = {};

const sign = (raw, secret = SECRET) =>
  `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

const statusEvent = (...statuses) => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        statuses: statuses.map(([id, status, ts = 1_763_000_000, errors]) => ({
          id, status, timestamp: String(ts), recipient_id: '919876543210', ...(errors ? { errors } : {}),
        })),
      },
    }],
  }],
});

const post = (raw, signature) => {
  const req = request(app).post(URL).set('Content-Type', 'application/json');
  if (signature) req.set('X-Hub-Signature-256', signature);
  return req.send(raw);
};

const seedLog = (wamid, deliveryStatus = 'accepted') => NotificationLog.create({
  notificationId: `wa:test:${wamid}`,
  orderId: new mongoose.Types.ObjectId(),
  type: 'whatsapp',
  event: 'order_shipped',
  recipient: '+919876543210',
  provider: 'meta',
  status: 'success',
  providerId: wamid,
  deliveryStatus,
});

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
beforeEach(() => {
  process.env.WHATSAPP_APP_SECRET = SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me-please';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  await NotificationLog.deleteMany({});
  jest.restoreAllMocks();
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('GET handshake', () => {
  it('echoes the challenge for the right verify token', async () => {
    const res = await request(app).get(URL)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me-please', 'hub.challenge': '1158201444' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('1158201444');
  });

  it.each([
    ['a wrong token', { 'hub.mode': 'subscribe', 'hub.verify_token': 'guess', 'hub.challenge': 'x' }],
    ['no token', { 'hub.mode': 'subscribe', 'hub.challenge': 'x' }],
    ['the wrong mode', { 'hub.mode': 'unsubscribe', 'hub.verify_token': 'verify-me-please', 'hub.challenge': 'x' }],
  ])('refuses %s with 403', async (_label, query) => {
    const res = await request(app).get(URL).query(query);
    expect(res.status).toBe(403);
    expect(res.text).not.toBe('x');
  });

  it('refuses everything when no verify token is configured', async () => {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    const res = await request(app).get(URL)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': 'x' });
    expect(res.status).toBe(403);
  });
});

describe('POST signature check — never 200 without a valid one', () => {
  it('a missing signature is 401 and changes nothing', async () => {
    await seedLog('wamid.A');
    const res = await post(statusEvent(['wamid.A', 'delivered']));
    expect(res.status).toBe(401);
    expect((await NotificationLog.findOne({ providerId: 'wamid.A' })).deliveryStatus).toBe('accepted');
  });

  it('a signature made with the wrong secret is 401', async () => {
    await seedLog('wamid.A');
    const raw = statusEvent(['wamid.A', 'read']);
    const res = await post(raw, sign(raw, 'not-the-secret'));
    expect(res.status).toBe(401);
    expect((await NotificationLog.findOne({ providerId: 'wamid.A' })).deliveryStatus).toBe('accepted');
  });

  it('a valid signature over DIFFERENT bytes (tampered body) is 401', async () => {
    const res = await post(statusEvent(['wamid.A', 'read']), sign(statusEvent(['wamid.A', 'sent'])));
    expect(res.status).toBe(401);
  });

  it('a malformed signature header is 401, not a crash', async () => {
    const res = await post(statusEvent(['wamid.A', 'read']), 'sha256=zz');
    expect(res.status).toBe(401);
  });

  it('with no app secret configured, every event is refused (503)', async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    const raw = statusEvent(['wamid.A', 'read']);
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(503);
  });
});

describe('POST with a good signature', () => {
  it('moves the message forward and answers 200', async () => {
    await seedLog('wamid.A');
    const raw = statusEvent(['wamid.A', 'sent'], ['wamid.A', 'delivered', 1_763_000_100]);
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(200);
    const row = await NotificationLog.findOne({ providerId: 'wamid.A' }).lean();
    expect(row.deliveryStatus).toBe('delivered');
    expect(row.deliveryStatusAt.toISOString()).toBe(new Date(1_763_000_100 * 1000).toISOString());
  });

  it('out of order: `read` then a late `delivered` and a repeated `sent` stay at read', async () => {
    await seedLog('wamid.B');
    const first = statusEvent(['wamid.B', 'read']);
    await post(first, sign(first));
    const late = statusEvent(['wamid.B', 'delivered'], ['wamid.B', 'sent'], ['wamid.B', 'read']);
    const res = await post(late, sign(late));
    expect(res.status).toBe(200);
    expect((await NotificationLog.findOne({ providerId: 'wamid.B' })).deliveryStatus).toBe('read');
  });

  it('`failed` marks a sent message failed with the reason, but never overrides delivered', async () => {
    await seedLog('wamid.C', 'sent');
    await seedLog('wamid.D', 'delivered');
    const raw = statusEvent(
      ['wamid.C', 'failed', 1_763_000_000, [{ code: 131026, title: 'Message undeliverable' }]],
      ['wamid.D', 'failed'],
    );
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(200);
    const c = await NotificationLog.findOne({ providerId: 'wamid.C' }).lean();
    expect(c).toMatchObject({ deliveryStatus: 'failed', status: 'failed' });
    expect(c.errorMessage).toMatch(/131026 Message undeliverable/);
    expect((await NotificationLog.findOne({ providerId: 'wamid.D' })).deliveryStatus).toBe('delivered');
  });

  it('a customer reply or an unknown message id is accepted and ignored', async () => {
    const raw = JSON.stringify({
      entry: [{ changes: [{ value: {
        messages: [{ from: '919876543210', id: 'wamid.IN', type: 'text', text: { body: 'hello' } }],
        statuses: [{ id: 'wamid.UNKNOWN', status: 'read', timestamp: '1763000000' }],
      } }] }],
    });
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(200);
    expect(await NotificationLog.countDocuments({})).toBe(0);
  });

  it('a signed but non-JSON body is 400', async () => {
    const raw = 'not json';
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(400);
  });
});

describe('the providerId index (scripts/create-whatsapp-indexes.js)', () => {
  it('builds once, idempotently, and the webhook lookup uses it', async () => {
    const { buildIndexes, INDEXES } = await import('../scripts/create-whatsapp-indexes.js');
    expect(INDEXES.map(([, o]) => o.name)).toEqual(['notification_provider_id']);
    await NotificationLog.collection.dropIndex('notification_provider_id').catch(() => {});
    const quiet = () => {};
    expect(await buildIndexes({ apply: false, log: quiet })).toEqual([['notification_provider_id', 'would build']]);
    expect(await buildIndexes({ apply: true, log: quiet })).toEqual([['notification_provider_id', 'built']]);
    expect(await buildIndexes({ apply: true, log: quiet })).toEqual([['notification_provider_id', 'already there']]);

    await seedLog('wamid.IDX');
    const plan = await NotificationLog.find({ providerId: 'wamid.IDX', type: 'whatsapp' }).explain('queryPlanner');
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain('notification_provider_id');
  });
});
