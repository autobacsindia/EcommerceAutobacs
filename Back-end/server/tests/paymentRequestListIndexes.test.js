/**
 * The Payments list's sorts must be served by an index, not by reading every
 * row of a status and sorting them in memory. On 100,000 requests the in-memory
 * sort read all 84,012 paid rows per page (66–92 ms); the indexes read 26.
 *
 * If this fails, a sort or the query shape changed so that the planner no longer
 * walks payment_request_status_amount / payment_request_status_paid — check the
 * sort spec in services/paymentRequestService.js (LIST_SORTS) against the index.
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
const svc = await import('../services/paymentRequestService.js');
const { default: repo } = await import('../repositories/paymentRequestRepository.js');
const { afterClause, and, decodeCursor, encodeCursor, sortSpec } = await import('../utils/listQuery.js');

const admin = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
const STATUSES = ['paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'submitted', 'approved', 'on_hold', 'declined'];

function plan(explain) {
  const s = JSON.stringify(explain.queryPlanner.winningPlan);
  return {
    sortsInMemory: s.includes('"stage":"SORT"'),
    scans: s.includes('COLLSCAN'),
    indexes: [...new Set([...s.matchAll(/"indexName":"([^"]+)"/g)].map((m) => m[1]))],
  };
}

async function explainFor(filters, cursorFrom = null) {
  const query = svc.listQuery(admin, filters);
  const { name, sort } = svc.listSort(filters);
  const after = cursorFrom ? decodeCursor(name, sort, encodeCursor(name, sort, cursorFrom)) : null;
  return plan(await PaymentRequest.find(and(query, afterClause(sort, after))).sort(sortSpec(sort)).limit(26).explain('queryPlanner'));
}

beforeAll(async () => {
  await dbHandler.connect();
  await PaymentRequest.syncIndexes();
  const t0 = Date.UTC(2026, 0, 1);
  await PaymentRequest.collection.insertMany(Array.from({ length: 3000 }, (_, i) => {
    const status = STATUSES[i % STATUSES.length];
    return {
      number: `PR-${String(i).padStart(5, '0')}`, kind: 'expense', status, team: ['marketing', 'operations', 'sales'][i % 3],
      requestedBy: new mongoose.Types.ObjectId(), requestedByName: 'x', amount: 100 + ((i * 7919) % 50000), category: 'fuel',
      payee: { name: 'x', method: 'upi' }, files: [], history: [],
      payment: status === 'paid' ? { paidAt: new Date(t0 + ((i * 104729) % 1e10)) } : { paidAt: null },
      createdAt: new Date(t0 + i * 60_000), updatedAt: new Date(),
    };
  }));
});
afterAll(async () => { await dbHandler.closeDatabase(); });

describe('Payments list sorts use an index (no in-memory sort, no scan)', () => {
  it.each([
    ['paid, amount high → low', { status: 'paid', sort: 'amount_desc' }, 'payment_request_status_amount'],
    ['paid, amount low → high', { status: 'paid', sort: 'amount_asc' }, 'payment_request_status_amount'],
    ['to pay (two statuses), amount high → low', { status: 'to_pay', sort: 'amount_desc' }, 'payment_request_status_amount'],
    ['paid, recently paid', { status: 'paid', sort: 'paid_recent' }, 'payment_request_status_paid'],
    ['to approve, oldest', { status: 'to_approve', sort: 'oldest' }, 'payment_request_status'],
    ['paid, newest', { status: 'paid' }, 'payment_request_status'],
  ])('%s', async (_, filters, index) => {
    const p = await explainFor(filters);
    expect(p.scans).toBe(false);
    expect(p.sortsInMemory).toBe(false);
    expect(p.indexes).toContain(index);
  });

  it('the next page (cursor) rides the same index', async () => {
    const row = await PaymentRequest.findOne({ status: 'paid' }).lean();
    for (const [filters, index] of [
      [{ status: 'paid', sort: 'amount_desc' }, 'payment_request_status_amount'],
      [{ status: 'paid', sort: 'paid_recent' }, 'payment_request_status_paid'],
    ]) {
      const p = await explainFor(filters, row);
      expect(p.sortsInMemory).toBe(false);
      expect(p.indexes).toContain(index);
    }
  });
});

describe('"Paid this month" from foreign accounts (admin overview)', () => {
  const since = new Date(Date.UTC(2026, 0, 1));
  const abroad = (n, foreignAmount) => ({
    number: `PR-FX-${n}`, kind: 'expense', status: 'paid', team: 'procurement', requestedBy: new mongoose.Types.ObjectId(), requestedByName: 'x',
    amount: 0, currency: 'THB', foreignAmount, category: 'import_purchase', payee: { name: 'x', method: 'bank' }, files: [], history: [],
    payment: { paidAt: new Date(Date.UTC(2026, 5, 1)), fromAccount: { currency: 'THB', amount: foreignAmount, label: '' } },
    createdAt: new Date(), updatedAt: new Date(),
  });

  // tests/setup.js empties every collection after each test: each one seeds its own rows.
  const seed = () => PaymentRequest.collection.insertMany([abroad(1, 10000), abroad(2, 0.1), abroad(3, 0.2)]);

  it('reads only the no-rupee rows (status + amount index), not every payment of the month', async () => {
    await seed();
    const ex = await PaymentRequest.aggregate([
      { $match: { status: 'paid', amount: { $lte: 0 }, 'payment.paidAt': { $gte: since } } },
    ]).hint('payment_request_status_amount').explain('executionStats');
    const s = JSON.stringify(ex);
    expect(s).toContain('payment_request_status_amount');
    expect(Number(s.match(/"totalDocsExamined":(\d+)/)[1])).toBe(3);
    // Summed in hundredths: 10000 + 0.1 + 0.2 is exactly 10000.3, no float drift.
    expect(await repo.paidNoRupeesSince(since)).toEqual([{ currency: 'THB', amount: 10000.3 }]);
  });

  it('still answers (slower) if the index is missing on a cluster', async () => {
    await seed();
    await PaymentRequest.collection.dropIndex('payment_request_status_amount');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await repo.paidNoRupeesSince(since)).toEqual([{ currency: 'THB', amount: 10000.3 }]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await PaymentRequest.syncIndexes();
    }
  });
});
