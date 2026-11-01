/**
 * The Past sales list's new controls (pastSaleService.listPastSales → utils/listQuery.js):
 * sort by sale date or bill amount, the amount range, "How sold" and "Paid by", and the
 * "N found · total" line. Search, dates, salesman and deleted are in pastSales.test.js.
 *
 * What must hold:
 *   - each filter narrows; an unknown value is ignored, never an error
 *   - a GTM lead still sees only their own sales, whatever is asked
 *   - pages never repeat or skip a sale under any sort, with filters on
 *   - the count and total are of what matches, first page only
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
const { default: PastSale } = await import('../models/PastSale.js');
const ps = await import('../services/pastSaleService.js');

const oid = () => new mongoose.Types.ObjectId();
const accounts = { _id: oid(), role: 'staff', staff: { active: true, team: 'accounts' } };
const lead = { _id: oid(), role: 'staff', staff: { active: true, team: 'sales' } };

let seq = 0;
function doc(over = {}) {
  seq += 1;
  return {
    _id: oid(), saleDate: new Date(Date.UTC(2024, 2, 1 + (seq % 20))), invoiceNo: `B-${seq}`, invoiceKey: `b${seq}`,
    fingerprint: `fp-${seq}`, customer: { name: `Customer ${seq}`, phone: '', phoneKey: null },
    items: [{ name: 'Mat', quantity: 1, price: 1000 }], itemsTotal: 1000, discount: 0, totalAmount: 1000,
    paymentMethod: 'upi', channel: 'store', salesUser: null, createdBy: accounts._id, active: true,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}
const seed = (...docs) => PastSale.collection.insertMany(docs);
const totals = (res) => res.sales.map((s) => s.totalAmount);

beforeAll(async () => { await dbHandler.connect(); });
afterAll(async () => { await dbHandler.closeDatabase(); });
beforeEach(() => { seq = 0; });

describe('filters and the count line', () => {
  beforeEach(() => seed(
    doc({ totalAmount: 500, channel: 'phone', paymentMethod: 'cash' }),
    doc({ totalAmount: 6500, channel: 'store', paymentMethod: 'upi', salesUser: lead._id }),
    doc({ totalAmount: 12000, channel: 'whatsapp', paymentMethod: 'card' }),
    doc({ totalAmount: 99999, active: false }),
  ));

  it('amount range, both ends included; junk is ignored', async () => {
    expect(totals(await ps.listPastSales(accounts, { min: '500', max: '6500', sort: 'amount_asc' }))).toEqual([500, 6500]);
    expect(totals(await ps.listPastSales(accounts, { min: '7000' }))).toEqual([12000]);
    expect((await ps.listPastSales(accounts, { min: 'lots' })).sales).toHaveLength(3);
  });

  it('how it was sold, and how it was paid', async () => {
    expect(totals(await ps.listPastSales(accounts, { channel: 'whatsapp' }))).toEqual([12000]);
    expect(totals(await ps.listPastSales(accounts, { payment: 'cash' }))).toEqual([500]);
    expect((await ps.listPastSales(accounts, { channel: 'carrier-pigeon', payment: { $ne: 'x' } })).sales).toHaveLength(3);
  });

  it('says how many match and what they add up to — deleted sales never count', async () => {
    expect((await ps.listPastSales(accounts, {})).summary).toEqual({ count: 3, total: 19000, capped: false });
    expect((await ps.listPastSales(accounts, { min: '1000' })).summary).toEqual({ count: 2, total: 18500, capped: false });
  });

  it('a GTM lead sees only their own, whatever is asked', async () => {
    const res = await ps.listPastSales(lead, { min: '0', sort: 'amount_desc' });
    expect(totals(res)).toEqual([6500]);
    expect(res.summary).toEqual({ count: 1, total: 6500, capped: false });
  });
});

describe('sort and pages', () => {
  beforeEach(() => seed(...Array.from({ length: 70 }, (_, i) => doc({
    totalAmount: 1000 + (i % 7) * 250, // repeats, so the _id tie-breaker is exercised
    paymentMethod: i % 2 ? 'cash' : 'upi',
  }))));

  it.each([
    ['newest', (s) => s.saleDate, (a, b) => (a < b ? 1 : a > b ? -1 : 0)],
    ['oldest', (s) => s.saleDate, (a, b) => (a < b ? -1 : a > b ? 1 : 0)],
    ['amount_desc', (s) => s.totalAmount, (a, b) => b - a],
    ['amount_asc', (s) => s.totalAmount, (a, b) => a - b],
  ])('%s, with a filter on: every match exactly once, in order', async (sort, pick, cmp) => {
    const rows = [];
    let cursor = '';
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- pages are sequential by nature
      const res = await ps.listPastSales(accounts, { payment: 'cash', sort, ...(cursor ? { cursor } : {}) });
      if (cursor) expect(res.summary).toBeUndefined();
      rows.push(...res.sales);
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    expect(rows).toHaveLength(35);
    expect(new Set(rows.map((r) => r.id)).size).toBe(35);
    expect(rows.map(pick)).toEqual([...rows.map(pick)].sort(cmp));
  });

  it('an unknown sort is newest; a cursor from another sort starts over', async () => {
    expect((await ps.listPastSales(accounts, { sort: 'random' })).sort).toBe('newest');
    const first = await ps.listPastSales(accounts, { sort: 'amount_desc' });
    const restarted = await ps.listPastSales(accounts, { sort: 'newest', cursor: first.nextCursor });
    expect(restarted.sales[0].id).toBe((await ps.listPastSales(accounts, {})).sales[0].id);
  });
});
