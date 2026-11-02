/**
 * Subscriptions & dues over HTTP (routes/subscriptionDues.js →
 * services/subscriptionDueService.js). Private storage and the job queue are
 * doubles; Mongo, auth, CSRF and chat are real.
 *
 * What must hold:
 *   - any active staff member adds an item for their own team; accounts / admin for any team;
 *     customers and former staff cannot
 *   - a team sees only its own items (list, one item, invoice), whatever it sends;
 *     accounts and admin see every team; the filters narrow, never widen
 *   - staff edit / delete only what they added (their team head: the team's);
 *     accounts and admin: anything
 *   - only accounts / admin verify or reject; a reject needs a reason the team sees
 *   - editing the amount, currency, due date, type or payment of a VERIFIED item
 *     puts it back to "waiting for check"; notes / link do not; editing a rejected
 *     item resubmits it
 *   - "delete" archives: gone from lists and from reads, the record and its
 *     history kept, and every step is in the history with who and when
 *   - no full card number is ever stored: card is exactly 4 digits; card-like text refused
 *   - a stale screen (old rev) or a double click changes it once (409 for the other)
 *   - pages never repeat or skip a row; soonest due first
 *   - each step is posted to #accounts and the team's space, once
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
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
const { default: ChatMessage } = await import('../models/ChatMessage.js');
const { default: ChatChannel } = await import('../models/ChatChannel.js');
const svc = await import('../services/subscriptionDueService.js');

const BASE = '/api/v1/subscription-dues';
const PW = 'SecurePass123!';
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);
const TEXT = Buffer.from('not a real invoice');

const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  const multipart = (method) => (url, fields = {}, files = []) => {
    let r = agent[method](`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    for (const f of files) r = r.attach('invoice', f.buffer, { filename: f.name, contentType: f.type });
    return r;
  };
  return {
    get: (url = '') => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url, body = {}) => agent.post(`${BASE}${url}/archive`).set('X-XSRF-TOKEN', csrf).send(body),
    add: (fields, files) => multipart('post')('', fields, files),
    edit: (id, fields, files) => multipart('put')(`/${id}`, fields, files),
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

const in30 = svc.addDays(svc.todayIst(), 30);
const RAILWAY = {
  name: 'Railway', purpose: 'Hosts the website backend', kind: 'monthly', amount: 20, currency: 'USD',
  dueDate: in30, payment: { method: 'card', cardLast4: '4007', autoDebit: true },
  billingUrl: 'https://railway.com/account/billing', notes: 'Card needs international payments on',
};

describe('Subscriptions & dues', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); await dbHandler.clearDatabase(); });

  let admin, accounts, dev, dev2, devHead, marketing, customer, former;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    dev = await makeUser('Dev', 'staff', staff('developer'));
    dev2 = await makeUser('Dina', 'staff', staff('developer'));
    devHead = await makeUser('Hari', 'staff', staff('developer', true));
    marketing = await makeUser('Mira', 'staff', staff('marketing'));
    customer = await makeUser('Cust', 'customer');
    former = await makeUser('Fred', 'staff', staff('developer', false, false));
  });

  const add = async (who = dev, over = {}, files) => {
    const res = await who.s.add({ ...RAILWAY, ...over }, files);
    expect(res.status).toBe(201);
    return res.body.item;
  };

  describe('adding', () => {
    it('a staff member adds one for their own team; it waits for check, numbered, with no rupees stored', async () => {
      const res = await dev.s.add({ ...RAILWAY, team: 'marketing' }, [{ buffer: PDF, name: 'nov.pdf', type: 'application/pdf' }]);
      expect(res.status).toBe(201);
      expect(res.body.item).toMatchObject({
        number: 'SD-0001', name: 'Railway', team: 'developer', status: 'pending', statusLabel: 'Waiting for check',
        kind: 'monthly', amount: 20, currency: 'USD', dueDate: in30, overdue: false, dueInDays: 30,
        payment: { method: 'card', cardLast4: '4007', autoDebit: true }, addedByName: 'Dev',
      });
      // The rupee figure is a rough label worked out on read, never a stored field.
      expect(res.body.item.approxInr).toBeGreaterThan(0);
      const raw = await SubscriptionDue.findById(res.body.item.id).lean();
      expect(raw).not.toHaveProperty('approxInr');
      expect(raw.history).toEqual([expect.objectContaining({ action: 'added', byName: 'Dev', role: 'developer' })]);
      expect([...stored.keys()][0]).toMatch(/^subscription-dues\//);
    });

    it('accounts and admin add for any team; admin must say which', async () => {
      expect((await add(accounts, { team: 'marketing' })).team).toBe('marketing');
      expect((await add(admin, { team: 'developer' })).team).toBe('developer');
      expect((await admin.s.add(RAILWAY)).status).toBe(400);
    });

    it('customers and former staff cannot add or list', async () => {
      expect((await customer.s.add(RAILWAY)).status).toBe(403);
      expect((await former.s.add(RAILWAY)).status).toBe(403);
      expect((await former.s.get()).status).toBe(403);
    });

    it.each([
      ['no name', { name: '' }, /name/],
      ['zero amount', { amount: 0 }, /amount/],
      ['negative amount', { amount: -5 }, /amount/],
      ['unknown currency', { currency: 'XYZ' }, /currency/],
      ['no due date', { dueDate: '' }, /due date/],
      ['impossible date', { dueDate: '2026-02-30' }, /due date/],
      ['far-off year', { dueDate: '2099-01-01' }, /year/],
      ['unknown type', { kind: 'weekly' }, /type/],
      ['http link', { billingUrl: 'http://railway.com/billing' }, /https/],
      ['not a link', { billingUrl: 'railway billing' }, /https/],
      ['no payment method', { payment: {} }, /how it is paid/],
    ])('refuses %s', async (_, over, message) => {
      const res = await dev.s.add({ ...RAILWAY, ...over });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(message);
      expect(await SubscriptionDue.countDocuments()).toBe(0);
    });

    it('refuses a file that is not a photo or PDF, and stores nothing', async () => {
      const res = await dev.s.add(RAILWAY, [{ buffer: TEXT, name: 'x.pdf', type: 'application/pdf' }]);
      expect(res.status).toBe(400);
      expect(stored.size).toBe(0);
      expect(await SubscriptionDue.countDocuments()).toBe(0);
    });
  });

  describe('no card numbers are stored', () => {
    it.each([
      ['5 digits', '40071'],
      ['the full number', '4111111111111111'],
      ['3 digits', '400'],
      ['letters', 'abcd'],
    ])('the card box refuses %s', async (_, cardLast4) => {
      const res = await dev.s.add({ ...RAILWAY, payment: { method: 'card', cardLast4 } });
      expect(res.status).toBe(400);
      expect(await SubscriptionDue.countDocuments()).toBe(0);
    });

    it.each([
      ['notes', { notes: 'card is 4111 1111 1111 1111 exp 12/28' }],
      ['what for', { purpose: 'paid with 4111-1111-1111-1111' }],
      ['name', { name: 'Railway 4111111111111111' }],
    ])('refuses a card number typed in %s', async (_, over) => {
      const res = await dev.s.add({ ...RAILWAY, ...over });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/card number/);
      expect(await SubscriptionDue.countDocuments()).toBe(0);
    });

    it('a card number in a non-card payment is refused too, and a non-card payment keeps no digits', async () => {
      expect((await dev.s.add({ ...RAILWAY, payment: { method: 'upi', cardLast4: '4111111111111111' } })).status).toBe(400);
      const item = await add(dev, { payment: { method: 'upi', cardLast4: '4007' } });
      expect(item.payment.cardLast4).toBe('');
    });

    it('ordinary long numbers (a phone number, an order number) are allowed', async () => {
      const item = await add(dev, { notes: 'Call +91 98765 43210, order 1234567890123' });
      expect(item.notes).toContain('98765');
    });

    it('nothing stored anywhere holds a 12+ digit run', async () => {
      await add(dev);
      const raw = JSON.stringify(await SubscriptionDue.find().lean());
      expect(raw).not.toMatch(/\d{12,}/);
    });
  });

  describe('who sees what', () => {
    let devItem, mktItem;
    beforeEach(async () => {
      devItem = await add(dev, {}, [{ buffer: PDF, name: 'nov.pdf', type: 'application/pdf' }]);
      mktItem = await add(marketing, { name: 'Canva' });
    });

    it('a team sees only its own, whatever it asks for', async () => {
      const names = async (who, q = '') => (await who.s.get(q)).body.items.map((x) => x.name);
      expect(await names(dev)).toEqual(['Railway']);
      expect(await names(dev, '?team=marketing')).toEqual(['Railway']);
      expect(await names(dev, '?q=canva')).toEqual([]);
      expect(await names(dev, '?team[$ne]=x')).toEqual(['Railway']);
      expect(await names(marketing)).toEqual(['Canva']);
    });

    it('another team cannot open, edit, delete, or download from an item (404, as if absent)', async () => {
      expect((await marketing.s.get(`/${devItem.id}`)).status).toBe(404);
      expect((await marketing.s.get(`/${devItem.id}/files/${devItem.files[0].id}`)).status).toBe(404);
      expect((await marketing.s.edit(devItem.id, { notes: 'x', rev: devItem.rev })).status).toBe(404);
      expect((await marketing.s.del(`/${devItem.id}`, { rev: devItem.rev })).status).toBe(404);
    });

    it('accounts and admin see every team in one list, and may pick one', async () => {
      expect((await accounts.s.get()).body.items).toHaveLength(2);
      expect((await admin.s.get()).body.items).toHaveLength(2);
      expect((await accounts.s.get('?team=marketing')).body.items.map((x) => x.name)).toEqual(['Canva']);
      expect((await accounts.s.get('?team=nonsense')).body.items).toHaveLength(2);
      expect((await accounts.s.get(`/${devItem.id}/files/${devItem.files[0].id}`)).status).toBe(200);
    });
  });

  describe('editing and deleting', () => {
    it('staff edit and delete only what they added; their team head and accounts / admin may too', async () => {
      const item = await add(dev);
      const res = await dev2.s.edit(item.id, { notes: 'mine now', rev: item.rev });
      expect(res.status).toBe(403);
      expect((await dev2.s.del(`/${item.id}`, { rev: item.rev })).status).toBe(403);
      expect((await dev2.s.get(`/${item.id}`)).body.item.can).toMatchObject({ edit: false, delete: false, verify: false });

      let r = await devHead.s.edit(item.id, { notes: 'head fixed it', rev: item.rev });
      expect(r.status).toBe(200);
      r = await accounts.s.edit(item.id, { notes: 'accounts note', rev: r.body.item.rev });
      expect(r.status).toBe(200);
      r = await admin.s.edit(item.id, { notes: 'admin note', rev: r.body.item.rev });
      expect(r.status).toBe(200);
      r = await dev.s.edit(item.id, { notes: 'owner note', rev: r.body.item.rev });
      expect(r.status).toBe(200);
      expect(r.body.item.notes).toBe('owner note');
    });

    it('staff cannot move an item to another team; accounts can', async () => {
      const item = await add(dev);
      const r = await dev.s.edit(item.id, { team: 'marketing', notes: 'x', rev: item.rev });
      expect(r.body.item.team).toBe('developer');
      const r2 = await accounts.s.edit(item.id, { team: 'marketing', rev: r.body.item.rev });
      expect(r2.body.item.team).toBe('marketing');
    });

    it('editing what accounts checked puts a verified item back to waiting; notes and link do not', async () => {
      const item = await add(dev);
      let v = (await accounts.s.post(`/${item.id}/verify`, { rev: item.rev })).body.item;
      expect(v.status).toBe('verified');
      expect(v.verifiedByName).toBe('Anu');

      v = (await dev.s.edit(item.id, { notes: 'new note', billingUrl: 'https://railway.com/x', rev: v.rev })).body.item;
      expect(v.status).toBe('verified');

      // Saving the same values again is not a change.
      v = (await dev.s.edit(item.id, { amount: 20, currency: 'USD', dueDate: in30, rev: v.rev })).body.item;
      expect(v.status).toBe('verified');

      for (const change of [
        { amount: 25 },
        { currency: 'EUR' },
        { dueDate: svc.addDays(in30, 3) },
        { kind: 'yearly' },
        { payment: { method: 'card', cardLast4: '1234', autoDebit: true } },
        { payment: { method: 'card', cardLast4: '4007', autoDebit: false } },
        { payment: { method: 'bank_transfer' } },
      ]) {
        const fresh = (await accounts.s.get(`/${item.id}`)).body.item;
        if (fresh.status !== 'verified') {
          const again = await accounts.s.post(`/${item.id}/verify`, { rev: fresh.rev });
          expect(again.status).toBe(200);
        }
        const before = (await accounts.s.get(`/${item.id}`)).body.item;
        const res = await dev.s.edit(item.id, { ...change, rev: before.rev });
        expect(res.status).toBe(200);
        expect([JSON.stringify(change), res.body.item]).toEqual([JSON.stringify(change), expect.objectContaining({ status: 'pending', verifiedByName: '' })]);
      }
      const history = (await accounts.s.get(`/${item.id}`)).body.item.history;
      expect(history.filter((h) => h.action === 'edited' && /back to waiting for check/.test(h.note))).toHaveLength(7);
      expect(history.find((h) => /amount USD 20 → USD 25/.test(h.note))).toBeTruthy();
    });

    it('a rejected item: the team sees the reason, fixes it, and it comes back for check', async () => {
      const item = await add(dev);
      expect((await accounts.s.post(`/${item.id}/reject`, { reason: '' })).status).toBe(400);
      const rej = await accounts.s.post(`/${item.id}/reject`, { reason: 'It is $25 now', rev: item.rev });
      expect(rej.status).toBe(200);
      const seen = (await dev.s.get(`/${item.id}`)).body.item;
      expect(seen).toMatchObject({ status: 'rejected', statusLabel: 'Rejected', rejectReason: 'It is $25 now' });
      const fixed = (await dev.s.edit(item.id, { amount: 25, rev: seen.rev })).body.item;
      expect(fixed).toMatchObject({ status: 'pending', rejectReason: '' });
    });

    it('delete archives: gone from lists and reads, the record and its history kept', async () => {
      const item = await add(dev);
      const v = (await accounts.s.post(`/${item.id}/verify`, { rev: item.rev })).body.item;
      const res = await dev.s.del(`/${item.id}`, { rev: v.rev, reason: 'Moved to another host' });
      expect(res.status).toBe(200);
      expect((await dev.s.get()).body.items).toEqual([]);
      expect((await accounts.s.get()).body.items).toEqual([]);
      expect((await dev.s.get(`/${item.id}`)).status).toBe(404);
      expect((await dev.s.edit(item.id, { notes: 'x' })).status).toBe(404);
      expect((await accounts.s.post(`/${item.id}/verify`)).status).toBe(404);
      expect((await dev.s.del(`/${item.id}`)).status).toBe(404);

      const raw = await SubscriptionDue.findById(item.id).lean();
      expect(raw).toMatchObject({ archived: true, archivedByName: 'Dev', name: 'Railway', amount: 20 });
      expect(raw.history.map((h) => [h.action, h.byName])).toEqual([
        ['added', 'Dev'], ['verified', 'Anu'], ['archived', 'Dev'],
      ]);
      expect(raw.history.at(-1).note).toBe('Moved to another host');
      expect(raw.history.every((h) => h.at instanceof Date)).toBe(true);
    });

    it('invoices can be added and removed on edit; a removed one is no longer stored', async () => {
      const item = await add(dev, {}, [{ buffer: PDF, name: 'oct.pdf', type: 'application/pdf' }]);
      const r = await dev.s.edit(item.id, { rev: item.rev, removeFileIds: [item.files[0].id] }, [{ buffer: PDF, name: 'nov.pdf', type: 'application/pdf' }]);
      expect(r.status).toBe(200);
      expect(r.body.item.files.map((f) => f.name)).toEqual(['nov.pdf']);
      expect(stored.size).toBe(1);
    });
  });

  describe('once only', () => {
    it('a stale screen cannot overwrite a newer change (409), and stores no file', async () => {
      const item = await add(dev);
      expect((await dev.s.edit(item.id, { notes: 'first', rev: item.rev })).status).toBe(200);
      const stale = await accounts.s.edit(item.id, { notes: 'second', rev: item.rev }, [{ buffer: PDF, name: 'x.pdf', type: 'application/pdf' }]);
      expect(stale.status).toBe(409);
      expect(stored.size).toBe(0);
      expect((await dev.s.get(`/${item.id}`)).body.item.notes).toBe('first');
    });

    it('two verify clicks at once verify it once', async () => {
      const item = await add(dev);
      const results = await Promise.all([
        accounts.s.post(`/${item.id}/verify`, { rev: item.rev }),
        admin.s.post(`/${item.id}/verify`, { rev: item.rev }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const raw = await SubscriptionDue.findById(item.id).lean();
      expect(raw.history.filter((h) => h.action === 'verified')).toHaveLength(1);
    });

    it('only accounts / admin verify or reject', async () => {
      const item = await add(dev);
      expect((await dev.s.post(`/${item.id}/verify`, { rev: item.rev })).status).toBe(403);
      expect((await devHead.s.post(`/${item.id}/reject`, { reason: 'no', rev: item.rev })).status).toBe(403);
      expect((await dev.s.get(`/${item.id}`)).body.item.status).toBe('pending');
    });
  });

  describe('the list', () => {
    const today = svc.todayIst();
    beforeEach(async () => {
      const base = { team: 'developer', kind: 'monthly', amount: 10, currency: 'USD', payment: { method: 'upi' }, addedBy: dev.user._id, addedByName: 'Dev', history: [] };
      await SubscriptionDue.insertMany([
        { ...base, number: 'SD-0101', name: 'Overdue tool', dueDate: svc.addDays(today, -3), status: 'verified' },
        { ...base, number: 'SD-0102', name: 'Today tool', dueDate: today, status: 'pending' },
        { ...base, number: 'SD-0103', name: 'Week tool', dueDate: svc.addDays(today, 7), status: 'pending' },
        { ...base, number: 'SD-0104', name: 'Later tool', dueDate: svc.addDays(today, 8), status: 'rejected', rejectReason: 'x' },
        { ...base, number: 'SD-0105', name: 'Archived tool', dueDate: today, archived: true },
        { ...base, number: 'SD-0106', name: 'Marketing tool', dueDate: today, team: 'marketing' },
      ]);
    });
    const names = async (who, q = '') => (await who.s.get(q)).body.items.map((x) => x.name);

    it('soonest due first; archived never shown; overdue flagged', async () => {
      const res = await accounts.s.get();
      expect(res.body.items.map((x) => x.name)).toEqual(['Overdue tool', 'Today tool', 'Marketing tool', 'Week tool', 'Later tool']);
      expect(res.body.items[0]).toMatchObject({ overdue: true, dueInDays: -3 });
      expect(res.body.summary).toMatchObject({ count: 5 });
    });

    it('filters: due in 7 days, overdue, waiting for check, team — and they combine', async () => {
      expect(await names(accounts, '?due=week')).toEqual(['Today tool', 'Marketing tool', 'Week tool']);
      expect(await names(accounts, '?due=overdue')).toEqual(['Overdue tool']);
      expect(await names(accounts, '?status=pending')).toEqual(['Today tool', 'Marketing tool', 'Week tool']);
      expect(await names(accounts, '?status=pending&team=developer&due=week')).toEqual(['Today tool', 'Week tool']);
      expect(await names(dev, '?status=pending&team=marketing')).toEqual(['Today tool', 'Week tool']);
      expect(await names(accounts, '?q=week')).toEqual(['Week tool']);
      expect(await names(accounts, '?due=nonsense')).toHaveLength(5);
    });

    it('an empty list is an empty page, not an error', async () => {
      await SubscriptionDue.deleteMany({});
      const res = await dev.s.get();
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ items: [], nextCursor: null });
    });

    it('pages never repeat or skip a row, ties on the same day included', async () => {
      const base = { team: 'developer', kind: 'monthly', amount: 10, currency: 'USD', payment: { method: 'upi' }, addedBy: dev.user._id, addedByName: 'Dev', history: [] };
      await SubscriptionDue.insertMany(Array.from({ length: 60 }, (_, i) => ({
        ...base, number: `SD-${2000 + i}`, name: `Bulk ${i}`, dueDate: svc.addDays(today, i % 4),
      })));
      const seen = [];
      let cursor = '';
      for (let i = 0; i < 10; i += 1) {
        const res = await dev.s.get(cursor ? `?cursor=${cursor}` : '');
        expect(res.body.items.length).toBeLessThanOrEqual(25);
        seen.push(...res.body.items.map((x) => x.number));
        if (!res.body.nextCursor) break;
        cursor = res.body.nextCursor;
      }
      expect(seen).toHaveLength(64);
      expect(new Set(seen).size).toBe(64);
    });
  });

  describe('chat', () => {
    const posts = async (space) => {
      const channel = await ChatChannel.findOne({ key: space }).lean();
      return channel ? ChatMessage.find({ channel: channel._id, kind: 'system' }).sort({ createdAt: 1 }).lean() : [];
    };

    it('adding, verifying and rejecting are posted to #accounts and the team space, threaded per item', async () => {
      const item = await add(dev);
      await accounts.s.post(`/${item.id}/verify`, { rev: item.rev });
      const v = (await dev.s.get(`/${item.id}`)).body.item;
      await accounts.s.post(`/${item.id}/reject`, { reason: 'Wrong card', rev: v.rev });
      const acc = await posts('team:accounts');
      expect(acc.map((m) => m.text)).toEqual([
        expect.stringMatching(/New subscription to check: Railway \(SD-0001\) — USD 20\/month, due .*auto-debit, card 4007/),
        expect.stringMatching(/Accounts verified Railway/),
        expect.stringMatching(/Accounts rejected Railway \(SD-0001\): “Wrong card”/),
      ]);
      // The person who added it is @mentioned where they can read it: their team's space.
      const team = await posts('team:developer');
      expect(team).toHaveLength(3);
      expect(team.at(-1).mentions.map(String)).toEqual([String(dev.user._id)]);
    });

    it('a plain note edit posts nothing; a recheck does', async () => {
      const item = await add(dev);
      const v = (await accounts.s.post(`/${item.id}/verify`, { rev: item.rev })).body.item;
      const e = (await dev.s.edit(item.id, { notes: 'x', rev: v.rev })).body.item;
      expect(await posts('team:accounts')).toHaveLength(2);
      await dev.s.edit(item.id, { amount: 30, rev: e.rev });
      expect((await posts('team:accounts')).at(-1).text).toMatch(/amount USD 20 → USD 30.*Back to waiting for check/);
    });
  });
});

describe('subscriptionDueService helpers', () => {
  it('today in India rolls over at midnight IST, not UTC', () => {
    expect(svc.todayIst(new Date('2026-12-01T18:29:00Z'))).toBe('2026-12-01');
    expect(svc.todayIst(new Date('2026-12-01T18:31:00Z'))).toBe('2026-12-02');
  });
  it('adds calendar days across months and years', () => {
    expect(svc.addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(svc.addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('explains a payment the way people say it', () => {
    expect(svc._test.howPaid({ method: 'card', cardLast4: '4007', autoDebit: true })).toBe('auto-debit, card 4007');
    expect(svc._test.howPaid({ method: 'bank_transfer' })).toBe('bank transfer');
    expect(svc._test.howPaid({ method: 'upi', autoDebit: true })).toBe('auto-debit, UPI');
  });
  it('a stale or malformed id is a 404, not a crash', async () => {
    const someone = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
    await expect(svc.getOne(someone, 'nope')).rejects.toMatchObject({ statusCode: 404 });
  });
});
