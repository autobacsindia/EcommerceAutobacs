/**
 * Index usage for project notifications — the optimization pass's evidence,
 * measured with explain() on a realistic spread (60 people, 300 projects,
 * 6,000 tasks with assignees):
 *   - the bell's "new work" read (every 20 s per open tab) is a short range of
 *     staff_task_inbox_list, never a scan of the person's whole Inbox
 *   - each read of the morning reminder is an index range
 *   - a whole morning run stays well inside the cron lock's 15 minutes
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import StaffTask from '../models/StaffTask.js';
import StaffProject from '../models/StaffProject.js';
import StaffTaskInbox from '../models/StaffTaskInbox.js';
import StaffProjectReminder from '../models/StaffProjectReminder.js';
import staffTaskInboxRepository from '../repositories/staffTaskInboxRepository.js';
import { ALERT_KINDS, ALERTS_MAX } from '../services/staffTaskInboxService.js';
import { runDailyReminders, addDays, SOON_DAYS } from '../services/projectReminderService.js';

jest.setTimeout(180000);

const planOf = (explain) => JSON.stringify(explain.queryPlanner?.winningPlan ?? explain);
const indexesIn = (explain) => [...new Set([...planOf(explain).matchAll(/"indexName":"([^"]+)"/g)].map((m) => m[1]))];
const scans = (explain) => planOf(explain).includes('COLLSCAN');
const exec = (explain) => explain.executionStats;

const TUE = '2030-03-12';
const ymd = (offset) => addDays(TUE, offset);
let people;
const projectIds = Array.from({ length: 300 }, () => new mongoose.Types.ObjectId());

beforeAll(async () => {
  await dbHandler.connect();
  await Promise.all([StaffTask.syncIndexes(), StaffProject.syncIndexes(), StaffTaskInbox.syncIndexes(), StaffProjectReminder.syncIndexes()]);
});

beforeEach(async () => {
  const users = Array.from({ length: 60 }, (_, i) => ({
    name: `P${i}`, email: `pnx${i}@autobacs.test`, phone: '9000000001', passwordHash: 'x',
    role: i === 0 ? 'admin' : 'staff', ...(i && { staff: { active: true, isHead: false, team: 'sales' } }),
  }));
  people = (await User.collection.insertMany(users)).insertedIds;
  people = Object.values(people);
  await StaffProject.collection.insertMany(projectIds.map((_id, i) => ({
    _id, name: `Project ${i}`, owner: { user: people[i % 60], name: '' },
    people: [0, 1, 2].map((k) => ({ user: people[(i + k * 7) % 60], name: `P${(i + k * 7) % 60}`, team: 'sales' })),
    teams: ['sales'], rank: ymd(i % 90), dueOn: ymd((i % 30) - 5), archivedAt: i % 15 === 0 ? new Date() : null,
    statusOverride: null, createdBy: people[0], rev: 1,
  })));
  const tasks = [];
  for (let n = 1; n <= 6000; n += 1) {
    const done = n % 3 === 0;
    const who = people[n % 60];
    const due = n % 10 === 0 ? null : ymd((n % 40) - 20);
    tasks.push({
      number: n, title: `t${n}`, team: 'sales', createdBy: people[0], bucket: done ? 'done' : 'open',
      rank: done ? `d${n}` : due || '9999-12-31', dueOn: due, project: n % 5 === 0 ? undefined : projectIds[n % 300],
      assignee: who, assignees: [{ user: who, name: `P${n % 60}` }], updatedAt: new Date(),
    });
  }
  await StaffTask.collection.insertMany(tasks);
  // A long Inbox: 400 lines for person 4, most of them comments, most of them old.
  const lines = [];
  for (let i = 0; i < 400; i += 1) {
    lines.push({
      _id: new mongoose.Types.ObjectId(Math.floor(Date.now() / 1000) - (400 - i) * 3600),
      user: people[4], key: `k${i}`, kind: i % 8 === 0 ? 'assigned' : 'comment', task: new mongoose.Types.ObjectId(), number: i, title: 't', state: 'unread',
    });
  }
  await StaffTaskInbox.collection.insertMany(lines);
});

it('the bell’s “new work” read: a short range of staff_task_inbox_list, not the whole Inbox', async () => {
  const since = new Date(Date.now() - 24 * 3600_000);
  const explain = await staffTaskInboxRepository.recentUnread(people[4], ALERT_KINDS, since, ALERTS_MAX).explain('executionStats');
  expect(scans(explain)).toBe(false);
  expect(indexesIn(explain)).toEqual(['staff_task_inbox_list']);
  // Only the last day's ~24 lines are read, of the 400.
  expect(exec(explain).totalKeysExamined).toBeLessThanOrEqual(26);
});

it('one person’s own project tasks: staff_task_assignees, their open rows only', async () => {
  const explain = await StaffTask.find({
    'assignees.user': people[4], bucket: 'open', personal: { $ne: true }, project: { $type: 'objectId' },
  }).sort({ rank: 1, _id: 1 }).limit(300).explain('executionStats');
  expect(scans(explain)).toBe(false);
  expect(indexesIn(explain)).toEqual(['staff_task_assignees']);
  expect(planOf(explain)).not.toContain('"stage":"SORT"');
  // Their 100 open tasks (every 60th task, none done), not the 4,000 open in the collection.
  expect(exec(explain).totalDocsExamined).toBeLessThanOrEqual(100);
});

it('a member’s near deadlines: staff_project_people', async () => {
  const uid = people[4];
  const explain = await StaffProject.find({
    'people.user': uid, archivedAt: null, 'owner.user': { $ne: uid }, dueOn: { $type: 'string', $lte: addDays(TUE, SOON_DAYS) },
  }).sort({ rank: 1, _id: 1 }).limit(50).explain('executionStats');
  expect(scans(explain)).toBe(false);
  expect(indexesIn(explain)).toEqual(['staff_project_people']);
  expect(exec(explain).totalDocsExamined).toBeLessThanOrEqual(20);
});

it('the admin’s late list: a rank range over open tasks, capped at 500', async () => {
  // Measured (26,000 tasks): the planner's pick (staff_task_all, open + rank < today) and a
  // hinted staff_task_project both read 573 keys in ~1 ms — a hint is not earned. What
  // matters is that it is a range over late OPEN tasks, never a scan, and stops at the cap.
  const live = projectIds.filter((_, i) => i % 15 !== 0);
  const explain = await StaffTask.find({ project: { $in: live }, bucket: 'open', rank: { $lt: TUE }, personal: { $ne: true } })
    .limit(500).explain('executionStats');
  expect(scans(explain)).toBe(false);
  expect(['staff_task_all', 'staff_task_project']).toEqual(expect.arrayContaining(indexesIn(explain)));
  expect(exec(explain).totalDocsExamined).toBeLessThanOrEqual(600);
});

it('a whole morning run over 60 people: every person once, in seconds', async () => {
  const pushes = [];
  const send = async (to) => { pushes.push(to[0].userId); return 1; };
  const started = Date.now();
  const r = await runDailyReminders(new Date(`${TUE}T05:00:00Z`), { send, holidays: new Set() });
  const ms = Date.now() - started;
  expect(r.failed).toBe(0);
  expect(r.people).toBe(60);
  expect(new Set(pushes).size).toBe(pushes.length);
  console.log(`[measure] morning run: ${r.people} people, ${r.withWork} with work, ${ms} ms`);
  expect(ms).toBeLessThan(30_000);
});
