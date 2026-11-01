/**
 * The Bank transfers list's search, filters, sort and pages
 * (bankTransferService.listBankTransfers → utils/listQuery.js).
 *
 * What must hold:
 *   - a GTM lead sees only their own transfers whatever they send (?seller= and
 *     crafted queries cannot widen it); accounts, admin and the GTM head see all;
 *     other teams are refused
 *   - search finds a transfer by order number, customer, city, UTR, salesman, who
 *     recorded it, the note, or the exact amount — and every typed word must match
 *   - each filter narrows (status, salesman, paid-on / recorded-on dates, amount)
 *   - pages never repeat or skip a row under any sort, with ties and filters on
 *   - the first page says how many match and their total; a huge match is capped
 */
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));

const dbHandler = await import('./db-handler.js');
const { default: BankTransfer } = await import('../models/BankTransfer.js');
const { default: User } = await import('../models/User.js');
const bt = await import('../services/bankTransferService.js');

const oid = () => new mongoose.Types.ObjectId();
const staff = (team, extra = {}) => ({ _id: oid(), role: 'staff', name: extra.name || team, staff: { active: true, team, ...extra } });
const admin = { _id: oid(), role: 'admin' };
const accounts = staff('accounts');
const head = staff('sales', { isHead: true });
const sam = staff('sales', { name: 'Sam Lead' });
const tina = staff('sales', { name: 'Tina Lead' });
const ops = staff('operations');
const exec = staff('sales', { subRole: 'executive' });

let seq = 0;
const T0 = Date.parse('2026-10-01T06:00:00Z'); // 11:30 India time

/** A raw transfer (driver insert, so the dates are exactly what we say). */
function doc(over = {}) {
  seq += 1;
  const seller = over.seller || sam;
  const { seller: _s, createdAt, ...rest } = over;
  return {
    _id: oid(),
    order: oid(),
    orderNumber: `ORD-${String(seq).padStart(4, '0')}`,
    salesUser: seller._id,
    salesUserName: seller.name,
    customer: { name: 'Arjun Shah', city: 'Pune' },
    amount: 5000,
    reference: `UTR${String(seq).padStart(8, '0')}`,
    referenceKey: `UTR${String(seq).padStart(8, '0')}`,
    paidOn: new Date(T0 + seq * 60_000),
    note: '',
    files: [],
    status: 'pending',
    active: true,
    recordedBy: seller._id,
    recordedByName: seller.name,
    history: [],
    createdAt: createdAt ?? new Date(T0 + seq * 60_000),
    updatedAt: new Date(),
    ...rest,
  };
}
const seed = (...docs) => BankTransfer.collection.insertMany(docs);
const orders = (res) => res.transfers.map((t) => t.orderNumber);

async function all(actor, params) {
  const out = [];
  let cursor = '';
  for (let i = 0; i < 50; i += 1) {
    const res = await bt.listBankTransfers(actor, { ...params, ...(cursor ? { cursor } : {}) });
    out.push(...res.transfers);
    if (!res.nextCursor) return out;
    cursor = res.nextCursor;
  }
  throw new Error('did not end');
}

beforeAll(async () => { await dbHandler.connect(); });
afterAll(async () => { await dbHandler.closeDatabase(); });
afterEach(async () => { await BankTransfer.deleteMany({}); await User.deleteMany({}); seq = 0; });

describe('who sees what (unchanged by filters)', () => {
  beforeEach(() => seed(doc(), doc({ seller: tina }), doc({ seller: tina, customer: { name: 'Arjun Shah', city: 'Goa' } })));

  it('a lead sees only their own, even when they pick another salesman or search a shared name', async () => {
    expect(orders(await bt.listBankTransfers(sam, {}))).toEqual(['ORD-0001']);
    expect(orders(await bt.listBankTransfers(sam, { seller: String(tina._id) }))).toEqual(['ORD-0001']);
    expect(orders(await bt.listBankTransfers(sam, { q: 'Arjun' }))).toEqual(['ORD-0001']);
  });

  it('a crafted ?salesUser[$ne]= or ?seller[$ne]= cannot widen it', async () => {
    expect(orders(await bt.listBankTransfers(sam, { seller: { $ne: null }, salesUser: { $ne: null } }))).toEqual(['ORD-0001']);
  });

  it('accounts, admin and the GTM head see all, and may pick a salesman', async () => {
    for (const who of [accounts, admin, head]) {
      expect((await bt.listBankTransfers(who, {})).transfers).toHaveLength(3);
      expect(orders(await bt.listBankTransfers(who, { seller: String(tina._id) }))).toEqual(['ORD-0003', 'ORD-0002']);
    }
  });

  it('other teams, GTM executives and customers are refused', async () => {
    for (const who of [ops, exec, { _id: oid(), role: 'customer' }]) {
      await expect(bt.listBankTransfers(who, {})).rejects.toMatchObject({ statusCode: 403 });
    }
  });
});

