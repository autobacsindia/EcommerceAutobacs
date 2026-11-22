/**
 * The reimbursement reads must each be an index range, never a collection scan,
 * and read about what they return — measured with explain() over a realistic
 * spread (6,000 payments from 40 people, 1 in 4 a reimbursement over six months,
 * 1 in 6 linked to one of 300 tasks).
 *
 *   - the expense form's "last UPI" prefill   (lastOwnPayee — every form open)
 *   - a task's Reimbursements box             (pageLinked by task + totalsForTask)
 *   - the monthly report                      (reimbursementReport)
 *   - linking by "T-42"                       (staffTaskRepository.findByNumber)
 *
 * Why pinned: prod runs with autoIndex off, so these indexes exist only because
 * config/db.js ensureCriticalIndexes builds them. A query that drifts off its
 * index still "works" — by scanning every payment.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import StaffTask from '../models/StaffTask.js';
import PaymentRequest from '../models/PaymentRequest.js';
import staffTaskRepository from '../repositories/staffTaskRepository.js';
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';

jest.setTimeout(120000);

const planOf = (explain) => JSON.stringify(explain.queryPlanner?.winningPlan ?? explain.stages?.[0]?.$cursor?.queryPlanner?.winningPlan ?? explain);
const indexesIn = (explain) => [...new Set([...planOf(explain).matchAll(/"indexName":"([^"]+)"/g)].map((m) => m[1]))];
const scans = (explain) => planOf(explain).includes('COLLSCAN');
const exec = (explain) => explain.executionStats ?? explain.stages?.[0]?.$cursor?.executionStats;

const N = 6000;
const people = Array.from({ length: 40 }, () => new mongoose.Types.ObjectId());
const taskIds = Array.from({ length: 300 }, () => new mongoose.Types.ObjectId());
const HOT_TASK = taskIds[0];
const ME = people[3]; // i % 40 === 3 → i % 4 === 3: their payments are reimbursements
const CATS = ['other', 'product_purchase', 'meta_ads', 'reimbursement'];
const TYPES = ['fuel', 'food', 'transport', 'other'];

beforeAll(async () => {
  await dbHandler.connect();
  await Promise.all([StaffTask.syncIndexes(), PaymentRequest.syncIndexes()]);
});
// tests/setup.js empties the database after every test: seed before each.
beforeEach(async () => {
  const day = Date.UTC(2026, 5, 1);
  const pays = [];
  for (let i = 0; i < N; i += 1) {
    const category = CATS[i % 4];
    const on = new Date(day + Math.floor(i / 33) * 86400000).toISOString().slice(0, 10); // ~6 months
    const task = i < 60 ? HOT_TASK : i % 6 === 0 ? taskIds[1 + (i % 299)] : null;
    pays.push({
      number: `PR-${i}`, kind: 'expense', status: ['submitted', 'approved', 'paid'][i % 3], team: 'operations',
      requestedBy: people[i % 40], requestedByName: `P${i % 40}`, amount: 100 + i, category,
      payee: { name: 'x', method: i % 5 === 0 ? 'card' : 'upi', upiId: 'x@ok' }, task, taskNumber: task ? 1 : null, taskTitle: '',
      ...(category === 'reimbursement' ? { reimbursement: { type: TYPES[i % 16 >> 2], on, km: null, ratePerKm: null, from: '', to: '' } } : {}),
      createdAt: new Date(day + i * 60000), updatedAt: new Date(day + i * 60000), history: [], files: [],
    });
  }
  await PaymentRequest.collection.insertMany(pays);
  await StaffTask.collection.insertMany(Array.from({ length: 300 }, (_, k) => ({
    _id: taskIds[k], number: k + 1, title: `t${k}`, status: 'todo', bucket: 'open', rank: `r${k}`, assignees: [], teams: ['operations'],
    createdBy: ME, priority: 'normal', checklist: [], files: [], history: [], rev: 1,
  })));
});
afterAll(async () => { await dbHandler.closeDatabase(); });

const expectRange = (explain, index, maxDocs) => {
  expect(scans(explain)).toBe(false);
  expect(indexesIn(explain)).toContain(index);
  expect(exec(explain).totalDocsExamined).toBeLessThanOrEqual(maxDocs);
};

it('the form’s last-UPI prefill reads one of my reimbursements, not every payment', async () => {
  const q = { requestedBy: ME, category: 'reimbursement', 'payee.method': { $in: ['upi', 'bank'] } };
  const explain = await PaymentRequest.findOne(q).sort({ createdAt: -1 }).select('payee').explain('executionStats');
  expectRange(explain, 'payment_request_requester_category', 5);
  expect((await paymentRequestRepository.lastOwnPayee(ME, 'reimbursement')).payee.upiId).toBe('x@ok');
});

it('a task’s box: one page of the task index; the totals read only that task’s payments', async () => {
  const page = await paymentRequestRepository.pageLinked({ task: HOT_TASK }, { limit: 21 }).explain('executionStats');
  expectRange(page, 'payment_request_task', 21);
  const totals = await PaymentRequest.aggregate([{ $match: { task: HOT_TASK } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
    .explain('executionStats');
  expectRange(totals, 'payment_request_task', 60);
});

it('the monthly report reads one month of reimbursements only', async () => {
  const explain = await PaymentRequest.aggregate([
    { $match: { 'reimbursement.on': { $type: 'string', $gte: '2026-07-01', $lt: '2026-08-01' }, category: 'reimbursement', status: { $nin: ['declined', 'cancelled'] } } },
    { $count: 'n' },
  ]).explain('executionStats');
  // ~31 days × 33 payments a day, a quarter of them reimbursements.
  expectRange(explain, 'payment_request_reimbursement_on', 31 * 33 / 4 + 10);
});

it('"T-42" reads one task (staff_task_number)', async () => {
  const explain = await StaffTask.findOne({ number: 42 }).explain('executionStats');
  expect(scans(explain)).toBe(false);
  expect(exec(explain).totalDocsExamined).toBe(1);
  expect((await staffTaskRepository.findByNumber(42)).title).toBe('t41');
});
