/**
 * Customer-facing website errors (routes/clientErrors.js).
 *
 * What matters is not the happy path but the invariants:
 *   - no personal data or secrets are stored (emails, phones, tokens, query strings, names);
 *   - storage is bounded: repeats group into one record, samples are capped, writes per
 *     error are capped, the record ceiling stops new records, and the TTL index is scoped;
 *   - the public endpoint can't be abused: staff, bots, staff pages, oversized and
 *     malformed reports are dropped, and it always answers 204;
 *   - recording never throws;
 *   - reads are scoped by role: admin + developer everything (and resolve), marketing
 *     payment/checkout/careers read only, everyone else 403; lists are cursor-paginated.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import ClientError from '../models/ClientError.js';
import clientErrorRepository from '../repositories/clientErrorRepository.js';
import * as dbHandler from './db-handler.js';
import { CLIENT_ERROR_LIMITS } from '../config/clientErrors.js';
import {
  cleanReport, scrubText, cleanPath, cleanContext, parseUserAgent, isBot, signatureOf, topFrame,
} from '../utils/clientErrorScrub.js';
import {
  claimWrite, recordClientError, resetClientErrorThrottle, clientErrorAccess,
} from '../services/clientErrorService.js';
import { buildIndexes } from '../scripts/create-client-error-indexes.js';

const BASE = '/api/v1';
const PASSWORD = 'SecurePass123!';
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

let csrfPair, csrfToken;
const withCsrf = (r) => r.set('Cookie', csrfPair).set('x-xsrf-token', csrfToken);
const auth = (r, token) => (token ? r.set('Authorization', `Bearer ${token}`) : r);

let n = 0;
async function makeUser(role, staff) {
  n += 1;
  const email = `cerr${n}@autobacs.test`;
  const user = await User.create({
    name: `Person ${n}`, email, role, phone: '9000000000', passwordHash: await bcrypt.hash(PASSWORD, 4),
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password: PASSWORD });
  const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='));
  return { user, token: cookie.split(';')[0].slice('accessToken='.length) };
}

const report = (o = {}) => ({
  feature: 'payment',
  step: 'payment-failed',
  name: 'Error',
  message: 'Payment declined by bank',
  url: 'https://www.autobacsindia.com/checkout?ref=abc',
  stack: 'Error: x\n    at pay (https://www.autobacsindia.com/_next/static/chunks/app/checkout/page-1a2b3c4d5e.js:1:2345)',
  release: 'abc1234',
  ...o,
});

/** POST a report without a CSRF token — the endpoint must not need one. */
const send = (body, { ua = PHONE_UA, token } = {}) =>
  auth(request(app).post(`${BASE}/client-errors`).set('User-Agent', ua), token).send(body);

/** The write happens after the 204, so wait for it. */
async function waitForCount(expected, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  let c;
  while (Date.now() < end) {
    c = await ClientError.countDocuments();
    if (c === expected) return c;
    await new Promise((r) => setTimeout(r, 25));
  }
  return c;
}
const settle = () => new Promise((r) => setTimeout(r, 150));