describe('search', () => {
  beforeEach(() => seed(
    doc({ customer: { name: 'Kavya Rao', city: 'Mysuru' }, amount: 48250.5, reference: 'HDFC12345678', note: 'paid from father\'s account' }),
    doc({ seller: tina, recordedByName: 'Accounts desk' }),
    doc(),
  ));

  it.each([
    ['order number', 'ORD-0002', ['ORD-0002']],
    ['order number with #', '#ORD-0002', ['ORD-0002']],
    ['part of an order number', '0003', ['ORD-0003']],
    ['customer, any case', 'kavya', ['ORD-0001']],
    ['city', 'mysuru', ['ORD-0001']],
    ['UTR', 'hdfc1234', ['ORD-0001']],
    ['salesman', 'tina', ['ORD-0002']],
    ['who recorded it', 'desk', ['ORD-0002']],
    ['the note', 'father', ['ORD-0001']],
    ['exact amount with ₹ and commas', '₹48,250.50', ['ORD-0001']],
  ])('%s', async (_, q, expected) => {
    expect(orders(await bt.listBankTransfers(admin, { q }))).toEqual(expected);
  });

  it('every word must match', async () => {
    expect(orders(await bt.listBankTransfers(admin, { q: 'arjun pune' }))).toHaveLength(2);
    expect(orders(await bt.listBankTransfers(admin, { q: 'arjun tina' }))).toEqual(['ORD-0002']);
  });

  it('a miss is an empty list with a zero count; a regex attack is plain text', async () => {
    expect(await bt.listBankTransfers(admin, { q: 'nobody' })).toMatchObject({ transfers: [], summary: { count: 0, total: 0 } });
    expect((await bt.listBankTransfers(admin, { q: '.*' })).transfers).toEqual([]);
    expect((await bt.listBankTransfers(admin, { q: '(a+)+$' })).transfers).toEqual([]);
  });
});

describe('filters', () => {
  beforeEach(() => seed(
    doc({ amount: 1000, paidOn: new Date('2026-09-30T20:00:00Z'), createdAt: new Date('2026-10-02T05:00:00Z') }), // paid 1 Oct IST, recorded 2 Oct
    doc({ amount: 2500, status: 'confirmed', active: true, paidOn: new Date('2026-10-02T10:00:00Z'), createdAt: new Date('2026-10-03T05:00:00Z') }),
    doc({ amount: 4000, status: 'rejected', active: false, paidOn: new Date('2026-10-05T10:00:00Z'), createdAt: new Date('2026-10-05T11:00:00Z') }),
    doc({ amount: 7000, status: 'withdrawn', active: false, paidOn: new Date('2026-09-20T10:00:00Z') }),
  ));

  it('status: pending by default; each tab; all', async () => {
    expect(orders(await bt.listBankTransfers(admin, {}))).toEqual(['ORD-0001']);
    expect(orders(await bt.listBankTransfers(admin, { status: 'confirmed' }))).toEqual(['ORD-0002']);
    expect(orders(await bt.listBankTransfers(admin, { status: 'rejected' }))).toEqual(['ORD-0003']);
    expect(orders(await bt.listBankTransfers(admin, { status: 'withdrawn' }))).toEqual(['ORD-0004']);
    expect((await bt.listBankTransfers(admin, { status: 'all' })).transfers).toHaveLength(4);
  });

  it('paid on (the receipt date), India time, both days included', async () => {
    expect(orders(await bt.listBankTransfers(admin, { status: 'all', from: '2026-10-01', to: '2026-10-02' }))).toEqual(['ORD-0002', 'ORD-0001']);
  });

  it('recorded on (when GTM entered it)', async () => {
    expect(orders(await bt.listBankTransfers(admin, { status: 'all', dateOf: 'recorded', from: '2026-10-02', to: '2026-10-02' }))).toEqual(['ORD-0001']);
  });

  it('an impossible date is ignored', async () => {
    expect((await bt.listBankTransfers(admin, { status: 'all', from: '2026-02-31' })).transfers).toHaveLength(4);
  });

  it('amount range, inclusive; filters combine; the count and total follow them', async () => {
    const res = await bt.listBankTransfers(admin, { status: 'all', min: '2500', max: '4000' });
    expect(orders(res)).toEqual(['ORD-0003', 'ORD-0002']);
    expect(res.summary).toEqual({ count: 2, total: 6500, capped: false });
    expect(orders(await bt.listBankTransfers(admin, { status: 'all', min: '2500', from: '2026-10-05' }))).toEqual(['ORD-0003']);
  });
});

