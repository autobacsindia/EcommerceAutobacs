/**
 * Per-team expense options and foreign-currency bills (config/expenseCategories.js,
 * enforced in services/paymentRequestService.js), over HTTP.
 *
 * What must hold:
 *   - the form's options come from the server, and the server refuses anything
 *     else: a category another team has, a missing note where one is needed —
 *     always a 400 with a reason, never a 500
 *   - old records (one shared list: fuel, travel, food, purchase, other) still
 *     read, list, total and print — and can be edited without being forced
 *     onto the new list, unless the edit changes the category
 *   - `amount` is ALWAYS rupees: a THB bill stores THB + the quoted rate, and
 *     the server works out the rupees. A client-sent rupee figure that
 *     disagrees is refused; totals never add baht to rupees
 */

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
const { default: ChatMessage } = await import('../models/ChatMessage.js');
const { default: paymentRequestRepository } = await import('../repositories/paymentRequestRepository.js');
const { STAFF_TEAM_VALUES } = await import('../config/staff.js');
const cfg = await import('../config/expenseCategories.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(300, 1)]);

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
    form: (url, fields = {}) => {
      let r = agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) r = r.field(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      return r.attach('bill', JPEG, { filename: 'bill.jpg', contentType: 'image/jpeg' });
    },
    // Multipart with no file: the pay step takes payment screenshots, not bills.
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
  return { user, session: await signIn(email) };
};
const staff = (team) => ({ team, isHead: false, active: true });

const UPI = { name: 'Fuel Station', method: 'upi', upiId: 'fuelstation@okaxis' };
const expense = (s, fields) => s.form('/payment-requests/expenses', { amount: 1000, payee: UPI, ...fields });

/** An expense saved before per-team lists and currencies: no currency fields at all. */
async function oldRecord(who, over = {}) {
  const { insertedId } = await PaymentRequest.collection.insertOne({
    number: `PR-${9000 + n++}`, kind: 'expense', status: 'submitted', team: who.user.staff.team,
    requestedBy: who.user._id, requestedByName: who.user.name, amount: 800, category: 'fuel',
    description: 'Diesel for the van', payee: UPI, files: [], history: [],
    createdAt: new Date(), updatedAt: new Date(), ...over,
  });
  return String(insertedId);
}

