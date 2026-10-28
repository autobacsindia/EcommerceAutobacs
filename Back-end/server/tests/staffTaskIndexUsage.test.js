/**
 * Staff task index usage — every list, the bell count and the duplicate checks
 * must each be ONE index range, never a collection scan, and must not walk other
 * people's rows. Measured with explain() on a realistic spread of tasks.
 *
 * Why this is pinned: the planner will not use a partial index unless the query
 * restates its filter (the gatewayPaymentId trap — tests/paymentIndexUsage.test.js),
 * and the clientId duplicate checks run on EVERY create and comment.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import StaffTask from '../models/StaffTask.js';
import StaffTaskComment from '../models/StaffTaskComment.js';
import staffTaskRepository from '../repositories/staffTaskRepository.js';

jest.setTimeout(120000);

function chosenIndex(explain) {
  const plan = JSON.stringify(explain.queryPlanner.winningPlan);
  if (plan.includes('COLLSCAN')) return 'COLLSCAN';
  return (plan.match(/"indexName":"([^"]+)"/) || [])[1] || 'UNKNOWN';
}
const stats = (explain) => ({
  index: chosenIndex(explain),
  keys: explain.executionStats.totalKeysExamined,
  docs: explain.executionStats.totalDocsExamined,
  returned: explain.executionStats.nReturned,
});

const PEOPLE = 40;
const PER_PERSON = 100;
const people = Array.from({ length: PEOPLE }, () => new mongoose.Types.ObjectId());
const teams = ['sales', 'procurement', 'accounts', 'operations'];
const ymd = (offset) => new Date(Date.UTC(2026, 9, 27 + offset)).toISOString().slice(0, 10);
const TODAY = ymd(0);
let busyTask;

beforeAll(async () => {
  await dbHandler.connect();
  await StaffTask.syncIndexes();
  await StaffTaskComment.syncIndexes();
});

// tests/setup.js empties every collection after each test, so seed before each.
beforeEach(async () => {
  const docs = [];
  let number = 0;
  for (let p = 0; p < PEOPLE; p += 1) {
    for (let i = 0; i < PER_PERSON; i += 1) {
      number += 1;
      const done = i % 4 === 0;
      const dueOn = i % 5 === 0 ? null : ymd((i % 30) - 10);
      docs.push({
        number, title: `t${number}`, assignee: people[p], team: teams[p % 4],
        createdBy: people[(p + 1) % PEOPLE], status: done ? 'done' : 'todo', priority: 'normal', dueOn,
        bucket: done ? 'done' : 'open', rank: done ? `d${String(9e12 - number).padStart(13, '0')}` : dueOn || '9999-12-31',
        clientId: `client-${number}`,
      });
    }
  }
  await StaffTask.insertMany(docs);
  busyTask = (await StaffTask.findOne({ number: 1 }).lean())._id;
  await StaffTaskComment.insertMany(Array.from({ length: 2000 }, (_, i) => ({
    task: i < 500 ? busyTask : new mongoose.Types.ObjectId(), by: people[i % PEOPLE], text: `c${i}`, clientId: `cmt-${i}`,
  })));
});

afterAll(async () => { await dbHandler.closeDatabase(); });

const listExplain = (query, opts = {}) => {
  const range = opts.range ? { rank: opts.range } : {};
  return StaffTask.find({ ...query, ...range }).sort({ rank: 1, _id: 1 }).limit(51).explain('executionStats');
};

describe('lists are one index range', () => {
  it('my tasks', async () => {
    const s = stats(await listExplain({ assignee: people[3], bucket: 'open' }));
    expect(s.index).toBe('staff_task_assignee');
    expect(s.keys).toBeLessThanOrEqual(s.returned + 1);
  });

  it('my overdue tasks (the bell filter)', async () => {
    const s = stats(await listExplain({ assignee: people[3], bucket: 'open' }, { range: { $lt: TODAY } }));
    expect(s.index).toBe('staff_task_assignee');
    expect(s.keys).toBeLessThanOrEqual(s.returned + 1);
  });

  it('given by me', async () => {
    const s = stats(await listExplain({ createdBy: people[3], bucket: 'open' }));
    expect(s.index).toBe('staff_task_creator');
    expect(s.keys).toBeLessThanOrEqual(s.returned + 1);
  });

  it('a head\'s team', async () => {
    const s = stats(await listExplain({ team: 'procurement', bucket: 'open' }));
    expect(s.index).toBe('staff_task_team');
    expect(s.keys).toBeLessThanOrEqual(s.returned + 1);
  });

  it('the admin\'s everything', async () => {
    const s = stats(await listExplain({ bucket: 'done' }));
    expect(s.index).toBe('staff_task_all');
    expect(s.keys).toBeLessThanOrEqual(s.returned + 1);
  });

  it('a later page starts where the last one stopped', async () => {
    const first = await StaffTask.find({ assignee: people[5], bucket: 'open' }).sort({ rank: 1, _id: 1 }).limit(20).lean();
    const last = first[first.length - 1];
    const s = stats(await staffTaskRepository.page({ assignee: people[5], bucket: 'open' }, { after: { rank: last.rank, id: last._id }, limit: 21 })
      .explain('executionStats'));
    expect(s.index).toBe('staff_task_assignee');
    expect(s.docs).toBeLessThanOrEqual(s.returned + 2);
  });
});

describe('the bell count', () => {
  it('counts on the assignee index without fetching documents', async () => {
    const explain = await StaffTask.find({ assignee: people[7], bucket: 'open', rank: { $lte: TODAY } }).explain('executionStats');
    const s = stats(explain);
    expect(s.index).toBe('staff_task_assignee');
    expect(s.keys).toBeLessThanOrEqual(s.returned + 1);
    expect(await staffTaskRepository.countDueBy(people[7], TODAY)).toBe(s.returned);
  });
});

describe('duplicate checks (every create and comment)', () => {
  it('a create\'s clientId lookup reads one key', async () => {
    const s = stats(await staffTaskRepository.model
      .findOne(staffTaskRepository.clientIdFilter(people[2], 'client-150')).explain('executionStats'));
    expect(s.index).toBe('staff_task_client_id');
    expect(s.keys).toBeLessThanOrEqual(1);
    expect((await staffTaskRepository.findByClientId(people[2], 'client-150')).number).toBe(150);
  });

  it('a comment\'s clientId lookup reads one key', async () => {
    const s = stats(await staffTaskRepository.commentModel
      .findOne(staffTaskRepository.commentClientIdFilter(people[4], 'cmt-4')).explain('executionStats'));
    expect(s.index).toBe('staff_task_comment_client_id');
    expect(s.keys).toBeLessThanOrEqual(1);
    expect((await staffTaskRepository.findCommentByClientId(people[4], 'cmt-4')).text).toBe('c4');
  });

  it('a task\'s comments page on the task index', async () => {
    const s = stats(await StaffTaskComment.find({ task: busyTask }).sort({ _id: -1 }).limit(51).explain('executionStats'));
    expect(s.index).toBe('staff_task_comment_task');
    expect(s.keys).toBeLessThanOrEqual(51);
  });
});


describe('the copies of a task given to several people', () => {
  // Measured before the index: COLLSCAN, 4,003 docs examined to return 3.
  it('are found on the group index, reading only that group', async () => {
    const group = new mongoose.Types.ObjectId();
    await StaffTask.insertMany([0, 1, 2].map((i) => ({
      number: 900000 + i, title: 'g', assignee: people[i], createdBy: people[9], status: 'todo', priority: 'normal',
      bucket: 'open', rank: '9999-12-31', group, groupSize: 3,
    })));
    const s = stats(await staffTaskRepository.findGroup(group).explain('executionStats'));
    expect(s.index).toBe('staff_task_group');
    expect(s.keys).toBeLessThanOrEqual(3);
    expect(s.returned).toBe(3);
  });
});

describe('list pages send counts, not checklists', () => {
  it('a page of 50 tasks with five steps each reads about half the bytes', async () => {
    const step = (i) => ({ _id: new mongoose.Types.ObjectId(), text: `Step number ${i} of the job`, done: i % 2 === 0, key: `k-${i}-123456789` });
    await StaffTask.updateMany({ assignee: people[11] }, { $set: { checklist: [0, 1, 2, 3, 4].map(step) } });
    const query = { assignee: people[11], bucket: 'open' };
    const full = await StaffTask.find(query).sort({ rank: 1, _id: 1 }).limit(50).select('-history -clientId').lean();
    const rows = await staffTaskRepository.page(query, { limit: 50 });
    const bytes = (docs) => docs.reduce((n, d) => n + mongoose.mongo.BSON.calculateObjectSize(d), 0);
    expect(rows.every((r) => r.checklist === undefined && r.checklistTotal === 5 && r.checklistDone === 3)).toBe(true);
    expect(bytes(rows)).toBeLessThan(bytes(full) * 0.6);
  });
});