beforeAll(async () => {
  await dbHandler.connect();
  await ClientError.syncIndexes();
  const seed = await request(app).get(`${BASE}/csrf-token`);
  csrfPair = (seed.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN=')).split(';')[0];
  csrfToken = csrfPair.split('=')[1];
});
beforeEach(() => resetClientErrorThrottle());
afterEach(async () => { await dbHandler.clearDatabase(); });
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

// ── Scrubbing ─────────────────────────────────────────────────────────────────

describe('scrubbing personal data and secrets', () => {
  test('emails, phones, cards, JWTs, long tokens and secret pairs are removed', () => {
    const dirty = 'Failed for ravi.k@gmail.com +91 98765 43210 card 4111 1111 1111 1111 '
      + 'jwt eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjEyMyJ9.abcdefghijk password=hunter2 token: s3cr3t '
      + 'Bearer abcdefghijklmnop key=' + '0123456789abcdef'.repeat(2); // built at runtime so the secret scanner doesn't flag this fake key
    const out = scrubText(dirty, 1000);
    expect(out).not.toMatch(/ravi|gmail|98765|4111|eyJ|hunter2|s3cr3t|abcdefghijklmnop|0123456789abcdef/);
    expect(out).toContain('[email]');
    expect(out).toContain('[number]');
  });

  test('URLs keep the path only — query strings carry payment and reset tokens', () => {
    expect(cleanPath('https://autobacsindia.com/reset-password?token=abc&email=a@b.c#x')).toBe('/reset-password');
    expect(cleanPath('/orders/65a1b2c3d4e5f60718293a4b?pay=1')).toBe('/orders/65a1b2c3d4e5f60718293a4b');
    expect(cleanPath('')).toBe('');
    expect(cleanPath(42)).toBe('');
    expect(scrubText('see https://x.com/a?sig=zzz', 100)).toBe('see https://x.com/a?[query]');
  });

  test('context keeps flat safe values and drops personal / secret keys', () => {
    const ctx = cleanContext({
      httpStatus: 503, code: 'BAD_REQUEST_ERROR', slot: 'videoOne', ok: true,
      email: 'a@b.c', phone: '9999999999', fileName: 'my cv.pdf', apiKey: 'k', customerName: 'Ravi',
      nested: { a: 1 }, 'bad key': 'x', list: [1, 2],
    });
    expect(ctx).toEqual({ httpStatus: '503', code: 'BAD_REQUEST_ERROR', slot: 'videoOne', ok: 'true' });
    expect(cleanContext(null)).toBeUndefined();
    expect(cleanContext(['a'])).toBeUndefined();
  });

  test('context is capped in keys and value length', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'v'.repeat(1000)]));
    const ctx = cleanContext(many);
    expect(Object.keys(ctx)).toHaveLength(CLIENT_ERROR_LIMITS.contextKeys);
    expect(Object.values(ctx).every((v) => v.length <= CLIENT_ERROR_LIMITS.contextValue)).toBe(true);
  });

  test('user agent → coarse browser / OS / device', () => {
    expect(parseUserAgent(PHONE_UA)).toEqual({ browser: 'Chrome 131', os: 'Android 14', device: 'mobile' });
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'))
      .toEqual({ browser: 'Safari 17', os: 'iOS 17', device: 'mobile' });
    expect(parseUserAgent('').device).toBe('unknown');
  });

  test('bots and scripts are recognised; an empty user agent counts as a bot', () => {
    for (const ua of ['Googlebot/2.1 (+http://www.google.com/bot.html)', 'curl/8.0', 'Mozilla/5.0 HeadlessChrome/120', 'python-requests/2.31', '']) {
      expect(isBot(ua)).toBe(true);
    }
    expect(isBot(PHONE_UA)).toBe(false);
  });
});

