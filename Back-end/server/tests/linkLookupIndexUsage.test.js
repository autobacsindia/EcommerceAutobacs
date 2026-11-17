/**
 * The admin lookup's reads (services/linkLookupService.js) and the project-code
 * read used when linking a payment must each be an index range, never a
 * collection scan, and read about a page — measured with explain() over a
 * realistic spread (6,000 payments, 6,000 tasks, 300 projects).
 *
 * Why pinned: prod runs with autoIndex off, so these indexes exist only because
 * config/db.js ensureCriticalIndexes builds them. If a query drifts off its index
 * the lookup still "works" — by scanning every payment. This catches that.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import StaffTask from '../models/StaffTask.js';
import StaffProject from '../models/StaffProject.js';
import PaymentRequest from '../models/PaymentRequest.js';
import staffTaskRepository from '../repositories/staffTaskRepository.js';
import staffProjectRepository from '../repositories/staffProjectRepository.js';
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';

jest.setTimeout(120000);

const planOf = (explain) => JSON.stringify(explain.queryPlanner?.winningPlan ?? explain.stages?.[0]?.$cursor?.queryPlanner?.winningPlan ?? explain);
const indexesIn = (explain) => [...new Set([...planOf(explain).matchAll(/"indexName":"([^"]+)"/g)].map((m) => m[1]))];
const scans = (explain) => planOf(explain).includes('COLLSCAN');
const exec = (explain) => explain.executionStats ?? explain.stages?.[0]?.$cursor?.executionStats;

const N = 6000;
const projectIds = Array.from({ length: 300 }, () => new mongoose.Types.ObjectId());
const orderIds = Array.from({ length: 500 }, () => new mongoose.Types.ObjectId());
const someone = new mongoose.Types.ObjectId();
const HOT = projectIds[0];

beforeAll(async () => {
  await dbHandler.connect();
  await Promise.all([StaffTask.syncIndexes(), StaffProject.syncIndexes(), PaymentRequest.syncIndexes()]);
});
// tests/setup.js empties the database after every test: seed before each.
beforeEach(async () => {
  await StaffProject.collection.insertMany(projectIds.map((_id, i) => ({
    _id, number: i + 1, name: `P${i}`, owner: { user: someone, name: '' }, people: [], teams: [], rank: '9999-12-31', archivedAt: null, createdBy: someone,
  })));
  const day = Date.UTC(2026, 0, 1);
  const pays = [];
  for (let i = 0; i < N; i += 1) {
    // 1 in 3 payments has a project — the hot project has 200 of them; 1 in 10 an order; 1 in 20 a reference.
    const project = i < 200 ? HOT : i % 3 === 0 ? projectIds[1 + (i % 299)] : null;
    pays.push({
      number: `PR-${i}`, kind: 'expense', status: ['submitted', 'approved', 'paid'][i % 3], team: 'operations', requestedBy: someone, requestedByName: '',
      amount: 100 + i, category: 'fuel', payee: { name: 'x', method: 'upi' }, project, projectCode: project ? 'PRJ-x' : '', projectName: '',
      order: i % 10 === 0 ? orderIds[i % 500] : null, reference: i % 20 === 0 ? `INV-${i % 40}` : '',
      createdAt: new Date(day + i * 60000), updatedAt: new Date(day + i * 60000), history: [], files: [],
    });
  }
  await PaymentRequest.collection.insertMany(pays);
  const tasks = [];
  for (let n = 1; n <= N; n += 1) {
    tasks.push({
      number: n, title: `t${n}`, status: 'todo', bucket: n % 4 === 0 ? 'done' : 'open', rank: `r${String(n).padStart(6, '0')}`,
      assignees: [], teams: ['sales'], createdBy: someone, priority: 'normal',
      ...(n % 7 === 0 ? { order: { target: orderIds[n % 500], code: '#x' } } : {}),
      ...(n <= 300 ? { project: HOT } : {}), checklist: [], files: [], history: [], rev: 1,
    });
  }
  await StaffTask.collection.insertMany(tasks);
});
afterAll(async () => { await dbHandler.closeDatabase(); });

const expectRange = (explain, index, maxKeys) => {
  expect(scans(explain)).toBe(false);
  expect(indexesIn(explain)).toContain(index);
  expect(exec(explain).totalKeysExamined).toBeLessThanOrEqual(maxKeys);
};

it('a typed project code reads one project (staff_project_number)', async () => {
  expectRange(await staffProjectRepository.findByNumber(7).explain('executionStats'), 'staff_project_number', 1);
});

it('a project’s payments: one page of the index, newest first, also after a cursor', async () => {
  const first = await paymentRequestRepository.pageLinked({ project: HOT }, { limit: 21 }).explain('executionStats');
  expectRange(first, 'payment_request_project', 21);
  const rows = await paymentRequestRepository.pageLinked({ project: HOT }, { limit: 21 });
  const last = rows[19];
  const next = await paymentRequestRepository.pageLinked({ project: HOT }, { after: { createdAt: last.createdAt, id: last._id }, limit: 21 }).explain('executionStats');
  expect(scans(next)).toBe(false);
  expect(exec(next).totalDocsExamined).toBeLessThanOrEqual(22);
});

it('an other ID reads only the payments carrying it (payment_request_reference)', async () => {
  expectRange(await paymentRequestRepository.pageLinked({ reference: 'INV-4' }, { limit: 21 }).explain('executionStats'), 'payment_request_reference', 21);
});

it('a project’s payment totals and linked orders read only that project’s rows', async () => {
  const totals = await PaymentRequest.aggregate([
    { $match: { project: HOT } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]).explain('executionStats');
  expect(scans(totals)).toBe(false);
  expect(indexesIn(totals)).toContain('payment_request_project');
  const got = await paymentRequestRepository.totalsForProject(HOT);
  expect(got.reduce((s, r) => s + r.n, 0)).toBe(200);
});

it('an order’s tasks (staff_task_order) and a project’s tasks per bucket (staff_task_project) are index ranges', async () => {
  expectRange(await staffTaskRepository.pageForOrder(orderIds[7], { limit: 21 }).explain('executionStats'), 'staff_task_order', 21);
  const open = await staffTaskRepository.pageForProject(HOT, 'open', { limit: 21 }).explain('executionStats');
  expectRange(open, 'staff_task_project', 21);
  expect(planOf(open)).not.toContain('"stage":"SORT"');
});