describe('sort', () => {
  beforeEach(() => seed(
    doc({ amount: 300, paidOn: new Date('2026-10-03T00:00:00Z') }),
    doc({ amount: 100, paidOn: new Date('2026-10-01T00:00:00Z') }),
    doc({ amount: 200, paidOn: new Date('2026-10-02T00:00:00Z') }),
  ));

  it.each([
    ['newest', ['ORD-0003', 'ORD-0002', 'ORD-0001']],
    ['oldest', ['ORD-0001', 'ORD-0002', 'ORD-0003']],
    ['amount_desc', ['ORD-0001', 'ORD-0003', 'ORD-0002']],
    ['amount_asc', ['ORD-0002', 'ORD-0003', 'ORD-0001']],
    ['paid_recent', ['ORD-0001', 'ORD-0003', 'ORD-0002']],
    ['random', ['ORD-0003', 'ORD-0002', 'ORD-0001']],
  ])('%s', async (sort, expected) => {
    expect(orders(await bt.listBankTransfers(admin, { sort }))).toEqual(expected);
  });
});

describe('pages', () => {
  beforeEach(() => seed(...Array.from({ length: 60 }, (_, i) => doc({
    amount: 100 * ((i % 7) + 1), // ties
    paidOn: new Date(T0 + (i % 5) * 1000), // ties
    seller: i % 3 === 0 ? tina : sam,
  }))));

  it.each(['newest', 'oldest', 'amount_desc', 'amount_asc', 'paid_recent'])('%s: every row exactly once, in order', async (sort) => {
    const rows = await all(admin, { sort });
    expect(rows).toHaveLength(60);
    expect(new Set(rows.map((r) => r.id)).size).toBe(60);
    const amounts = rows.map((r) => r.amount);
    if (sort === 'amount_desc') expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    if (sort === 'amount_asc') expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
    if (sort === 'paid_recent') {
      const t = rows.map((r) => new Date(r.paidOn).getTime());
      expect(t).toEqual([...t].sort((a, b) => b - a));
    }
  });

  it('with filters on: a lead pages through only their own matching rows', async () => {
    const rows = await all(sam, { min: '300', sort: 'amount_desc' });
    const expected = await BankTransfer.countDocuments({ salesUser: sam._id, amount: { $gte: 300 } });
    expect(rows.every((r) => r.salesPerson === 'Sam Lead' && r.amount >= 300)).toBe(true);
    expect(rows).toHaveLength(expected);
    expect(new Set(rows.map((r) => r.id)).size).toBe(expected);
  });

  it('25 a page; the count and total come with the first page only', async () => {
    const first = await bt.listBankTransfers(admin, {});
    expect(first.transfers).toHaveLength(25);
    expect(first.summary.count).toBe(60);
    const second = await bt.listBankTransfers(admin, { cursor: first.nextCursor });
    expect(second.transfers).toHaveLength(25);
    expect(second.summary).toBeUndefined();
  });

  it('a cursor from another sort, an old-style cursor, or junk starts from the top', async () => {
    const first = await bt.listBankTransfers(admin, { sort: 'amount_desc' });
    expect(orders(await bt.listBankTransfers(admin, { sort: 'oldest', cursor: first.nextCursor }))[0]).toBe('ORD-0001');
    const oldStyle = Buffer.from(`${new Date().toISOString()}|${oid()}`).toString('base64url');
    expect(orders(await bt.listBankTransfers(admin, { cursor: oldStyle }))[0]).toBe('ORD-0060');
    expect(orders(await bt.listBankTransfers(admin, { cursor: 'garbage' }))[0]).toBe('ORD-0060');
  });
});

describe('the count is capped', () => {
  it('over 1,000 matches: "1,000+", no total', async () => {
    await seed(...Array.from({ length: 1001 }, () => doc({ amount: 10 })));
    expect((await bt.listBankTransfers(admin, {})).summary).toEqual({ count: 1000, total: null, capped: true });
    expect((await bt.listBankTransfers(admin, { q: 'ORD-0001' })).summary.capped).toBe(false);
  });
});

describe('the "Salesman" choices', () => {
  beforeEach(() => User.collection.insertMany([
    { ...sam, email: 'sam@x.test' }, { ...tina, email: 'tina@x.test' }, { ...ops, email: 'ops@x.test' },
    { _id: oid(), role: 'staff', name: 'Gone', email: 'gone@x.test', staff: { active: false, team: 'sales' } },
  ]));

  it('accounts, admin and the GTM head get the active GTM people', async () => {
    for (const who of [accounts, admin, head]) {
      const { sellers } = await bt.transferFilterOptions(who);
      expect(sellers.map((s) => s.name).sort()).toEqual(['Sam Lead', 'Tina Lead']);
    }
  });

  it('a lead gets nobody (they see only their own); other teams are refused', async () => {
    expect(await bt.transferFilterOptions(sam)).toEqual({ sellers: [] });
    await expect(bt.transferFilterOptions(ops)).rejects.toMatchObject({ statusCode: 403 });
  });
});
