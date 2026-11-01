/**
 * The Bank transfers list's sorts must be served by an index, not by reading
 * every row of a status and sorting them in memory. On 100,000 transfers the
 * in-memory sort read all 82,225 confirmed rows per page (~50 ms); the indexes
 * read 26.
 *
 * If this fails, a sort or the query shape changed so that the planner no longer
 * walks bank_transfer_status_amount / bank_transfer_status_paid_on — check
 * TRANSFER_SORTS in services/bankTransferService.js against the index.
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
const svc = await import('../services/bankTransferService.js');
const { afterClause, and, decodeCursor, encodeCursor, sortSpec } = await import('../utils/listQuery.js');

const accounts = { _id: new mongoose.Types.ObjectId(), role: 'staff', staff: { active: true, team: 'accounts' } };
const STATUSES = ['confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'pending', 'pending', 'rejected', 'withdrawn'];

function plan(explain) {
  const s = JSON.stringify(explain.queryPlanner.winningPlan);
  return {
    sortsInMemory: s.includes('"stage":"SORT"'),
    scans: s.includes('COLLSCAN'),
    indexes: [...new Set([...s.matchAll(/"indexName":"([^"]+)"/g)].map((m) => m[1]))],
  };
}

async function explainFor(filters, cursorFrom = null) {
  const query = svc.transferQuery(accounts, filters);
  const name = svc.TRANSFER_SORTS[filters.sort] ? filters.sort : 'newest';
  const sort = svc.TRANSFER_SORTS[name];
  const after = cursorFrom ? decodeCursor(name, sort, encodeCursor(name, sort, cursorFrom)) : null;
  return plan(await BankTransfer.find(and(query, afterClause(sort, after))).sort(sortSpec(sort)).limit(26).explain('queryPlanner'));
}

beforeAll(async () => {
  await dbHandler.connect();
  await BankTransfer.syncIndexes();
  const t0 = Date.UTC(2026, 0, 1);
  await BankTransfer.collection.insertMany(Array.from({ length: 3000 }, (_, i) => {
    const status = STATUSES[i % STATUSES.length];
    const ref = `UTR${100000 + i}`;
    return {
      order: new mongoose.Types.ObjectId(), orderNumber: `#SO${i}`, salesUser: new mongoose.Types.ObjectId(), salesUserName: 'x',
      customer: { name: 'x', city: 'y' }, amount: 100 + ((i * 7919) % 50000), reference: ref, referenceKey: ref,
      paidOn: new Date(t0 + ((i * 104729) % 1e10)), files: [], status, active: ['pending', 'confirmed'].includes(status),
      history: [], createdAt: new Date(t0 + i * 60_000), updatedAt: new Date(),
    };
  }));
});
afterAll(async () => { await dbHandler.closeDatabase(); });

describe('Bank transfers list sorts use an index (no in-memory sort, no scan)', () => {
  it.each([
    ['confirmed, amount high → low', { status: 'confirmed', sort: 'amount_desc' }, 'bank_transfer_status_amount'],
    ['to check, amount low → high', { sort: 'amount_asc' }, 'bank_transfer_status_amount'],
    ['confirmed, latest paid date', { status: 'confirmed', sort: 'paid_recent' }, 'bank_transfer_status_paid_on'],
    ['confirmed, newest', { status: 'confirmed' }, 'bank_transfer_status_recent'],
    ['to check, oldest', { sort: 'oldest' }, 'bank_transfer_status_recent'],
  ])('%s', async (_, filters, index) => {
    const p = await explainFor(filters);
    expect(p.scans).toBe(false);
    expect(p.sortsInMemory).toBe(false);
    expect(p.indexes).toContain(index);
  });

  it('the next page (cursor) rides the same index', async () => {
    const row = await BankTransfer.findOne({ status: 'confirmed' }).lean();
    for (const [filters, index] of [
      [{ status: 'confirmed', sort: 'amount_desc' }, 'bank_transfer_status_amount'],
      [{ status: 'confirmed', sort: 'paid_recent' }, 'bank_transfer_status_paid_on'],
    ]) {
      const p = await explainFor(filters, row);
      expect(p.sortsInMemory).toBe(false);
      expect(p.indexes).toContain(index);
    }
  });
});
