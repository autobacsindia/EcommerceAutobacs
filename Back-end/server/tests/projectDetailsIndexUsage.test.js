/**
 * Index usage for project details and the daily reminder — measured with
 * explain() on a realistic spread, the optimization pass's evidence:
 *   - the reminder's two reads (an owner's projects, their open tasks) and its
 *     once-a-day row are index ranges, never collection scans
 *   - "fill from order" by the short number reads only the look-back window of
 *     order_list_date, not every order
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import StaffTask from '../models/StaffTask.js';
import StaffProject from '../models/StaffProject.js';
import StaffProjectReminder from '../models/StaffProjectReminder.js';
import Order from '../models/Order.js';
import { digestFor, ensureRow } from '../services/projectReminderService.js';
import { findOrder, ORDER_SUFFIX_LOOKBACK_DAYS } from '../services/staffProjectDetailsService.js';

jest.setTimeout(120000);

const planOf = (explain) => JSON.stringify(explain.queryPlanner?.winningPlan ?? explain);
const indexesIn = (explain) => [...new Set([...planOf(explain).matchAll(/"indexName":"([^"]+)"/g)].map((m) => m[1]))];
const scans = (explain) => planOf(explain).includes('COLLSCAN');
const exec = (explain) => explain.executionStats;

const people = Array.from({ length: 60 }, () => new mongoose.Types.ObjectId());
const projectIds = Array.from({ length: 300 }, () => new mongoose.Types.ObjectId());
const ymd = (offset) => new Date(Date.UTC(2030, 2, 10 + offset)).toISOString().slice(0, 10);
const DAY = 86_400_000;
const NOW = new Date('2030-03-10T05:00:00Z');

beforeAll(async () => {
  await dbHandler.connect();
  await Promise.all([StaffTask.syncIndexes(), StaffProject.syncIndexes(), StaffProjectReminder.syncIndexes(), Order.syncIndexes()]);
});

beforeEach(async () => {
  await StaffProject.collection.insertMany(projectIds.map((_id, i) => ({
    _id, name: `P${i}`, owner: { user: people[i % 60], name: '' },
    people: [0, 1, 2].map((k) => ({ user: people[(i + k * 7) % 60], name: '', team: 'sales' })),
    teams: ['sales'], rank: ymd(i % 90), archivedAt: i % 15 === 0 ? new Date() : null, createdBy: people[0],
  })));
  const tasks = [];
  for (let n = 1; n <= 6000; n += 1) {
    const done = n % 3 === 0;
    tasks.push({
      number: n, title: `t${n}`, team: 'sales', createdBy: people[0], bucket: done ? 'done' : 'open',
      rank: done ? `d${n}` : ymd((n % 40) - 20), dueOn: ymd((n % 40) - 20), project: projectIds[n % 300],
    });
  }
  await StaffTask.collection.insertMany(tasks);
  const orders = [];
  for (let n = 0; n < 4000; n += 1) orders.push({ listDate: new Date(NOW.getTime() - n * 0.25 * DAY), shippingAddress: { fullName: `C${n}` } });
  await Order.collection.insertMany(orders);
});

it('an owner’s projects for the reminder: one range of staff_project_people', async () => {
  const uid = people[4];
  const explain = await StaffProject.find({ 'people.user': uid, archivedAt: null, 'owner.user': uid })
    .sort({ rank: 1, _id: 1 }).limit(50).explain('executionStats');
  expect(scans(explain)).toBe(false);
  expect(indexesIn(explain)).toEqual(['staff_project_people']);
  expect(exec(explain).totalDocsExamined).toBeLessThanOrEqual(20); // their ~15 projects, not 300
  expect(planOf(explain)).not.toContain('"stage":"SORT"');
});

it('their open tasks: staff_task_project, only those projects’ rows', async () => {
  const mine = projectIds.filter((_, i) => i % 60 === 4);
  const explain = await StaffTask.find({ project: { $in: mine }, bucket: 'open', personal: { $ne: true } })
    .sort({ rank: 1, _id: 1 }).limit(500).explain('executionStats');
  expect(scans(explain)).toBe(false);
  expect(indexesIn(explain)).toEqual(['staff_task_project']);
  // Exactly their 5 projects × 20 open tasks — not the 4000 open tasks in the collection.
  expect(exec(explain).totalDocsExamined).toBe(100);
  const digest = await digestFor(people[4], ymd(0));
  expect(digest.length).toBeGreaterThan(0);
});

it('the once-a-day row is a unique-index lookup', async () => {
  await ensureRow(people[1], ymd(0), NOW);
  const explain = await StaffProjectReminder.find({ user: people[1], day: ymd(0) }).explain('executionStats');
  expect(indexesIn(explain)).toEqual(['staff_project_reminder_user_day']);
  expect(exec(explain).totalDocsExamined).toBe(1);
});

it('an order by its short number reads only the look-back window of order_list_date', async () => {
  const since = new Date(NOW.getTime() - ORDER_SUFFIX_LOOKBACK_DAYS * DAY);
  const target = await Order.collection.findOne({ listDate: { $lt: new Date(NOW.getTime() - 10 * DAY) } });
  const short = String(target._id).slice(-8);
  const explain = await Order.find({
    listDate: { $gte: since },
    $expr: { $eq: [{ $substrCP: [{ $toString: '$_id' }, 16, 8] }, short] },
  }).sort({ listDate: -1, _id: -1 }).limit(2).explain('executionStats');
  expect(scans(explain)).toBe(false);
  expect(indexesIn(explain)).toEqual(['order_list_date']);
  // 120 days × 4 orders a day = 480 in the window, of 4000 orders.
  expect(exec(explain).totalDocsExamined).toBeLessThanOrEqual(ORDER_SUFFIX_LOOKBACK_DAYS * 4 + 1);
  const found = await findOrder(`#${short.toUpperCase()}`, NOW);
  expect(String(found._id)).toBe(String(target._id));
});
