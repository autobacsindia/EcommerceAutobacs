/**
 * The supplier-deal reads use indexes, measured with explain — they run on every
 * order panel load, every ship and every cancellation:
 *   - a deal's parts:            payment_request_deal
 *   - "advance committed?":      payment_request_order (the cancel guard)
 *   - an order's open deals:     a supplier_deal_* index, never a collection scan
 */
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import PaymentRequest from '../models/PaymentRequest.js';
import SupplierDeal from '../models/SupplierDeal.js';
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';
import { COMMITTED_STATUSES } from '../services/supplierAdvanceGuard.js';

const plan = (explain) => JSON.stringify(explain.queryPlanner.winningPlan);
const indexOf = (explain) => (plan(explain).includes('COLLSCAN') ? 'COLLSCAN' : (plan(explain).match(/"indexName":"([^"]+)"/) || [])[1]);

const order = new mongoose.Types.ObjectId();
const item = new mongoose.Types.ObjectId();
let deal;

beforeAll(async () => {
  await dbHandler.connect();
  await Promise.all([PaymentRequest.syncIndexes(), SupplierDeal.syncIndexes()]);
});
// Seeded per test: the shared test setup may clear collections between tests.
beforeEach(async () => {
  await Promise.all([PaymentRequest.deleteMany({}), SupplierDeal.deleteMany({})]);
  const other = () => new mongoose.Types.ObjectId();
  await SupplierDeal.insertMany(Array.from({ length: 300 }, () => ({
    order: other(), itemIds: [other()], supplierName: 'X', agreedPaise: 100000, createdBy: other(),
  })));
  deal = await SupplierDeal.create({ order, itemIds: [item], supplierName: 'Kochi Fabricators', agreedPaise: 2900000, createdBy: other() });
  const base = (i, over) => ({
    number: `PR-${i}`, kind: 'supplier', status: 'paid', team: 'procurement', requestedBy: other(), requestedByName: 'P',
    amount: 100, category: 'supplier', payee: { name: 'ARB', method: 'upi', upiId: 'arb@okaxis' }, order: other(), ...over,
  });
  await PaymentRequest.insertMany([
    ...Array.from({ length: 500 }, (_, i) => base(i, { deal: i % 2 ? other() : null })),
    base(9001, { order, itemIds: [item], deal: deal._id, part: 'advance', amount: 10000 }),
    base(9002, { order, itemIds: [item], deal: deal._id, part: 'balance', amount: 19000, status: 'submitted' }),
  ]);
});
afterAll(async () => { await dbHandler.closeDatabase(); });

it("a deal's parts read on payment_request_deal, examining only its own", async () => {
  const explain = await paymentRequestRepository.findForDeals([deal._id]).explain('executionStats');
  expect(indexOf(explain)).toBe('payment_request_deal');
  expect(explain.executionStats.totalDocsExamined).toBe(2);
  expect(await paymentRequestRepository.findForDeals([deal._id])).toHaveLength(2);
});

it('the cancel guard reads one order on payment_request_order', async () => {
  const explain = await paymentRequestRepository.findCommittedDealPart(order, [item], COMMITTED_STATUSES).explain('executionStats');
  expect(indexOf(explain)).toBe('payment_request_order');
  expect(explain.executionStats.totalDocsExamined).toBeGreaterThanOrEqual(1);
  expect(explain.executionStats.totalDocsExamined).toBeLessThanOrEqual(2);
});

it('the shipping guard and the order panel read one order on payment_request_order', async () => {
  for (const q of [paymentRequestRepository.findOpenForOrder(order), paymentRequestRepository.findForOrder(order)]) {
    const explain = await q.explain('executionStats');
    expect(indexOf(explain)).toBe('payment_request_order');
    expect(explain.executionStats.totalDocsExamined).toBe(explain.executionStats.nReturned);
    expect(explain.executionStats.nReturned).toBeGreaterThanOrEqual(1);
  }
});

it("an order's open deals read on an index", async () => {
  const explain = await SupplierDeal.find({ order, status: 'open', itemIds: { $in: [item] } }).sort({ createdAt: 1 }).limit(50).explain('executionStats');
  expect(indexOf(explain)).toMatch(/^supplier_deal_/);
  expect(explain.executionStats.totalDocsExamined).toBe(1);
  expect(await SupplierDeal.countDocuments({ order })).toBe(1);
});