describe('cleanReport', () => {
  test('a good report is cleaned and signed', () => {
    const r = cleanReport(report({ orderId: '65a1b2c3d4e5f60718293a4b', context: { code: 'X' } }), { userAgent: PHONE_UA });
    expect(r.ok).toBe(true);
    expect(r.report).toMatchObject({
      feature: 'payment', step: 'payment-failed', path: '/checkout', release: 'abc1234',
      orderId: '65a1b2c3d4e5f60718293a4b', context: { code: 'X' }, device: 'mobile',
    });
    expect(r.report.signature).toMatch(/^[0-9a-f]{40}$/);
  });

  test.each([
    ['not an object', 'x'],
    ['an array', [1]],
    ['an unknown feature', report({ feature: 'admin-stuff' })],
    ['no message', report({ message: '' })],
    ['no url', report({ url: '' })],
    ['a staff page', report({ url: 'https://autobacsindia.com/admin/orders' })],
    ['a team page', report({ url: '/team/marketing/coupons' })],
    ['too large', report({ stack: 'x'.repeat(CLIENT_ERROR_LIMITS.maxPayloadBytes) })],
  ])('drops %s', (_label, body) => {
    expect(cleanReport(body, { userAgent: PHONE_UA }).ok).toBe(false);
  });

  test('long fields are capped and an invalid order id is ignored', () => {
    const r = cleanReport(report({ message: 'm'.repeat(5000), stack: 'at x\n'.repeat(1200), orderId: '{$gt:""}' }), { userAgent: PHONE_UA });
    expect(r.ok).toBe(true);
    expect(r.report.message.length).toBeLessThanOrEqual(CLIENT_ERROR_LIMITS.message);
    expect(r.report.stack.length).toBeLessThanOrEqual(CLIENT_ERROR_LIMITS.stack);
    expect(r.report.orderId).toBeNull();
  });

  test('the same error on another order / another deploy has the same signature', () => {
    const a = signatureOf({ feature: 'payment', step: 's', name: 'Error', message: 'Order 65a1b2c3d4e5f60718293a4b failed at 12', stack: 'at f (https://x/_next/static/chunks/page-abc123def.js:1:10)' });
    const b = signatureOf({ feature: 'payment', step: 's', name: 'Error', message: 'Order 75a1b2c3d4e5f60718293a4c failed at 99', stack: 'at f (https://x/_next/static/chunks/page-999fff000.js:7:88)' });
    expect(a).toBe(b);
    expect(topFrame('at f (https://x/_next/static/chunks/page-abc123def.js:1:10)')).toBe('at f (/_next/static/chunks/page.js)');
    // Different step = different error.
    expect(signatureOf({ feature: 'payment', step: 't', name: 'Error', message: 'Order 1 failed', stack: '' }))
      .not.toBe(signatureOf({ feature: 'payment', step: 's', name: 'Error', message: 'Order 1 failed', stack: '' }));
  });
});

// ── Bounded storage ───────────────────────────────────────────────────────────

