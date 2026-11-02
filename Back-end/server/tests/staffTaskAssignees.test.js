/**
 * Tasks phase 4a — the several-people fields (`assignees`, `teams`), written
 * beside `assignee` / `team`, and the backfill for tasks made before them.
 *
 * What must hold:
 *   - every create and every change of person writes the new fields too, and
 *     they always describe the same one person as `assignee` / `team`
 *     (the admin's own task: team null in both)
 *   - "own copy each" still makes one task per person, each with its own one person
 *   - the backfill: a dry run writes nothing; --apply fills every older task from
 *     its own fields; a second run changes nothing; it never overwrites a task
 *     the live code already wrote
 *   - the new list indexes serve "my tasks" and "my team's tasks" as one index
 *     range, sorted by the index (no in-memory sort), even with several people
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

jest.setTimeout(120000);

const pushMock = {
  pushConfigured: () => true,
  publicKey: () => 'k',
  cleanSubscription: (x) => x,
  subscribe: async () => ({ subscribed: true }),
  unsubscribe: async () => ({ subscribed: false }),
  sendToUsers: async (recipients) => recipients.length,
  sendTest: async () => ({ sent: 1 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const tasks = await import('../services/staffTaskService.js');
const { backfill } = await import('../scripts/backfill-task-assignees.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name, email: `a${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const raw = (id) => StaffTask.findById(id).lean();
const people = (t) => (t.assignees || []).map((p) => ({ user: String(p.user), name: p.name }));

let admin, procHead, procA, salesA;
beforeAll(async () => { await StaffTask.syncIndexes(); });
beforeEach(async () => {
  admin = await person('admin', null, 'Owner');
  procHead = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
  procA = await person('staff', { team: 'procurement' }, 'Arun');
  salesA = await person('staff', { team: 'sales' }, 'Sam');
});

describe('every write carries the several-people fields', () => {
  it('a task for one person: that person and their team', async () => {
    const { task } = await tasks.createTask(procHead, { title: 'Count stock', assigneeId: String(procA._id) }, req);
    const t = await raw(task.id);
    expect(people(t)).toEqual([{ user: String(procA._id), name: 'Arun' }]);
    expect(t.teams).toEqual(['procurement']);
    expect(t.followers).toBeUndefined();
  });

  it('the admin\'s own task: team null in both forms', async () => {
    const { task } = await tasks.createTask(admin, { title: 'Plan training' }, req);
    const t = await raw(task.id);
    expect(t.team).toBeNull();
    expect(people(t)).toEqual([{ user: String(admin._id), name: 'Owner' }]);
    expect(t.teams).toEqual([null]);
  });

  it('"own copy each" still makes one task per person, each with its own one person', async () => {
    const { tasks: made } = await tasks.createTask(admin, {
      title: 'Read the new policy', assigneeIds: [String(procA._id), String(salesA._id)], clientId: 'copies-0001',
    }, req);
    expect(made).toHaveLength(2);
    const [a, b] = await Promise.all(made.map((t) => raw(t.id)));
    expect(people(a)).toEqual([{ user: String(procA._id), name: 'Arun' }]);
    expect(a.teams).toEqual(['procurement']);
    expect(people(b)).toEqual([{ user: String(salesA._id), name: 'Sam' }]);
    expect(b.teams).toEqual(['sales']);
  });

  it('a retried create does not write the task twice', async () => {
    const input = { title: 'Once', assigneeId: String(procA._id), clientId: 'retry-0001' };
    const first = await tasks.createTask(procHead, input, req);
    const again = await tasks.createTask(procHead, input, req);
    expect(again.duplicate).toBe(true);
    expect(await StaffTask.countDocuments({ clientId: 'retry-0001' })).toBe(1);
    expect(people(await raw(first.task.id))).toHaveLength(1);
  });

  it('giving it to someone else moves the new fields with it', async () => {
    const { task } = await tasks.createTask(admin, { title: 'Call Bosch', assigneeId: String(procA._id) }, req);
    await tasks.updateTask(admin, task.id, { rev: task.rev, assigneeId: String(salesA._id) }, req);
    const t = await raw(task.id);
    expect(String(t.assignee)).toBe(String(salesA._id));
    expect(people(t)).toEqual([{ user: String(salesA._id), name: 'Sam' }]);
    expect(t.teams).toEqual(['sales']);
  });

  it('a change that is not about the person leaves the fields as they were', async () => {
    const { task } = await tasks.createTask(procHead, { title: 'Call Bosch', assigneeId: String(procA._id) }, req);
    await tasks.updateTask(procHead, task.id, { rev: task.rev, status: 'in_progress', priority: 'high' }, req);
    const t = await raw(task.id);
    expect(people(t)).toEqual([{ user: String(procA._id), name: 'Arun' }]);
    expect(t.teams).toEqual(['procurement']);
  });

  it('a bulk change of person writes them too', async () => {
    const { task } = await tasks.createTask(admin, { title: 'Bulk', assigneeId: String(procA._id) }, req);
    const r = await tasks.bulkUpdate(admin, { items: [{ id: task.id, rev: task.rev }], changes: { assigneeId: String(salesA._id) } }, req);
    expect(r.changed).toBe(1);
    const t = await raw(task.id);
    expect(people(t)).toEqual([{ user: String(salesA._id), name: 'Sam' }]);
    expect(t.teams).toEqual(['sales']);
  });

  it('a refused change of person writes nothing', async () => {
    const { task } = await tasks.createTask(procHead, { title: 'Mine to give', assigneeId: String(procA._id) }, req);
    await expect(tasks.updateTask(procA, task.id, { rev: task.rev, assigneeId: String(salesA._id) }, req))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(people(await raw(task.id))).toEqual([{ user: String(procA._id), name: 'Arun' }]);
  });
});

describe('scripts/backfill-task-assignees.js', () => {
  const db = () => mongoose.connection.db;
  const ids = () => new mongoose.Types.ObjectId();
  /** A task as the code before phase 4a wrote it: no assignees, no teams. */
  const legacy = (over = {}) => ({
    number: Math.floor(Math.random() * 1e9), title: 'Old', status: 'todo', priority: 'normal', bucket: 'open', rank: '9999-12-31',
    assignee: ids(), assigneeName: 'Old person', team: 'procurement', createdBy: ids(), rev: 1, ...over,
  });

  it('a dry run counts and shows, and writes nothing', async () => {
    await db().collection('stafftasks').insertMany([legacy(), legacy({ team: null })]);
    const r = await backfill(db());
    expect(r).toMatchObject({ total: 2, missing: 2, filled: 0, left: 2, mismatched: 0 });
    expect(r.sample).toHaveLength(2);
    expect(await db().collection('stafftasks').countDocuments({ assignees: { $exists: true } })).toBe(0);
  });

  it('--apply fills each task from its own fields, in small batches, and checks the result', async () => {
    const docs = [
      legacy({ assigneeName: 'Arun' }),
      legacy({ team: null, assigneeName: 'Owner' }), // the admin's own task
      legacy({ assigneeName: undefined, team: 'sales' }), // a name never written
      ...Array.from({ length: 7 }, () => legacy()),
    ];
    await db().collection('stafftasks').insertMany(docs);
    const lines = [];
    const r = await backfill(db(), { apply: true, batch: 3, log: (l) => lines.push(l) });
    expect(r).toMatchObject({ total: 10, missing: 10, filled: 10, left: 0, mismatched: 0 });
    expect(lines.length).toBe(4); // 3 + 3 + 3 + 1

    const got = await db().collection('stafftasks').find({}).sort({ _id: 1 }).toArray();
    const byId = new Map(got.map((t) => [String(t._id), t]));
    for (const d of docs) {
      const t = byId.get(String(d._id));
      expect(t.assignees).toEqual([{ user: d.assignee, name: d.assigneeName ?? '' }]);
      expect(t.teams).toEqual([d.team ?? null]);
      // The old fields are never touched.
      expect(t.assignee).toEqual(d.assignee);
      expect(t.team ?? null).toEqual(d.team ?? null);
    }
  });

  it('running it again changes nothing', async () => {
    await db().collection('stafftasks').insertMany([legacy(), legacy()]);
    await backfill(db(), { apply: true });
    const again = await backfill(db(), { apply: true });
    expect(again).toMatchObject({ total: 2, missing: 0, filled: 0, left: 0, mismatched: 0 });
  });

  it('never overwrites a task the live code already wrote', async () => {
    const written = legacy({ assignees: [{ user: ids(), name: 'Written by the app' }], teams: ['sales'] });
    await db().collection('stafftasks').insertMany([written, legacy()]);
    const r = await backfill(db(), { apply: true });
    expect(r.filled).toBe(1);
    const t = await db().collection('stafftasks').findOne({ _id: written._id });
    expect(t.assignees[0].name).toBe('Written by the app');
    expect(t.teams).toEqual(['sales']);
    // Its first person is not its assignee, so the check reports it rather than hiding it.
    expect(r.mismatched).toBe(1);
  });

  it('an empty collection is fine', async () => {
    expect(await backfill(db(), { apply: true })).toMatchObject({ total: 0, missing: 0, filled: 0, left: 0, mismatched: 0 });
  });

  it('tasks written by the app itself need nothing', async () => {
    await tasks.createTask(procHead, { title: 'New', assigneeId: String(procA._id) }, req);
    expect(await backfill(db())).toMatchObject({ total: 1, missing: 0, mismatched: 0 });
  });
});

