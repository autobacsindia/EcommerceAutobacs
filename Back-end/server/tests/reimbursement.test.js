/**
 * Reimbursements (services/reimbursement.js, wired through services/paymentRequestService.js),
 * over HTTP.
 *
 * What must hold:
 *   - Fuel: amount = km × the per-km rate, worked out by the SERVER. A tampered
 *     amount from the browser is ignored, on create and on edit.
 *   - The rate is snapshotted on the claim: the admin changing it moves new claims
 *     only, and editing an old claim's km recomputes at the old claim's rate.
 *   - Only the admin changes the rate; a bad rate is a 400.
 *   - Validation: km ≤ 0, km > 1,000, no km, a future date → 400. Others needs
 *     details. Food / Transportation / Others above ₹200 need a bill. Rupees only.
 *   - Every active staff team (and the admin, for a team) may claim; nobody else.
 *   - The approval flow is unchanged: accounts approves, the admin pays.
 *   - A claim can be linked to a task; the task's box lists it with its status
 *     for the admin / accounts / the task's people only; the list filters by
 *     sub-type; the monthly report sums per person and per task.
 *   - Operations no longer offers the old typed Fuel/Food/Travel; old records still edit.
 */

import { withoutMinimumMargin } from './helpers/marginRule.js';
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));
const stored = new Map();
const storageMock = {
  resourceTypeFor: (t) => (String(t).startsWith('image/') ? 'image' : 'raw'),
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, resourceType: 'image', url: '' };
  },
  deletePrivateAsset: async ({ publicId }) => { stored.delete(publicId); return true; },
  readPrivateAsset: async (ref) => stored.get(ref.publicId),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: PaymentRequest } = await import('../models/PaymentRequest.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const claims = await import('../services/reimbursement.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(300, 1)]);
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const MONTH = TODAY.slice(0, 7);
const TOMORROW = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    /** Multipart, as the form sends it; `bill: false` sends no file. */
    form: (url, fields = {}, { bill = true } = {}) => {
      let r = agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) r = r.field(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      return bill ? r.attach('bill', JPEG, { filename: 'bill.jpg', contentType: 'image/jpeg' }) : r;
    },
    /** An edit as the edit form sends it: multipart PUT, with a new bill attached. */
    editForm: (url, fields = {}) => {
      let r = agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      return r.attach('bill', JPEG, { filename: 'bill.jpg', contentType: 'image/jpeg' });
    },
    pay: (url, fields) => {
      let r = agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, String(v));
      return r;
    },
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, id: String(user._id), session: await signIn(email) };
};
const staff = (team, over = {}) => ({ team, isHead: false, active: true, ...over });

const fuel = (km, over = {}) => ({ category: 'reimbursement', reimbursement: { type: 'fuel', on: TODAY, km, ...over } });
const claim = (who, fields, opts) => who.session.form('/payment-requests/expenses', fields, { bill: false, ...opts });