describe('Expense options per team, and foreign-currency bills', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); await dbHandler.clearDatabase(); });

  let admin, accounts, ops, marketing, procurement, gtm, developer;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    ops = await makeUser('Omar', 'staff', staff('operations'));
    marketing = await makeUser('Mira', 'staff', staff('marketing'));
    procurement = await makeUser('Priya', 'staff', staff('procurement'));
    gtm = await makeUser('Sam', 'staff', staff('sales'));
    developer = await makeUser('Dev', 'staff', staff('developer'));
  });

  describe('the list itself', () => {
    it('every team has a list, ending in "Others" which always needs details, with no value twice', () => {
      for (const team of STAFF_TEAM_VALUES) {
        const list = cfg.categoriesFor(team);
        expect(list.length).toBeGreaterThan(1);
        expect(list.at(-1)).toEqual({ value: 'other', label: 'Others', noteRequired: true });
        expect(new Set(list.map((x) => x.value)).size).toBe(list.length);
      }
    });

    it('old values stay readable, and anything unknown shows as stored', () => {
      expect(cfg.categoryLabel('purchase')).toBe('Purchase for the company');
      expect(cfg.categoryLabel('fuel')).toBe('Fuel');
      expect(cfg.categoryLabel('supplier')).toBe('Supplier payment');
      expect(cfg.categoryLabel('forwarder_cha')).toBe('Freight forwarder / CHA (customs agent)');
      expect(cfg.categoryLabel('mystery')).toBe('mystery');
      // A value off the team's list (an old record) keeps the old "details required" rule.
      expect(cfg.noteRequiredFor('procurement', 'fuel')).toBe(true);
      expect(cfg.noteRequiredFor('operations', 'fuel')).toBe(false);
    });
  });

  describe('GET /payment-requests/expense-options', () => {
    it('gives each person their own team’s options; currencies only to procurement', async () => {
      const opsRes = await ops.session.get('/payment-requests/expense-options');
      expect(opsRes.status).toBe(200);
      expect(opsRes.body.options.categories.map((c) => c.value)).toEqual(['fuel', 'food', 'travel', 'other']);
      expect(opsRes.body.options.currencies).toEqual([{ code: 'INR', label: 'Indian rupee (₹)' }]);
      // A staff member cannot ask for another team's list.
      const sneaky = await ops.session.get('/payment-requests/expense-options?team=procurement');
      expect(sneaky.body.options.team).toBe('operations');

      const proc = (await procurement.session.get('/payment-requests/expense-options')).body.options;
      expect(proc.categories.map((c) => c.value)).toEqual(['import_purchase', 'forwarder_cha', 'other']);
      expect(proc.currencies.map((c) => c.code)).toEqual(expect.arrayContaining(['INR', 'THB', 'USD', 'CNY', 'EUR', 'JPY']));
      expect(proc.currencies[0].code).toBe('INR');

      const acc = (await accounts.session.get('/payment-requests/expense-options')).body.options;
      expect(acc.categories.every((c) => c.noteRequired)).toBe(true);
    });

    it('an admin names the team; a customer cannot ask', async () => {
      expect((await admin.session.get('/payment-requests/expense-options')).status).toBe(400);
      const mkt = await admin.session.get('/payment-requests/expense-options?team=marketing');
      expect(mkt.body.options.categories.map((c) => c.value)).toEqual(['meta_ads', 'google_ads', 'claude', 'tools', 'other']);
      const customer = await makeUser('Cara', 'customer');
      expect((await customer.session.get('/payment-requests/expense-options')).status).toBe(403);
    });
  });

  describe('raising: the team’s own options only', () => {
    it('refuses another team’s option with a 400 that says what this team can claim', async () => {
      const res = await expense(procurement.session, { category: 'fuel', description: 'Diesel' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Procurement can claim: Import purchase, Freight forwarder \/ CHA \(customs agent\), Others/);
      expect((await expense(ops.session, { category: 'import_purchase', description: 'x'.repeat(5) })).status).toBe(400);
      expect((await expense(marketing.session, { category: 'purchase', description: 'Old option' })).status).toBe(400);
      expect((await expense(ops.session, { description: 'No category' })).status).toBe(400);
      expect((await expense(ops.session, { category: { $ne: 'x' }, description: 'Injected' })).status).toBe(400);
      expect(stored.size).toBe(0); // nothing was stored for a refused request
    });

    it('takes each team’s own options', async () => {
      const cases = [
        [ops, 'fuel'], [ops, 'food'], [ops, 'travel'],
        [marketing, 'meta_ads'], [marketing, 'google_ads'], [marketing, 'claude'],
        [procurement, 'import_purchase'], [procurement, 'forwarder_cha'],
        [developer, 'hosting'], [developer, 'ai_tools'],
        [gtm, 'customer_travel'], [gtm, 'samples'],
      ];
      for (const [who, category] of cases) {
        const res = await expense(who.session, { category });
        expect([category, res.status]).toEqual([category, 201]);
        expect(res.body.request).toMatchObject({ category, categoryLabel: cfg.categoryLabel(category), currency: 'INR', foreignAmount: null, fxRate: null });
      }
    });

    it('an admin raising for a team is held to that team’s list', async () => {
      expect((await expense(admin.session, { team: 'procurement', category: 'fuel', description: 'Diesel' })).status).toBe(400);
      const ok = await expense(admin.session, { team: 'procurement', category: 'forwarder_cha' });
      expect(ok.status).toBe(201);
      expect(ok.body.request.team).toBe('procurement');
    });
  });

  describe('raising: details where they are required', () => {
    it('optional on a plain option, required on Others / Tools / every Accounts option', async () => {
      expect((await expense(ops.session, { category: 'fuel' })).status).toBe(201);
      expect((await expense(marketing.session, { category: 'meta_ads', description: '' })).status).toBe(201);

      for (const [who, category] of [[ops, 'other'], [marketing, 'tools'], [marketing, 'other'], [accounts, 'gst'],
        [accounts, 'salary'], [accounts, 'epf'], [accounts, 'other'], [procurement, 'other'], [gtm, 'other'], [developer, 'other']]) {
        for (const description of [undefined, '', '   ', 'ab']) {
          const res = await expense(who.session, { category, description });
          expect([category, description, res.status]).toEqual([category, description, 400]);
          expect(res.body.message).toMatch(/Add details/);
        }
        expect((await expense(who.session, { category, description: 'Canva yearly plan' })).status).toBe(201);
      }
    });
  });

  describe('old records', () => {
    it('read, list and print as they were, as rupees', async () => {
      const id = await oldRecord(procurement);
      const legacy = await oldRecord(marketing, { category: 'purchase', amount: 450 });

      const one = await procurement.session.get(`/payment-requests/${id}`);
      expect(one.status).toBe(200);
      expect(one.body.request).toMatchObject({ category: 'fuel', categoryLabel: 'Fuel', currency: 'INR', amount: 800, foreignAmount: null });
      const all = await accounts.session.get('/payment-requests?status=open');
      expect(all.body.requests.map((r) => r.id)).toEqual(expect.arrayContaining([id, legacy]));
      expect(all.body.requests.find((r) => r.id === legacy).categoryLabel).toBe('Purchase for the company');

      const slip = await accounts.session.get(`/payment-requests/${id}/slip`);
      expect(slip.status).toBe(200);
      expect(slip.headers['content-type']).toMatch(/pdf/);
    });

    it('can be corrected without changing the category; changing it applies the team’s list', async () => {
      const id = await oldRecord(procurement);
      const fixed = await procurement.session.put(`/payment-requests/${id}`, { amount: 850, description: 'Diesel for the van, 2 trips', category: 'fuel' });
      expect(fixed.status).toBe(200);
      expect(fixed.body.request).toMatchObject({ category: 'fuel', amount: 850, currency: 'INR' });

      expect((await procurement.session.put(`/payment-requests/${id}`, { category: 'travel' })).status).toBe(400);
      const moved = await procurement.session.put(`/payment-requests/${id}`, { category: 'import_purchase' });
      expect(moved.status).toBe(200);
      expect(moved.body.request.category).toBe('import_purchase');
      expect(moved.body.request.history.at(-1).note).toMatch(/for Fuel → Import purchase/);
      // Once moved off the old value, it cannot be moved back onto it.
      expect((await procurement.session.put(`/payment-requests/${id}`, { category: 'fuel' })).status).toBe(400);
    });

    it('an edit cannot blank the details where they are required', async () => {
      const raised = (await expense(marketing.session, { category: 'tools', description: 'Figma seats' })).body.request;
      expect((await marketing.session.put(`/payment-requests/${raised.id}`, { description: '' })).status).toBe(400);
      expect((await marketing.session.put(`/payment-requests/${raised.id}`, { category: 'claude', description: '' })).status).toBe(200);
      const plain = (await expense(ops.session, { category: 'fuel' })).body.request;
      expect((await ops.session.put(`/payment-requests/${plain.id}`, { category: 'other' })).status).toBe(400);
      expect((await ops.session.put(`/payment-requests/${plain.id}`, { category: 'other', description: 'Parking fee' })).status).toBe(200);
    });
  });

  describe('foreign currency (procurement)', () => {
    const thb = (over = {}) => expense(procurement.session, {
      category: 'import_purchase', amount: undefined, currency: 'THB', foreignAmount: 10000, fxRate: 2.45, ...over,
    });

    it('keeps the bill in baht and works out the rupees itself', async () => {
      const res = await thb();
      expect(res.status).toBe(201);
      expect(res.body.request).toMatchObject({ amount: 24500, currency: 'THB', foreignAmount: 10000, fxRate: 2.45 });
      const saved = await PaymentRequest.findById(res.body.request.id).lean();
      expect(saved).toMatchObject({ amount: 24500, currency: 'THB', foreignAmount: 10000, fxRate: 2.45 });
      // Lower case is the same code; a matching rupee figure is accepted.
      expect((await thb({ currency: 'usd', foreignAmount: 100, fxRate: 83.5, amount: 8350 })).body.request).toMatchObject({ currency: 'USD', amount: 8350 });
      // Rounded to paise, as every rupee amount is.
      expect((await thb({ foreignAmount: 333.33, fxRate: 2.4567 })).body.request.amount).toBe(818.89);
    });

    it('chat shows both, the rupees first', async () => {
      await thb();
      const raised = await ChatMessage.findOne({ text: /New Import purchase expense/ }).lean();
      expect(raised.text).toMatch(/₹24,500 \(THB 10,000 @ ₹2\.45\)/);
    });

    it('refuses a rupee figure that disagrees with the bill and the rate', async () => {
      const res = await thb({ amount: 1 });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/worked out from the THB amount and the rate \(₹24,500\)/);
    });

    it('refuses a missing or silly rate or bill amount, and an unknown currency', async () => {
      for (const over of [{ fxRate: undefined }, { fxRate: 0 }, { fxRate: -2 }, { fxRate: 5000 }, { fxRate: 'abc' },
        { foreignAmount: undefined }, { foreignAmount: 0 }, { foreignAmount: -10 }, { currency: 'XYZ' },
        { foreignAmount: 1e9, fxRate: 900 }]) {
        const res = await thb(over);
        expect([over, res.status]).toEqual([over, 400]);
      }
    });

    it('other teams claim in rupees only', async () => {
      const res = await expense(ops.session, { category: 'fuel', amount: undefined, currency: 'THB', foreignAmount: 100, fxRate: 2.45 });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/claimed in rupees/);
      expect((await expense(ops.session, { category: 'fuel', currency: 'INR' })).status).toBe(201);
    });

    it('totals add rupees only — a baht bill counts as its rupee amount', async () => {
      const inrId = (await expense(procurement.session, { category: 'forwarder_cha', amount: 1000 })).body.request.id;
      const thbId = (await thb()).body.request.id;
      await oldRecord(ops, { status: 'submitted', amount: 800 });
      const byStatus = await paymentRequestRepository.countByStatus();
      expect(byStatus.find((r) => r._id === 'submitted')).toMatchObject({ n: 3, amount: 1000 + 24500 + 800 });

      for (const id of [inrId, thbId]) {
        await accounts.session.post(`/payment-requests/${id}/approve`);
        expect((await admin.session.pay(`/payment-requests/${id}/pay`, { method: 'bank', reference: 'UTR1' })).status).toBe(200);
      }
      const paid = await paymentRequestRepository.paidSinceByTeam(new Date(Date.now() - 60000));
      expect(paid).toEqual([{ _id: 'procurement', n: 2, amount: 25500 }]);
    });

    it('editing the rate works the rupees out again, and sends an approved one back to accounts', async () => {
      const id = (await thb()).body.request.id;
      await accounts.session.post(`/payment-requests/${id}/approve`);
      const res = await admin.session.put(`/payment-requests/${id}`, { fxRate: 2.5 });
      expect(res.status).toBe(200);
      expect(res.body.request).toMatchObject({ amount: 25000, currency: 'THB', foreignAmount: 10000, fxRate: 2.5, status: 'submitted' });
      expect(res.body.request.history.at(-1).note).toMatch(/bill THB 10,000 @ ₹2\.45 → THB 10,000 @ ₹2\.5.*back to accounts/);

      // A rupee figure alone cannot override a foreign bill...
      expect((await procurement.session.put(`/payment-requests/${id}`, { amount: 100 })).status).toBe(400);
      // ...but the bill can be switched to rupees, with the rupees given.
      const inr = await procurement.session.put(`/payment-requests/${id}`, { currency: 'INR', amount: 24800 });
      expect(inr.body.request).toMatchObject({ amount: 24800, currency: 'INR', foreignAmount: null, fxRate: null });
    });

    it('prints the bill line on the slip', async () => {
      const id = (await thb()).body.request.id;
      const slip = await procurement.session.get(`/payment-requests/${id}/slip`);
      expect(slip.status).toBe(200);
      expect(slip.headers['content-type']).toMatch(/pdf/);
    });
  });
});