describe('the new list indexes', () => {
  const plan = (explain) => JSON.stringify(explain.queryPlanner.winningPlan);
  const indexOf = (explain) => (plan(explain).includes('COLLSCAN') ? 'COLLSCAN' : (plan(explain).match(/"indexName":"([^"]+)"/) || [])[1]);

  beforeEach(async () => {
    const who = Array.from({ length: 12 }, () => new mongoose.Types.ObjectId());
    const teamsOf = ['sales', 'procurement', 'accounts'];
    const docs = [];
    for (let i = 0; i < 600; i += 1) {
      const a = who[i % 12];
      const b = who[(i + 5) % 12];
      docs.push({
        number: i + 1, title: `t${i}`, status: 'todo', priority: 'normal', bucket: i % 3 ? 'open' : 'done',
        rank: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`, assignee: a, team: teamsOf[i % 3], createdBy: b, rev: 1,
        // Every third task has two people, from two teams.
        assignees: i % 3 === 0 ? [{ user: a, name: 'a' }, { user: b, name: 'b' }] : [{ user: a, name: 'a' }],
        teams: i % 3 === 0 ? [teamsOf[i % 3], teamsOf[(i + 1) % 3]] : [teamsOf[i % 3]],
      });
    }
    await StaffTask.collection.insertMany(docs);
  });

  it('"my tasks" is one range on staff_task_assignees, sorted by the index', async () => {
    const me = (await StaffTask.findOne({}).lean()).assignee;
    const ex = await StaffTask.find({ 'assignees.user': me, bucket: 'open' }).sort({ rank: 1, _id: 1 }).limit(50).explain('executionStats');
    expect(indexOf(ex)).toBe('staff_task_assignees');
    expect(plan(ex)).not.toContain('"stage":"SORT"');
    expect(ex.executionStats.totalDocsExamined).toBe(ex.executionStats.nReturned);
  });

  it('"my team\'s tasks" is one range on staff_task_teams, sorted by the index', async () => {
    const ex = await StaffTask.find({ teams: 'sales', bucket: 'open', rank: { $lte: '2026-11-10' } })
      .sort({ rank: 1, _id: 1 }).limit(50).explain('executionStats');
    expect(indexOf(ex)).toBe('staff_task_teams');
    expect(plan(ex)).not.toContain('"stage":"SORT"');
    expect(ex.executionStats.totalDocsExamined).toBe(ex.executionStats.nReturned);
  });
});
