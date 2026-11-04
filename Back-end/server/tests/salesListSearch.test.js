/**
 * Search / filter / sort on the GTM lists — Quotations (salesQuotationService.listQuotations)
 * and a seller's own orders (salesOrderService.listSalesOrders) — against a real
 * in-memory Mongo. Rows are inserted with the driver so dates and amounts are exact.
 *
 * What must hold:
 *   - a seller sees only their own, whatever they search or filter (seller= is ignored);
 *     the GTM head and the admin see the team's and can narrow to one salesman
 *   - every search word must match; regex characters are just characters
 *   - status tabs keep their meaning (Open leaves out quotations on hold)
 *   - dates are India-time days, both ends included
 *   - every sort pages with no repeats or gaps, filters included; a cursor from
 *     another sort (or an old-style one) starts the list over
 *   - the first page says how many match and what they add up to
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));

const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: SalesQuotation } = await import('../models/SalesQuotation.js');
const quotes = await import('../services/salesQuotationService.js');
const sales = await import('../services/salesOrderService.js');

const oid = () => new mongoose.Types.ObjectId();
const DAY = 86400000;
const NOW = Date.now();
let n = 0;
const makeStaff = (team, { isHead = false, name } = {}) => {
  n += 1;
  return User.create({
    name: name || `${team} ${n}`, email: `${team}${n}@autobacs.test`, phone: '9000000001',
    passwordHash: 'x', role: 'staff', staff: { team, isHead, active: true },
  });
};
const admin = { _id: oid(), role: 'admin' };
const idsOf = (rows) => rows.map((r) => r.id);

let seq = 0;
/** One quotation, inserted as stored. `ageDays`: how long ago it was created. */
function quote(salesUser, over = {}) {
  seq += 1;
  const { ageDays = seq, ...rest } = over;
  const createdAt = new Date(NOW - ageDays * DAY);
  return {
    // As in real data, the id carries the moment of creation (newest/oldest sort by it).
    _id: new mongoose.Types.ObjectId(mongoose.mongo.ObjectId.generate(Math.floor(createdAt.getTime() / 1000))),
    number: `Q-${String(seq).padStart(4, '0')}`,
    version: 1,
    status: 'open',
    customer: { name: `Customer ${seq}`, email: '', phone: `98000${String(seq).padStart(5, '0')}` },
    shippingAddress: { fullName: 'x', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001', country: 'India' },
    items: [{ name: 'Floor mat', quantity: 1, price: 1000 }],
    subtotal: 1000,
    totalAmount: 1000,
    salesUser,
    validUntil: new Date(NOW + 30 * DAY),
    hold: null,
    createdAt,
    updatedAt: createdAt,
    ...rest,
  };
}
const insertQuotes = (rows) => SalesQuotation.collection.insertMany(rows);

describe('Quotations list', () => {
  let rep; let other; let head;
  beforeEach(async () => {
    rep = await makeStaff('sales', { name: 'Nevin' });
    other = await makeStaff('sales', { name: 'Arjun' });
    head = await makeStaff('sales', { isHead: true, name: 'Head' });
  });

  it('a seller sees only their own, even with seller= someone else; the head narrows to one salesman', async () => {
    const mine = quote(rep._id);
    const theirs = quote(other._id);
    await insertQuotes([mine, theirs]);
    expect(idsOf((await quotes.listQuotations(rep, {})).quotations)).toEqual([String(mine._id)]);
    expect(idsOf((await quotes.listQuotations(rep, { seller: String(other._id) })).quotations)).toEqual([String(mine._id)]);
    expect((await quotes.listQuotations(head, {})).quotations).toHaveLength(2);
    expect(idsOf((await quotes.listQuotations(head, { seller: String(other._id) })).quotations)).toEqual([String(theirs._id)]);
    expect(idsOf((await quotes.listQuotations(admin, { seller: String(rep._id) })).quotations)).toEqual([String(mine._id)]);
    // A seller searching for another seller's customer finds nothing.
    expect((await quotes.listQuotations(rep, { q: theirs.customer.name })).quotations).toEqual([]);
  });

  it('someone who cannot sell gets 403', async () => {
    const p = await makeStaff('procurement');
    await expect(quotes.listQuotations(p, {})).rejects.toMatchObject({ statusCode: 403 });
  });

  it('finds the number (printed with its version too), customer, phone, city, product and exact amount', async () => {
    const a = quote(rep._id, { customer: { name: 'Ravi Menon', email: 'ravi@x.in', phone: '9876543210' }, items: [{ name: 'Hilux roof rack', quantity: 1, price: 12500 }], totalAmount: 12500 });
    const b = quote(rep._id, { version: 2, shippingAddress: { addressLine1: '1', city: 'Gurgaon', state: 'Haryana', postalCode: '122001', country: 'India' } });
    await insertQuotes([a, b]);
    const find = async (q) => idsOf((await quotes.listQuotations(rep, { q })).quotations);
    expect(await find(a.number.toLowerCase())).toEqual([String(a._id)]);
    expect(await find(`#${b.number}-v2`)).toEqual([String(b._id)]);
    expect(await find('ravi menon')).toEqual([String(a._id)]);
    expect(await find('ravi gurgaon')).toEqual([]); // every word must match
    expect(await find('43210')).toEqual([String(a._id)]);
    expect(await find('ravi@x.in')).toEqual([String(a._id)]);
    expect(await find('gurgaon')).toEqual([String(b._id)]);
    expect(await find('ROOF rack')).toEqual([String(a._id)]);
    expect(await find('₹12,500')).toEqual([String(a._id)]);
    expect(await find('.*')).toEqual([]); // a regex character is just a character
    expect(await find('nothing like this')).toEqual([]);
  });

  it('status tabs: Open leaves out quotations on hold until their date; On hold lists only those', async () => {
    const open = quote(rep._id);
    const held = quote(rep._id, { hold: { until: new Date(NOW + 2 * DAY), note: 'thinking' } });
    const due = quote(rep._id, { hold: { until: new Date(NOW - DAY), note: 'call back' } });
    const accepted = quote(rep._id, { status: 'accepted' });
    const cancelled = quote(rep._id, { status: 'cancelled' });
    await insertQuotes([open, held, due, accepted, cancelled]);
    const tab = async (status, extra = {}) => idsOf((await quotes.listQuotations(rep, { status, ...extra })).quotations).sort();
    expect(await tab('open')).toEqual([String(open._id), String(due._id)].sort());
    expect(await tab('on_hold')).toEqual([String(held._id)]);
    expect(await tab('accepted')).toEqual([String(accepted._id)]);
    expect(await tab('cancelled')).toEqual([String(cancelled._id)]);
    expect(await tab('')).toHaveLength(5);
    // A search stays inside the tab.
    expect(await tab('on_hold', { q: open.number })).toEqual([]);
  });

  it('created-on dates are India-time days, both ends included', async () => {
    // 00:10 on 2 Oct India time is still 1 Oct in UTC.
    const early = quote(rep._id, { createdAt: new Date('2026-10-01T18:40:00.000Z') });
    const late = quote(rep._id, { createdAt: new Date('2026-10-01T18:20:00.000Z') }); // 23:50 on 1 Oct, India time
    await insertQuotes([early, late]);
    const on = async (from, to) => idsOf((await quotes.listQuotations(rep, { from, to })).quotations);
    expect(await on('2026-10-02', '2026-10-02')).toEqual([String(early._id)]);
    expect(await on('2026-10-01', '2026-10-01')).toEqual([String(late._id)]);
    expect(await on('2026-10-01', '2026-10-02')).toEqual([String(early._id), String(late._id)]);
    expect(await on('nonsense', '')).toHaveLength(2); // ignored, not an error
  });

  it('sorts: newest, oldest, amount both ways; follow-up date only on the On hold tab', async () => {
    const a = quote(rep._id, { ageDays: 3, totalAmount: 500 });
    const b = quote(rep._id, { ageDays: 2, totalAmount: 9000, hold: { until: new Date(NOW + 5 * DAY) } });
    const c = quote(rep._id, { ageDays: 1, totalAmount: 2000, hold: { until: new Date(NOW + 1 * DAY) } });
    await insertQuotes([a, b, c]);
    const order = async (params) => idsOf((await quotes.listQuotations(rep, params)).quotations);
    const [A, B, C] = [a, b, c].map((x) => String(x._id));
    expect(await order({})).toEqual([C, B, A]);
    expect(await order({ sort: 'oldest' })).toEqual([A, B, C]);
    expect(await order({ sort: 'amount_desc' })).toEqual([B, C, A]);
    expect(await order({ sort: 'amount_asc' })).toEqual([A, C, B]);
    expect(await order({ status: 'on_hold', sort: 'follow_up' })).toEqual([C, B]);
    // Elsewhere "follow-up" means nothing: the list falls back to newest.
    const fallback = await quotes.listQuotations(rep, { status: '', sort: 'follow_up' });
    expect(fallback.sort).toBe('newest');
    expect(idsOf(fallback.quotations)).toEqual([C, B, A]);
    expect((await quotes.listQuotations(rep, { sort: 'nonsense' })).sort).toBe('newest');
  });

  it('pages with equal amounts and a search: no repeats or gaps; a stale cursor starts over', async () => {
    const rows = Array.from({ length: 31 }, () => quote(rep._id, { totalAmount: 2500, items: [{ name: 'Seat cover', quantity: 1, price: 2500 }] }));
    rows.push(...Array.from({ length: 4 }, () => quote(rep._id, { totalAmount: 2500 }))); // floor mats: not found
    await insertQuotes(rows);
    const p1 = await quotes.listQuotations(rep, { q: 'seat', sort: 'amount_desc' });
    expect(p1.quotations).toHaveLength(25);
    expect(p1.summary).toEqual({ count: 31, capped: false, total: 77500 });
    const p2 = await quotes.listQuotations(rep, { q: 'seat', sort: 'amount_desc', cursor: p1.nextCursor });
    expect(p2.summary).toBeUndefined();
    expect(p2.nextCursor).toBeNull();
    const seen = [...p1.quotations, ...p2.quotations].map((x) => x.id);
    expect(new Set(seen).size).toBe(31);
    // The old cursor (a bare quotation id) and one from another sort start from the top.
    expect((await quotes.listQuotations(rep, { q: 'seat', cursor: String(rows[0]._id) })).quotations).toHaveLength(25);
    expect((await quotes.listQuotations(rep, { q: 'seat', sort: 'oldest', cursor: p1.nextCursor })).summary.count).toBe(31);
  });

  it('the count stops at 1,000 and then gives no total', async () => {
    await insertQuotes(Array.from({ length: 1001 }, () => quote(rep._id)));
    const res = await quotes.listQuotations(rep, {});
    expect(res.summary).toEqual({ count: 1000, capped: true, total: null });
  });

  it('the filter options: the head and admin get the salesmen, a seller none', async () => {
    expect(await sales.salesListFilterOptions(rep)).toEqual({ sellers: [] });
    const forHead = await sales.salesListFilterOptions(head);
    expect(forHead.sellers.map((s) => s.name).sort()).toEqual(['Arjun', 'Head', 'Nevin']);
    expect((await sales.salesListFilterOptions(admin)).sellers).toHaveLength(3);
    await expect(sales.salesListFilterOptions(await makeStaff('procurement'))).rejects.toMatchObject({ statusCode: 403 });
  });
});

/** One sales order, inserted as stored. */
function order(salesUser, over = {}) {
  seq += 1;
  const { ageDays = seq, ...rest } = over;
  const createdAt = new Date(NOW - ageDays * DAY);
  return {
    _id: oid(),
    user: oid(),
    source: 'offline',
    salesUser,
    items: [{ product: oid(), name: 'Floor mat', price: 1000, quantity: 1 }],
    shippingAddress: { fullName: `Buyer ${seq}`, phone: `97000${String(seq).padStart(5, '0')}`, addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 1000,
    totalAmount: 1000,
    status: 'awaiting_payment',
    paymentStatus: 'pending',
    salesHold: null,
    createdAt,
    updatedAt: createdAt,
    ...rest,
  };
}
// Straight to the driver, so the save hook does not run: give each row the list date
// it would have stamped (utils/orderListDate.js — the paid date, else the created date).
const insertOrders = (rows) => Order.collection.insertMany(rows.map((r) => ({
  ...r, listDate: r.listDate ?? r.paidAt ?? r.createdAt ?? new Date(),
})));

describe('My orders (a seller\'s sales orders)', () => {
  let rep; let other; let head;
  beforeEach(async () => {
    rep = await makeStaff('sales', { name: 'Nevin' });
    other = await makeStaff('sales', { name: 'Arjun' });
    head = await makeStaff('sales', { isHead: true, name: 'Head' });
  });

  it('a seller sees only their own; the head the team\'s, narrowed to one salesman on request', async () => {
    const mine = order(rep._id);
    const theirs = order(other._id);
    await insertOrders([mine, theirs]);
    expect(idsOf((await sales.listSalesOrders(rep, {})).orders)).toEqual([String(mine._id)]);
    expect(idsOf((await sales.listSalesOrders(rep, { seller: String(other._id) })).orders)).toEqual([String(mine._id)]);
    expect((await sales.listSalesOrders(head, {})).orders).toHaveLength(2);
    expect(idsOf((await sales.listSalesOrders(head, { seller: String(other._id) })).orders)).toEqual([String(theirs._id)]);
    expect((await sales.listSalesOrders(rep, { q: theirs.shippingAddress.fullName })).orders).toEqual([]);
  });

  it('search: customer, phone, city, product, order number; every word must match', async () => {
    const a = order(rep._id, { items: [{ product: oid(), name: 'Thar steering wheel', price: 4000, quantity: 1 }], shippingAddress: { fullName: 'Arun Kaushik', phone: '9811122233', city: 'Gurgaon' } });
    const b = order(rep._id);
    await insertOrders([a, b]);
    const find = async (q) => idsOf((await sales.listSalesOrders(rep, { q })).orders);
    expect(await find('arun')).toEqual([String(a._id)]);
    expect(await find('22233')).toEqual([String(a._id)]);
    expect(await find('thar gurgaon')).toEqual([String(a._id)]);
    expect(await find('thar kochi')).toEqual([]);
    expect(await find(`#${String(b._id).slice(-8).toUpperCase()}`)).toEqual([String(b._id)]);
    expect(await find('.*')).toEqual([]);
  });

  it('Paid / Not paid yet, dates, and the tabs still split active from on hold', async () => {
    const unpaid = order(rep._id, { createdAt: new Date('2026-10-01T06:00:00.000Z') });
    const paid = order(rep._id, { status: 'processing', paymentStatus: 'paid', createdAt: new Date('2026-10-02T06:00:00.000Z') });
    const failed = order(rep._id, { paymentStatus: 'failed' });
    const held = order(rep._id, { salesHold: { until: new Date(NOW + 2 * DAY), note: '' } });
    await insertOrders([unpaid, paid, failed, held]);
    const list = async (params) => idsOf((await sales.listSalesOrders(rep, params)).orders).sort();
    expect(await list({ paid: 'paid' })).toEqual([String(paid._id)]);
    expect(await list({ paid: 'unpaid' })).toEqual([String(unpaid._id), String(failed._id)].sort());
    expect(await list({ from: '2026-10-01', to: '2026-10-01' })).toEqual([String(unpaid._id)]);
    expect(await list({ view: 'on_hold' })).toEqual([String(held._id)]);
    expect(await list({ view: 'on_hold', paid: 'paid' })).toEqual([]);
    expect(await list({ paid: 'nonsense' })).toHaveLength(3); // ignored: the active tab
  });

  it('amount sorts page with no repeats or gaps; the first page carries the count and total', async () => {
    const rows = Array.from({ length: 28 }, (_, i) => order(rep._id, { totalAmount: i % 2 ? 3000 : 1000 }));
    await insertOrders(rows);
    const p1 = await sales.listSalesOrders(rep, { sort: 'amount_desc' });
    expect(p1.summary).toEqual({ count: 28, capped: false, total: 56000 });
    const p2 = await sales.listSalesOrders(rep, { sort: 'amount_desc', cursor: p1.nextCursor });
    const all = [...p1.orders, ...p2.orders];
    expect(new Set(all.map((o) => o.id)).size).toBe(28);
    const amounts = all.map((o) => o.totalAmount);
    expect(amounts).toEqual([...amounts].sort((x, y) => y - x));
    const asc = await sales.listSalesOrders(rep, { sort: 'amount_asc' });
    expect(asc.orders[0].totalAmount).toBe(1000);
  });

  it('someone who cannot sell gets 403', async () => {
    await expect(sales.listSalesOrders(await makeStaff('accounts'), {})).rejects.toMatchObject({ statusCode: 403 });
  });
});
