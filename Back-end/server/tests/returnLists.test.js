/**
 * The team Returns lists and "Suppliers owe us": search, filters, sort and pages
 * (returnService.listReturns / suppliersOweUs → utils/listQuery.js).
 *
 * What must hold:
 *   - a return is found by its number, the order number (or the old website's #number),
 *     the customer's name or phone, a product name, or the supplier — every word must match
 *   - Reason, Came from and Raised on narrow it; the queue's own rule (what the bell
 *     counts) still applies: a search never shows a return from another team's queue,
 *     and a seller's "Mine" never shows someone else's
 *   - newest or oldest first; pages never repeat or skip a row, with filters on
 *   - "Suppliers owe us": search by supplier, return number, credit-note number, PR or
 *     amount; filter by supplier and kind; oldest / newest / amount; the per-supplier
 *     totals stay whole, the summary is what matches
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
const { default: ReturnRequest } = await import('../models/ReturnRequest.js');
const { default: Order } = await import('../models/Order.js');
const { default: Product } = await import('../models/Product.js');
const svc = await import('../services/returnService.js');

const oid = () => new mongoose.Types.ObjectId();
const staff = (team, extra = {}) => ({ _id: oid(), role: 'staff', staff: { active: true, team, ...extra } });
const ops = staff('operations');
const procurement = staff('procurement');
const accounts = staff('accounts');
const seller = staff('sales');
const marketing = staff('marketing');

const DAY = 86400000;
const ist = (ymd, hh = 12) => new Date(`${ymd}T${String(hh).padStart(2, '0')}:00:00+05:30`);

const WIPER = { _id: oid(), name: 'Bosch Aerotwin Wiper Blade', slug: 'bosch-aerotwin' };
const MAT = { _id: oid(), name: '3D Floor Mat Creta', slug: '3d-floor-mat' };

async function order(over = {}) {
  const _id = oid();
  await Order.collection.insertOne({
    _id, shippingAddress: { fullName: 'Anil Thomas', phone: '9847001122' }, items: [], totalAmount: 1000, createdAt: new Date(), ...over,
  });
  return _id;
}

function ret(orderId, over = {}) {
  const { line, ...rest } = over;
  return {
    _id: oid(), order: orderId, origin: 'customer', status: 'pending', type: 'return', resolution: 'refund',
    items: [{ product: WIPER._id, quantity: 1, reason: 'wrong_item', unitPrice: 900, ...line }],
    supplierClaims: [], pickupAttempts: [], refund: { status: 'pending' }, destination: { kind: 'warehouse' },
    createdAt: ist('2026-10-10'), updatedAt: new Date(), ...rest,
  };
}
const ids = (res) => res.returns.map((r) => r.id);

beforeAll(async () => { await dbHandler.connect(); });
afterAll(async () => { await dbHandler.closeDatabase(); });
// tests/setup.js empties every collection after each test.
beforeEach(() => Product.collection.insertMany([{ ...WIPER }, { ...MAT }]));

describe('search', () => {
  let anil; let kavya; let fromSite; let toSupplier;
  beforeEach(async () => {
    const o1 = await order({ wpId: 48213 });
    const o2 = await order({ shippingAddress: { fullName: 'Kavya Rao', phone: '+91 98450 77665' } });
    anil = ret(o1);
    kavya = ret(o2, { line: { product: MAT._id }, customerPhone: '9845077665' });
    fromSite = ret(await order({ shippingAddress: { fullName: 'Joseph Mathew', phone: '9000000000' } }), { line: { product: MAT._id } });
    toSupplier = ret(await order(), {
      line: { product: MAT._id }, destination: { kind: 'supplier', supplierName: 'Ram Traders' },
    });
    await ReturnRequest.collection.insertMany([anil, kavya, fromSite, toSupplier]);
  });

  const ref = (r) => String(r._id).slice(-8).toUpperCase();

  it.each([
    ['the return number, any case, with or without #', () => `#${ref(anil).toLowerCase()}`, () => [anil]],
    ['the order number', () => ref({ _id: kavya.order }), () => [kavya]],
    ["the old website's order number", () => '#48213', () => [anil]],
    ['the customer', () => 'KAVYA', () => [kavya]],
    ["the customer's phone on the order", () => '98450 77665', () => [kavya]],
    ['a product', () => 'aerotwin', () => [anil]],
    ['the supplier it goes to', () => 'ram traders', () => [toSupplier]],
  ])('%s', async (_, q, expected) => {
    expect(ids(await svc.listReturns(ops, { queue: 'all', q: q() }))).toEqual(expected().map((r) => String(r._id)));
  });

  it('every word must match; a miss is empty with a zero count; regex is plain text', async () => {
    expect(ids(await svc.listReturns(ops, { q: 'joseph floor' }))).toEqual([String(fromSite._id)]);
    expect(await svc.listReturns(ops, { q: 'joseph wiper' })).toMatchObject({ returns: [], summary: { count: 0, capped: false } });
    expect(ids(await svc.listReturns(ops, { q: '.*' }))).toEqual([]);
    expect((await svc.listReturns(ops, { q: { $ne: '' } })).returns).toHaveLength(4);
  });

  it("never reaches past the queue's own rule", async () => {
    await ReturnRequest.updateOne({ _id: anil._id }, { status: 'approved' });
    expect(ids(await svc.listReturns(ops, { queue: 'review', q: 'anil' }))).toEqual([String(toSupplier._id)]);
    expect(ids(await svc.listReturns(ops, { queue: 'pickup', q: 'anil' }))).toEqual([String(anil._id)]);
  });

  it("a seller's Mine stays theirs, whatever is searched", async () => {
    await ReturnRequest.updateOne({ _id: kavya._id }, { seller: seller._id });
    expect(ids(await svc.listReturns(seller, { queue: 'mine', q: 'a' }))).toEqual([String(kavya._id)]);
    expect(ids(await svc.listReturns(seller, { queue: 'mine', q: 'anil' }))).toEqual([]);
    await expect(svc.listReturns(seller, { queue: 'all', q: 'anil' })).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('filters', () => {
  beforeEach(async () => {
    const o = await order();
    await ReturnRequest.collection.insertMany([
      ret(o, { _id: new mongoose.Types.ObjectId('a00000000000000000000001'), line: { product: oid() }, createdAt: ist('2026-10-01', 0) }),
      ret(o, { _id: new mongoose.Types.ObjectId('a00000000000000000000002'), origin: 'staff', line: { product: oid(), reason: 'transit_damage' }, createdAt: ist('2026-10-05') }),
      ret(o, { _id: new mongoose.Types.ObjectId('a00000000000000000000003'), origin: 'admin_offline', line: { product: oid(), reason: 'changed_mind' }, createdAt: ist('2026-10-07', 23) }),
    ]);
  });
  const short = (res) => ids(res).map((id) => id.slice(-1));

  it('reason on any line', async () => {
    expect(short(await svc.listReturns(ops, { reason: 'transit_damage' }))).toEqual(['2']);
    expect((await svc.listReturns(ops, { reason: 'nonsense' })).returns).toHaveLength(3);
  });

  it('came from the website, the team, or recorded by hand', async () => {
    expect(short(await svc.listReturns(ops, { origin: 'website' }))).toEqual(['1']);
    expect(short(await svc.listReturns(ops, { origin: 'staff' }))).toEqual(['2']);
    expect(short(await svc.listReturns(ops, { origin: 'recorded' }))).toEqual(['3']);
  });

  it('raised on: India-time days, both ends included', async () => {
    expect(short(await svc.listReturns(ops, { from: '2026-10-01', to: '2026-10-01' }))).toEqual(['1']);
    expect(short(await svc.listReturns(ops, { from: '2026-10-05', to: '2026-10-07' }))).toEqual(['3', '2']);
    expect(short(await svc.listReturns(ops, { from: '2026-10-08' }))).toEqual([]);
  });

  it('newest first by default; oldest first; an unknown sort is newest', async () => {
    expect(short(await svc.listReturns(ops, {}))).toEqual(['3', '2', '1']);
    expect(short(await svc.listReturns(ops, { sort: 'oldest' }))).toEqual(['1', '2', '3']);
    expect(await svc.listReturns(ops, { sort: 'random' })).toMatchObject({ sort: 'newest' });
  });
});

describe('pages', () => {
  beforeEach(async () => {
    const o = await order();
    await ReturnRequest.collection.insertMany(Array.from({ length: 70 }, (_, i) => ret(o, {
      origin: i % 2 ? 'staff' : 'customer', line: { product: oid() },
      // Five share each moment, so the _id tie-breaker is exercised.
      createdAt: new Date(Date.UTC(2026, 9, 1) + Math.floor(i / 5) * DAY),
    })));
  });

  it.each(['newest', 'oldest'])('%s, with a filter on: every match exactly once, in order', async (sort) => {
    const rows = [];
    let cursor = '';
    for (let i = 0; i < 10; i += 1) {
      const res = await svc.listReturns(ops, { origin: 'staff', sort, ...(cursor ? { cursor } : {}) });
      if (!cursor) expect(res.summary).toEqual({ count: 35, capped: false });
      else expect(res.summary).toBeUndefined();
      rows.push(...res.returns);
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    expect(rows).toHaveLength(35);
    expect(new Set(rows.map((r) => r.id)).size).toBe(35);
    const times = rows.map((r) => new Date(r.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => (sort === 'newest' ? b - a : a - b)));
  });

  it("a cursor from the other sort starts over", async () => {
    const first = await svc.listReturns(ops, { sort: 'newest' });
    const other = await svc.listReturns(ops, { sort: 'oldest', cursor: first.nextCursor });
    expect(other.returns[0].id).toBe((await svc.listReturns(ops, { sort: 'oldest' })).returns[0].id);
  });
});

describe('Suppliers owe us', () => {
  const claim = (supplierName, amountRupees, promisedAt, extra = {}) => ({
    _id: oid(), supplierName, status: 'promised', paymentRequestRef: extra.pr || null,
    settlement: { kind: extra.kind || 'credit_note', amountPaise: amountRupees * 100, reference: extra.reference || '', promisedAt },
  });
  let rA; let rB;
  beforeEach(async () => {
    const o = await order();
    rA = ret(o, { status: 'refunded', supplierClaims: [
      claim('Ram Traders', 7000, ist('2026-09-01'), { reference: 'CN-7781' }),
      claim('Ram Traders', 500, ist('2026-09-20'), { kind: 'refund', pr: 'PR-0042' }),
    ] });
    rB = ret(o, { status: 'refunded', supplierClaims: [
      claim('Bosch Distributor', 3000, ist('2026-09-10')),
      { ...claim('Bosch Distributor', 9999, ist('2026-08-01')), status: 'settled' }, // received: never listed
    ] });
    await ReturnRequest.collection.insertMany([rA, rB]);
  });
  const amounts = (res) => res.items.map((i) => i.amount);

  it('oldest promise first, with the whole totals and a summary of what matches', async () => {
    const res = await svc.suppliersOweUs(accounts, {});
    expect(amounts(res)).toEqual([7000, 3000, 500]);
    expect(res.summary).toEqual({ count: 3, total: 10500, capped: false });
    expect(res.items[0]).toMatchObject({ returnId: String(rA._id), returnRef: String(rA._id).slice(-8).toUpperCase(), supplierName: 'Ram Traders' });
  });

  it.each([
    ['supplier', 'bosch', [3000]],
    ['credit-note number', 'cn-7781', [7000]],
    ['payment request', 'pr-0042', [500]],
    ['amount', '₹3,000', [3000]],
    ['two words', 'ram 500', [500]],
  ])('search by %s', async (_, q, expected) => {
    expect(amounts(await svc.suppliersOweUs(procurement, { q }))).toEqual(expected);
  });

  it('search by the return number', async () => {
    const res = await svc.suppliersOweUs(accounts, { q: `#${String(rB._id).slice(-8)}` });
    expect(amounts(res)).toEqual([3000]);
  });

  it('filter by supplier and kind; totals stay whole', async () => {
    const one = await svc.suppliersOweUs(accounts, { supplier: 'Ram Traders' });
    expect(amounts(one)).toEqual([7000, 500]);
    expect(one.summary).toEqual({ count: 2, total: 7500, capped: false });
    expect(one.totals.map((t) => t.supplierName).sort()).toEqual(['Bosch Distributor', 'Ram Traders']);
    expect(amounts(await svc.suppliersOweUs(accounts, { kind: 'refund' }))).toEqual([500]);
    expect(amounts(await svc.suppliersOweUs(accounts, { supplier: { $ne: '' } }))).toEqual([7000, 3000, 500]);
  });

  it.each([
    ['newest', [500, 3000, 7000]],
    ['amount_desc', [7000, 3000, 500]],
    ['amount_asc', [500, 3000, 7000]],
    ['random', [7000, 3000, 500]],
  ])('sort %s', async (sort, expected) => {
    expect(amounts(await svc.suppliersOweUs(accounts, { sort }))).toEqual(expected);
  });

  it('pages with a filter on never repeat a settlement', async () => {
    const o = await order();
    await ReturnRequest.collection.insertMany(Array.from({ length: 30 }, (_, i) => ret(o, {
      status: 'refunded', supplierClaims: [claim('Ram Traders', 100 + (i % 3), ist('2026-09-02'))],
    })));
    const seen = [];
    let cursor = '';
    for (let i = 0; i < 5; i += 1) {
      const res = await svc.suppliersOweUs(accounts, { supplier: 'Ram Traders', sort: 'amount_desc', ...(cursor ? { cursor } : {}) });
      seen.push(...res.items);
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(32);
    expect(new Set(seen.map((s) => s.claimId)).size).toBe(32);
    expect(amounts({ items: seen })).toEqual([...amounts({ items: seen })].sort((a, b) => b - a));
  });

  it.each(['oldest', 'newest'])('a promise with no date (never written today, but a hand-edited row could) is listed once — %s', async (sort) => {
    const o = await order();
    await ReturnRequest.collection.insertMany(Array.from({ length: 30 }, (_, i) => ret(o, {
      status: 'refunded', createdAt: ist('2026-07-01'), supplierClaims: [claim('Ram Traders', 100 + i, i < 27 ? null : ist('2026-09-02'))],
    })));
    const seen = [];
    let cursor = '';
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- pages are sequential by nature
      const res = await svc.suppliersOweUs(accounts, { sort, ...(cursor ? { cursor } : {}) });
      seen.push(...res.items);
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(33);
    expect(new Set(seen.map((s) => s.claimId)).size).toBe(33);
    // An undated one sorts by its return (1 July) and shows no date of its own.
    const undated = seen.filter((s) => s.promisedAt === null);
    expect(undated).toHaveLength(27);
    expect(undated.every((s) => s.ageDays === null)).toBe(true);
  });

  it('only accounts, procurement and the admin', async () => {
    await expect(svc.suppliersOweUs(marketing, {})).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.suppliersOweUs(ops, {})).rejects.toMatchObject({ statusCode: 403 });
  });
});
