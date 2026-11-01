/**
 * The Payments list's search, filters, sort and pages
 * (paymentRequestService.list → utils/listQuery.js).
 *
 * What must hold:
 *   - a team sees only its own requests, whatever filters it sends (no widening
 *     through ?team=, ?by= or a crafted query); admin and accounts see all
 *   - search finds a request by PR number, payee / supplier, UPI, exact amount,
 *     UTR / reference, order number, who raised it, description, item, customer —
 *     and every typed word must match
 *   - each filter narrows; each sort orders; "recently paid" only on the paid list
 *   - pages never repeat or skip a row, under any sort and with filters on,
 *     including ties (equal amounts); a cursor from another sort starts over
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
const { default: PaymentRequest } = await import('../models/PaymentRequest.js');
const { default: User } = await import('../models/User.js');
const pr = await import('../services/paymentRequestService.js');

const oid = () => new mongoose.Types.ObjectId();
const admin = { _id: oid(), role: 'admin' };
const accounts = { _id: oid(), role: 'staff', staff: { active: true, team: 'accounts' } };
const marketing = { _id: oid(), role: 'staff', staff: { active: true, team: 'marketing' } };
const procurement = { _id: oid(), role: 'staff', staff: { active: true, team: 'procurement' } };
const customer = { _id: oid(), role: 'customer' };
const leftStaff = { _id: oid(), role: 'staff', staff: { active: false, team: 'marketing' } };

const ravi = oid();
const meera = oid();
let seq = 0;
const T0 = Date.parse('2026-10-01T06:00:00Z'); // 11:30 India time

/** A raw request (driver insert, so createdAt is exactly what we say). */
function doc(over = {}) {
  seq += 1;
  const { createdAt, payment, ...rest } = over;
  return {
    _id: oid(),
    number: `PR-${String(seq).padStart(4, '0')}`,
    kind: 'expense',
    status: 'submitted',
    team: 'marketing',
    requestedBy: ravi,
    requestedByName: 'Ravi Kumar',
    amount: 1000,
    category: 'fuel',
    description: '',
    payee: { name: 'Indian Oil', method: 'upi', upiId: 'ioc@upi' },
    order: null,
    orderNumber: '',
    itemNames: [],
    customer: { name: '', phone: '', city: '' },
    files: [],
    history: [],
    payment: payment ? { method: 'bank', reference: '', paidAt: null, transactionAt: null, ...payment } : { reference: '', paidAt: null, transactionAt: null },
    createdAt: createdAt ?? new Date(T0 + seq * 60_000),
    updatedAt: new Date(),
    ...rest,
  };
}
const seed = (...docs) => PaymentRequest.collection.insertMany(docs);
const numbers = (res) => res.requests.map((r) => r.number);

/** Every row, page after page. */
async function all(actor, params) {
  const out = [];
  let cursor = '';
  for (let i = 0; i < 50; i += 1) {
    const res = await pr.list(actor, { ...params, ...(cursor ? { cursor } : {}) });
    out.push(...res.requests);
    if (!res.nextCursor) return out;
    cursor = res.nextCursor;
  }
  throw new Error('did not end');
}

beforeAll(async () => { await dbHandler.connect(); });
afterAll(async () => { await dbHandler.closeDatabase(); });
afterEach(async () => { await PaymentRequest.deleteMany({}); await User.deleteMany({}); seq = 0; });

