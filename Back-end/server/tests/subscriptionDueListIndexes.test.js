/**
 * The Subscriptions & dues list must walk an index in due-date order — never
 * read every row and sort it in memory, never scan the collection. Every list
 * read carries `archived: false`, and a team reads only its own, so the indexes
 * lead with those (models/SubscriptionDue.js).
 *
 * Measured on 6,000 items (6 teams, 3 statuses, 1 in 10 archived), one page
 * of 26 rows: every shape below reads 15–56 documents (a team's "waiting for
 * check" is the most, 56 — filtered on the team index; not worth a fourth index).
 * If this fails, the query or the sort changed so the planner no longer uses
 * subscription_due_due / _team_due / _status_due — check LIST_SORTS and
 * listQuery in services/subscriptionDueService.js against the indexes.
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
const { default: SubscriptionDue } = await import('../models/SubscriptionDue.js');
const svc = await import('../services/subscriptionDueService.js');
const { afterClause, and, decodeCursor, encodeCursor, sortSpec } = await import('../utils/listQuery.js');

const oid = () => new mongoose.Types.ObjectId();
const accounts = { _id: oid(), role: 'staff', staff: { active: true, team: 'accounts' } };
const dev = { _id: oid(), role: 'staff', staff: { active: true, team: 'developer' } };
const TEAMS = ['developer', 'marketing', 'operations', 'procurement', 'sales', 'accounts'];
const STATUSES = ['pending', 'verified', 'verified', 'rejected'];
const N = 6000;

async function measure(actor, filters, cursorFrom = null) {
  const query = svc.listQuery(actor, filters);
  const sort = svc.LIST_SORTS.due;
  const after = cursorFrom ? decodeCursor('due', sort, encodeCursor('due', sort, cursorFrom)) : null;
  const ex = await SubscriptionDue.find(and(query, afterClause(sort, after))).sort(sortSpec(sort)).limit(26).explain('executionStats');
  const s = JSON.stringify(ex.queryPlanner.winningPlan);
  return {
    sortsInMemory: s.includes('"stage":"SORT"'),
    scans: s.includes('COLLSCAN'),
    indexes: [...new Set([...s.matchAll(/"indexName":"([^"]+)"/g)].map((m) => m[1]))],
    examined: ex.executionStats.totalDocsExamined,
    returned: ex.executionStats.nReturned,
  };
}

beforeAll(async () => {
  await dbHandler.connect();
  await SubscriptionDue.syncIndexes();
});
// tests/setup.js empties the database after every test: seed before each one.
beforeEach(async () => {
  const today = svc.todayIst();
  await SubscriptionDue.collection.insertMany(Array.from({ length: N }, (_, i) => ({
    number: `SD-${String(i).padStart(5, '0')}`, name: `Tool ${i}`, purpose: 'x', team: TEAMS[i % TEAMS.length],
    kind: 'monthly', amount: 10, currency: 'USD', dueDate: svc.addDays(today, ((i * 7919) % 400) - 60),
    payment: { method: 'upi', cardLast4: '', autoDebit: false }, status: STATUSES[i % STATUSES.length],
    addedBy: oid(), addedByName: 'x', archived: i % 10 === 0, rev: 0, files: [], history: [],
  })));
});
afterAll(async () => { await dbHandler.closeDatabase(); });

describe('Subscriptions & dues list uses an index (no in-memory sort, no scan, bounded reads)', () => {
  it('the data is there (a page that reads nothing proves nothing)', async () => {
    expect(await SubscriptionDue.countDocuments({ archived: false })).toBe(N * 0.9);
  });

  it.each([
    ['accounts, everything', accounts, {}, 'subscription_due_due'],
    ['accounts, one team', accounts, { team: 'marketing' }, 'subscription_due_team_due'],
    ['accounts, waiting for check', accounts, { status: 'pending' }, 'subscription_due_status_due'],
    ['accounts, due in 7 days', accounts, { due: 'week' }, null],
    ['accounts, overdue', accounts, { due: 'overdue' }, null],
    ['a team, everything', dev, {}, 'subscription_due_team_due'],
    ['a team, waiting for check', dev, { status: 'pending' }, null],
    ['a team, due in 7 days', dev, { due: 'week' }, 'subscription_due_team_due'],
  ])('%s', async (_, actor, filters, index) => {
    const m = await measure(actor, filters);
    expect(m.scans).toBe(false);
    expect(m.sortsInMemory).toBe(false);
    if (index) expect(m.indexes).toContain(index);
    expect(m.returned).toBeGreaterThan(0);
    // A page reads a bounded slice, never the whole collection.
    expect(m.examined).toBeLessThan(N / 10);
  });

  it('the next page (cursor) rides the same index', async () => {
    const row = await SubscriptionDue.findOne({ archived: false, team: 'developer' }).sort({ dueDate: 1, _id: 1 }).skip(30).lean();
    const m = await measure(dev, {}, row);
    expect(m.returned).toBe(26);
    expect(m.scans).toBe(false);
    expect(m.sortsInMemory).toBe(false);
    expect(m.examined).toBeLessThan(N / 10);
  });
});