describe('storage stays bounded', () => {
  const clean = (o) => cleanReport(report(o), { userAgent: PHONE_UA }).report;

  test('repeats group into one record with a count and the last 3 samples', async () => {
    const t0 = new Date('2026-11-26T10:00:00Z');
    for (let i = 0; i < 5; i += 1) {
      // One a minute, so the per-minute write cap does not batch them.
      expect(await recordClientError(clean({ message: `Payment declined ${i}` }), { now: new Date(t0.getTime() + i * 61000) })).toBe('stored');
    }
    const docs = await ClientError.find().lean();
    expect(docs).toHaveLength(1);
    expect(docs[0].count).toBe(5);
    expect(docs[0].samples).toHaveLength(CLIENT_ERROR_LIMITS.samples);
    expect(docs[0].samples.at(-1).message).toBe('Payment declined 4');
    expect(docs[0].firstSeenAt).toEqual(t0);
    expect(docs[0].expireAt.getTime() - docs[0].lastSeenAt.getTime()).toBe(CLIENT_ERROR_LIMITS.retentionDays * 86400000);
  });

  test('writes per error per minute are capped; extra hits are counted into the next write', async () => {
    const r = clean();
    const t0 = new Date('2026-11-26T10:00:00Z');
    const outcomes = [];
    for (let i = 0; i < 20; i += 1) outcomes.push(await recordClientError(r, { now: t0 }));
    expect(outcomes.filter((o) => o === 'stored')).toHaveLength(CLIENT_ERROR_LIMITS.writesPerSignaturePerMinute);
    expect(outcomes.filter((o) => o === 'batched')).toHaveLength(20 - CLIENT_ERROR_LIMITS.writesPerSignaturePerMinute);
    expect((await ClientError.findOne().lean()).count).toBe(CLIENT_ERROR_LIMITS.writesPerSignaturePerMinute);

    // Next minute: the first write carries the 14 batched hits.
    await recordClientError(r, { now: new Date(t0.getTime() + 61000) });
    expect((await ClientError.findOne().lean()).count).toBe(21);
  });

  test('the global per-minute write budget is enforced across errors', () => {
    const now = Date.now();
    let granted = 0;
    for (let i = 0; i < CLIENT_ERROR_LIMITS.writesPerMinute + 50; i += 1) if (claimWrite(`sig-${i}`, now)) granted += 1;
    expect(granted).toBe(CLIENT_ERROR_LIMITS.writesPerMinute);
  });

  test('past the record ceiling, new errors are not created but known ones still count', async () => {
    const known = clean({ message: 'known' });
    await recordClientError(known);
    const spy = jest.spyOn(clientErrorRepository, 'estimatedDocumentCount').mockResolvedValue(CLIENT_ERROR_LIMITS.maxRecords);
    resetClientErrorThrottle();
    try {
      expect(await recordClientError(clean({ message: 'brand new', step: 'other' }))).toBe('dropped');
      expect(await recordClientError(known)).toBe('stored');
    } finally {
      spy.mockRestore();
    }
    const docs = await ClientError.find().lean();
    expect(docs).toHaveLength(1);
    expect(docs[0].count).toBe(2);
  });

  test('two first reports of a new error at once create ONE record', async () => {
    const r = clean();
    await Promise.all([recordClientError(r), recordClientError(r), recordClientError(r)]);
    const docs = await ClientError.find().lean();
    expect(docs).toHaveLength(1);
    expect(docs[0].count).toBe(3);
  });

  test('recording never throws, even when the database fails', async () => {
    const spy = jest.spyOn(clientErrorRepository, 'updateOne').mockRejectedValue(new Error('db down'));
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(recordClientError(clean())).resolves.toBe('failed');
      await expect(recordClientError(undefined)).resolves.toBe('failed');
    } finally {
      spy.mockRestore();
      err.mockRestore();
    }
  });

  test('a resolved error that happens again reopens itself', async () => {
    const r = clean();
    await recordClientError(r, { now: new Date('2026-11-26T10:00:00Z') });
    await ClientError.updateOne({}, { status: 'resolved', resolvedAt: new Date('2026-11-26T11:00:00Z') });
    await recordClientError(r, { now: new Date('2026-11-26T12:00:00Z') });
    const doc = await ClientError.findOne().lean();
    expect(doc.status).toBe('open');
    expect(doc.reopenedAt).toEqual(new Date('2026-11-26T12:00:00Z'));
  });

  test('the TTL index is a scalar date with a $type partial filter (never $ne)', () => {
    const ttl = ClientError.schema.indexes().find(([, o]) => o.expireAfterSeconds != null);
    expect(ttl[0]).toEqual({ expireAt: 1 });
    expect(ttl[1].partialFilterExpression).toEqual({ expireAt: { $type: 'date' } });
  });

  test('the index script builds every declared index, and is a no-op the second time', async () => {
    await ClientError.collection.dropIndexes().catch(() => {});
    const log = () => {};
    expect((await buildIndexes({ apply: false, log })).every(([, s]) => s === 'would build')).toBe(true);
    expect((await buildIndexes({ apply: true, log })).every(([, s]) => s === 'built')).toBe(true);
    expect((await buildIndexes({ apply: true, log })).every(([, s]) => s === 'already there')).toBe(true);
    const names = (await ClientError.collection.indexes()).map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(['signature_1', 'expireAt_ttl', 'lastSeenAt_-1__id_-1']));
  });
});

// ── Public endpoint ───────────────────────────────────────────────────────────

