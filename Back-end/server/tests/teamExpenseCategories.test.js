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
 *   - `amount` is ALWAYS rupees. A THB bill is raised and approved in THB, with
 *     no rate and no rupees (amount 0); the admin records the rupees the bank
 *     debited when paying, and the rate is worked out from that. Paying it
 *     without the rupees is refused; a rupee figure on raising is refused;
 *     totals never add baht to rupees and say how many bills they left out
 *   - older THB requests, raised with a quoted rate, still read, total, print
 *     and edit as they were
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
    it('gives each person their own team’s options; every team gets every currency', async () => {
      const opsRes = await ops.session.get('/payment-requests/expense-options');
      expect(opsRes.status).toBe(200);
      expect(opsRes.body.options.categories.map((c) => c.value)).toEqual(['fuel', 'food', 'travel', 'other']);
      // Every team pays in any currency on the list (owner, 2026-11-05), rupees first.
      expect(opsRes.body.options.currencies[0]).toEqual({ code: 'INR', label: 'Indian rupee (₹)' });
      expect(opsRes.body.options.currencies.map((c) => c.code)).toEqual(expect.arrayContaining(['THB', 'USD']));
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
      category: 'import_purchase', amount: undefined, currency: 'THB', foreignAmount: 22950, ...over,
    });
    /** A THB request raised the old way: with a quoted rate, rupees worked out. */
    const rated = (over = {}) => oldRecord(procurement, {
      category: 'import_purchase', currency: 'THB', foreignAmount: 10000, fxRate: 2.45, amount: 24500, ...over,
    });
    const pay = (id, fields = {}) => admin.session.pay(`/payment-requests/${id}/pay`, { method: 'bank', reference: 'UTR1', ...fields });

    it('keeps the bill in baht, with no rate and no rupees until it is paid', async () => {
      const res = await thb();
      expect(res.status).toBe(201);
      expect(res.body.request).toMatchObject({ amount: 0, currency: 'THB', foreignAmount: 22950, fxRate: null, rupeesPending: true });
      const saved = await PaymentRequest.findById(res.body.request.id).lean();
      expect(saved).toMatchObject({ amount: 0, currency: 'THB', foreignAmount: 22950, fxRate: null });
      // Lower case is the same code; a retired rate from a stale tab is ignored.
      expect((await thb({ currency: 'usd', foreignAmount: 100, fxRate: 83.5 })).body.request)
        .toMatchObject({ currency: 'USD', foreignAmount: 100, amount: 0, fxRate: null });
      // A rupee request is unchanged: its rupees are known from the start.
      expect((await expense(procurement.session, { category: 'forwarder_cha', amount: 1000 })).body.request)
        .toMatchObject({ amount: 1000, currency: 'INR', rupeesPending: false });
    });

    it('chat shows the bill and says the rupees come when it is paid', async () => {
      await thb();
      const raised = await ChatMessage.findOne({ text: /New Import purchase expense/ }).lean();
      expect(raised.text).toMatch(/THB 22,950 \(rupees when paid\)/);
      expect(raised.text).not.toMatch(/₹0/);
    });

    it('refuses a rupee figure on a foreign bill — the bank debit is recorded at payment', async () => {
      const res = await thb({ amount: 56227 });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/approved in THB; the rupees are recorded when it is paid/);
    });

    it('refuses a missing or silly bill amount, and an unknown currency', async () => {
      for (const over of [{ foreignAmount: undefined }, { foreignAmount: 0 }, { foreignAmount: -10 }, { foreignAmount: 'abc' },
        { foreignAmount: 2e9 }, { currency: 'XYZ' }]) {
        const res = await thb(over);
        expect([over, res.status]).toEqual([over, 400]);
      }
    });

    it('every team may claim a foreign bill; an unknown currency is refused', async () => {
      const res = await expense(ops.session, { category: 'fuel', amount: undefined, currency: 'THB', foreignAmount: 100 });
      expect(res.status).toBe(201);
      expect(res.body.request).toMatchObject({ currency: 'THB', foreignAmount: 100, amount: 0, rupeesPending: true });
      const bad = await expense(ops.session, { category: 'fuel', amount: undefined, currency: 'XYZ', foreignAmount: 100 });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toMatch(/XYZ is not a currency we pay in/);
      expect((await expense(ops.session, { category: 'fuel', currency: 'INR' })).status).toBe(201);
    });

    it('paying it needs the rupees the bank debited; the rate is worked out from them', async () => {
      const id = (await thb()).body.request.id;
      await accounts.session.post(`/payment-requests/${id}/approve`);

      const without = await pay(id);
      expect(without.status).toBe(400);
      expect(without.body.message).toMatch(/Enter the rupees the bank debited for this THB 22,950 bill/);
      expect((await PaymentRequest.findById(id).lean()).status).toBe('approved');

      // A figure off by a few zeros implies a rate no currency has: refused, not recorded.
      for (const rupees of ['0', '-5', 'abc', '99999999', '1']) {
        expect([rupees, (await pay(id, { rupees })).status]).toEqual([rupees, 400]);
      }

      const res = await pay(id, { rupees: '56227' });
      expect(res.status).toBe(200);
      expect(res.body.request).toMatchObject({ status: 'paid', amount: 56227, fxRate: 2.449978, rupeesPending: false, currency: 'THB', foreignAmount: 22950 });
      expect(res.body.request.history.at(-1).note).toMatch(/₹56,227 debited for THB 22,950 \(₹2\.45 per THB\)/);
      const paidMsg = await ChatMessage.findOne({ text: /^💸 Paid/ }).lean();
      expect(paidMsg.text).toMatch(/₹56,227 \(THB 22,950 @ ₹2\.45\)/);

      // Once: a second click is a lost race, and does not re-price it.
      expect((await pay(id, { rupees: '60000' })).status).toBe(409);
      expect((await PaymentRequest.findById(id).lean()).amount).toBe(56227);
    });

    it('the admin can correct a typo in the rupees afterwards — logged — but never a rupee payment\'s amount', async () => {
      const id = (await thb()).body.request.id;
      await pay(id, { rupees: '56227' });
      const fixed = await admin.session.put(`/payment-requests/${id}/payment`, { rupees: '56272' });
      expect(fixed.status).toBe(200);
      expect(fixed.body.request).toMatchObject({ amount: 56272, fxRate: 2.451939 });
      expect(fixed.body.request.history.at(-1).note).toMatch(/rupees debited ₹56,227 → ₹56,272/);
      expect((await admin.session.put(`/payment-requests/${id}/payment`, { rupees: '1' })).status).toBe(400);

      const inrId = (await expense(procurement.session, { category: 'forwarder_cha', amount: 1000 })).body.request.id;
      await pay(inrId);
      const refused = await admin.session.put(`/payment-requests/${inrId}/payment`, { rupees: '900' });
      expect(refused.status).toBe(400);
      expect((await PaymentRequest.findById(inrId).lean()).amount).toBe(1000);
    });

    it('a rupee request is paid at what accounts approved — a different figure is refused', async () => {
      const id = (await expense(procurement.session, { category: 'forwarder_cha', amount: 1000 })).body.request.id;
      expect((await pay(id, { rupees: '900' })).status).toBe(400);
      expect((await pay(id, { rupees: '1000' })).status).toBe(200);
    });

    it('an older request raised with a rate pays at its estimate, or at the real debit', async () => {
      const asQuoted = await rated();
      const shown = (await procurement.session.get(`/payment-requests/${asQuoted}`)).body.request;
      expect(shown).toMatchObject({ amount: 24500, fxRate: 2.45, rupeesPending: false });
      expect((await pay(asQuoted)).body.request).toMatchObject({ status: 'paid', amount: 24500, fxRate: 2.45 });

      const debited = await rated();
      expect((await pay(debited, { rupees: '24610' })).body.request).toMatchObject({ amount: 24610, fxRate: 2.461 });
    });

    it('totals add rupees only, and say how many foreign bills they left out', async () => {
      const inrId = (await expense(procurement.session, { category: 'forwarder_cha', amount: 1000 })).body.request.id;
      const thbId = (await thb()).body.request.id;
      await rated();
      await oldRecord(ops, { status: 'submitted', amount: 800 });
      const byStatus = await paymentRequestRepository.countByStatus();
      expect(byStatus.find((r) => r._id === 'submitted')).toMatchObject({ n: 4, amount: 1000 + 24500 + 800, pending: 1 });

      const list = await admin.session.get('/payment-requests?status=to_approve');
      expect(list.body.summary).toMatchObject({ count: 4, total: 26300, pending: 1 });

      expect((await pay(inrId)).status).toBe(200);
      expect((await pay(thbId, { rupees: '56227' })).status).toBe(200);
      const paid = await paymentRequestRepository.paidSinceByTeam(new Date(Date.now() - 60000));
      expect(paid).toEqual([{ _id: 'procurement', n: 2, amount: 57227 }]);
    });

    it('the list: an unpriced bill pages under the amount sort, is skipped by amount filters, and is found by its bill amount', async () => {
      const thbId = (await thb()).body.request.id;
      for (const amount of [500, 1500]) await expense(procurement.session, { category: 'forwarder_cha', amount });
      const seen = [];
      let cursor = '';
      do {
        const page = await admin.session.get(`/payment-requests?sort=amount_desc${cursor ? `&cursor=${cursor}` : ''}`);
        seen.push(...page.body.requests.map((r) => r.id));
        cursor = page.body.nextCursor || '';
      } while (cursor);
      expect(seen).toHaveLength(3);
      expect(seen.at(-1)).toBe(thbId);
      expect((await admin.session.get('/payment-requests?max=1000')).body.requests.map((r) => r.amount)).toEqual([500]);
      expect((await admin.session.get('/payment-requests?q=22950')).body.requests.map((r) => r.id)).toEqual([thbId]);
    });

    it('editing the bill amount keeps it in baht, and sends an approved one back to accounts', async () => {
      const id = (await thb()).body.request.id;
      await accounts.session.post(`/payment-requests/${id}/approve`);
      const res = await admin.session.put(`/payment-requests/${id}`, { foreignAmount: 23000 });
      expect(res.status).toBe(200);
      expect(res.body.request).toMatchObject({ amount: 0, foreignAmount: 23000, status: 'submitted' });
      expect(res.body.request.history.at(-1).note).toMatch(/bill THB 22,950 → THB 23,000.*back to accounts/);
      expect(res.body.request.history.at(-1).note).not.toMatch(/amount ₹/);

      // A rupee figure alone cannot override a foreign bill...
      expect((await procurement.session.put(`/payment-requests/${id}`, { amount: 100 })).status).toBe(400);
      // ...but the bill can be switched to rupees, with the rupees given.
      const inr = await procurement.session.put(`/payment-requests/${id}`, { currency: 'INR', amount: 24800 });
      expect(inr.body.request).toMatchObject({ amount: 24800, currency: 'INR', foreignAmount: null, fxRate: null, rupeesPending: false });
    });

    it('an older rated request keeps its rate through an edit that leaves the bill alone', async () => {
      const id = await rated();
      const same = await procurement.session.put(`/payment-requests/${id}`, { currency: 'THB', foreignAmount: 10000, fxRate: 9, description: 'Bumpers, invoice 77' });
      expect(same.status).toBe(200);
      expect(same.body.request).toMatchObject({ amount: 24500, fxRate: 2.45, description: 'Bumpers, invoice 77' });
      // Changing the bill drops the quote: the rupees now come from the bank at payment.
      const changed = await procurement.session.put(`/payment-requests/${id}`, { foreignAmount: 12000 });
      expect(changed.body.request).toMatchObject({ amount: 0, fxRate: null, foreignAmount: 12000, rupeesPending: true });
      expect(changed.body.request.history.at(-1).note).toMatch(/bill THB 10,000 @ ₹2\.45 → THB 12,000/);
    });

    describe('paid from a foreign-currency account (e.g. HR\'s Thai bank account)', () => {
      const abroad = (id, over = {}) => pay(id, { paidFrom: 'foreign', sentAmount: '22950', accountLabel: 'HR\'s Thailand account', ...over });

      it('records the baht sent and the account — no rupees, and no rupees asked for', async () => {
        const id = (await thb()).body.request.id;
        await accounts.session.post(`/payment-requests/${id}/approve`);
        const res = await abroad(id, { sentAmount: '22,950', note: 'Paid by HR' });
        expect(res.status).toBe(200);
        expect(res.body.request).toMatchObject({
          status: 'paid', amount: 0, fxRate: null, currency: 'THB', foreignAmount: 22950, rupeesPending: false,
          paidFrom: { currency: 'THB', amount: 22950, label: 'HR\'s Thailand account' },
        });
        expect(res.body.request.payment).toMatchObject({ method: 'bank', reference: 'UTR1' });
        expect(res.body.request.history.at(-1).note).toMatch(/THB 22,950 sent from HR's Thailand account \(no rupees debited\) — Paid by HR/);
        const saved = await PaymentRequest.findById(id).lean();
        expect(saved.payment.fromAccount).toEqual({ currency: 'THB', amount: 22950, label: 'HR\'s Thailand account' });
        const paidMsg = await ChatMessage.findOne({ text: /^💸 Paid/ }).lean();
        expect(paidMsg.text).toMatch(/THB 22,950 \(paid from HR's Thailand account\)/);
        expect(paidMsg.text).not.toMatch(/₹0/);
      });

      it('the amount sent must be the bill, exactly; a missing or bad amount is refused and nothing changes', async () => {
        const id = (await thb()).body.request.id;
        for (const sentAmount of ['', '0', '-5', 'abc', '22950.001', '22949.99', '23000', '2295']) {
          expect([sentAmount, (await abroad(id, { sentAmount })).status]).toEqual([sentAmount, 400]);
        }
        expect((await abroad(id, { sentAmount: '1' })).body.message).toMatch(/This bill is THB 22,950/);
        expect((await abroad(id, { sentAmount: '' })).body.message).toMatch(/Enter the THB amount sent/);
        // Not a different currency, not rupees as well, not an unknown account kind.
        expect((await abroad(id, { sentCurrency: 'USD' })).body.message).toMatch(/This bill is in THB/);
        expect((await abroad(id, { rupees: '56227' })).status).toBe(400);
        expect((await pay(id, { paidFrom: 'cash-box' })).status).toBe(400);
        const saved = await PaymentRequest.findById(id).lean();
        expect(saved.status).toBe('submitted');
        expect(saved.payment?.fromAccount).toBeUndefined();
        // Satang are fine when the bill has them.
        const odd = (await thb({ foreignAmount: 1234.5 })).body.request.id;
        expect((await abroad(odd, { sentAmount: '1234.50' })).body.request.paidFrom.amount).toBe(1234.5);
      });

      it('a rupee bill cannot be paid from a foreign account', async () => {
        const id = (await expense(procurement.session, { category: 'forwarder_cha', amount: 1000 })).body.request.id;
        const res = await abroad(id, { sentAmount: '1000' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/This bill is in rupees/);
      });

      it('once only: a double click or retry is refused and records nothing twice', async () => {
        const id = (await thb()).body.request.id;
        const [a, b] = await Promise.all([abroad(id), abroad(id)]);
        expect([a.status, b.status].sort()).toEqual([200, 409]);
        expect((await abroad(id)).status).toBe(409);
        expect((await pay(id, { rupees: '56227' })).status).toBe(409);
        const saved = await PaymentRequest.findById(id).lean();
        expect(saved.history.filter((h) => h.action === 'paid')).toHaveLength(1);
        expect(saved.amount).toBe(0);
      });

      it('an older request with a rupee estimate drops the estimate (no rupees left the company) — logged', async () => {
        const id = await rated();
        const res = await abroad(id, { sentAmount: '10000' });
        expect(res.body.request).toMatchObject({ amount: 0, fxRate: null, paidFrom: { amount: 10000 } });
        expect(res.body.request.history.at(-1).note).toMatch(/earlier estimate of ₹24,500 is dropped/);
      });

      it('totals: rupees stay rupees, and the baht is listed beside them, never added in', async () => {
        const inrId = (await expense(procurement.session, { category: 'forwarder_cha', amount: 1000 })).body.request.id;
        const thbId = (await thb()).body.request.id;
        const thb2 = (await thb({ foreignAmount: 0.1 + 0.2 })).body.request.id; // 0.3: no float drift in the sum
        const debited = (await thb()).body.request.id;
        expect((await pay(inrId)).status).toBe(200);
        expect((await abroad(thbId)).status).toBe(200);
        expect((await abroad(thb2, { sentAmount: '0.30' })).status).toBe(200);
        expect((await pay(debited, { rupees: '56227' })).status).toBe(200);

        const list = await admin.session.get('/payment-requests?status=paid');
        expect(list.body.summary).toMatchObject({ count: 4, total: 57227, pending: 2, foreign: [{ currency: 'THB', amount: 22950.3 }] });
        const paid = await paymentRequestRepository.paidSinceByTeam(new Date(Date.now() - 60000));
        expect(paid).toEqual([{ _id: 'procurement', n: 4, amount: 57227 }]);
        expect(await paymentRequestRepository.paidNoRupeesSince(new Date(Date.now() - 60000))).toEqual([{ currency: 'THB', amount: 22950.3 }]);
      });

      it('the record stays editable: UTR, time, account name — but there are no rupees to change', async () => {
        const id = (await thb()).body.request.id;
        await abroad(id);
        const fixed = await admin.session.put(`/payment-requests/${id}/payment`, { reference: 'UTR2', accountLabel: 'Bangkok Bank (HR)' });
        expect(fixed.status).toBe(200);
        expect(fixed.body.request.paidFrom).toMatchObject({ label: 'Bangkok Bank (HR)', amount: 22950 });
        expect(fixed.body.request.history.at(-1).note).toMatch(/reference UTR1 → UTR2, paid from HR's Thailand account → Bangkok Bank \(HR\)/);
        const refused = await admin.session.put(`/payment-requests/${id}/payment`, { rupees: '56227' });
        expect(refused.status).toBe(400);
        expect(refused.body.message).toMatch(/no rupees were debited/);
        expect((await PaymentRequest.findById(id).lean()).amount).toBe(0);
      });

      it('prints the receipt', async () => {
        const id = (await thb()).body.request.id;
        await abroad(id);
        const receipt = await procurement.session.get(`/payment-requests/${id}/slip`);
        expect(receipt.status).toBe(200);
        expect(receipt.headers['content-type']).toMatch(/pdf/);
      });
    });

    it('prints the slip before and after payment, and an older rated request too', async () => {
      const id = (await thb()).body.request.id;
      for (const which of [id, await rated()]) {
        const slip = await procurement.session.get(`/payment-requests/${which}/slip`);
        expect(slip.status).toBe(200);
        expect(slip.headers['content-type']).toMatch(/pdf/);
      }
      await pay(id, { rupees: '56227' });
      const receipt = await procurement.session.get(`/payment-requests/${id}/slip`);
      expect(receipt.status).toBe(200);
    });
  });
});
