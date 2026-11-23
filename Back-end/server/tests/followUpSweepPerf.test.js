/**
 * Follow-up sweep cost — the optimization pass's evidence. The sweep runs every
 * 5 minutes in office time over the whole open workflow, so its STEADY STATE
 * (nothing new to send) is what production pays all day.
 *
 * Seed: 1,000 open orders × 2 lines, all long past every ladder level.
 *   - every engine read is an index range, never a COLLSCAN
 *   - a steady-state pass makes a bounded number of round trips (not ~one write
 *     per step per level) and finishes well inside the 4½-minute lock
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));
const pushMock = {
  pushConfigured: () => true, publicKey: () => 'k', cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}), sendToUsers: async () => 0, sendTest: async () => ({ sent: 1 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: Order } = await import('../models/Order.js');
const { default: User } = await import('../models/User.js');
const { default: FollowUpDelay } = await import('../models/FollowUpDelay.js');
const { buildIndexes } = await import('../scripts/create-followup-indexes.js');
const { runFollowUpSweep } = await import('../services/followUp/index.js');

jest.setTimeout(300000);

const ORDERS = 1000;
const ist = (s) => new Date(`${s.replace(' ', 'T')}:00+05:30`);
const ENV = { FOLLOWUP_MODE: 'live', STAFF_HOLIDAYS: '' };
const NOW = ist('2026-11-27 12:00'); // Friday: every step from Monday is past the admin level

/** Count the commands the sweep sends, per collection and op. */
function countOps() {
  const ops = {};
  mongoose.set('debug', (coll, op) => { const k = `${coll}.${op}`; ops[k] = (ops[k] || 0) + 1; });
  return { ops, stop: () => mongoose.set('debug', false), total: () => Object.values(ops).reduce((a, b) => a + b, 0) };
}
const planOf = (e) => JSON.stringify(e.queryPlanner?.winningPlan ?? e);

let buyer;
beforeAll(async () => {
  await buildIndexes({ apply: true, log: () => {} });
  buyer = await User.create({ name: 'Buyer', email: 'perfbuyer@autobacs.test', phone: '9000000001', passwordHash: 'x', role: 'staff', staff: { team: 'procurement', active: true } });
  await User.create({ name: 'Head', email: 'perfhead@autobacs.test', phone: '9000000001', passwordHash: 'x', role: 'staff', staff: { team: 'procurement', active: true, isHead: true } });
  await User.create({ name: 'Admin', email: 'perfadmin@autobacs.test', phone: '9000000001', passwordHash: 'x', role: 'admin' });
  const docs = [];
  for (let i = 0; i < ORDERS; i += 1) {
    const items = [0, 1].map(() => ({ _id: new mongoose.Types.ObjectId(), product: new mongoose.Types.ObjectId(), name: 'Part', price: 1000, quantity: 1 }));
    const at = new Date(ist('2026-11-23 10:00').getTime() + i * 1000);
    docs.push({
      user: new mongoose.Types.ObjectId(), items, status: 'processing', paymentStatus: 'paid', subtotal: 2000, totalAmount: 2000,
      workflow: {
        enteredAt: at, open: true,
        lines: items.map((it) => ({ itemId: it._id, stock: 'in_stock' })),
        history: items.map((it) => ({ at, by: buyer._id, byName: 'Buyer', team: 'procurement', action: 'stock_in_stock', itemId: it._id })),
      },
    });
  }
  await Order.collection.insertMany(docs);
  await Order.syncIndexes();
});

it('first pass, then the steady state: bounded round trips and time', async () => {
  // A 2,000-step backlog: each pass stops at its time budget and the next one
  // carries on — nothing is lost, nothing sent twice.
  let t = Date.now();
  let passes = 0;
  let first;
  do {
    first = await runFollowUpSweep({ now: NOW, env: ENV });
    passes += 1;
    expect(first.failed).toBe(0);
  } while (first.truncated && passes < 6);
  const firstMs = Date.now() - t;
  expect(first).toMatchObject({ scanned: ORDERS, steps: 2 * ORDERS, truncated: false });
  expect(await FollowUpDelay.countDocuments({ lateAt: { $type: 'date' } })).toBe(2 * ORDERS);
  expect(await FollowUpDelay.countDocuments({ 'levelsReached.2': { $exists: true }, 'levelsReached.3': { $exists: false } })).toBe(2 * ORDERS);

  const c = countOps();
  t = Date.now();
  const steady = await runFollowUpSweep({ now: new Date(NOW.getTime() + 5 * 60000), env: ENV });
  const steadyMs = Date.now() - t;
  c.stop();
  expect(steady).toMatchObject({ scanned: ORDERS, failed: 0, levels: { due: 0, head: 0, admin: 0 }, resolved: 0 });
  // eslint-disable-next-line no-console
  console.log(`[followup-perf] backlog ${firstMs} ms in ${passes} pass(es) · steady ${steadyMs} ms · steady ops ${c.total()} ${JSON.stringify(c.ops)}`);
  // Steady state: no per-step writes. Reads are paged (orders 100/page, rows 200/page).
  expect(c.ops['followupdelays.findOneAndUpdate'] || 0).toBe(0);
  expect(c.ops['followupdelays.updateOne'] || 0).toBe(0);
  expect(c.total()).toBeLessThanOrEqual(80);
  expect(steadyMs).toBeLessThan(60000);

  // Every engine read is an index range (checked here: tests/setup.js empties
  // the collections between tests).
  const coll = FollowUpDelay.collection;
  const someId = (await coll.findOne({}))._id;
  const plans = [
    await coll.find({ open: true, _id: { $gt: someId } }).sort({ open: 1, _id: 1 }).limit(200).explain('executionStats'),
    await coll.find({ lateAt: { $type: 'date' }, 'ownerAtLate.user': buyer._id }).sort({ lateAt: -1, _id: -1 }).limit(51).explain('executionStats'),
    await coll.find({ lateAt: { $type: 'date' }, team: 'procurement' }).sort({ lateAt: -1, _id: -1 }).limit(51).explain('executionStats'),
    await coll.find({ lateAt: { $type: 'date' } }).sort({ lateAt: -1, _id: -1 }).limit(51).explain('executionStats'),
    await coll.find({ key: { $in: ['a', 'b'] } }).explain('executionStats'),
  ];
  for (const p of plans) {
    expect(planOf(p)).not.toContain('COLLSCAN');
    expect(planOf(p)).not.toContain('"stage":"SORT"');
    expect(p.executionStats.totalDocsExamined).toBeLessThanOrEqual(201);
  }
});
