/**
 * Google review bonus over HTTP (routes/googleReviews.js → services/googleReviewService.js):
 * who may submit / verify, duplicates, idempotent verify & unverify, and the
 * Roav Points ledger rows they write (append-only, locked-month landing).
 * Auth, CSRF and the real routers run; storage and the queue are doubles.
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

jest.setTimeout(120000);
process.env.INCENTIVES_START_MONTH = '2020-01';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, enqueueMetaLeadSheetWrite: () => Promise.resolve(), closeQueues: () => Promise.resolve(),
}));

// Private storage double: keeps the bytes in memory.
const stored = new Map();
const deleted = [];
const resourceTypeFor = (t) => (String(t).startsWith('image/') ? 'image' : 'raw');
jest.unstable_mockModule('../services/storage/privateUploads.js', () => {
  const api = {
    resourceTypeFor,
    putPrivateAsset: async ({ buffer, folder, basename, contentType }) => {
      const publicId = `${folder}/${basename}`;
      stored.set(publicId, buffer);
      return { publicId, provider: 'r2', bytes: buffer.length, resourceType: resourceTypeFor(contentType), url: '' };
    },
    deletePrivateAsset: async ({ publicId }) => { deleted.push(publicId); stored.delete(publicId); return true; },
    readPrivateAsset: async (ref) => stored.get(ref.publicId),
  };
  return { ...api, default: api };
});

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: AuditLog } = await import('../models/AuditLog.js');
const { default: IncentiveLedgerEntry } = await import('../models/IncentiveLedgerEntry.js');
const { default: IncentiveMonth } = await import('../models/IncentiveMonth.js');
const { default: IncentiveRuleSet } = await import('../models/IncentiveRuleSet.js');
const { default: GoogleReviewSubmission } = await import('../models/GoogleReviewSubmission.js');
const { monthOf, addMonths } = await import('../services/incentives/months.js');
const { validateRules } = await import('../services/incentives/ruleService.js');
const { INCENTIVE_DEFAULT_RULES } = await import('../config/incentiveDefaults.js');

const BASE = '/api/v1/google-reviews';
const PW = 'SecurePass123!';
const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return {
    raw: (path) => agent.get(path),
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    upload: (fields, file) => {
      let r = agent.post(BASE).set('X-XSRF-TOKEN', csrf);
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) r = r.field(k, String(v));
      if (file) r = r.attach('screenshot', file.buffer, { filename: file.name || 'review.png', contentType: file.type || 'image/png' });
      return r;
    },
  };
}
let n = 0;
async function makeUser(name, role, staff) {
  n += 1;
  const email = `${name.toLowerCase().replace(/\s/g, '')}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, s: await signIn(email) };
}

// A real PNG header + unique tail, so each "screenshot" has its own hash.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
let shot = 0;
const png = () => { shot += 1; return { buffer: Buffer.concat([PNG, Buffer.from(`shot-${shot}-${Date.now()}`)]) }; };
let sid = 0;
const submitId = () => { sid += 1; return `sub_${Date.now()}_${sid}`; };

const month = monthOf(new Date());
const prevMonth = addMonths(month, -1);
const reviewRows = (id) => IncentiveLedgerEntry.find({ review: id }).sort({ _id: 1 }).lean();
const sumPoints = (rows) => rows.reduce((a, r) => a + r.centi, 0) / 100;

describe('Google review bonus', () => {
  let admin; let mktHead; let mktMember; let gtmHead; let nevin; let asha; let accounts;
  beforeAll(async () => {
    await dbHandler.connect();
    await Promise.all([GoogleReviewSubmission.init(), IncentiveLedgerEntry.init(), IncentiveMonth.init(), IncentiveRuleSet.init()]);
  });
  beforeEach(async () => {
    await Promise.all([
      GoogleReviewSubmission.deleteMany({}),
      IncentiveLedgerEntry.collection.deleteMany({}),
      IncentiveMonth.deleteMany({}),
      Order.collection.deleteMany({}),
    ]);
    admin = await makeUser('Owner', 'admin');
    mktHead = await makeUser('Mkt Head', 'staff', { team: 'marketing', isHead: true, active: true });
    mktMember = await makeUser('Mkt Member', 'staff', { team: 'marketing', active: true });
    gtmHead = await makeUser('Gtm Head', 'staff', { team: 'sales', isHead: true, active: true });
    nevin = await makeUser('Nevin P Vinu', 'staff', { team: 'sales', subRole: 'lead', active: true });
    asha = await makeUser('Asha', 'staff', { team: 'sales', subRole: 'lead', active: true });
    accounts = await makeUser('Accounts', 'staff', { team: 'accounts', active: true });
  });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  const send = (who, fields = {}, file = png()) => who.s.upload({ customerName: 'Rahul Menon', submitId: submitId(), ...fields }, file);
  const verifyAs = (who, r, body) => who.s.post(`/${r.id}/verify`, { expectedVersion: r.version, ...body });
  const rejectAs = (who, r, body) => who.s.post(`/${r.id}/reject`, { expectedVersion: r.version, ...body });

  // ── Submitting ──────────────────────────────────────────────────────────────

  test('a salesperson sends a review; it is pending with a "submitted" history and an audit row', async () => {
    const res = await send(nevin, { customerPhone: '+91 98470 12345', claimedStars: 5, notes: 'Shared link after delivery' });
    expect(res.status).toBe(201);
    expect(res.body.review).toMatchObject({
      status: 'pending', customerName: 'Rahul Menon', customerPhone: '9847012345', claimedStars: 5, points: 0,
      submittedBy: { name: 'Nevin P Vinu' }, version: 0,
    });
    expect(res.body.review.history).toEqual([expect.objectContaining({ action: 'submitted', byName: 'Nevin P Vinu', stars: 5 })]);
    const audit = await AuditLog.findOne({ resource: 'GoogleReviewSubmission', resourceId: res.body.review.id }).lean();
    expect(audit).toBeTruthy();
    // The screenshot is served to the submitter, never as a public link.
    const img = await nevin.s.get(`/${res.body.review.id}/screenshot`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toMatch(/image\/png/);
    expect(img.headers['cache-control']).toMatch(/no-store/);
  });

  test('a retried submit (same submitId) returns the first submission, not a second', async () => {
    const file = png();
    const id = submitId();
    const a = await nevin.s.upload({ customerName: 'Rahul', submitId: id }, file);
    const b = await nevin.s.upload({ customerName: 'Rahul', submitId: id }, file);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.review.id).toBe(a.body.review.id);
    expect(await GoogleReviewSubmission.countDocuments({})).toBe(1);
  });

  test('duplicates are refused: same screenshot, same phone, same order, same name with nothing else', async () => {
    const file = png();
    expect((await send(nevin, { customerPhone: '9847012345' }, file)).status).toBe(201);
    const sameShot = await send(asha, { customerName: 'Someone Else' }, file);
    expect(sameShot.status).toBe(409);
    expect(sameShot.body.message).toMatch(/screenshot was already sent.*Nevin/);
    const samePhone = await send(asha, { customerName: 'X', customerPhone: '098470 12345' });
    expect(samePhone.status).toBe(409);
    expect(samePhone.body.message).toMatch(/phone number/);

    await Order.collection.insertOne({ wpId: 5001, salesUser: nevin.user._id, createdAt: new Date() });
    expect((await send(nevin, { customerName: 'Priya', orderRef: '#5001' })).status).toBe(201);
    const sameOrder = await send(nevin, { customerName: 'Priya K', orderRef: '5001' });
    expect(sameOrder.status).toBe(409);
    expect(sameOrder.body.message).toMatch(/this order/);

    expect((await send(nevin, { customerName: 'Joseph' })).status).toBe(201);
    expect((await send(asha, { customerName: '  joseph ' })).status).toBe(409);
    // Only the first of each stored a file; the refused ones stored nothing (pre-check) or were cleaned up.
    expect(await GoogleReviewSubmission.countDocuments({})).toBe(3);
  });

  test('two identical submits at the same moment make one submission', async () => {
    const file = png();
    const [a, b] = await Promise.all([
      send(nevin, { customerPhone: '9000000001' }, file),
      send(asha, { customerPhone: '9000000002' }, file),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await GoogleReviewSubmission.countDocuments({})).toBe(1);
  });

  test('a rejected submission frees its customer, so a corrected one can be sent', async () => {
    const first = (await send(nevin, { customerPhone: '9847012345' })).body.review;
    expect((await rejectAs(mktHead, first, { reason: 'Screenshot is blurry' })).status).toBe(200);
    expect((await send(nevin, { customerPhone: '9847012345' })).status).toBe(201);
  });

  test('order checks: unknown order, someone else\'s order, our own "#1A2B3C4D" numbers', async () => {
    expect((await send(nevin, { orderRef: '#999999' })).status).toBe(400);
    await Order.collection.insertOne({ wpId: 7001, salesUser: asha.user._id, createdAt: new Date() });
    const other = await send(nevin, { orderRef: '#7001' });
    expect(other.status).toBe(400);
    expect(other.body.message).toMatch(/another salesperson/);
    const { insertedId } = await Order.collection.insertOne({ salesUser: nevin.user._id, createdAt: new Date() });
    const own = await send(nevin, { orderRef: `#${String(insertedId).slice(-8).toUpperCase()}` });
    expect(own.status).toBe(201);
    expect(own.body.review.orderId).toBe(String(insertedId));
  });

  test('input and upload limits', async () => {
    expect((await nevin.s.upload({ customerName: 'Rahul', submitId: submitId() })).status).toBe(400); // no file
    expect((await send(nevin, { customerName: '', customerPhone: '' })).status).toBe(400);            // no customer
    expect((await send(nevin, { customerPhone: '12345' })).status).toBe(400);                         // bad phone
    expect((await send(nevin, { claimedStars: 6 })).status).toBe(400);
    const fake = await send(nevin, {}, { buffer: Buffer.from('MZ not really a png'), type: 'image/png' });
    expect(fake.status).toBe(400);
    const pdf = await send(nevin, {}, { buffer: Buffer.from('%PDF-1.4 x'), type: 'application/pdf', name: 'r.pdf' });
    expect(pdf.status).toBe(400);
    expect(pdf.body.message).toMatch(/JPG, PNG or WebP/);
    const big = await send(nevin, {}, { buffer: Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 1)]) });
    expect(big.status).toBe(400);
    expect(big.body.message).toMatch(/5 MB/);
    expect(await GoogleReviewSubmission.countDocuments({})).toBe(0);
  });

  // ── Who may do what ─────────────────────────────────────────────────────────

  test('only GTM members submit; only the marketing head and admins review', async () => {
    expect((await send(mktHead)).status).toBe(403);
    expect((await send(accounts)).status).toBe(403);
    expect((await send(admin)).status).toBe(403);
    const r = (await send(nevin)).body.review;
    for (const who of [mktMember, gtmHead, asha, accounts]) {
      expect((await verifyAs(who, r, { stars: 5, points: 50 })).status).toBe(403);
      expect((await rejectAs(who, r, { reason: 'nope nope' })).status).toBe(403);
      expect((await who.s.get('?status=pending')).status).toBe(403);
    }
    expect((await mktHead.s.get('?status=pending')).status).toBe(200);
    expect((await admin.s.get('?status=pending')).body.pendingCount).toBe(1);
    // Another salesperson cannot open it or its screenshot; the reviewers can.
    expect((await asha.s.get(`/${r.id}`)).status).toBe(404);
    expect((await asha.s.get(`/${r.id}/screenshot`)).status).toBe(404);
    expect((await mktHead.s.get(`/${r.id}/screenshot`)).status).toBe(200);
    const policy = await nevin.s.get('/policy');
    expect(policy.body).toMatchObject({ canSubmit: true, canReview: false, maxPoints: 100, suggestedByStars: [0, 0, 0, 30, 50] });
    expect((await mktHead.s.get('/policy')).body).toMatchObject({ canSubmit: false, canReview: true });
  });

  test('nobody verifies their own submission (even an admin)', async () => {
    const r = (await send(nevin)).body.review;
    // A submission credited to the admin themself (e.g. an admin who also sells).
    await GoogleReviewSubmission.updateOne({ _id: r.id }, { $set: { submittedBy: admin.user._id } });
    const res = await verifyAs(admin, r, { stars: 5, points: 50 });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/own review/);
    expect(await IncentiveLedgerEntry.countDocuments({})).toBe(0);
  });

  // ── Verify, change, unverify — and the ledger ──────────────────────────────

  test('verify credits one "review" ledger row to the salesperson, with no order', async () => {
    const r = (await send(nevin, { customerPhone: '9847012345' })).body.review;
    const res = await verifyAs(mktHead, r, { stars: 5, points: 50 });
    expect(res.status).toBe(200);
    expect(res.body.review).toMatchObject({ status: 'verified', stars: 5, points: 50, reviewedByName: 'Mkt Head', version: 1, creditMonth: month });
    const rows = await reviewRows(r.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: `review:${r.id}:v1`, type: 'earn', component: 'review', order: null, month,
      earnerKey: `u:${nevin.user._id}`, centi: 5000, flatCenti: 5000,
    });
    // It reaches Roav Points as points, never as an order.
    const me = await nevin.s.raw(`/api/v1/incentives/me?month=${month}`);
    expect(me.body.points).toBe(50);
    expect(me.body.statement.orders).toBe(0);
    const orders = await nevin.s.raw(`/api/v1/incentives/me/orders?month=${month}`);
    expect(orders.body.orders).toEqual([]);
    const mine = await nevin.s.raw(`/api/v1/incentives/me/reviews?month=${month}`);
    expect(mine.body).toMatchObject({ points: 50, rows: [expect.objectContaining({ type: 'earn', points: 50, stars: 5, customerName: 'Rahul Menon' })] });
    expect(await AuditLog.countDocuments({ resource: 'GoogleReviewSubmission', resourceId: r.id })).toBe(2);
  });

  test('a double-click on Verify gives one credit', async () => {
    const r = (await send(nevin)).body.review;
    const [a, b] = await Promise.all([
      verifyAs(mktHead, r, { stars: 5, points: 50 }),
      verifyAs(mktHead, r, { stars: 5, points: 50 }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.changed, b.body.changed].sort()).toEqual([false, true]);
    expect(await reviewRows(r.id)).toHaveLength(1);
  });

  test('two reviewers with different points at once: one wins, the other is told to refresh', async () => {
    const r = (await send(nevin)).body.review;
    const [a, b] = await Promise.all([
      verifyAs(mktHead, r, { stars: 5, points: 50 }),
      verifyAs(admin, r, { stars: 4, points: 30 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const rows = await reviewRows(r.id);
    expect(rows).toHaveLength(1);
    const doc = await GoogleReviewSubmission.findById(r.id).lean();
    expect(rows[0].centi).toBe(doc.points * 100);
  });

  test('changing points writes the difference; unverify reverses the rest; nothing is edited', async () => {
    let r = (await send(nevin)).body.review;
    r = (await verifyAs(mktHead, r, { stars: 5, points: 50 })).body.review;
    const before = (await reviewRows(r.id))[0];

    const stale = await verifyAs(admin, { ...r, version: 0 }, { stars: 4, points: 30 });
    expect(stale.status).toBe(409);

    r = (await verifyAs(admin, r, { stars: 4, points: 30 })).body.review;
    expect(r).toMatchObject({ status: 'verified', points: 30, stars: 4, version: 2 });
    let rows = await reviewRows(r.id);
    expect(rows.map((x) => [x.key, x.type, x.centi])).toEqual([
      [`review:${r.id}:v1`, 'earn', 5000],
      [`review:${r.id}:v2`, 'reverse', -2000],
    ]);
    expect(rows[0]).toEqual(before); // the first row is untouched

    const un = await rejectAs(mktHead, r, { reason: 'Review was removed from Google' });
    expect(un.status).toBe(200);
    r = un.body.review;
    expect(r).toMatchObject({ status: 'rejected', points: 0, reason: 'Review was removed from Google', version: 3 });
    rows = await reviewRows(r.id);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ type: 'reverse', centi: -3000, reason: 'review_unverified' });
    expect(sumPoints(rows)).toBe(0);
    expect(r.history.map((h) => [h.action, h.deltaPoints])).toEqual([
      ['submitted', null], ['verified', 50], ['points_changed', -20], ['unverified', -30],
    ]);

    // Unverify again (a second click) is a no-op; verifying again re-credits once.
    expect((await rejectAs(mktHead, r, { reason: 'Review was removed' })).body.changed).toBe(false);
    r = (await verifyAs(admin, r, { stars: 5, points: 40 })).body.review;
    expect(sumPoints(await reviewRows(r.id))).toBe(40);
    expect((await nevin.s.raw(`/api/v1/incentives/me?month=${month}`)).body.points).toBe(40);
  });

  test('rejecting a pending review writes no ledger row; a reason is required', async () => {
    const r = (await send(nevin)).body.review;
    expect((await rejectAs(mktHead, r, { reason: '' })).status).toBe(400);
    const res = await rejectAs(mktHead, r, { reason: 'Not our business page' });
    expect(res.status).toBe(200);
    expect(res.body.review.history.at(-1)).toMatchObject({ action: 'rejected', reason: 'Not our business page', byName: 'Mkt Head' });
    expect(await IncentiveLedgerEntry.countDocuments({})).toBe(0);
  });

  test('points must be 1 to the rules maximum, stars 1 to 5', async () => {
    const r = (await send(nevin)).body.review;
    expect((await verifyAs(mktHead, r, { stars: 5, points: 101 })).status).toBe(400);
    expect((await verifyAs(mktHead, r, { stars: 5, points: 0 })).status).toBe(400);
    expect((await verifyAs(mktHead, r, { stars: 5, points: 12.5 })).status).toBe(400);
    expect((await verifyAs(mktHead, r, { stars: 0, points: 50 })).status).toBe(400);
    expect((await verifyAs(mktHead, r, { stars: 5, points: 100 })).status).toBe(200);
  });

  // ── Month landing ──────────────────────────────────────────────────────────

  test('a review sent last month credits last month while it is open', async () => {
    const r = (await send(nevin)).body.review;
    await GoogleReviewSubmission.collection.updateOne({ _id: new mongoose.Types.ObjectId(r.id) }, { $set: { createdAt: new Date(`${prevMonth}-15T06:00:00Z`) } });
    await verifyAs(mktHead, r, { stars: 5, points: 50 });
    expect((await reviewRows(r.id))[0].month).toBe(prevMonth);
  });

  test('a locked month is never written to: the credit lands in the current month', async () => {
    const r = (await send(nevin)).body.review;
    await GoogleReviewSubmission.collection.updateOne({ _id: new mongoose.Types.ObjectId(r.id) }, { $set: { createdAt: new Date(`${prevMonth}-15T06:00:00Z`) } });
    await IncentiveMonth.collection.insertOne({ month: prevMonth, status: 'locked', statements: [], history: [] });
    const res = await verifyAs(mktHead, r, { stars: 5, points: 50 });
    expect(res.body.review.history.at(-1).month).toBe(month);
    expect((await reviewRows(r.id))[0].month).toBe(month);
  });

  test('unverifying after the credit month locked reverses in the current month', async () => {
    let r = (await send(nevin)).body.review;
    await GoogleReviewSubmission.collection.updateOne({ _id: new mongoose.Types.ObjectId(r.id) }, { $set: { createdAt: new Date(`${prevMonth}-15T06:00:00Z`) } });
    r = (await verifyAs(mktHead, r, { stars: 5, points: 50 })).body.review;
    await IncentiveMonth.collection.insertOne({ month: prevMonth, status: 'locked', statements: [], history: [] });
    await rejectAs(admin, r, { reason: 'Customer deleted the review' });
    const rows = await reviewRows(r.id);
    expect(rows.map((x) => [x.month, x.centi])).toEqual([[prevMonth, 5000], [month, -5000]]);
  });

  // ── Lists ──────────────────────────────────────────────────────────────────

  test('lists are cursor-paginated, newest first, and filtered by status', async () => {
    const made = [];
    for (let i = 0; i < 3; i += 1) made.push((await send(nevin, { customerName: `Customer ${i}` })).body.review);
    await verifyAs(mktHead, made[0], { stars: 5, points: 50 });
    const p1 = await nevin.s.get('/mine?limit=2');
    expect(p1.body.reviews.map((r) => r.customerName)).toEqual(['Customer 2', 'Customer 1']);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await nevin.s.get(`/mine?limit=2&cursor=${p1.body.nextCursor}`);
    expect(p2.body.reviews.map((r) => r.customerName)).toEqual(['Customer 0']);
    expect(p2.body.nextCursor).toBeNull();
    expect(p1.body.reviews[0].screenshot).toBeUndefined(); // storage refs never leave the server

    const pending = await mktHead.s.get('?status=pending');
    expect(pending.body.reviews).toHaveLength(2);
    expect(pending.body.pendingCount).toBe(2);
    expect((await mktHead.s.get('?status=verified')).body.reviews).toHaveLength(1);
    expect((await mktHead.s.get(`?status=all&person=${asha.user._id}`)).body.reviews).toHaveLength(0);
    expect((await mktHead.s.get('?status=bogus')).status).toBe(400);
    expect((await asha.s.get('/mine')).body.reviews).toHaveLength(0);
  });
});

describe('Google review rules', () => {
  test('a rule set without a googleReview block keeps the defaults', () => {
    const { googleReview: _g, ...old } = structuredClone(INCENTIVE_DEFAULT_RULES);
    expect(validateRules(old).googleReview).toEqual({ maxPoints: 100, suggestedByStars: [0, 0, 0, 30, 50] });
  });
  test('suggested points above the maximum, or the wrong count, are refused', () => {
    const r = structuredClone(INCENTIVE_DEFAULT_RULES);
    r.googleReview = { maxPoints: 40, suggestedByStars: [0, 0, 0, 30, 50] };
    expect(() => validateRules(r)).toThrow(/5 stars/);
    r.googleReview = { maxPoints: 40, suggestedByStars: [0, 0, 30] };
    expect(() => validateRules(r)).toThrow(/each of 1 to 5/);
    r.googleReview = { maxPoints: 200, suggestedByStars: [0, 0, 0, 80, 150] };
    expect(validateRules(r).googleReview).toEqual({ maxPoints: 200, suggestedByStars: [0, 0, 0, 80, 150] });
  });
});