describe('POST /client-errors', () => {
  test('a customer report is stored without a CSRF token, answers 204, and stores no PII', async () => {
    const { user, token } = await makeUser('customer');
    const res = await send(report({
      message: 'Upload failed for ravi@gmail.com 9876543210',
      url: 'https://autobacsindia.com/careers?utm=x&email=ravi@gmail.com',
      feature: 'careers', step: 'file-upload',
      context: { httpStatus: 403, slot: 'videoOne', fileName: 'Ravi Kumar CV.pdf' },
    }), { token });
    expect(res.status).toBe(204);
    expect(await waitForCount(1)).toBe(1);
    const doc = await ClientError.findOne().lean();
    const stored = JSON.stringify(doc);
    expect(stored).not.toMatch(/ravi|gmail|9876543210|utm|Kumar/i);
    expect(doc.path).toBe('/careers');
    expect(doc.samples[0].user).toEqual(user._id);
    expect(doc.samples[0].context).toEqual({ httpStatus: '403', slot: 'videoOne' });
  });

  test('anonymous visitors are recorded too', async () => {
    expect((await send(report())).status).toBe(204);
    expect(await waitForCount(1)).toBe(1);
    expect((await ClientError.findOne().lean()).samples[0].user).toBeNull();
  });

  test.each([
    ['staff', () => makeUser('staff', { team: 'sales' })],
    ['admins', () => makeUser('admin')],
  ])('%s are not customers: dropped', async (_l, mk) => {
    const { token } = await mk();
    expect((await send(report(), { token })).status).toBe(204);
    await settle();
    expect(await ClientError.countDocuments()).toBe(0);
  });

  test('bots, staff pages and junk are dropped with the same 204', async () => {
    const responses = await Promise.all([
      send(report(), { ua: 'Googlebot/2.1' }),
      send(report({ url: '/admin/orders' })),
      send(report({ feature: 'nope' })),
      send({ huge: 'x'.repeat(20000) }),
      send('not json'),
    ]);
    expect(responses.map((r) => r.status)).toEqual([204, 204, 204, 204, 204]);
    await settle();
    expect(await ClientError.countDocuments()).toBe(0);
  });

  test('sub-paths are NOT exempt from CSRF', async () => {
    const { token } = await makeUser('admin');
    const doc = await ClientError.create({
      signature: 's', feature: 'payment', message: 'm', firstSeenAt: new Date(), lastSeenAt: new Date(), expireAt: new Date(Date.now() + 86400000),
    });
    // Cookie auth without a CSRF token is refused.
    const res = await request(app).patch(`${BASE}/client-errors/${doc._id}/status`)
      .set('Cookie', `accessToken=${token}`).send({ status: 'resolved' });
    expect(res.status).toBe(403);
  });
});

// ── Panel reads ───────────────────────────────────────────────────────────────

