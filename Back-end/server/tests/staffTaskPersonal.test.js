/**
 * Time estimates, and the private Personal list.
 *
 * What must hold:
 *   - a personal task is seen by its maker ONLY: the admin, their head and their
 *     team get 404, and it is in nobody else's list ("All teams" included)
 *   - it can never be shared: no other assignee, follower, mention or team list,
 *     through the single edit or the bulk edit
 *   - everything under it stays personal; a shared task can't have a personal sub-task
 *   - a retried create makes one task
 *   - the estimate is optional, bounded, editable only by editors, and logged
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

jest.setTimeout(120000);

const pushes = [];
const pushMock = {
  pushConfigured: () => true, publicKey: () => 'k', cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}),
  sendToUsers: async (recipients) => { pushes.push(recipients.map((r) => r.userId)); return recipients.length; },
  sendTest: async () => ({ sent: 1 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const tasks = await import('../services/staffTaskService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name, email: `p${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const refused = (promise, status) => expect(promise).rejects.toMatchObject({ statusCode: status });
const codes = (res) => res.tasks.map((t) => t.code);

let admin, head, me, mate;
beforeAll(async () => { await StaffTask.syncIndexes(); });
beforeEach(async () => {
  pushes.length = 0;
  admin = await person('admin', null, 'Owner');
  head = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
  me = await person('staff', { team: 'procurement' }, 'Arun');
  mate = await person('staff', { team: 'procurement' }, 'Bala');
});
const mine = async (extra = {}) => (await tasks.createTask(me, { title: 'Renew my licence', personal: true, ...extra }, req)).task;

describe('the Personal list', () => {
  it('only its maker sees it: everyone else gets 404, the admin too', async () => {
    const t = await mine();
    expect(t).toMatchObject({ personal: true, teamLabel: 'Personal', assignees: [{ name: 'Arun' }], list: null });
    expect((await tasks.getTask(me, t.id)).title).toBe('Renew my licence');
    for (const other of [admin, head, mate]) await refused(tasks.getTask(other, t.id), 404);
  });

  it('is in the maker\'s Personal and My tasks lists, and no team list', async () => {
    const t = await mine();
    const shared = (await tasks.createTask(me, { title: 'Team job' }, req)).task;
    expect(codes(await tasks.listTasks(me, { view: 'personal' }))).toEqual([t.code]);
    expect(codes(await tasks.listTasks(me, { view: 'mine' })).sort()).toEqual([t.code, shared.code].sort());
    expect(codes(await tasks.listTasks(me, { view: 'team' }))).toEqual([shared.code]);
    expect(codes(await tasks.listTasks(head, { view: 'team' }))).toEqual([shared.code]);
    expect(codes(await tasks.listTasks(admin, { view: 'team' }))).toEqual([shared.code]);
    expect(codes(await tasks.listTasks(admin, { view: 'team', team: 'procurement' }))).toEqual([shared.code]);
    expect(codes(await tasks.listTasks(admin, { view: 'team', team: 'admin' }))).toEqual([]);
    expect((await tasks.listTasks(admin, { view: 'personal' })).tasks).toEqual([]);
    expect((await tasks.listTasks(admin, { view: 'team', state: 'archived' })).tasks).toEqual([]);
  });

  it('ignores anyone picked when it is made, and tells nobody', async () => {
    const t = await mine({ assigneeIds: [String(mate._id)], shared: true });
    expect(t.assignees.map((p) => p.name)).toEqual(['Arun']);
    expect(pushes).toEqual([]);
    const row = await StaffTask.findById(t.id).lean();
    expect(row.teams).toEqual([]);
    expect(row.team).toBeNull();
  });

  it('can never be shared afterwards: person, list, follower or mention', async () => {
    const t = await mine();
    await refused(tasks.updateTask(me, t.id, { rev: t.rev, assigneeIds: [String(mate._id)] }, req), 400);
    await refused(tasks.updateTask(me, t.id, { rev: t.rev, listId: String(new mongoose.Types.ObjectId()) }, req), 400);
    await refused(tasks.changeFollowers(me, t.id, { add: [String(mate._id)] }), 400);
    await refused(tasks.addComment(me, t.id, { text: 'hey', mentions: [String(mate._id)] }), 400);
    expect((await tasks.listMentionable(me, t.id)).people).toEqual([]);
    const res = await tasks.bulkUpdate(me, { items: [{ id: t.id, rev: t.rev }], changes: { assigneeId: String(mate._id) } }, req);
    expect(res.results[0]).toMatchObject({ ok: false, status: 400 });
    const row = await StaffTask.findById(t.id).lean();
    expect(row.assignees).toHaveLength(1);
    expect(row.followers ?? []).toEqual([]);
  });

  it('the maker works on it normally, and the buttons say what they can do', async () => {
    const t = await mine();
    expect(t.can).toMatchObject({ edit: true, status: true, reassign: false, follow: false, followers: false, comment: true });
    const done = await tasks.updateTask(me, t.id, { rev: t.rev, status: 'done', title: 'Licence renewed' }, req);
    expect(done).toMatchObject({ status: 'done', title: 'Licence renewed' });
    await expect(tasks.addComment(me, t.id, { text: 'note to self' })).resolves.toBeTruthy();
  });

  it('nobody else can change it, even knowing its id', async () => {
    const t = await mine();
    for (const other of [admin, head, mate]) {
      await refused(tasks.updateTask(other, t.id, { rev: t.rev, title: 'Nope' }, req), 404);
      await refused(tasks.addComment(other, t.id, { text: 'hi' }), 404);
      const res = await tasks.bulkUpdate(other, { items: [{ id: t.id, rev: t.rev }], changes: { priority: 'high' } }, req);
      expect(res.results[0]).toMatchObject({ ok: false, status: 404 });
    }
  });

  it('a sub-task of it is personal too, whoever was picked; a shared task refuses one', async () => {
    const t = await mine();
    const { task: child } = await tasks.createTask(me, { title: 'Step', parentId: t.id, assigneeIds: [String(mate._id)] }, req);
    expect(child.personal).toBe(true);
    expect(child.assignees.map((p) => p.name)).toEqual(['Arun']);
    await refused(tasks.getTask(mate, child.id), 404);
    const shared = (await tasks.createTask(me, { title: 'Team job' }, req)).task;
    await refused(tasks.createTask(me, { title: 'Secret', parentId: shared.id, personal: true }, req), 400);
  });

  it('a retried create makes one task', async () => {
    const clientId = 'personal-retry-1';
    const [a, b] = await Promise.all([mine({ clientId }), mine({ clientId })]);
    expect(a.id).toBe(b.id);
    expect(await StaffTask.countDocuments({ personal: true })).toBe(1);
  });

  it('empty: someone with none sees an empty list', async () => {
    expect(await tasks.listTasks(mate, { view: 'personal' })).toMatchObject({ tasks: [], nextCursor: null });
  });

  it('the list is one range on staff_task_personal, sorted by the index', async () => {
    await StaffTask.insertMany(Array.from({ length: 300 }, (_, i) => ({
      number: 70000 + i, title: `t${i}`, assignee: me._id, assignees: [{ user: me._id, name: '' }], teams: i % 3 ? ['procurement'] : [],
      ...(i % 3 ? {} : { personal: true }), createdBy: me._id, status: 'todo', priority: 'normal', bucket: 'open',
      rank: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`,
    })));
    const plan = await StaffTask.find({ createdBy: me._id, personal: true, bucket: 'open' }).sort({ rank: 1, _id: 1 }).limit(51).explain('executionStats');
    const text = JSON.stringify(plan.queryPlanner.winningPlan);
    expect(text).toContain('staff_task_personal');
    expect(text).not.toContain('"SORT"');
    expect(plan.executionStats.totalDocsExamined).toBe(51);
  });
});

describe('time estimate', () => {
  it('is optional, set when made, changed and cleared, and logged', async () => {
    const { task } = await tasks.createTask(head, { title: 'Stock check', assigneeIds: [String(me._id)], estimateMinutes: 120 }, req);
    expect(task.estimateMinutes).toBe(120);
    expect((await tasks.createTask(head, { title: 'None', assigneeIds: [String(me._id)] }, req)).task.estimateMinutes).toBeNull();
    const changed = await tasks.updateTask(head, task.id, { rev: task.rev, estimateMinutes: 90 }, req);
    expect(changed.estimateMinutes).toBe(90);
    expect(changed.history[0]).toMatchObject({ action: 'estimate', from: '120', to: '90' });
    const cleared = await tasks.updateTask(head, task.id, { rev: changed.rev, estimateMinutes: null }, req);
    expect(cleared.estimateMinutes).toBeNull();
    expect(cleared.history[0]).toMatchObject({ from: '90', to: 'none' });
    expect((await tasks.listTasks(me, { view: 'mine' })).tasks[0]).toHaveProperty('estimateMinutes');
  });

  it.each([[0], [-5], [60001], [1.5], ['abc']])('refuses %p', async (estimateMinutes) => {
    await refused(tasks.createTask(me, { title: 'x', estimateMinutes }, req), 400);
  });

  it('only editors change it; the same value changes nothing; a stale edit is refused', async () => {
    const { task } = await tasks.createTask(head, { title: 'Job', assigneeIds: [String(me._id)], estimateMinutes: 60 }, req);
    await refused(tasks.updateTask(me, task.id, { rev: task.rev, estimateMinutes: 30 }, req), 403);
    expect((await tasks.updateTask(me, task.id, { rev: task.rev, estimateMinutes: 60 }, req)).rev).toBe(task.rev);
    await tasks.updateTask(head, task.id, { rev: task.rev, title: 'Job 2' }, req);
    await refused(tasks.updateTask(head, task.id, { rev: task.rev, estimateMinutes: 30 }, req), 409);
  });
});