describe('who sees what (unchanged by filters)', () => {
  beforeEach(() => seed(
    doc({ team: 'marketing', payee: { name: 'Shared Name', method: 'upi' } }),
    doc({ team: 'procurement', kind: 'supplier', category: 'supplier', payee: { name: 'Shared Name', method: 'bank' } }),
  ));

  it('a team sees only its own, even when it asks for another team or searches a shared name', async () => {
    expect(numbers(await pr.list(marketing, {}))).toEqual(['PR-0001']);
    expect(numbers(await pr.list(marketing, { team: 'procurement' }))).toEqual(['PR-0001']);
    expect(numbers(await pr.list(marketing, { q: 'shared' }))).toEqual(['PR-0001']);
    expect(numbers(await pr.list(procurement, { q: 'shared', kind: 'supplier' }))).toEqual(['PR-0002']);
  });

  it('a crafted ?team[$ne]= cannot widen it either', async () => {
    expect(numbers(await pr.list(marketing, { team: { $ne: 'x' } }))).toEqual(['PR-0001']);
  });

  it('admin and accounts see every team, and may pick one', async () => {
    expect(numbers(await pr.list(admin, {}))).toHaveLength(2);
    expect(numbers(await pr.list(accounts, { team: 'procurement' }))).toEqual(['PR-0002']);
    expect(numbers(await pr.list(accounts, { team: 'nonsense' }))).toHaveLength(2);
  });

  it('customers and former staff are refused', async () => {
    await expect(pr.list(customer, {})).rejects.toMatchObject({ statusCode: 403 });
    await expect(pr.list(leftStaff, {})).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('search', () => {
  beforeEach(() => seed(
    doc({ amount: 4500, description: 'Fuel for Kochi delivery', payee: { name: 'HP Petrol Pump', method: 'upi', upiId: 'hp.kochi@okaxis' } }),
    doc({
      kind: 'supplier', team: 'procurement', category: 'supplier', amount: 12000,
      payee: { name: 'Bosch Distributor', method: 'bank' }, orderNumber: 'A1B2C3D4',
      itemNames: ['Bosch Wiper Blade'], customer: { name: 'Anil Thomas', phone: '9847012345', city: 'Thrissur' },
      requestedBy: meera, requestedByName: 'Meera Nair',
    }),
    doc({ status: 'paid', amount: 760, category: 'food', payee: { name: 'Hotel Saravana', method: 'upi' }, payment: { reference: 'UTR998877', paidAt: new Date(T0) } }),
    doc({ amount: 45000, description: 'Price (approx.) for stand', category: 'purchase', payee: { name: 'Display Co', method: 'bank' } }),
  ));

  it.each([
    ['PR number', 'PR-0002', ['PR-0002']],
    ['PR number with #', '#pr-0003', ['PR-0003']],
    ['payee / supplier name', 'bosch', ['PR-0002']],
    ['UPI id', 'okaxis', ['PR-0001']],
    ['exact amount', '4500', ['PR-0001']],
    ['amount with comma and ₹', '₹12,000', ['PR-0002']],
    ['UTR / reference', 'utr9988', ['PR-0003']],
    ['order number', 'a1b2c3', ['PR-0002']],
    ['who raised it', 'meera', ['PR-0002']],
    ['description', 'kochi delivery', ['PR-0001']],
    ['item name', 'wiper', ['PR-0002']],
    ['customer phone', '98470', ['PR-0002']],
    ['customer city', 'thrissur', ['PR-0002']],
    ['expense category', 'food', ['PR-0003']],
    ['brackets and dots matched literally', '(approx.)', ['PR-0004']],
  ])('finds by %s', async (_, q, expected) => {
    expect(numbers(await pr.list(admin, { q }))).toEqual(expected);
  });

  it('every word must match (more words → fewer rows)', async () => {
    expect(numbers(await pr.list(admin, { q: 'kochi' }))).toEqual(['PR-0001']);
    expect(numbers(await pr.list(admin, { q: 'kochi bosch' }))).toEqual([]);
  });

  it('a miss is an empty list with a zero count', async () => {
    const res = await pr.list(admin, { q: 'nobody-has-this' });
    expect(res.requests).toEqual([]);
    expect(res.summary).toEqual({ count: 0, total: 0, capped: false });
  });

  it('a regex attack is plain text', async () => {
    expect(numbers(await pr.list(admin, { q: '.*' }))).toEqual([]);
    expect(numbers(await pr.list(admin, { q: '(a+)+$' }))).toEqual([]);
  });
});

describe('filters', () => {
  const at = (ymdHm) => new Date(`${ymdHm}:00+05:30`);
  beforeEach(() => seed(
    doc({ status: 'submitted', category: 'fuel', amount: 500, createdAt: at('2026-09-30T23:59') }),
    doc({ status: 'approved', category: 'travel', amount: 1500, requestedBy: meera, requestedByName: 'Meera', createdAt: at('2026-10-01T00:00') }),
    doc({ status: 'on_hold', kind: 'supplier', team: 'procurement', category: 'supplier', amount: 9000, createdAt: at('2026-10-15T10:00') }),
    doc({ status: 'paid', amount: 2500, createdAt: at('2026-10-02T10:00'), payment: { method: 'upi', paidAt: at('2026-10-31T23:00'), transactionAt: at('2026-11-01T00:10') } }),
    doc({ status: 'paid', amount: 3000, createdAt: at('2026-10-03T10:00'), payment: { method: 'bank', paidAt: at('2026-10-20T12:00'), transactionAt: null } }),
    doc({ status: 'declined', amount: 700, createdAt: at('2026-10-31T23:59') }),
    doc({ status: 'cancelled', amount: 800, createdAt: at('2026-11-01T00:00') }),
  ));

  it.each([
    ['to_approve', ['PR-0001']],
    ['to_pay', ['PR-0003', 'PR-0002']],
    ['open', ['PR-0003', 'PR-0002', 'PR-0001']],
    ['on_hold', ['PR-0003']],
    ['paid', ['PR-0005', 'PR-0004']],
    ['declined', ['PR-0006']],
    ['cancelled', ['PR-0007']],
  ])('status %s', async (status, expected) => {
    expect(numbers(await pr.list(admin, { status }))).toEqual(expected);
  });

  it('an unknown status shows everything (a stale link still opens)', async () => {
    expect(numbers(await pr.list(admin, { status: 'nope' }))).toHaveLength(7);
  });

  it('type, category, raised-by and paid-by', async () => {
    expect(numbers(await pr.list(admin, { kind: 'supplier' }))).toEqual(['PR-0003']);
    expect(numbers(await pr.list(admin, { kind: 'expense' }))).toHaveLength(6);
    expect(numbers(await pr.list(admin, { category: 'travel' }))).toEqual(['PR-0002']);
    expect(numbers(await pr.list(admin, { by: String(meera) }))).toEqual(['PR-0002']);
    expect(numbers(await pr.list(admin, { by: 'not-an-id' }))).toHaveLength(7);
    expect(numbers(await pr.list(admin, { method: 'upi' }))).toEqual(['PR-0004']);
    expect(numbers(await pr.list(admin, { method: 'bank', status: 'paid' }))).toEqual(['PR-0005']);
  });

  it('raised between two India-time days, both included', async () => {
    // 30 Sep 23:59 and 1 Nov 00:00 fall outside October; 1 Oct 00:00 and 31 Oct 23:59 inside.
    const oct = numbers(await pr.list(admin, { from: '2026-10-01', to: '2026-10-31' }));
    expect(oct).toEqual(['PR-0006', 'PR-0003', 'PR-0005', 'PR-0004', 'PR-0002']);
    expect(numbers(await pr.list(admin, { from: '2026-11-01' }))).toEqual(['PR-0007']);
    expect(numbers(await pr.list(admin, { to: '2026-09-30' }))).toEqual(['PR-0001']);
  });

  it('paid between: the transaction time, else when it was recorded', async () => {
    // PR-0004 was recorded 31 Oct but the money went 1 Nov; PR-0005 has only a recorded time.
    expect(numbers(await pr.list(admin, { dateOf: 'paid', from: '2026-10-01', to: '2026-10-31' }))).toEqual(['PR-0005']);
    expect(numbers(await pr.list(admin, { dateOf: 'paid', from: '2026-11-01', to: '2026-11-01' }))).toEqual(['PR-0004']);
  });

  it('amount range, inclusive', async () => {
    expect(numbers(await pr.list(admin, { min: '1500', max: '3000' }))).toEqual(['PR-0005', 'PR-0004', 'PR-0002']);
    expect(numbers(await pr.list(admin, { min: '5000' }))).toEqual(['PR-0003']);
    expect(numbers(await pr.list(admin, { max: '500' }))).toEqual(['PR-0001']);
  });

  it('filters combine', async () => {
    expect(numbers(await pr.list(accounts, { status: 'paid', method: 'bank', from: '2026-10-01', to: '2026-10-31', min: '1000' })))
      .toEqual(['PR-0005']);
  });

  it('the count and total follow the filters', async () => {
    expect((await pr.list(admin, { status: 'paid' })).summary).toEqual({ count: 2, total: 5500, capped: false });
    expect((await pr.list(marketing, {})).summary).toEqual({ count: 6, total: 9000, capped: false });
  });
});

describe('sort', () => {
  beforeEach(() => seed(
    doc({ amount: 300, status: 'paid', payment: { paidAt: new Date(T0 + 5e6) } }),
    doc({ amount: 900, status: 'paid', payment: { paidAt: new Date(T0 + 1e6) } }),
    doc({ amount: 100 }),
    doc({ amount: 600, status: 'paid', payment: { paidAt: new Date(T0 + 9e6) } }),
  ));

  it.each([
    ['newest', ['PR-0004', 'PR-0003', 'PR-0002', 'PR-0001']],
    ['oldest', ['PR-0001', 'PR-0002', 'PR-0003', 'PR-0004']],
    ['amount_desc', ['PR-0002', 'PR-0004', 'PR-0001', 'PR-0003']],
    ['amount_asc', ['PR-0003', 'PR-0001', 'PR-0004', 'PR-0002']],
  ])('%s', async (sort, expected) => {
    const res = await pr.list(admin, { sort });
    expect(numbers(res)).toEqual(expected);
    expect(res.sort).toBe(sort);
  });

  it('recently paid, on the paid list', async () => {
    expect(numbers(await pr.list(admin, { status: 'paid', sort: 'paid_recent' }))).toEqual(['PR-0004', 'PR-0001', 'PR-0002']);
  });

  it('recently paid anywhere else falls back to newest', async () => {
    const res = await pr.list(admin, { sort: 'paid_recent' });
    expect(res.sort).toBe('newest');
    expect(numbers(res)[0]).toBe('PR-0004');
  });

  it('an unknown sort is newest', async () => {
    expect((await pr.list(admin, { sort: 'random' })).sort).toBe('newest');
  });
});

describe('pages', () => {
  // 60 rows: amounts repeat (ties) so the _id tie-breaker is exercised.
  beforeEach(() => seed(...Array.from({ length: 60 }, (_, i) => doc({
    amount: 100 * ((i % 7) + 1),
    team: i % 3 === 0 ? 'procurement' : 'marketing',
    status: i % 4 === 0 ? 'paid' : 'submitted',
    payment: i % 4 === 0 ? { paidAt: new Date(T0 + (i % 5) * 1000) } : undefined, // paidAt ties too
  }))));

  it.each(['newest', 'oldest', 'amount_desc', 'amount_asc'])('%s: every row exactly once, in order', async (sort) => {
    const rows = await all(admin, { sort });
    expect(rows).toHaveLength(60);
    expect(new Set(rows.map((r) => r.id)).size).toBe(60);
    const amounts = rows.map((r) => r.amount);
    if (sort === 'amount_desc') expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    if (sort === 'amount_asc') expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
  });

  it('recently paid on the paid list: every paid row once', async () => {
    const rows = await all(admin, { status: 'paid', sort: 'paid_recent' });
    expect(rows).toHaveLength(15);
    expect(new Set(rows.map((r) => r.id)).size).toBe(15);
  });

  it('with filters on: only matching rows, none repeated, and a team still sees only its own', async () => {
    const rows = await all(marketing, { min: '300', sort: 'amount_desc' });
    expect(rows.every((r) => r.team === 'marketing' && r.amount >= 300)).toBe(true);
    const expected = await PaymentRequest.countDocuments({ team: 'marketing', amount: { $gte: 300 } });
    expect(rows).toHaveLength(expected);
    expect(new Set(rows.map((r) => r.id)).size).toBe(expected);
  });

  it('25 a page; the count and total come with the first page only', async () => {
    const first = await pr.list(admin, {});
    expect(first.requests).toHaveLength(25);
    expect(first.summary.count).toBe(60);
    const second = await pr.list(admin, { cursor: first.nextCursor });
    expect(second.requests).toHaveLength(25);
    expect(second.summary).toBeUndefined();
  });

  it('a cursor from another sort starts again from the top', async () => {
    const first = await pr.list(admin, { sort: 'amount_desc' });
    const mixed = await pr.list(admin, { sort: 'oldest', cursor: first.nextCursor });
    expect(numbers(mixed)[0]).toBe('PR-0001');
    expect(mixed.summary.count).toBe(60);
  });

  it('a junk cursor starts from the top', async () => {
    expect(numbers(await pr.list(admin, { cursor: 'garbage' }))[0]).toBe('PR-0060');
  });
});

describe('the count is capped', () => {
  it('over 1,000 matches: "1,000+", no total', async () => {
    await seed(...Array.from({ length: 1001 }, () => doc({ amount: 10 })));
    const res = await pr.list(admin, {});
    expect(res.summary).toEqual({ count: 1000, total: null, capped: true });
    expect((await pr.list(admin, { q: 'PR-0001' })).summary.capped).toBe(false);
  });
});

describe('the filter choices', () => {
  it('admin and accounts get every team\'s "What for" and the people; old shared values stay', async () => {
    await User.collection.insertMany([
      { name: 'Admin A', email: 'a@x.in', role: 'admin' },
      { name: 'Ravi', email: 'r@x.in', role: 'staff', staff: { active: true, team: 'marketing' } },
      { name: 'Gone', email: 'g@x.in', role: 'staff', staff: { active: false, team: 'marketing' } },
      { name: 'Cust', email: 'c@x.in', role: 'customer' },
    ]);
    const { categories, people } = await pr.listFilterOptions(accounts);
    expect(people.map((p) => p.name).sort()).toEqual(['Admin A', 'Ravi']);
    expect(people.find((p) => p.name === 'Ravi').team).toBe('marketing');
    expect(people.find((p) => p.name === 'Admin A').team).toBe('admin');
    const values = categories.map((c) => c.value);
    expect(values).toEqual(expect.arrayContaining(['meta_ads', 'salary', 'import_purchase', 'fuel', 'purchase', 'other']));
    expect(values).not.toContain('supplier');
    expect(new Set(values).size).toBe(values.length); // "other" is on every team's list, shown once
  });

  it('a team gets its own "What for" (plus the old shared ones) and nobody', async () => {
    const { categories, people } = await pr.listFilterOptions(marketing);
    const values = categories.map((c) => c.value);
    expect(values).toEqual(expect.arrayContaining(['meta_ads', 'google_ads', 'fuel']));
    expect(values).not.toContain('salary');
    expect(people).toEqual([]);
  });

  it('customers and former staff are refused', async () => {
    await expect(pr.listFilterOptions(customer)).rejects.toMatchObject({ statusCode: 403 });
    await expect(pr.listFilterOptions(leftStaff)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('"What for" codes', () => {
  beforeEach(() => seed(
    doc({ category: 'meta_ads', team: 'marketing' }),
    doc({ category: 'salary', team: 'accounts' }),
    doc({ category: 'fuel', team: 'operations' }),
  ));

  it('search finds a category by its name, not just its code', async () => {
    expect(numbers(await pr.list(admin, { q: 'meta ads' }))).toEqual(['PR-0001']);
    expect(numbers(await pr.list(admin, { q: 'Salary' }))).toEqual(['PR-0002']);
  });

  it('the filter takes any stored code, new or old; junk is ignored', async () => {
    expect(numbers(await pr.list(admin, { category: 'meta_ads' }))).toEqual(['PR-0001']);
    expect(numbers(await pr.list(admin, { category: 'fuel' }))).toEqual(['PR-0003']);
    expect(numbers(await pr.list(admin, { category: 'x"; drop' }))).toHaveLength(3);
  });
});
