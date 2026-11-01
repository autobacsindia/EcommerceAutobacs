/**
 * The Past sales and admin affiliate Payouts lists' sorts must be served by an index,
 * not by reading every row and sorting it in memory. Measured on 20,000 rows
 * (measure-pr3): the amount sort read 19,000 past sales per page, and the payouts
 * newest / amount sorts read the whole collection.
 *
 * This reads what the list services actually send (the database profiler), so a change
 * to a sort spec or a query shape that loses the index fails here. If it does, compare
 * PAST_SALE_SORTS / PAYOUT_SORTS against past_sale_amount (models/PastSale.js) and the
 * payout_* indexes (models/AffiliatePayout.js).
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
const { default: AffiliatePayout } = await import('../models/AffiliatePayout.js');
const ps = await import('../services/pastSaleService.js');
const { default: payouts } = await import('../services/affiliatePayoutService.js');

const oid = () => new mongoose.Types.ObjectId();
const accounts = { _id: oid(), role: 'staff', staff: { active: true, team: 'accounts' } };
const t0 = Date.UTC(2025, 0, 1);

/** Run `fn` with the profiler on; return the plan summary of each find it sent to `collection`. */
async function plansOf(collection, fn) {
  const db = mongoose.connection.db;
  await db.command({ profile: 0 });
  await db.collection('system.profile').drop().catch(() => {});
  await db.command({ profile: 2 });
  try { await fn(); } finally { await db.command({ profile: 0 }); }
  const entries = await db.collection('system.profile').find({ ns: `${db.databaseName}.${collection}`, 'command.find': collection }).toArray();
  return entries.map((e) => ({ plan: e.planSummary, sortsInMemory: Boolean(e.hasSortStage), read: e.docsExamined }));
}

beforeAll(async () => {
  await dbHandler.connect();
  await Promise.all([PastSale.syncIndexes(), AffiliatePayout.syncIndexes()]);
});
afterAll(async () => { await dbHandler.closeDatabase(); });
// tests/setup.js empties every collection after each test; the indexes stay.
beforeEach(async () => {
  await PastSale.collection.insertMany(Array.from({ length: 600 }, (_, i) => ({
    saleDate: new Date(t0 + i * 3600e3), invoiceNo: `B-${i}`, invoiceKey: `b${i}`, fingerprint: `fp-${i}`,
    customer: { name: `C ${i}`, phone: '', phoneKey: null }, items: [], itemsTotal: 1000, discount: 0,
    totalAmount: 200 + ((i * 7919) % 50000), paymentMethod: ['upi', 'cash'][i % 2], channel: ['store', 'phone', 'whatsapp'][i % 3],
    salesUser: null, createdBy: accounts._id, active: i % 20 !== 0, createdAt: new Date(), updatedAt: new Date(),
  })));
  await AffiliatePayout.collection.insertMany(Array.from({ length: 600 }, (_, i) => ({
    affiliate: oid(), status: ['paid', 'paid', 'draft', 'failed'][i % 4], grossPaise: 1, tdsPercent: 0, tdsPaise: 0,
    netPaise: 50000 + ((i * 7919) % 500000), commissionCount: 1, reference: `UTR${i}`, bankSnapshot: {},
    createdAt: new Date(t0 + i * 3600e3), updatedAt: new Date(),
  })));
});

const indexed = (index) => expect.objectContaining({ plan: expect.stringContaining(`IXSCAN { ${index}`), sortsInMemory: false });

describe('past sales', () => {
  it.each([
    ['bill amount high → low', { sort: 'amount_desc' }],
    ['bill amount low → high', { sort: 'amount_asc' }],
    ['amount high → low, sold on WhatsApp', { sort: 'amount_desc', channel: 'whatsapp' }],
  ])('%s walks past_sale_amount, page 1 and page 2', async (_, filters) => {
    const plans = await plansOf('pastsales', async () => {
      const first = await ps.listPastSales(accounts, filters);
      await ps.listPastSales(accounts, { ...filters, cursor: first.nextCursor });
    });
    expect(plans).toHaveLength(2);
    expect(plans).toEqual([indexed('active: 1, totalAmount: -1, _id: -1'), indexed('active: 1, totalAmount: -1, _id: -1')]);
  });
});

describe('affiliate payouts', () => {
  it.each([
    ['newest', {}, 'createdAt: -1, _id: -1'],
    ['oldest', { sort: 'oldest' }, 'createdAt: -1, _id: -1'],
    ['amount high → low', { sort: 'amount_desc' }, 'netPaise: -1, _id: -1'],
    ['amount low → high', { sort: 'amount_asc' }, 'netPaise: -1, _id: -1'],
    ['Paid tab, newest', { status: 'paid' }, 'status: 1, createdAt: -1, _id: -1'],
    ['Paid tab, amount high → low', { status: 'paid', sort: 'amount_desc' }, 'status: 1, netPaise: -1, _id: -1'],
  ])('%s is served by an index, page 1 and page 2', async (_, filters, index) => {
    const plans = await plansOf('affiliatepayouts', async () => {
      const first = await payouts.listAdmin({ ...filters, limit: '25' });
      await payouts.listAdmin({ ...filters, limit: '25', cursor: first.nextCursor });
    });
    expect(plans).toHaveLength(2);
    expect(plans).toEqual([indexed(index), indexed(index)]);
  });
});
