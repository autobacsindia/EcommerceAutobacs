/**
 * The Tasks list's sort and count (services/staffTaskService.js listTasks).
 *
 * What must hold:
 *   - open tasks: due date (the default), newest or oldest given out; every one
 *     pages with no repeats or gaps, and keeps the person / search / due filters
 *   - done and archived lists keep their own order whatever `sort` says
 *   - the open list's first page says how many match; later pages do not
 *   - the sort never widens what a person sees (their own, or their own team's — never another team's)
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));

const { default: StaffTask } = await import('../models/StaffTask.js');
const { listTasks, todayIST, TASK_PAGE_SIZE } = await import('../services/staffTaskService.js');

const oid = () => new mongoose.Types.ObjectId();
const me = { _id: oid(), role: 'staff', name: 'Me', staff: { active: true, team: 'procurement', isHead: false } };
const head = { _id: oid(), role: 'staff', name: 'Head', staff: { active: true, team: 'procurement', isHead: true } };
const someoneElse = oid();
const T0 = Date.UTC(2026, 9, 1);
const HOUR = 3600e3;

let number = 0;
/** One open task, inserted as stored: `at` hours after T0, due on `dueOn` (or never). */
function task(assignee, { at, dueOn = null, title, bucket = 'open', team = 'procurement' } = {}) {
  number += 1;
  const createdAt = new Date(T0 + (at ?? number) * HOUR);
  return {
    _id: oid(), number, title: title || `Task ${number}`, description: '', status: 'todo', priority: 'normal',
    dueOn, assignee, assigneeName: '', team, assignees: [{ user: assignee, name: '' }], teams: [team], createdBy: head._id, createdByName: 'Head',
    bucket, rank: bucket === 'open' ? (dueOn || '9999-12-31') : `d${String(9e12 - createdAt.getTime()).padStart(13, '0')}`,
    rev: 1, checklist: [], commentCount: 0, history: [], createdAt, updatedAt: createdAt,
  };
}
const insert = (rows) => StaffTask.collection.insertMany(rows);
const titles = (res) => res.tasks.map((t) => t.title);

it('newest and oldest order the open list by when the task was given out; due date stays the default', async () => {
  await insert([
    task(me._id, { at: 1, dueOn: '2026-12-01', title: 'given first, due last' }),
    task(me._id, { at: 3, dueOn: null, title: 'given last, no date' }),
    task(me._id, { at: 2, dueOn: '2026-10-05', title: 'given second, due first' }),
  ]);
  expect(titles(await listTasks(me, { view: 'mine' }))).toEqual(['given second, due first', 'given first, due last', 'given last, no date']);
  expect(titles(await listTasks(me, { view: 'mine', sort: 'newest' }))).toEqual(['given last, no date', 'given second, due first', 'given first, due last']);
  expect(titles(await listTasks(me, { view: 'mine', sort: 'oldest' }))).toEqual(['given first, due last', 'given second, due first', 'given last, no date']);
  expect((await listTasks(me, { view: 'mine', sort: 'sideways' })).sort).toBe('due');
});

it('pages under a sort with no repeats or gaps, keeping the search; counted on the first page only', async () => {
  const rows = Array.from({ length: TASK_PAGE_SIZE + 12 }, (_, i) => task(me._id, { at: i % 3, title: `Call supplier ${i}` }));
  rows.push(task(me._id, { title: 'Pack the parcel' }));
  await insert(rows);
  const p1 = await listTasks(me, { view: 'mine', sort: 'newest', q: 'supplier' });
  expect(p1.tasks).toHaveLength(TASK_PAGE_SIZE);
  expect(p1.summary).toEqual({ count: TASK_PAGE_SIZE + 12, capped: false });
  const p2 = await listTasks(me, { view: 'mine', sort: 'newest', q: 'supplier', cursor: p1.nextCursor });
  expect(p2.summary).toBeUndefined();
  expect(p2.nextCursor).toBeNull();
  const all = [...p1.tasks, ...p2.tasks];
  expect(new Set(all.map((t) => t.id)).size).toBe(TASK_PAGE_SIZE + 12);
  const times = all.map((t) => new Date(t.createdAt).getTime());
  expect(times).toEqual([...times].sort((a, b) => b - a));
});

it('a due filter and a sort together: only what is due, in the order asked for', async () => {
  const today = todayIST();
  await insert([
    task(me._id, { at: 1, dueOn: '2020-01-01', title: 'late, given first' }),
    task(me._id, { at: 2, dueOn: today, title: 'today, given second' }),
    task(me._id, { at: 3, dueOn: '2999-01-01', title: 'far off' }),
  ]);
  const late = await listTasks(me, { view: 'mine', due: 'late', sort: 'newest' });
  expect(titles(late)).toEqual(['today, given second', 'late, given first']);
  expect(late.summary.count).toBe(2);
});

it('done tasks keep "most recently finished first", whatever the sort', async () => {
  await insert([
    task(me._id, { at: 1, bucket: 'done', title: 'finished long ago' }),
    task(me._id, { at: 5, bucket: 'done', title: 'finished just now' }),
  ]);
  const done = await listTasks(me, { view: 'mine', state: 'done', sort: 'oldest' });
  expect(titles(done)).toEqual(['finished just now', 'finished long ago']);
  expect(done.summary).toBeUndefined();
});

it('the sort never shows another team\'s tasks; a member and a head both see their own team\'s', async () => {
  await insert([task(me._id, { title: 'mine' }), task(someoneElse, { title: 'theirs' }), task(oid(), { title: 'other team', team: 'accounts' })]);
  expect(titles(await listTasks(me, { view: 'mine', sort: 'newest' }))).toEqual(['mine']);
  expect(titles(await listTasks(head, { view: 'team', sort: 'oldest' }))).toEqual(['mine', 'theirs']);
  // Since Part 3 (team spaces, like Google Chat) a member sees the whole team too — but only that team.
  expect(titles(await listTasks(me, { view: 'team', sort: 'newest' }))).toEqual(['theirs', 'mine']);
  // Asking for another team is ignored for anyone but the admin: still only their own.
  expect(titles(await listTasks(me, { view: 'team', team: 'accounts', sort: 'newest' }))).toEqual(['theirs', 'mine']);
  const loner = { _id: oid(), role: 'staff', name: 'No team', staff: { active: true, team: null, isHead: false } };
  await expect(listTasks(loner, { view: 'team', sort: 'newest' })).rejects.toMatchObject({ statusCode: 403 });
});
