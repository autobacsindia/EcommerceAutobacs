/**
 * Subscriptions & dues → "Mark paid" → one expense in Payments → accounts decides
 * (services/subscriptionDueService.js markPaid / settleFromExpense,
 * services/paymentRequestService.js raiseForSubscription / approve / decline / markPaid).
 * Private storage and the job queue are doubles; Mongo (with transactions), auth,
 * CSRF and chat are real.
 *
 * What must hold:
 *   - marking a due cycle paid raises exactly ONE expense, linked to the item and the
 *     cycle — a double click, a retry or a stale screen never raises a second, and a
 *     lost attempt keeps no receipt
 *   - the money comes from the item, never the browser: a fixed bill is its amount (a
 *     different figure only with a reason); a usage-based bill needs its actual amount
 *     and invoice; a foreign bill paid already needs the rupees charged
 *   - paid already: accounts' approval closes the expense as PAID, the cycle is paid and
 *     the due date moves on; the admin cannot "pay" it again
 *   - not paid yet: approve → admin pays → only then is the cycle paid
 *   - declined / cancelled → the cycle is due again with the reason; it can be marked again
 *   - nobody approves an expense they marked paid themselves
 *   - who may mark: the adder, their team head, the admin — verified items, from 3 days before due
 *   - a step that failed half-way re-syncs when the item is opened
 *   - monthly totals add the paid bills in rupees
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
const { default: SubscriptionDue } = await import('../models/SubscriptionDue.js');
const { default: PaymentRequest } = await import('../models/PaymentRequest.js');
const svc = await import('../services/subscriptionDueService.js');

const BASE = '/api/v1/subscription-dues';
const PAY = '/api/v1/payment-requests';
const PW = 'SecurePass123!';
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);
const RECEIPT = [{ buffer: PDF, name: 'receipt.pdf', type: 'application/pdf' }];

const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  const multipart = (url, fields = {}, files = [], field = 'invoice') => {
    let r = agent.post(url).set('X-XSRF-TOKEN', csrf);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    for (const f of files) r = r.attach(field, f.buffer, { filename: f.name, contentType: f.type });
    return r;
  };
  return {
    get: (url) => agent.get(url),
    post: (url, body = {}) => agent.post(url).set('X-XSRF-TOKEN', csrf).send(body),
    add: (fields) => multipart(BASE, fields),
    markPaid: (id, fields, files = []) => multipart(`${BASE}/${id}/mark-paid`, fields, files),
    pay: (id, fields) => multipart(`${PAY}/${id}/pay`, fields, [], 'proof'),
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, s: await signIn(email) };
};
const staff = (team, isHead = false, active = true) => ({ team, isHead, active });

const today = svc.todayIst();
const RENT = {
  name: 'Office rent', purpose: 'Warehouse', kind: 'monthly', amount: 50000, currency: 'INR',
  dueDate: svc.addDays(today, 2), payment: { method: 'bank_transfer', autoDebit: false },
};
const RAILWAY = {
  name: 'Railway', kind: 'monthly', amount: 20, currency: 'USD', dueDate: today,
  payment: { method: 'card', cardLast4: '4007', autoDebit: true },
};
const PAID = { paidVia: 'bank', paidOn: today, reference: 'UTR123456' };

describe('Subscriptions & dues — mark paid → expense', () => {
  beforeAll(async () => { await dbHandler.connect(); await PaymentRequest.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); await dbHandler.clearDatabase(); await PaymentRequest.init(); });

  let admin, accounts, accounts2, dev, dev2, devHead, marketing;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    accounts2 = await makeUser('Asha', 'staff', staff('accounts'));
    dev = await makeUser('Dev', 'staff', staff('developer'));
    dev2 = await makeUser('Dina', 'staff', staff('developer'));
    devHead = await makeUser('Hari', 'staff', staff('developer', true));
    marketing = await makeUser('Mira', 'staff', staff('marketing'));
  });

  /** Added by `who` (dev by default) and verified by accounts. */
  const verified = async (over = {}, who = dev) => {
    const a = await who.s.add({ ...RENT, ...over });
    expect(a.status).toBe(201);
    const v = await accounts.s.post(`${BASE}/${a.body.item.id}/verify`, { rev: a.body.item.rev });
    expect(v.status).toBe(200);
    // As the person who added it sees it (the verify reply is shaped for accounts).
    return (await who.s.get(`${BASE}/${a.body.item.id}`)).body.item;
  };
  const mark = async (item, fields = PAID, who = dev, files = RECEIPT) => {
    const res = await who.s.markPaid(item.id, { rev: item.rev, ...fields }, files);
    expect(res.status).toBe(201);
    return res.body.item;
  };
  const expenses = () => PaymentRequest.find({}).lean();

  describe('marking it paid', () => {
    it('raises one expense for accounts, linked to the item and the cycle; the due date waits for approval', async () => {
      const item = await verified();
      expect(item.can.markPaid).toBe(true);
      const after = await mark(item);
      expect(after.current).toMatchObject({ state: 'waiting', amount: 50000, alreadyPaid: true, paidVia: 'bank', reference: 'UTR123456' });
      expect(after.current.expense.number).toMatch(/^PR-\d{4}$/);
      expect(after.dueDate).toBe(RENT.dueDate);
      expect(after.can.markPaid).toBe(false);

      const [e] = await expenses();
      expect(e).toMatchObject({
        kind: 'expense', status: 'submitted', team: 'developer', amount: 50000, currency: 'INR',
        category: 'subscription', reference: item.number, requestedByName: 'Dev',
      });
      expect(e.subscription).toMatchObject({ number: item.number, name: 'Office rent', cycleDueDate: RENT.dueDate, alreadyPaid: true });
      expect(e.subscription.paid).toMatchObject({ method: 'bank', reference: 'UTR123456', autoDebit: false });
      expect(String(e.subscription.cycle)).toBe(after.current.id);
      expect(e.files).toHaveLength(1);
      expect(e.files[0].kind).toBe('bill');
      expect(e.description).toMatch(/Office rent \(SD-0001\) — bill due .*: INR 50,000\. Paid by Bank transfer on .*, ref UTR123456\./);

      // Payments shows where it came from; the requester's own team sees it.
      const shown = (await dev.s.get(`${PAY}/${e._id}`)).body;
      const r = shown.request || shown.item || shown;
      expect(r.subscription).toMatchObject({ number: item.number, alreadyPaid: true });
      expect(r.categoryLabel).toBe('Subscription / due');
    });

    it('a double click raises one expense (409 for the other) and keeps one receipt', async () => {
      const item = await verified();
      const [a, b] = await Promise.all([
        dev.s.markPaid(item.id, { rev: item.rev, ...PAID }, RECEIPT),
        dev.s.markPaid(item.id, { rev: item.rev, ...PAID }, RECEIPT),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await expenses()).toHaveLength(1);
      expect((await SubscriptionDue.findById(item.id).lean()).cycles).toHaveLength(1);
      expect(stored.size).toBe(1);
    });

    it('a retry after it went through, or a stale screen, is refused and raises nothing', async () => {
      const item = await verified();
      const after = await mark(item);
      let res = await dev.s.markPaid(item.id, { rev: after.rev, ...PAID }, RECEIPT);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already marked this one paid \(PR-\d{4}\) — waiting for accounts/);
      res = await dev.s.markPaid(item.id, { rev: item.rev, ...PAID }, RECEIPT);
      expect(res.status).toBe(409);
      expect(await expenses()).toHaveLength(1);
      expect(stored.size).toBe(1);
    });

    it('a fixed bill is its amount: a different figure needs a reason; a usage-based one needs its amount and invoice', async () => {
      const item = await verified();
      let res = await dev.s.markPaid(item.id, { rev: item.rev, ...PAID, amount: 1 }, RECEIPT);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/say why INR 1 was paid/);
      res = await dev.s.markPaid(item.id, { rev: item.rev, ...PAID, amount: 51200, amountReason: 'Late fee' }, RECEIPT);
      expect(res.status).toBe(201);
      expect(res.body.item.current).toMatchObject({ amount: 51200, amountReason: 'Late fee' });
      expect((await expenses())[0].amount).toBe(51200);

      const atlas = await verified({ name: 'MongoDB Atlas', variableAmount: true, amount: 8000 });
      res = await dev.s.markPaid(atlas.id, { rev: atlas.rev, ...PAID }, RECEIPT);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/actual bill amount/);
      res = await dev.s.markPaid(atlas.id, { rev: atlas.rev, ...PAID, amount: 9100 }, []);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invoice/);
      const done = await mark(atlas, { ...PAID, amount: 9100.456 });
      expect(done.current).toMatchObject({ amount: 9100.46, estimate: 8000 });
      expect(await expenses()).toHaveLength(2);
    });

    it('a foreign bill paid already needs the rupees charged; the expense is in rupees with the bill beside it', async () => {
      const item = await verified(RAILWAY);
      let res = await dev.s.markPaid(item.id, { rev: item.rev, paidVia: 'auto_debit', paidOn: today }, []);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/rupees charged for this USD bill/);
      res = await dev.s.markPaid(item.id, { rev: item.rev, paidVia: 'auto_debit', paidOn: today, rupees: 25000 }, []);
      expect(res.status).toBe(400);
      const after = await mark(item, { paidVia: 'auto_debit', paidOn: today, rupees: 1712.5 }, dev, []);
      expect(after.current).toMatchObject({ amount: 20, currency: 'USD', rupees: 1712.5, paidVia: 'auto_debit' });
      const [e] = await expenses();
      expect(e).toMatchObject({ amount: 1712.5, currency: 'USD', foreignAmount: 20, fxRate: 85.625 });
      // Auto-debit is recorded as the item's own method (a card here).
      expect(e.subscription.paid).toMatchObject({ method: 'card', autoDebit: true });
    });

    it('refuses a paid day in the future, a missing way of paying, and a card number in the reference', async () => {
      const item = await verified();
      for (const [fields, msg] of [
        [{ ...PAID, paidOn: svc.addDays(today, 1) }, /future/],
        [{ ...PAID, paidVia: 'cash' }, /how it was paid/],
        [{ ...PAID, reference: '4111 1111 1111 1111' }, /card number/],
      ]) {
        const res = await dev.s.markPaid(item.id, { rev: item.rev, ...fields }, RECEIPT);
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(msg);
      }
      expect(await expenses()).toHaveLength(0);
      expect(stored.size).toBe(0);
    });

    it('only a verified item, and only from 3 days before the due day', async () => {
      const a = await dev.s.add(RENT);
      let res = await dev.s.markPaid(a.body.item.id, { rev: a.body.item.rev, ...PAID }, RECEIPT);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/verify/);
      const later = await verified({ dueDate: svc.addDays(today, 4) });
      expect(later.can.markPaid).toBe(false);
      res = await dev.s.markPaid(later.id, { rev: later.rev, ...PAID }, RECEIPT);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/3 days before/);
      const overdue = await verified({ dueDate: svc.addDays(today, -20) });
      expect(overdue).toMatchObject({ overdue: true });
      expect(overdue.can.markPaid).toBe(true);
      expect(await expenses()).toHaveLength(0);
    });

    it('who may mark it: the adder, the team head, the admin — not teammates, other teams or accounts', async () => {
      const item = await verified();
      expect((await dev2.s.markPaid(item.id, { rev: item.rev, ...PAID }, RECEIPT)).status).toBe(403);
      expect((await marketing.s.markPaid(item.id, { rev: item.rev, ...PAID }, RECEIPT)).status).toBe(404);
      expect((await accounts.s.markPaid(item.id, { rev: item.rev, ...PAID }, RECEIPT)).status).toBe(403);
      expect(stored.size).toBe(0);
      expect((await devHead.s.markPaid(item.id, { rev: item.rev, ...PAID }, RECEIPT)).status).toBe(201);
      const other = await verified({ name: 'Domain' });
      expect((await admin.s.markPaid(other.id, { rev: other.rev, ...PAID }, RECEIPT)).status).toBe(201);
      // Accounts may mark what accounts itself added (for any team).
      const own = await verified({ name: 'Tally', team: 'developer' }, accounts);
      expect((await accounts.s.markPaid(own.id, { rev: own.rev, ...PAID }, RECEIPT)).status).toBe(201);
    });
  });

  describe('accounts decides', () => {
    it('paid already: approving closes the expense as paid, the cycle is paid and the due date moves on', async () => {
      const item = await verified({ dueDate: today });
      const after = await mark(item);
      const id = after.current.expense.id;
      const res = await accounts.s.post(`${PAY}/${id}/approve`, { note: 'ok' });
      expect(res.status).toBe(200);
      const e = await PaymentRequest.findById(id).lean();
      expect(e.status).toBe('paid');
      expect(e.payment).toMatchObject({ method: 'bank', reference: 'UTR123456', paidByName: 'Dev' });
      expect(String(e.payment.paidBy)).toBe(String(dev.user._id));
      expect(String(e.approvedBy)).toBe(String(accounts.user._id));

      const now = (await dev.s.get(`${BASE}/${item.id}`)).body.item;
      expect(now.dueDate).toBe(svc.nextDueDate(today, 'monthly'));
      expect(now.current).toBeNull();
      expect(now.cycles.at(-1)).toMatchObject({ state: 'paid', rupees: 50000, dueDate: today });
      expect(now.history.map((h) => h.action)).toEqual(expect.arrayContaining(['marked paid', 'paid']));

      // The admin cannot pay money that already left.
      const pay = await admin.s.pay(id, { method: 'bank', reference: 'X' });
      expect(pay.status).toBe(409);
    });

    it('the admin cannot "pay" a waiting already-paid expense either', async () => {
      const item = await verified();
      const after = await mark(item);
      const res = await admin.s.pay(after.current.expense.id, { method: 'bank', reference: 'X' });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/paid already/);
      expect((await expenses())[0].status).toBe('submitted');
    });

    it('not paid yet: approved waits for the admin; the cycle is paid when the admin pays', async () => {
      const item = await verified({ dueDate: svc.addDays(today, 1) });
      const after = await mark(item, { alreadyPaid: false });
      expect(after.current).toMatchObject({ state: 'waiting', alreadyPaid: false });
      const id = after.current.expense.id;
      expect((await accounts.s.post(`${PAY}/${id}/approve`)).status).toBe(200);
      let now = (await dev.s.get(`${BASE}/${item.id}`)).body.item;
      expect(now.current).toMatchObject({ state: 'approved' });
      expect(now.dueDate).toBe(svc.addDays(today, 1));
      const pay = await admin.s.pay(id, { method: 'bank', reference: 'NEFT9' });
      expect(pay.status).toBe(200);
      now = (await dev.s.get(`${BASE}/${item.id}`)).body.item;
      expect(now.dueDate).toBe(svc.nextDueDate(svc.addDays(today, 1), 'monthly'));
      expect(now.cycles.at(-1).state).toBe('paid');
    });

    it('declined: the cycle is due again with the reason, and can be marked again (a second expense)', async () => {
      const item = await verified();
      const after = await mark(item);
      const res = await accounts.s.post(`${PAY}/${after.current.expense.id}/decline`, { note: 'Wrong UTR' });
      expect(res.status).toBe(200);
      const now = (await dev.s.get(`${BASE}/${item.id}`)).body.item;
      expect(now.current).toMatchObject({ state: 'rejected', rejectReason: 'Wrong UTR' });
      expect(now.dueDate).toBe(RENT.dueDate);
      expect(now.can.markPaid).toBe(true);
      const again = await mark(now, { ...PAID, reference: 'UTR999' });
      expect(again.current).toMatchObject({ state: 'waiting', reference: 'UTR999' });
      expect(await expenses()).toHaveLength(2);
    });

    it('cancelled by whoever marked it: due again', async () => {
      const item = await verified();
      const after = await mark(item);
      expect((await dev.s.post(`${PAY}/${after.current.expense.id}/cancel`)).status).toBe(200);
      const now = (await dev.s.get(`${BASE}/${item.id}`)).body.item;
      expect(now.current).toMatchObject({ state: 'rejected' });
      expect(now.current.rejectReason).toMatch(/cancelled by Dev/);
    });

    it('nobody approves what they marked paid themselves', async () => {
      const item = await verified({ name: 'Tally' }, accounts);
      const after = await mark(item, PAID, accounts);
      const id = after.current.expense.id;
      const shown = (await accounts.s.get(`${PAY}/${id}`)).body;
      expect((shown.request || shown.item || shown).can.approve).toBe(false);
      let res = await accounts.s.post(`${PAY}/${id}/approve`);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/marked this one paid yourself/);
      res = await accounts2.s.post(`${PAY}/${id}/approve`);
      expect(res.status).toBe(200);

      const other = await verified({ name: 'Domain' });
      const byAdmin = await mark(other, PAID, admin);
      expect((await admin.s.post(`${PAY}/${byAdmin.current.expense.id}/approve`)).status).toBe(403);
      expect((await accounts.s.post(`${PAY}/${byAdmin.current.expense.id}/approve`)).status).toBe(200);
    });

    it('a one-time purchase is paid once: the due date stays, and it cannot be marked again', async () => {
      const item = await verified({ kind: 'one_time', name: 'Laptop' });
      const after = await mark(item);
      await accounts.s.post(`${PAY}/${after.current.expense.id}/approve`);
      const now = (await dev.s.get(`${BASE}/${item.id}`)).body.item;
      expect(now.dueDate).toBe(RENT.dueDate);
      expect(now.current).toMatchObject({ state: 'paid' });
      expect(now.can.markPaid).toBe(false);
      expect((await dev.s.markPaid(item.id, { rev: now.rev, ...PAID }, RECEIPT)).status).toBe(409);
    });

    it('a step that failed half-way re-syncs when the item is opened, and settling twice changes nothing', async () => {
      const item = await verified({ dueDate: today });
      const after = await mark(item);
      // The expense moved but the item never heard (a crash between the two writes).
      await PaymentRequest.updateOne({ _id: after.current.expense.id }, { $set: { status: 'paid' } });
      const now = (await dev.s.get(`${BASE}/${item.id}`)).body.item;
      expect(now.dueDate).toBe(svc.nextDueDate(today, 'monthly'));
      expect(now.cycles.at(-1).state).toBe('paid');
      const e = await PaymentRequest.findById(after.current.expense.id).lean();
      expect(await svc.settleFromExpense(e)).toBeNull();
      expect((await SubscriptionDue.findById(item.id).lean()).dueDate).toBe(svc.nextDueDate(today, 'monthly'));
    });

    it('one expense per cycle holds in the database too', async () => {
      const item = await verified();
      await mark(item);
      const [e] = await expenses();
      const { _id, number, ...copy } = e;
      await expect(PaymentRequest.create({ ...copy, number: 'PR-9999' })).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe('monthly totals', () => {
    it('adds the paid bills in rupees per month; a team sees only its own', async () => {
      const rent = await verified({ dueDate: today });
      const rail = await verified({ ...RAILWAY, dueDate: today });
      const ads = await verified({ name: 'Ads tool', dueDate: today, amount: 3000 }, marketing);
      const r1 = await mark(rent);
      const r2 = await mark(rail, { paidVia: 'card', paidOn: today, rupees: 1700 }, dev, []);
      const r3 = await mark(ads, PAID, marketing);
      for (const x of [r1, r2, r3]) await accounts.s.post(`${PAY}/${x.current.expense.id}/approve`);
      // One more, still waiting: not counted.
      const waiting = await verified({ name: 'Domain', dueDate: today, amount: 999 });
      await mark(waiting);

      const all = (await admin.s.get(`${BASE}/monthly`)).body.months;
      expect(all).toEqual([{ month: today.slice(0, 7), bills: 3, rupees: 54700, unpriced: 0 }]);
      const mine = (await dev.s.get(`${BASE}/monthly?team=marketing`)).body.months;
      expect(mine).toEqual([{ month: today.slice(0, 7), bills: 2, rupees: 51700, unpriced: 0 }]);
    });
  });
});