describe('Reimbursements: fuel by km, food / transport / others, task links', () => {
  beforeAll(async () => { await dbHandler.connect(); await StaffTask.init(); await PaymentRequest.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); await dbHandler.clearDatabase(); });

  let admin, accounts, ops, procurement, procHead, gtm, outsider;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    ops = await makeUser('Omar', 'staff', staff('operations'));
    procurement = await makeUser('Arun', 'staff', staff('procurement'));
    procHead = await makeUser('Priya', 'staff', staff('procurement', { isHead: true }));
    gtm = await makeUser('Gita', 'staff', staff('sales'));
    outsider = await makeUser('Bala', 'staff', staff('procurement'));
  });

  describe('Fuel: the server works out km × rate', () => {
    test('42 km → ₹630 at the default ₹15, and a tampered amount is ignored', async () => {
      const res = await claim(ops, { ...fuel(42), amount: 99999, description: 'Supplier visit' });
      expect(res.status).toBe(201);
      expect(res.body.request.amount).toBe(630);
      expect(res.body.request.reimbursement).toMatchObject({ type: 'fuel', km: 42, ratePerKm: 15, on: TODAY });
      expect(res.body.request.categoryLabel).toBe('Reimbursement – Fuel (42 km × ₹15)');
      const doc = await PaymentRequest.findById(res.body.request.id).lean();
      expect(doc.amount).toBe(630);
      expect(doc.reimbursement.ratePerKm).toBe(15);
    });

    test('decimal km are paid to the paisa (12.5 km → ₹187.50)', async () => {
      const res = await claim(ops, fuel('12.5'));
      expect(res.status).toBe(201);
      expect(res.body.request.amount).toBe(187.5);
      expect(claims.fuelAmount(0.01, 15)).toBe(0.15);
      expect(claims.fuelAmount(33.33, 15.5)).toBe(516.62);
    });

    test('km ≤ 0, km over 1,000, no km, a bad or future date → 400', async () => {
      for (const km of [0, -5, 1000.01, 'abc', undefined]) {
        const res = await claim(ops, fuel(km));
        expect(res.status).toBe(400);
      }
      expect((await claim(ops, fuel(1000))).status).toBe(201);
      expect((await claim(ops, fuel(10, { on: TOMORROW }))).status).toBe(400);
      expect((await claim(ops, fuel(10, { on: '2026-02-30' }))).status).toBe(400);
      expect((await claim(ops, fuel(10, { on: '' }))).status).toBe(400);
      expect(await PaymentRequest.countDocuments()).toBe(1);
    });

    test('rupees only', async () => {
      const res = await claim(ops, { ...fuel(10), currency: 'USD' });
      expect(res.status).toBe(400);
    });
  });

  describe('The rate: admin-editable, snapshotted on each claim', () => {
    test('a rate change moves new claims only; editing an old claim recomputes at ITS rate', async () => {
      const old = (await claim(ops, fuel(42))).body.request;
      expect(old.amount).toBe(630);

      const set = await admin.session.put('/payment-requests/reimbursements/settings', { fuelRatePerKm: 16 });
      expect(set.status).toBe(200);
      expect(set.body.settings.fuelRatePerKm).toBe(16);
      expect((await ops.session.get('/payment-requests/reimbursements/settings')).body.settings.fuelRatePerKm).toBe(16);

      const fresh = (await claim(ops, fuel(42))).body.request;
      expect(fresh.amount).toBe(672);
      expect(fresh.reimbursement.ratePerKm).toBe(16);
      expect((await PaymentRequest.findById(old.id).lean()).amount).toBe(630);

      // Edit the old claim's km (and try to sneak an amount in): 50 km × its ₹15.
      const edited = await ops.session.put(`/payment-requests/${old.id}`, { reason: "Correction", amount: 5000, reimbursement: { km: 50 } });
      expect(edited.status).toBe(200);
      expect(edited.body.request.amount).toBe(750);
      expect(edited.body.request.reimbursement).toMatchObject({ km: 50, ratePerKm: 15 });

      // An amount alone on a fuel claim changes nothing.
      const sneaky = await ops.session.put(`/payment-requests/${old.id}`, { reason: "Correction", amount: 5000 });
      expect(sneaky.status).toBe(200);
      expect(sneaky.body.request.amount).toBe(750);
    });

    test('food → fuel on an edit takes today’s rate; fuel → food takes the typed amount', async () => {
      const r = (await claim(ops, { category: 'reimbursement', reimbursement: { type: 'food', on: TODAY }, amount: 150 })).body.request;
      const toFuel = await ops.session.put(`/payment-requests/${r.id}`, { reason: "Correction", reimbursement: { type: 'fuel', km: 12 } });
      expect(toFuel.status).toBe(200);
      expect(toFuel.body.request.amount).toBe(180);
      expect(toFuel.body.request.reimbursement).toMatchObject({ type: 'fuel', km: 12, ratePerKm: 15 });
      const back = await ops.session.put(`/payment-requests/${r.id}`, { reason: "Correction", reimbursement: { type: 'food' }, amount: 120 });
      expect(back.status).toBe(200);
      expect(back.body.request.amount).toBe(120);
      expect(back.body.request.reimbursement).toMatchObject({ type: 'food', km: null, ratePerKm: null });
    });

    test('only the admin changes the rate; a bad rate is refused', async () => {
      expect((await accounts.session.put('/payment-requests/reimbursements/settings', { fuelRatePerKm: 20 })).status).toBe(403);
      expect((await ops.session.put('/payment-requests/reimbursements/settings', { fuelRatePerKm: 20 })).status).toBe(403);
      for (const bad of [0, -1, 101, 'x', 15.555, null]) {
        expect((await admin.session.put('/payment-requests/reimbursements/settings', { fuelRatePerKm: bad })).status).toBe(400);
      }
      expect((await ops.session.get('/payment-requests/reimbursements/settings')).body.settings.fuelRatePerKm).toBe(15);
    });
  });

  describe('Food, Transportation, Others', () => {
    test('a typed amount; Others needs details', async () => {
      const food = await claim(ops, { category: 'reimbursement', reimbursement: { type: 'food', on: TODAY }, amount: 180 });
      expect(food.status).toBe(201);
      expect(food.body.request.amount).toBe(180);
      expect(food.body.request.categoryLabel).toBe('Reimbursement – Food');

      const bare = await claim(ops, { category: 'reimbursement', reimbursement: { type: 'other', on: TODAY }, amount: 90 });
      expect(bare.status).toBe(400);
      expect(bare.body.message).toMatch(/details/i);
      const told = await claim(ops, { category: 'reimbursement', reimbursement: { type: 'other', on: TODAY }, amount: 90, description: 'Printer ink' });
      expect(told.status).toBe(201);

      const noType = await claim(ops, { category: 'reimbursement', reimbursement: { on: TODAY }, amount: 90 });
      expect(noType.status).toBe(400);
    });

    test('above ₹200 needs a bill (fuel never does)', async () => {
      const kinds = { category: 'reimbursement', reimbursement: { type: 'transport', on: TODAY }, amount: 450 };
      const none = await claim(ops, kinds);
      expect(none.status).toBe(400);
      expect(none.body.message).toMatch(/bill/i);
      expect((await claim(ops, kinds, { bill: true })).status).toBe(201);
      expect((await claim(ops, { ...kinds, amount: 200 })).status).toBe(201);
      expect((await claim(ops, fuel(500))).status).toBe(201); // ₹7,500 of fuel, no bill
    });

    test('an edit raising a billless claim above ₹200 is refused', async () => {
      const r = (await claim(ops, { category: 'reimbursement', reimbursement: { type: 'food', on: TODAY }, amount: 150 })).body.request;
      const up = await ops.session.put(`/payment-requests/${r.id}`, { reason: "Correction", amount: 900 });
      expect(up.status).toBe(400);
      expect((await PaymentRequest.findById(r.id).lean()).amount).toBe(150);
    });

    test('an edit that attaches the bill may raise it above ₹200 (the bills it will carry count)', async () => {
      const r = (await claim(ops, { category: 'reimbursement', reimbursement: { type: 'food', on: TODAY }, amount: 150 }, { bill: false })).body.request;
      const up = await ops.session.editForm(`/payment-requests/${r.id}`, { reason: 'Found the bill', amount: 900 });
      expect(up.status).toBe(200);
      expect(up.body.request.amount).toBe(900);
      expect(up.body.request.files.filter((f) => f.kind === 'bill')).toHaveLength(1);
    });
  });

  describe('Who may claim', () => {
    test('every active staff team, and the admin for a team; nobody else', async () => {
      for (const who of [ops, procurement, gtm, accounts]) {
        expect((await claim(who, fuel(10))).status).toBe(201);
      }
      expect((await claim(admin, { ...fuel(10), team: 'procurement' })).status).toBe(201);

      const customer = await makeUser('Cust', 'customer');
      expect((await claim(customer, fuel(10))).status).toBe(403);
      const gone = await makeUser('Left', 'staff', staff('operations', { active: false }));
      expect((await claim(gone, fuel(10))).status).toBe(403);
    });

    test('operations keeps typed Fuel / Food / Travel beside Reimbursement (owner, 2026-11-25); an old one still edits', async () => {
      const opts = (await ops.session.get('/payment-requests/expense-options')).body.options;
      expect(opts.categories.map((c) => c.value)).toEqual(['reimbursement', 'fuel', 'food', 'travel', 'other']);
      expect(opts.reimbursement).toMatchObject({ fuelRatePerKm: 15, maxKm: 1000, billRequiredAbove: 200 });
      const typed = await claim(ops, { category: 'fuel', amount: 500, description: 'Diesel bill' });
      expect(typed.status).toBe(201);
      expect(typed.body.request).toMatchObject({ category: 'fuel', amount: 500 });
      expect(typed.body.request.reimbursement ?? null).toBeNull();

      const { insertedId } = await PaymentRequest.collection.insertOne({
        number: 'PR-9001', kind: 'expense', status: 'submitted', team: 'operations',
        requestedBy: ops.user._id, requestedByName: 'Omar', amount: 800, category: 'fuel',
        description: 'Diesel for the van', payee: { name: 'Pump', method: '' }, files: [], history: [],
        createdAt: new Date(), updatedAt: new Date(),
      });
      const fixed = await ops.session.put(`/payment-requests/${insertedId}`, { reason: "Correction", amount: 850 });
      expect(fixed.status).toBe(200);
      expect(fixed.body.request.amount).toBe(850);
      expect(fixed.body.request.categoryLabel).toBe('Fuel');
    });

    test('the form pre-fills the UPI of this person’s last reimbursement', async () => {
      await claim(ops, { ...fuel(10), payee: { name: 'Omar', method: 'upi', upiId: 'omar@okaxis' } });
      const opts = (await ops.session.get('/payment-requests/expense-options')).body.options;
      expect(opts.reimbursement.lastPayee).toMatchObject({ method: 'upi', upiId: 'omar@okaxis' });
      expect((await gtm.session.get('/payment-requests/expense-options')).body.options.reimbursement.lastPayee).toBeNull();
    });
  });

  describe('The approval flow is unchanged', () => {
    test('accounts approves, the admin pays — the amount stays km × rate', async () => {
      const r = (await claim(ops, fuel(42))).body.request;
      expect(r.status).toBe('submitted');
      expect((await ops.session.post(`/payment-requests/${r.id}/approve`)).status).toBe(403);
      const ok = await accounts.session.post(`/payment-requests/${r.id}/approve`);
      expect(ok.status).toBe(200);
      expect(ok.body.request.status).toBe('approved');
      const paid = await admin.session.pay(`/payment-requests/${r.id}/pay`, { method: 'upi', reference: 'UTR123456789' });
      expect(paid.status).toBe(200);
      expect(paid.body.request.status).toBe('paid');
      expect(paid.body.request.amount).toBe(630);
      // A paid claim is locked.
      expect((await ops.session.put(`/payment-requests/${r.id}`, { reason: "Correction", reimbursement: { km: 80 } })).status).toBe(403);
    });
  });

  describe('Linked to a task', () => {
    let taskId;
    beforeEach(async () => {
      const t = await procHead.session.post('/staff/tasks', { dueOn: TODAY, title: 'Pick up Hilux bumper', assigneeId: procurement.id });
      expect(t.status).toBe(201);
      taskId = t.body.task.id;
    });

    test('Arun drove 42 km for "Pick up Hilux bumper" → ₹630 on the task, waiting then paid', async () => {
      const r = await claim(procurement, { ...fuel(42), task: taskId, description: 'To the supplier' });
      expect(r.status).toBe(201);
      expect(r.body.request.task).toMatchObject({ id: taskId, title: 'Pick up Hilux bumper' });
      expect(r.body.request.task.code).toMatch(/^T-\d+$/);

      let box = await procurement.session.get(`/staff/tasks/${taskId}/payments`);
      expect(box.status).toBe(200);
      expect(box.body.totals.waiting).toEqual({ count: 1, amount: 630 });
      expect(box.body.payments.items[0]).toMatchObject({ number: r.body.request.number, status: 'submitted', amount: 630, claim: 'Fuel (42 km × ₹15)' });

      await accounts.session.post(`/payment-requests/${r.body.request.id}/approve`);
      await admin.session.pay(`/payment-requests/${r.body.request.id}/pay`, { method: 'upi', reference: 'UTR987654321' });
      box = await procHead.session.get(`/staff/tasks/${taskId}/payments`);
      expect(box.body.totals.paid).toEqual({ count: 1, amount: 630 });
      expect(box.body.totals.waiting.count).toBe(0);
      // Accounts cannot open this task (not theirs), so not its box either: it reads the monthly report.
      expect((await accounts.session.get(`/staff/tasks/${taskId}/payments`)).status).toBe(404);
      expect((await admin.session.get(`/staff/tasks/${taskId}/payments`)).status).toBe(200);
    });

    test('a task the person cannot see cannot be linked; outsiders do not see the box', async () => {
      const own = await gtm.session.post('/staff/tasks', { dueOn: TODAY, title: 'Note to self' });
      const sneaky = await claim(procurement, { ...fuel(10), task: own.body.task.id });
      expect(sneaky.status).toBe(400);
      expect((await claim(procurement, { ...fuel(10), task: 'T-999999' })).status).toBe(400);
      expect((await claim(procurement, { ...fuel(10), task: 'nonsense' })).status).toBe(400);

      await claim(procurement, { ...fuel(10), task: taskId });
      const box = await outsider.session.get(`/staff/tasks/${taskId}/payments`);
      expect([403, 404]).toContain(box.status);
      expect(box.body.totals).toBeUndefined();
      expect((await gtm.session.get(`/staff/tasks/${taskId}/payments`)).status).toBe(404);
    });

    test('a task can be linked after raising, by T-number, and removed', async () => {
      const r = (await claim(procurement, fuel(10))).body.request;
      const code = (await StaffTask.findById(taskId).lean()).number;
      const linked = await procurement.session.post(`/payment-requests/${r.id}/links`, { task: `T-${code}` });
      expect(linked.status).toBe(200);
      expect(linked.body.request.task.id).toBe(taskId);
      const off = await procurement.session.post(`/payment-requests/${r.id}/links`, { task: '' });
      expect(off.body.request.task).toBeNull();
    });
  });

  describe('Lists and the monthly report', () => {
    test('the list filters by sub-type', async () => {
      await claim(ops, fuel(10));
      await claim(ops, { category: 'reimbursement', reimbursement: { type: 'food', on: TODAY }, amount: 120 });
      const opts = (await accounts.session.get('/payment-requests/filter-options')).body.categories.map((c) => c.value);
      expect(opts).toEqual(expect.arrayContaining(['reimbursement', 'reimbursement:fuel', 'reimbursement:food']));
      const fuelOnly = await accounts.session.get('/payment-requests?category=reimbursement:fuel');
      expect(fuelOnly.body.requests).toHaveLength(1);
      expect(fuelOnly.body.requests[0].reimbursement.type).toBe('fuel');
      expect((await accounts.session.get('/payment-requests?category=reimbursement')).body.requests).toHaveLength(2);
    });

    test('per person and per task, for the month spent; declined left out; admin / accounts only', async () => {
      const t = await procHead.session.post('/staff/tasks', { dueOn: TODAY, title: 'Pick up Hilux bumper', assigneeId: procurement.id });
      const a = (await claim(procurement, { ...fuel(42), task: t.body.task.id })).body.request;
      await claim(procurement, { category: 'reimbursement', reimbursement: { type: 'food', on: TODAY }, amount: 150, task: t.body.task.id });
      await claim(ops, fuel(10));
      const no = (await claim(ops, fuel(20))).body.request;
      await accounts.session.post(`/payment-requests/${no.id}/decline`, { note: 'duplicate' });
      await accounts.session.post(`/payment-requests/${a.id}/approve`);
      await admin.session.pay(`/payment-requests/${a.id}/pay`, { method: 'upi', reference: 'UTR111122223' });

      const res = await accounts.session.get(`/payment-requests/reimbursements/report?month=${MONTH}`);
      expect(res.status).toBe(200);
      const rep = res.body.report;
      expect(rep.total).toMatchObject({ count: 3, amount: 930, paid: 630, waiting: 300, km: 52 });
      const arun = rep.people.find((p) => p.name === 'Arun');
      expect(arun).toMatchObject({ count: 2, amount: 780, paid: 630, km: 42, byType: { fuel: 630, food: 150, transport: 0, other: 0 } });
      expect(rep.people.find((p) => p.name === 'Omar')).toMatchObject({ count: 1, amount: 150 });
      expect(rep.tasks).toHaveLength(1);
      expect(rep.tasks[0]).toMatchObject({ title: 'Pick up Hilux bumper', amount: 780, paid: 630 });

      expect((await ops.session.get(`/payment-requests/reimbursements/report?month=${MONTH}`)).status).toBe(403);
      expect((await admin.session.get('/payment-requests/reimbursements/report?month=2026-13')).status).toBe(400);
      const empty = (await admin.session.get('/payment-requests/reimbursements/report?month=2020-01')).body.report;
      expect(empty.total.count).toBe(0);
    });
  });
});

// Older payment cases are not about the 30% minimum (tests/supplierMargin.test.js is).
withoutMinimumMargin();
