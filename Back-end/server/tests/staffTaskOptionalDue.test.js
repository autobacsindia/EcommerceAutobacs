/**
 * When a staff task needs a due date (services/staffTaskService.js dueRequired,
 * asked for by the owner 2026-11). Mongo is real; push is a double.
 *
 * What must hold:
 *   - Tasks panel (no project): a To Do task saves without a date; moving it out
 *     of To Do (status, bulk) without one is refused (400), with one it moves —
 *     a date sent with the move counts. Under way, the date can't be taken off;
 *     in To Do it can.
 *   - Projects: a task never needs a date — created, moved to any column (its
 *     own statuses too), or its date taken off. Its sub-tasks follow it.
 *   - A repeating task always needs one.
 *   - No date sorts last, is never late, today or counted as late anywhere.
 *   - An old task already under way with no date still takes other changes.
 */
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const pushMock = {
  pushConfigured: () => true, publicKey: () => 'k', cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}), sendToUsers: async (r) => r.length, sendTest: async () => ({ sent: 1 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const tasks = await import('../services/staffTaskService.js');
const projects = await import('../services/staffProjectService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const day = (n = 0) => tasks.todayIST(new Date(Date.now() + n * 86400000));
const status = (code, fn, msg) => expect(fn()).rejects.toMatchObject({ statusCode: code, ...(msg && { message: expect.stringMatching(msg) }) });

let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name: name || `${role} ${n}`, email: `tod${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const as = async (u) => {
  const fresh = await User.findById(u._id);
  await projects.loadProjectAccess(fresh);
  return fresh;
};
const make = async (actor, over = {}) => (await tasks.createTask(await as(actor), { title: 'Call supplier', ...over }, req)).task;
const edit = async (actor, t, patch) => tasks.updateTask(await as(actor), t.id, { rev: t.rev, ...patch }, req);
const bulk = async (actor, list, changes) => tasks.bulkUpdate(await as(actor), { items: list.map((t) => ({ id: t.id, rev: t.rev })), changes }, req);
const startProject = async (actor, input = {}) => (await projects.createProject(await as(actor), { name: 'Garage work', ...input }, req)).project;

const STAGES = [
  { name: 'To do', type: 'todo', colour: 'gray' },
  { name: 'Garage 1', type: 'in_progress', colour: 'blue' },
  { name: 'Garage 2', type: 'in_progress', colour: 'amber' },
  { name: 'Done', type: 'done', colour: 'green' },
];

let head, arun;
beforeAll(async () => { await StaffTask.init(); });
beforeEach(async () => {
  head = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
  arun = await person('staff', { team: 'procurement' }, 'Arun');
});

describe('the rule itself', () => {
  it('only a task outside a project that is not in To Do needs a date', () => {
    expect(tasks.dueRequired({ status: 'todo', inProject: false })).toBe(false);
    expect(tasks.dueRequired({ status: 'in_progress', inProject: false })).toBe(true);
    expect(tasks.dueRequired({ status: 'waiting', inProject: false })).toBe(true);
    expect(tasks.dueRequired({ status: 'done', inProject: false })).toBe(true);
    for (const s of ['todo', 'in_progress', 'done']) expect(tasks.dueRequired({ status: s, inProject: true })).toBe(false);
  });
});

describe('Tasks panel: To Do is the backlog', () => {
  it('a To Do task saves without a date — missing, blank or null', async () => {
    for (const dueOn of [undefined, '', null]) {
      const t = await make(arun, { dueOn });
      expect(t).toMatchObject({ status: 'todo', dueOn: null, dueTime: null, overdue: false, dueToday: false });
    }
    expect(await StaffTask.countDocuments({ dueOn: null })).toBe(3);
  });

  it('a time without a date is still refused', async () => {
    await status(400, () => make(arun, { dueTime: '10:00' }), /due date before a time/);
  });

  it('starting a task straight in In Progress still needs a date', async () => {
    await status(400, () => make(arun, { status: 'in_progress' }), /out of To Do/);
    expect((await make(arun, { status: 'in_progress', dueOn: day(1) })).status).toBe('in_progress');
  });

  it('moving it out of To Do without a date is refused, and nothing changes', async () => {
    const t = await make(arun);
    await status(400, () => edit(arun, t, { status: 'in_progress' }), /Pick a due date before moving this task out of To Do/);
    await status(400, () => edit(arun, t, { status: 'done' }), /out of To Do/);
    const saved = await tasks.getTask(await as(arun), t.id);
    expect(saved).toMatchObject({ status: 'todo', rev: t.rev, dueOn: null });
  });

  it('a date sent with the move lets it through in one change', async () => {
    const t = await make(arun);
    const moved = await edit(arun, t, { status: 'in_progress', dueOn: day(2) });
    expect(moved).toMatchObject({ status: 'in_progress', dueOn: day(2) });
    expect(moved.rev).toBe(t.rev + 1);
  });

  it('the person doing it (not the giver) can give it its first date as they move it — and only then', async () => {
    const t = await make(head, { assigneeId: String(arun._id) });
    await status(403, () => edit(arun, t, { dueOn: day(1) }), /Only whoever gave this task/);
    const moved = await edit(arun, t, { status: 'in_progress', dueOn: day(1) });
    expect(moved).toMatchObject({ status: 'in_progress', dueOn: day(1) });
    await status(403, () => edit(arun, moved, { dueOn: day(2) }), /Only whoever gave this task/);
  });

  it('with a date already set it moves as before', async () => {
    const t = await make(arun, { dueOn: day(1) });
    expect((await edit(arun, t, { status: 'done' })).status).toBe('done');
  });

  it('the date checks still run on a date picked with the move', async () => {
    const t = await make(arun, { priority: 'high' });
    await status(400, () => edit(arun, t, { status: 'in_progress', dueOn: day(5) }), /High/);
  });

  it('bulk "set status" moves the dated ones and refuses the rest, one by one', async () => {
    const dated = await make(arun, { dueOn: day(1) });
    const undated = await make(arun);
    const r = await bulk(arun, [dated, undated], { status: 'in_progress' });
    expect(r).toMatchObject({ changed: 1, failed: 1 });
    expect(r.results.find((x) => x.id === undated.id)).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/out of To Do/) });
  });

  it('the date can come off in To Do, but not once the task is under way', async () => {
    const t = await make(arun, { dueOn: day(1) });
    const cleared = await edit(arun, t, { dueOn: null });
    expect(cleared.dueOn).toBeNull();
    const going = await edit(arun, cleared, { status: 'in_progress', dueOn: day(1) });
    await status(400, () => edit(arun, going, { dueOn: null }), /under way/);
    await status(400, () => bulk(arun, [going], { dueOn: null }).then((x) => { if (x.failed) throw Object.assign(new Error(x.results[0].error), { statusCode: x.results[0].status }); }), /under way/);
  });

  it('taking the date off drops a waiting approval', async () => {
    const t = await make(arun, { dueOn: day(15) });
    expect(t.dueApproval.status).toBe('pending');
    const cleared = await edit(arun, t, { dueOn: null });
    expect(cleared.dueApproval).toBeNull();
  });

  it('reopening a dateless finished task back to To Do is fine', async () => {
    const t = await make(arun, { dueOn: day(0) });
    const done = await edit(arun, t, { status: 'done' });
    await StaffTask.updateOne({ _id: t.id }, { $set: { dueOn: null } });
    const back = await edit(arun, { ...done }, { status: 'todo' });
    expect(back).toMatchObject({ status: 'todo', dueOn: null });
  });

  it('an older task already under way with no date still takes other changes', async () => {
    const t = await make(arun, { dueOn: day(0), status: 'in_progress' });
    await StaffTask.updateOne({ _id: t.id }, { $set: { dueOn: null, rank: '9999-12-31' } });
    const renamed = await edit(arun, t, { title: 'Call supplier again', priority: 'urgent' });
    expect(renamed).toMatchObject({ status: 'in_progress', dueOn: null, title: 'Call supplier again' });
  });
});

describe('Projects: the date is always optional', () => {
  it('a project task with no date is created and moved to every column, then its date added later', async () => {
    const made = await startProject(head);
    const proj = await projects.updateProject(await as(head), made.id, { rev: made.rev, statuses: STAGES }, req);
    let t = await make(head, { projectId: proj.id });
    expect(t).toMatchObject({ dueOn: null, status: 'todo' });
    for (const stage of proj.statuses.slice(1)) {
      t = await edit(head, t, { stageId: stage.id });
      expect(t).toMatchObject({ stage: stage.id, dueOn: null });
    }
    t = await edit(head, t, { status: 'in_progress' });
    expect(t.dueOn).toBeNull();
    t = await edit(head, t, { dueOn: day(3) });
    expect(t.dueOn).toBe(day(3));
    t = await edit(head, t, { dueOn: null });
    expect(t.dueOn).toBeNull();
  });

  it('a plain project (no own columns) task can start in progress and finish with no date', async () => {
    const p = await startProject(head);
    const t = await make(head, { projectId: p.id, status: 'in_progress' });
    expect(t).toMatchObject({ status: 'in_progress', dueOn: null });
    expect((await edit(head, t, { status: 'done' })).status).toBe('done');
  });

  it('a sub-task follows its main task: optional inside a project, needed outside', async () => {
    const p = await startProject(head);
    const inProject = await make(head, { projectId: p.id });
    const sub = await make(head, { parentId: inProject.id, status: 'in_progress' });
    expect(sub).toMatchObject({ status: 'in_progress', dueOn: null });

    const loose = await make(head);
    const looseSub = await make(head, { parentId: loose.id });
    await status(400, () => edit(head, looseSub, { status: 'in_progress' }), /out of To Do/);
  });

  it('taking a dateless task under way out of its project needs a date first', async () => {
    const p = await startProject(head);
    const t = await make(head, { projectId: p.id, status: 'in_progress' });
    await status(400, () => edit(head, t, { projectId: null }), /Outside a project/);
    expect((await edit(head, t, { projectId: null, dueOn: day(1) })).project).toBeNull();
  });
});

describe('a repeating task still needs a date', () => {
  it('on create, when turned on, and when its date would come off', async () => {
    await status(400, () => make(arun, { repeat: { every: 1, unit: 'week' } }), /repeating task needs a due date/);
    const t = await make(arun);
    await status(400, () => edit(arun, t, { repeat: { every: 1, unit: 'week' } }), /repeating/);
    const r = await make(arun, { dueOn: day(1), repeat: { every: 1, unit: 'week' } });
    await status(400, () => edit(arun, r, { dueOn: null }), /repeating/);
  });

  it('a project task that repeats needs one too', async () => {
    const p = await startProject(head);
    await status(400, () => make(head, { projectId: p.id, repeat: { every: 1, unit: 'day' } }), /repeating/);
  });
});

describe('no date is never late, and sorts last', () => {
  it('sorts after every dated task, and is missing from late/today/overdue filters and counts', async () => {
    await make(arun, { title: 'no date' });
    await make(arun, { title: 'tomorrow', dueOn: day(1) });
    await make(arun, { title: 'yesterday', dueOn: day(-1) });
    await make(arun, { title: 'today', dueOn: day(0) });
    const me = await as(arun);
    const open = await tasks.listTasks(me, { view: 'mine' });
    expect(open.tasks.map((t) => t.title)).toEqual(['yesterday', 'today', 'tomorrow', 'no date']);
    const nodate = open.tasks.find((t) => t.title === 'no date');
    expect(nodate).toMatchObject({ overdue: false, dueToday: false, dueOn: null });
    for (const due of ['overdue', 'late', 'today', 'week']) {
      expect((await tasks.listTasks(me, { view: 'mine', due })).tasks.map((t) => t.title)).not.toContain('no date');
    }
    const summary = await tasks.summaryFor(me);
    expect(summary).toMatchObject({ late: 1, today: 1 });
    expect(await tasks.countDueForBell(me)).toBe(2);
    const overview = await tasks.teamOverview(await as(head), { team: 'procurement' });
    expect(overview.counts).toMatchObject({ late: 1, noDate: 1 });
  });
});