describe('panel access and list', () => {
  const seed = (feature, i, extra = {}) => ClientError.create({
    signature: `${feature}-${i}`, feature, step: 's', message: `${feature} problem ${i}`,
    count: 1, firstSeenAt: new Date(Date.UTC(2026, 10, 1, 0, i)), lastSeenAt: new Date(Date.UTC(2026, 10, 1, 0, i)),
    expireAt: new Date(Date.UTC(2026, 11, 1)), ...extra,
  });

  test('role access map', () => {
    expect(clientErrorAccess({ role: 'admin' }).canResolve).toBe(true);
    expect(clientErrorAccess({ role: 'staff', staff: { active: true, team: 'developer' } }).canResolve).toBe(true);
    expect(clientErrorAccess({ role: 'staff', staff: { active: true, team: 'marketing' } }))
      .toEqual({ features: ['payment', 'checkout', 'careers'], canResolve: false });
    expect(clientErrorAccess({ role: 'staff', staff: { active: false, team: 'developer' } })).toBeNull();
    expect(clientErrorAccess({ role: 'staff', staff: { active: true, team: 'sales' } })).toBeNull();
    expect(clientErrorAccess({ role: 'customer' })).toBeNull();
    expect(clientErrorAccess(null)).toBeNull();
  });

  test('customers, other teams and the logged-out are refused', async () => {
    const { token: customer } = await makeUser('customer');
    const { token: sales } = await makeUser('staff', { team: 'sales' });
    expect((await request(app).get(`${BASE}/client-errors`)).status).toBe(401);
    expect((await auth(request(app).get(`${BASE}/client-errors`), customer)).status).toBe(403);
    expect((await auth(request(app).get(`${BASE}/client-errors`), sales)).status).toBe(403);
  });

  test('developer team: every feature, newest first, cursor pages without gaps or repeats', async () => {
    for (let i = 0; i < 30; i += 1) await seed(i % 2 ? 'script' : 'payment', i);
    const { token } = await makeUser('staff', { team: 'developer' });
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const res = await auth(request(app).get(`${BASE}/client-errors${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`), token);
      expect(res.status).toBe(200);
      expect(res.body.canResolve).toBe(true);
      expect(res.body.errors.length).toBeLessThanOrEqual(25);
      expect(res.body.errors[0].samples).toBeUndefined();
      expect(res.body.errors[0].signature).toBeUndefined();
      seen.push(...res.body.errors.map((e) => e.message));
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor && pages < 5);
    expect(pages).toBe(2);
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
    expect(seen[0]).toBe('script problem 29');
  });

  test('filters: feature, status, search, date range', async () => {
    await seed('payment', 1);
    await seed('careers', 2, { status: 'resolved' });
    await seed('script', 3);
    const { token } = await makeUser('admin');
    const q = async (qs) => (await auth(request(app).get(`${BASE}/client-errors?${qs}`), token)).body.errors.map((e) => e.feature);
    expect(await q('feature=careers')).toEqual(['careers']);
    expect(await q('status=open')).toEqual(['script', 'payment']);
    expect(await q('q=script')).toEqual(['script']);
    expect(await q('from=2026-11-02')).toEqual([]);
    expect(await q('from=2026-11-01&to=2026-11-01')).toHaveLength(3);
  });

  test('marketing: payment/checkout/careers only, cannot ask for others, cannot resolve', async () => {
    await seed('payment', 1);
    await seed('careers', 2);
    const script = await seed('script', 3);
    const pay = await ClientError.findOne({ feature: 'payment' });
    const { token } = await makeUser('staff', { team: 'marketing' });
    const list = await auth(request(app).get(`${BASE}/client-errors`), token);
    expect(list.body.errors.map((e) => e.feature).sort()).toEqual(['careers', 'payment']);
    expect(list.body.canResolve).toBe(false);
    // Asking for a feature outside the scope falls back to the scope, never widens it.
    const asked = await auth(request(app).get(`${BASE}/client-errors?feature=script`), token);
    expect(asked.body.errors.map((e) => e.feature).sort()).toEqual(['careers', 'payment']);
    expect((await auth(request(app).get(`${BASE}/client-errors/${script._id}`), token)).status).toBe(404);
    expect((await auth(request(app).get(`${BASE}/client-errors/${pay._id}`), token)).status).toBe(200);
    const patch = await withCsrf(auth(request(app).patch(`${BASE}/client-errors/${pay._id}/status`), token)).send({ status: 'resolved' });
    expect(patch.status).toBe(403);
  });

  test('detail shows samples with the customer; resolve and reopen are recorded', async () => {
    const { user: customer } = await makeUser('customer');
    const doc = await seed('payment', 1, {
      samples: [{ at: new Date(), url: '/checkout', message: 'm', browser: 'Chrome 131', os: 'Android 14', device: 'mobile', user: customer._id }],
    });
    const { user: dev, token } = await makeUser('staff', { team: 'developer' });
    const detail = await auth(request(app).get(`${BASE}/client-errors/${doc._id}`), token);
    expect(detail.status).toBe(200);
    expect(detail.body.error.samples[0].user).toMatchObject({ name: customer.name, email: customer.email });

    const resolve = await withCsrf(auth(request(app).patch(`${BASE}/client-errors/${doc._id}/status`), token))
      .send({ status: 'resolved', note: 'Fixed in #700' });
    expect(resolve.status).toBe(200);
    expect(resolve.body.error).toMatchObject({ status: 'resolved', resolvedNote: 'Fixed in #700', resolvedBy: String(dev._id) });

    const reopen = await withCsrf(auth(request(app).patch(`${BASE}/client-errors/${doc._id}/status`), token)).send({ status: 'open' });
    expect(reopen.body.error).toMatchObject({ status: 'open', resolvedAt: null, resolvedNote: '' });

    const bad = await withCsrf(auth(request(app).patch(`${BASE}/client-errors/${doc._id}/status`), token)).send({ status: 'deleted' });
    expect(bad.status).toBe(400);
    const missing = await withCsrf(auth(request(app).patch(`${BASE}/client-errors/${new mongoose.Types.ObjectId()}/status`), token)).send({ status: 'open' });
    expect(missing.status).toBe(404);
    expect((await auth(request(app).get(`${BASE}/client-errors/not-an-id`), token)).status).toBe(404);
  });
});
