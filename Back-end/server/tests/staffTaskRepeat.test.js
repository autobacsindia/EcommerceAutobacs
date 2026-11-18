/**
 * Repeating tasks ("Monthly office supply purchase", due on the 1st, every month).
 *
 * What must hold:
 *   - the date rules: every N days / weeks / months, "day X of the month",
 *     month ends (the 31st → the last day of a short month, and back to the 31st),
 *     leap years, and a task done late never comes back already overdue
 *   - marking a repeating task done makes ONE next copy with the next due date,
 *     the same title, people, list, project (first not-started status), priority,
 *     tags and checklist (unticked) — not comments, files, time or the order
 *   - done twice at once, a retried request, a bulk retry, or reopen-then-done
 *     again: still exactly one copy (unique staff_task_repeat_of)
 *   - reopening the done task leaves the copy; "Never" or archiving ends the chain
 *   - the date limits and approval do not stop the copy (owner's call)
 *   - who may set a repeat: whoever may edit the task; never on a sub-task
 */
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const pushMock = {
  pushConfigured: () => false, publicKey: () => null, cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}), sendToUsers: async () => 0, sendTest: async () => ({ sent: 0 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffProject } = await import('../models/StaffProject.js');
const tasks = await import('../services/staffTaskService.js');
const projects = await import('../services/staffProjectService.js');
const { cleanRepeat, nextDueOn, stepOnce, shiftStart, repeatLabel } = await import('../services/taskRepeat.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const d = (n = 0) => tasks.todayIST(new Date(Date.now() + n * 86400000));
let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name, email: `rep${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const as = async (u) => {
  const fresh = await User.findById(u._id);
  await projects.loadProjectAccess(fresh);
  return fresh;
};
const refused = (promise, status, message) => expect(promise).rejects.toMatchObject({ statusCode: status, ...(message && { message: expect.stringMatching(message) }) });
const raw = (id) => StaffTask.findById(id).lean();
const edit = async (actor, id, input) => tasks.updateTask(await as(actor), id, { rev: (await raw(id)).rev, ...input }, req);
const copiesOf = (id) => StaffTask.find({ repeatOf: id }).lean();
const MONTHLY_1ST = { every: 1, unit: 'month', day: 1 };

describe('repeat date rules (pure)', () => {
  it('checks the rule as sent', () => {
    expect(cleanRepeat(null, '2026-11-17')).toBeNull();
    expect(cleanRepeat('never', '2026-11-17')).toBeNull();
    expect(cleanRepeat({ unit: 'never' }, '2026-11-17')).toBeNull();
    expect(cleanRepeat({ unit: 'week' }, '2026-11-17')).toEqual({ every: 1, unit: 'week' });
    expect(cleanRepeat({ unit: 'day', every: 3, day: 9 }, '2026-11-17')).toEqual({ every: 3, unit: 'day' });
    // A monthly repeat with no day takes the due date's day.
    expect(cleanRepeat({ unit: 'month' }, '2026-11-17')).toEqual({ every: 1, unit: 'month', day: 17 });
    expect(cleanRepeat({ unit: 'month', every: '2', day: '31' }, '2026-11-17')).toEqual({ every: 2, unit: 'month', day: 31 });
    for (const bad of [{ unit: 'year' }, { unit: 'day', every: 0 }, { unit: 'day', every: 100 }, { unit: 'week', every: 1.5 }, { unit: 'month', day: 32 }, { unit: 'month', day: 0 }, 'monthly', [1]]) {
      expect(() => cleanRepeat(bad, '2026-11-17')).toThrow();
    }
  });

  it('steps days, weeks and months', () => {
    expect(stepOnce({ every: 1, unit: 'day' }, '2026-12-31')).toBe('2027-01-01');
    expect(stepOnce({ every: 2, unit: 'week' }, '2026-11-17')).toBe('2026-12-01');
    expect(stepOnce(MONTHLY_1ST, '2026-11-01')).toBe('2026-12-01');
    expect(stepOnce(MONTHLY_1ST, '2026-12-01')).toBe('2027-01-01');
    // Due mid-month, repeat on the 1st: the next 1st.
    expect(stepOnce(MONTHLY_1ST, '2026-11-15')).toBe('2026-12-01');
    // Due early, repeat on the 20th: later the same month.
    expect(stepOnce({ every: 1, unit: 'month', day: 20 }, '2026-11-15')).toBe('2026-11-20');
    expect(stepOnce({ every: 3, unit: 'month', day: 5 }, '2026-11-05')).toBe('2027-02-05');
  });

  it('the 31st lands on the last day of short months, and comes back to the 31st', () => {
    const r = { every: 1, unit: 'month', day: 31 };
    const run = ['2027-01-31'];
    for (let i = 0; i < 4; i += 1) run.push(stepOnce(r, run[run.length - 1]));
    expect(run).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
    // Leap year: 29 Feb.
    expect(stepOnce(r, '2028-01-31')).toBe('2028-02-29');
    expect(stepOnce({ every: 1, unit: 'month', day: 30 }, '2027-01-30')).toBe('2027-02-28');
  });

  it('a task done late comes back on the next date still ahead, never overdue', () => {
    // Owner's example: due 1 May, ticked done 20 July → 1 August, not 1 June.
    expect(nextDueOn(MONTHLY_1ST, '2026-05-01', '2026-07-20')).toBe('2026-08-01');
    // On time: just the next month.
    expect(nextDueOn(MONTHLY_1ST, '2026-05-01', '2026-04-28')).toBe('2026-06-01');
    // Landing exactly on today is fine (due today, not late).
    expect(nextDueOn({ every: 1, unit: 'week' }, '2026-11-03', '2026-11-17')).toBe('2026-11-17');
    // Years behind on a daily repeat still finishes.
    expect(nextDueOn({ every: 1, unit: 'day' }, '2001-01-01', '2026-11-17')).toBe('2026-11-17');
  });

  it('the start date keeps its distance from the due date', () => {
    expect(shiftStart('2026-11-25', '2026-12-01', '2027-01-01')).toBe('2026-12-26');
    expect(shiftStart(null, '2026-12-01', '2027-01-01')).toBeNull();
  });

  it('labels the rule in plain words', () => {
    expect(repeatLabel(MONTHLY_1ST)).toBe('Every month on the 1st');
    expect(repeatLabel({ every: 2, unit: 'week' })).toBe('Every 2 weeks');
    expect(repeatLabel({ every: 1, unit: 'month', day: 22 })).toBe('Every month on the 22nd');
    expect(repeatLabel({ every: 1, unit: 'month', day: 13 })).toBe('Every month on the 13th');
    expect(repeatLabel(null)).toBe('Never');
  });
});

describe('repeating tasks', () => {
  let admin, head, member, other;
  beforeAll(async () => { await StaffTask.init(); await StaffProject.init(); });
  beforeEach(async () => {
    admin = await person('admin', null, 'Owner');
    head = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
    member = await person('staff', { team: 'procurement' }, 'Arun');
    other = await person('staff', { team: 'sales' }, 'Sam');
  });

  /** Priya gives Arun the monthly office supply purchase, due today. */
  const supplies = async (extra = {}) => (await tasks.createTask(await as(head), {
    title: 'Monthly office supply purchase', description: 'Pens, paper, toner', dueOn: d(), priority: 'high',
    tags: ['office'], assigneeIds: [String(member._id)], checklist: ['Count stock', 'Order'],
    repeat: { unit: 'month', every: 1, day: 1 }, ...extra,
  }, req)).task;

  it('done makes the next copy, due on the next 1st, with the right fields', async () => {
    const t = await supplies();
    expect(t.repeat).toMatchObject({ every: 1, unit: 'month', day: 1, label: 'Every month on the 1st' });
    // Ticked steps, a comment and a file must not travel.
    const first = (await raw(t.id)).checklist[0];
    await tasks.updateChecklistItem(await as(head), t.id, String(first._id), { done: true });
    await StaffTask.updateOne({ _id: t.id }, { $set: { commentCount: 3, files: [{ publicId: 'tasks/x/a.pdf', kind: 'file', name: 'a.pdf', mime: 'application/pdf' }] } });

    const done = await edit(member, t.id, { status: 'done' });
    expect(done.status).toBe('done');
    const [copy] = await copiesOf(t.id);
    // The reply to "done" already links the copy, so the page shows "Next: T-…" at once.
    expect(done.repeatNext).toEqual({ id: String(copy._id), code: `T-${copy.number}` });
    expect(copy).toBeTruthy();
    expect(copy.dueOn).toBe(nextDueOn(MONTHLY_1ST, d(), d()));
    expect(copy.dueOn.endsWith('-01')).toBe(true);
    expect(copy).toMatchObject({
      title: 'Monthly office supply purchase', description: 'Pens, paper, toner', priority: 'high',
      status: 'todo', bucket: 'open', tags: ['office'], commentCount: 0, files: [], completedAt: null,
      repeat: { every: 1, unit: 'month', day: 1 },
    });
    // A High task is normally limited to tomorrow: the copy skips the date rules.
    expect(copy.dueApproval).toBeUndefined();
    expect(copy.assignees.map((p) => String(p.user))).toEqual([String(member._id)]);
    expect(String(copy.createdBy)).toBe(String(head._id));
    expect(copy.checklist.map((c) => [c.text, c.done])).toEqual([['Count stock', false], ['Order', false]]);
    expect(copy.number).toBeGreaterThan(t.number);
    // The done task points at its copy, and the copy back at it.
    const page = await tasks.getTask(await as(head), t.id);
    expect(page.repeatNext).toEqual({ id: String(copy._id), code: `T-${copy.number}` });
    const copyPage = await tasks.getTask(await as(member), String(copy._id));
    expect(copyPage.repeatOf).toBe(t.id);
    expect(copyPage.can.edit).toBe(false);
  });

  it('done twice, at once or as a retry, makes exactly one copy', async () => {
    const t = await supplies();
    const rev = (await raw(t.id)).rev;
    const both = await Promise.allSettled([
      tasks.updateTask(await as(member), t.id, { rev, status: 'done' }, req),
      tasks.updateTask(await as(head), t.id, { rev, status: 'done' }, req),
    ]);
    expect(both.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    // The same request again (a retry): already done, nothing new.
    await tasks.updateTask(await as(member), t.id, { rev: (await raw(t.id)).rev, status: 'done' }, req);
    await tasks.bulkUpdate(await as(head), { items: [{ id: t.id, rev: (await raw(t.id)).rev }], changes: { status: 'done' } }, req);
    expect(await copiesOf(t.id)).toHaveLength(1);
  });

  it('two makers racing past the "is there a copy?" check still leave one copy', async () => {
    const t = await supplies();
    await edit(member, t.id, { status: 'done' });
    await StaffTask.deleteMany({ repeatOf: t.id });
    const src = await raw(t.id);
    const made = await Promise.all([1, 2, 3].map(async () => tasks.makeNextRepeat(await as(member), src, req)));
    expect(new Set(made.map((c) => String(c._id))).size).toBe(1);
    expect(await copiesOf(t.id)).toHaveLength(1);
  });

  it('a retried "done" makes the copy the first attempt never made', async () => {
    const t = await supplies();
    await edit(member, t.id, { status: 'done' });
    // As if the server died right after marking it done.
    await StaffTask.deleteMany({ repeatOf: t.id });
    await StaffTask.updateOne({ _id: t.id }, { $unset: { repeatNext: 1 } });
    await edit(member, t.id, { status: 'done' });
    expect(await copiesOf(t.id)).toHaveLength(1);
    expect((await raw(t.id)).repeatNext).toBeTruthy();
  });

  it('reopening keeps the copy; done again makes no second one', async () => {
    const t = await supplies();
    await edit(member, t.id, { status: 'done' });
    await edit(member, t.id, { status: 'in_progress' });
    expect(await copiesOf(t.id)).toHaveLength(1);
    await edit(member, t.id, { status: 'done' });
    expect(await copiesOf(t.id)).toHaveLength(1);
  });

  it('the chain goes on: the copy, when done, makes the one after it', async () => {
    const t = await supplies();
    await edit(member, t.id, { status: 'done' });
    const [copy] = await copiesOf(t.id);
    await edit(member, String(copy._id), { status: 'done' });
    const [third] = await copiesOf(copy._id);
    expect(third.dueOn).toBe(stepOnce(MONTHLY_1ST, copy.dueOn));
  });

  it('"Never" or archiving stops it', async () => {
    const t = await supplies();
    const off = await edit(head, t.id, { repeat: 'never' });
    expect(off.repeat).toBeNull();
    expect(off.history[0]).toMatchObject({ action: 'repeat', from: 'Every month on the 1st', to: 'Never' });
    await edit(member, t.id, { status: 'done' });
    expect(await copiesOf(t.id)).toHaveLength(0);

    const u = await supplies();
    await edit(head, u.id, { archived: true });
    await refused(edit(member, u.id, { status: 'done' }), 409);
    expect(await copiesOf(u.id)).toHaveLength(0);
  });

  it('weekly and daily repeats count from the due date', async () => {
    const t = await supplies({ repeat: { unit: 'week', every: 2 } });
    await edit(member, t.id, { status: 'done' });
    expect((await copiesOf(t.id))[0].dueOn).toBe(d(14));
    const u = await supplies({ repeat: { unit: 'day', every: 1 }, dueOn: d(1), priority: 'normal' });
    await edit(member, u.id, { status: 'done' });
    expect((await copiesOf(u.id))[0].dueOn).toBe(d(2));
  });

  it('only whoever may edit the task sets a repeat', async () => {
    const t = await supplies({ repeat: undefined });
    expect(t.repeat).toBeNull();
    expect((await tasks.getTask(await as(member), t.id)).can.repeat).toBe(false);
    await refused(edit(member, t.id, { repeat: { unit: 'week' } }), 403);
    await refused(edit(other, t.id, { repeat: { unit: 'week' } }), 404);
    const byHead = await edit(head, t.id, { repeat: { unit: 'month' } });
    // No day picked: the due date's day.
    expect(byHead.repeat).toMatchObject({ unit: 'month', day: Number(d().slice(8)) });
    const byAdmin = await edit(admin, t.id, { repeat: { unit: 'week', every: 3 } });
    expect(byAdmin.repeat.label).toBe('Every 3 weeks');
    await refused(edit(head, t.id, { repeat: { unit: 'year' } }), 400);
  });

  it('a sub-task never repeats', async () => {
    const parent = await supplies({ repeat: undefined });
    await refused(tasks.createTask(await as(head), { title: 'Sub', dueOn: d(), parentId: parent.id, repeat: { unit: 'week' } }, req), 400, /sub-task/);
    const sub = (await tasks.createTask(await as(head), { title: 'Sub', dueOn: d(), parentId: parent.id }, req)).task;
    expect(sub.can.repeat).toBe(false);
    await refused(edit(head, sub.id, { repeat: { unit: 'week' } }), 400, /sub-task/);
  });

  it('in a project with its own statuses, the copy starts in the first not-started one', async () => {
    const p = (await projects.createProject(await as(head), { name: 'Office' }, req)).project;
    const withStages = await projects.updateProject(await as(head), p.id, {
      rev: p.rev,
      lists: [{ name: 'Supplies' }],
      statuses: [
        { name: 'Ideas', type: 'todo', colour: 'gray' },
        { name: 'Buying', type: 'in_progress', colour: 'blue' },
        { name: 'Bought', type: 'done', colour: 'green' },
      ],
    }, req);
    const bought = withStages.statuses.find((s) => s.type === 'done');
    const t = await supplies({ projectId: p.id, projectListId: withStages.lists[0].id });
    await edit(member, t.id, { stageId: bought.id });
    const [copy] = await copiesOf(t.id);
    expect(String(copy.project)).toBe(p.id);
    expect(String(copy.projectList)).toBe(withStages.lists[0].id);
    expect(copy).toMatchObject({ status: 'todo', stageName: 'Ideas' });
  });

  it('a personal repeating task stays personal', async () => {
    const t = (await tasks.createTask(await as(member), { title: 'Water plants', dueOn: d(), personal: true, repeat: { unit: 'week' } }, req)).task;
    await edit(member, t.id, { status: 'done' });
    const [copy] = await copiesOf(t.id);
    expect(copy.personal).toBe(true);
    await refused(tasks.getTask(await as(admin), String(copy._id)), 404);
  });

  it('list rows carry the repeat (the "repeats" marker)', async () => {
    const t = await supplies();
    const rows = (await tasks.listTasks(await as(member), { view: 'mine' })).tasks;
    expect(rows.find((r) => r.id === t.id).repeat).toMatchObject({ label: 'Every month on the 1st' });
  });
});

describe('scripts/create-task-repeat-index.js', () => {
  it('dry-runs by default, builds with apply, and is safe to run again', async () => {
    const { buildIndexes } = await import('../scripts/create-task-repeat-index.js');
    await StaffTask.init();
    await StaffTask.collection.dropIndex('staff_task_repeat_of');
    const log = () => {};
    expect(await buildIndexes({ apply: false, log })).toEqual([['staff_task_repeat_of', 'would build']]);
    expect((await StaffTask.collection.indexes()).some((i) => i.name === 'staff_task_repeat_of')).toBe(false);
    expect(await buildIndexes({ apply: true, log })).toEqual([['staff_task_repeat_of', 'built']]);
    const built = (await StaffTask.collection.indexes()).find((i) => i.name === 'staff_task_repeat_of');
    expect(built).toMatchObject({ unique: true, partialFilterExpression: { repeatOf: { $type: 'objectId' } } });
    expect(await buildIndexes({ apply: true, log })).toEqual([['staff_task_repeat_of', 'already there']]);
  });
});

describe('the "is there a copy already?" lookup on every done', () => {
  it('is one point read on staff_task_repeat_of, never a scan of the tasks', async () => {
    await StaffTask.init();
    const id = new (await import('mongoose')).default.Types.ObjectId();
    // Plenty of other tasks, and one copy of something else.
    const base = { title: 'x', status: 'todo', priority: 'normal', assignee: id, createdBy: id, bucket: 'open', rank: '2026-12-01' };
    await StaffTask.insertMany(Array.from({ length: 200 }, (_, i) => ({ ...base, number: 900000 + i })));
    await StaffTask.create({ ...base, number: 901000, repeatOf: id });
    const plan = await StaffTask.find({ repeatOf: { $type: 'objectId', $eq: id } }).explain('executionStats');
    const stages = JSON.stringify(plan.queryPlanner.winningPlan);
    expect(stages).toContain('staff_task_repeat_of');
    expect(stages).not.toContain('COLLSCAN');
    expect(plan.executionStats.totalDocsExamined).toBe(1);
    expect(plan.executionStats.totalKeysExamined).toBeLessThanOrEqual(2);
  });
});
