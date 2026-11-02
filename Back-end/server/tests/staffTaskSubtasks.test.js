/**
 * Tasks phase 5a — sub-tasks.
 *
 * What must hold:
 *   - a sub-task is a whole task under one parent; one level only; at most
 *     SUBTASKS_MAX; only whoever may edit the parent adds them; never under an
 *     archived task, or one you cannot see (404)
 *   - a double-click or retry makes ONE sub-task, and a retry of a full create
 *     still succeeds
 *   - the parent's "1/2" is counted from its sub-tasks after every change (made,
 *     done, reopened, archived, restored) — and stays right when two change at once
 *   - archiving a parent archives its sub-tasks; restoring it brings back exactly
 *     those it took; a retry finishes a half-done move; a sub-task does not come
 *     back on its own while its parent is archived
 *   - each sub-task is in its people's lists with the parent's name, even for
 *     someone who may not open the parent; renaming the parent renames it there
 *   - whoever sees the parent sees every sub-task listed, opens only theirs
 *   - a checklist step becomes a sub-task once, however often it is retried
 *   - reading the sub-tasks of a task is one range on staff_task_parent
 */
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const pushes = [];
const pushMock = {
  pushConfigured: () => true,
  publicKey: () => 'k',
  cleanSubscription: (x) => x,
  subscribe: async () => ({ subscribed: true }),
  unsubscribe: async () => ({ subscribed: false }),
  sendToUsers: async (recipients, message) => {
    pushes.push({ to: recipients.map((r) => r.userId).sort(), title: message.title });
    return recipients.length;
  },
  sendTest: async () => ({ sent: 1 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: staffTaskRepository } = await import('../repositories/staffTaskRepository.js');
const tasks = await import('../services/staffTaskService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const settle = () => new Promise((r) => setTimeout(r, 40));
const raw = (id) => StaffTask.findById(id).lean();
const counts = async (id) => (await raw(id)).subtasks;
let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name, email: `sub${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const refused = async (promise, status, message) => {
  await expect(promise).rejects.toMatchObject({ statusCode: status, ...(message && { message: expect.stringMatching(message) }) });
};

let admin, priya, arun, bala, sam;
beforeAll(async () => { await StaffTask.syncIndexes(); });
beforeEach(async () => {
  pushes.length = 0;
  admin = await person('admin', null, 'Owner');
  priya = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
  arun = await person('staff', { team: 'procurement' }, 'Arun');
  bala = await person('staff', { team: 'accounts' }, 'Bala');
  sam = await person('staff', { team: 'sales' }, 'Sam');
});

/** Priya's "Diwali stock check" for herself, and sub-tasks under it. */
const parentTask = async (extra = {}) => (await tasks.createTask(priya, { title: 'Diwali stock check', ...extra }, req)).task;
const sub = async (parent, title, who = arun, extra = {}, actor = priya) => (await tasks.createTask(actor, {
  title, parentId: parent.id, assigneeIds: [String(who._id)], shared: true, ...extra,
}, req)).task;
const patch = async (actor, id, input) => tasks.updateTask(actor, id, { rev: (await raw(id)).rev, ...input }, req);

describe('making a sub-task', () => {
  it('is a whole task that names its parent; the parent counts it and says so in its history', async () => {
    const p = await parentTask();
    const s = await sub(p, 'Count Bosch pads');
    expect(s.parent).toEqual({ id: p.id, code: p.code, title: 'Diwali stock check' });
    expect(s.assignees).toEqual([{ id: String(arun._id), name: 'Arun' }]);
    expect(s.can.subtask).toBe(false); // one level only
    expect(await counts(p.id)).toEqual({ total: 1, done: 0 });
    const parent = await tasks.getTask(priya, p.id);
    expect(parent.subtasks).toEqual({ total: 1, done: 0 });
    expect(parent.can.subtask).toBe(true);
    expect(parent.history[0]).toMatchObject({ action: 'subtask_added', to: `${s.code} Count Bosch pads` });
    await settle();
    expect(pushes.map((x) => x.title)).toContain('New task from Priya');
  });

  it('a double-click or retry makes one; a retry still succeeds when the parent is full', async () => {
    const p = await parentTask();
    const input = { title: 'Count wipers', parentId: p.id, clientId: 'sub-retry-01' };
    const [a, b] = await Promise.all([tasks.createTask(priya, input, req), tasks.createTask(priya, input, req)]);
    expect(a.task.id).toBe(b.task.id);
    expect(await StaffTask.countDocuments({ 'parent.task': p.id })).toBe(1);
    expect(await counts(p.id)).toEqual({ total: 1, done: 0 });
    // Fill it up, then retry the first create: it is already there, so it is not refused.
    for (let i = 1; i < tasks.SUBTASKS_MAX; i += 1) {
      await StaffTask.create({ ...(await raw(a.task.id)), _id: undefined, number: 10_000 + i, clientId: undefined, title: `filler ${i}` });
    }
    await tasks.recountSubtasks(p.id);
    expect((await counts(p.id)).total).toBe(tasks.SUBTASKS_MAX);
    expect((await tasks.createTask(priya, input, req)).duplicate).toBe(true);
    await refused(sub(p, 'one too many'), 400, /at most 50 sub-tasks/);
  });

  it('refuses a sub-task under a sub-task, under an archived task, or by someone who may not edit the parent', async () => {
    const p = await parentTask();
    const s = await sub(p, 'Count Bosch pads');
    await refused(sub(s, 'deeper'), 400, /can’t have sub-tasks/);
    // Arun does the sub-task and sees it, but did not give the parent: he may not add to it (he cannot see it: 404).
    await refused(sub(p, 'Arun adds', arun, {}, arun), 404);
    // Sam follows the parent: he sees it, but following is not editing.
    await tasks.changeFollowers(priya, p.id, { add: [String(sam._id)] });
    await refused(sub(p, 'Sam adds', sam, {}, sam), 403, /add sub-tasks/);
    await patch(priya, p.id, { archived: true });
    await refused(sub(p, 'after archive'), 409, /archived/);
    expect(await StaffTask.countDocuments({ 'parent.task': p.id })).toBe(1);
  });

  it('follows the same rule for its people as any task: someone who left the panel stops it', async () => {
    const p = await parentTask();
    await User.updateOne({ _id: bala._id }, { $set: { 'staff.active': false } });
    await refused(sub(p, 'for Bala', bala), 400);
    expect(await counts(p.id)).toBeUndefined();
  });

  it('"own copy each" makes one sub-task per person, all counted', async () => {
    const p = await parentTask();
    const { tasks: made } = await tasks.createTask(priya, {
      title: 'Count your shelf', parentId: p.id, assigneeIds: [String(arun._id), String(bala._id)],
    }, req);
    expect(made).toHaveLength(2);
    expect(made.every((t) => t.parent.id === p.id)).toBe(true);
    expect(await counts(p.id)).toEqual({ total: 2, done: 0 });
  });
});

describe('the parent\'s count', () => {
  it('follows done, reopen, archive and restore of a sub-task', async () => {
    const p = await parentTask();
    const a = await sub(p, 'Count Bosch pads');
    await sub(p, 'Count wipers', bala);
    await patch(arun, a.id, { status: 'done' });
    expect(await counts(p.id)).toEqual({ total: 2, done: 1 });
    await patch(arun, a.id, { status: 'in_progress' });
    expect(await counts(p.id)).toEqual({ total: 2, done: 0 });
    await patch(priya, a.id, { archived: true });
    expect(await counts(p.id)).toEqual({ total: 1, done: 0 });
    await patch(priya, a.id, { archived: false });
    expect(await counts(p.id)).toEqual({ total: 2, done: 0 });
    // A change that does not move it between lists leaves the count alone (and right).
    await patch(priya, a.id, { priority: 'urgent' });
    expect(await counts(p.id)).toEqual({ total: 2, done: 0 });
  });

  it('stays right when several sub-tasks are completed at the same moment', async () => {
    const p = await parentTask();
    const made = [];
    for (let i = 0; i < 6; i += 1) made.push(await sub(p, `step ${i}`, i % 2 ? arun : bala));
    await Promise.all(made.map((s) => patch(priya, s.id, { status: 'done' })));
    expect(await counts(p.id)).toEqual({ total: 6, done: 6 });
  });

  it('a bulk change counts too, and a broken count is put right by the next change', async () => {
    const p = await parentTask();
    const a = await sub(p, 'one');
    const b = await sub(p, 'two', bala);
    await StaffTask.updateOne({ _id: p.id }, { $set: { subtasks: { total: 9, done: 7 } } }); // e.g. a crash mid-way
    const r = await tasks.bulkUpdate(priya, {
      items: [{ id: a.id, rev: (await raw(a.id)).rev }, { id: b.id, rev: (await raw(b.id)).rev }],
      changes: { status: 'done' },
    }, req);
    expect(r.changed).toBe(2);
    expect(await counts(p.id)).toEqual({ total: 2, done: 2 });
  });

  it('a count read just before another change is put right before the recount returns', async () => {
    const p = await parentTask();
    await sub(p, 'one');
    const b = await sub(p, 'two', bala);
    // Interleave: the first count is read, then another sub-task is completed before it is stored.
    const real = staffTaskRepository.countSubtasks;
    let first = true;
    const spy = jest.spyOn(staffTaskRepository, 'countSubtasks').mockImplementation(async (id) => {
      const c = await real(id);
      if (first) { first = false; await StaffTask.updateOne({ _id: b.id }, { $set: { status: 'done', bucket: 'done' } }); }
      return c;
    });
    try {
      expect(await tasks.recountSubtasks(p.id)).toEqual({ total: 2, done: 1 });
    } finally {
      spy.mockRestore();
    }
    expect(await counts(p.id)).toEqual({ total: 2, done: 1 });
  });
});

describe('archiving a parent', () => {
  it('takes its sub-tasks with it, and restoring brings back exactly those', async () => {
    const p = await parentTask();
    const a = await sub(p, 'Count Bosch pads');
    const b = await sub(p, 'Count wipers', bala);
    const c = await sub(p, 'Already gone', sam);
    await patch(arun, a.id, { status: 'done' });
    await patch(priya, c.id, { archived: true }); // archived on its own, before the parent
    const revB = (await raw(b.id)).rev;

    await patch(priya, p.id, { archived: true });
    const [ra, rb, rc] = await Promise.all([raw(a.id), raw(b.id), raw(c.id)]);
    expect([ra.bucket, rb.bucket, rc.bucket]).toEqual(['archived', 'archived', 'archived']);
    expect([ra.archivedWithParent, rb.archivedWithParent, rc.archivedWithParent]).toEqual([true, true, undefined]);
    expect(rb.rev).toBe(revB + 1); // someone's open edit of it goes stale
    expect(rb.history.at(-1)).toMatchObject({ action: 'archived', to: `with ${p.code}` });
    expect(await counts(p.id)).toEqual({ total: 0, done: 0 });

    await patch(priya, p.id, { archived: false });
    const [ba, bb, bc] = await Promise.all([raw(a.id), raw(b.id), raw(c.id)]);
    expect([ba.bucket, bb.bucket, bc.bucket]).toEqual(['done', 'open', 'archived']);
    expect(ba.archivedWithParent).toBeNull();
    expect(await counts(p.id)).toEqual({ total: 2, done: 1 });
    // Back in the right place in its list (sorted by due day again).
    expect(bb.rank).toBe(tasks.placeOf({ status: 'todo', dueOn: null }).rank);
  });

  it('a retry finishes a half-done archive (and a half-done restore)', async () => {
    const p = await parentTask();
    const a = await sub(p, 'one');
    const b = await sub(p, 'two', bala);
    // The parent's archive landed, then the server died before moving b.
    await patch(priya, p.id, { archived: true });
    await StaffTask.updateOne({ _id: b.id }, { $set: { archivedAt: null, archivedWithParent: null, bucket: 'open', rank: '9999-12-31' } });
    await patch(priya, p.id, { archived: true }); // the retry: the parent is already archived
    expect((await raw(b.id)).bucket).toBe('archived');
    // The same through the bulk bar.
    await patch(priya, p.id, { archived: false });
    await StaffTask.updateOne({ _id: a.id }, { $set: { bucket: 'archived', archivedWithParent: true, archivedAt: new Date() } });
    const r = await tasks.bulkUpdate(priya, { items: [{ id: p.id, rev: (await raw(p.id)).rev }], changes: { archived: false } }, req);
    expect(r.unchanged).toBe(1);
    expect((await raw(a.id)).bucket).toBe('open');
    expect(await counts(p.id)).toEqual({ total: 2, done: 0 });
  });

  it('a sub-task cannot be restored on its own while its parent is archived', async () => {
    const p = await parentTask();
    const a = await sub(p, 'one');
    await patch(priya, p.id, { archived: true });
    await refused(patch(priya, a.id, { archived: false }), 409, new RegExp(`Restore ${p.code} first`));
    expect((await raw(a.id)).bucket).toBe('archived');
  });

  it('archiving a sub-task never touches its parent', async () => {
    const p = await parentTask();
    const a = await sub(p, 'one');
    await patch(priya, a.id, { archived: true });
    expect((await raw(p.id)).bucket).toBe('open');
  });
});

describe('seeing sub-tasks', () => {
  it('each is in its people\'s lists with the parent\'s name, even for someone who may not open the parent', async () => {
    const p = await parentTask();
    const a = await sub(p, 'Count Bosch pads', bala);
    const { tasks: mine } = await tasks.listTasks(bala, { view: 'mine' });
    expect(mine.map((t) => [t.code, t.parent?.code, t.parent?.title])).toEqual([[a.code, p.code, 'Diwali stock check']]);
    await refused(tasks.getTask(bala, p.id), 404);
    // The parent's own row carries its count.
    const { tasks: given } = await tasks.listTasks(priya, { view: 'created' });
    expect(given.find((t) => t.id === p.id).subtasks).toEqual({ total: 1, done: 0 });
  });

  it('renaming the parent renames it on its sub-tasks', async () => {
    const p = await parentTask();
    const a = await sub(p, 'one');
    await patch(priya, p.id, { title: 'Diwali stock check (all branches)' });
    expect((await tasks.getTask(arun, a.id)).parent.title).toBe('Diwali stock check (all branches)');
  });

  it('whoever sees the parent sees every sub-task listed, and opens only those they may see', async () => {
    const p = await parentTask({ assigneeIds: [String(arun._id)] });
    const mineSub = await sub(p, 'Arun counts', arun);
    const balaSub = await sub(p, 'Bala counts', bala, { description: 'Shelf 4 has the Bosch stock' });
    await sub(p, 'gone', sam).then((s) => patch(priya, s.id, { archived: true }));
    const list = await tasks.listSubtasks(arun, p.id);
    expect(list.total).toBe(2);
    expect(list.subtasks.map((s) => [s.code, s.canOpen])).toEqual([[mineSub.code, true], [balaSub.code, false]]);
    expect(list.subtasks[1].summary).toBe('');
    expect(list.subtasks[1].can.status).toBe(false);
    await refused(tasks.getTask(arun, balaSub.id), 404);
    // The giver sees and opens everything.
    expect((await tasks.listSubtasks(priya, p.id)).subtasks.every((s) => s.canOpen)).toBe(true);
    // Someone who cannot see the parent cannot list its sub-tasks.
    await refused(tasks.listSubtasks(sam, p.id), 404);
    // A sub-task has none.
    expect(await tasks.listSubtasks(arun, mineSub.id)).toEqual({ subtasks: [], total: 0, done: 0 });
  });
});

describe('a checklist step becomes a sub-task', () => {
  const withStep = async () => {
    const p = await parentTask({ checklist: ['Count Bosch pads', 'Label shelves'] });
    return { p, step: (await raw(p.id)).checklist[0] };
  };

  it('takes the step\'s words, leaves the checklist, and says so once in the history', async () => {
    const { p, step } = await withStep();
    const { task, subtask } = await tasks.subtaskFromStep(priya, p.id, String(step._id), { clientId: 'step-sub-0001', assigneeIds: [String(arun._id)] }, req);
    expect(subtask).toMatchObject({ title: 'Count Bosch pads', parent: { id: p.id } });
    expect(subtask.assignees).toEqual([{ id: String(arun._id), name: 'Arun' }]);
    expect(task.checklistItems.map((c) => c.text)).toEqual(['Label shelves']);
    expect(task.subtasks).toEqual({ total: 1, done: 0 });
    expect(task.history.filter((h) => h.action.startsWith('sub') || h.action.startsWith('check_'))).toEqual([
      expect.objectContaining({ action: 'check_to_subtask', from: 'Count Bosch pads', to: subtask.code }),
    ]);
  });

  it('a retry, or two at once, makes one sub-task', async () => {
    const { p, step } = await withStep();
    const go = () => tasks.subtaskFromStep(priya, p.id, String(step._id), { clientId: 'step-sub-0002' }, req);
    const [x, y] = await Promise.all([go(), go()]);
    const again = await go();
    expect(new Set([x.subtask.id, y.subtask.id, again.subtask.id]).size).toBe(1);
    expect(await StaffTask.countDocuments({ 'parent.task': p.id })).toBe(1);
    expect((await raw(p.id)).checklist).toHaveLength(1);
  });

  it('a half-done first try (sub-task made, step still there) is finished by the retry', async () => {
    const { p, step } = await withStep();
    await tasks.createTask(priya, { title: step.text, parentId: p.id, clientId: 'step-sub-0003', shared: true }, req, { note: false });
    const { subtask } = await tasks.subtaskFromStep(priya, p.id, String(step._id), { clientId: 'step-sub-0003' }, req);
    expect(await StaffTask.countDocuments({ 'parent.task': p.id })).toBe(1);
    expect(subtask.title).toBe('Count Bosch pads');
    expect((await raw(p.id)).checklist.map((c) => c.text)).toEqual(['Label shelves']);
  });

  it('refuses without a clientId, for a step that is gone, and for someone who may not edit', async () => {
    const { p, step } = await withStep();
    await refused(tasks.subtaskFromStep(priya, p.id, String(step._id), {}, req), 400);
    await refused(tasks.subtaskFromStep(priya, p.id, String(new StaffTask()._id), { clientId: 'step-sub-0004' }, req), 404, /no longer on the checklist/);
    await tasks.changeFollowers(priya, p.id, { add: [String(sam._id)] });
    await refused(tasks.subtaskFromStep(sam, p.id, String(step._id), { clientId: 'step-sub-0005' }, req), 403);
    expect((await raw(p.id)).checklist).toHaveLength(2);
  });
});

describe('the admin', () => {
  it('may add sub-tasks to anyone\'s task, and archive the parent with them', async () => {
    const p = await parentTask();
    const a = await sub(p, 'one', bala, {}, admin);
    await patch(admin, p.id, { archived: true });
    expect((await raw(a.id)).bucket).toBe('archived');
  });
});

describe('the database', () => {
  it('reads a task\'s sub-tasks as one range on staff_task_parent', async () => {
    const p = await parentTask();
    const other = await parentTask();
    for (let i = 0; i < 5; i += 1) await sub(p, `p ${i}`);
    for (let i = 0; i < 20; i += 1) await sub(other, `o ${i}`);
    const filter = staffTaskRepository.childFilter(p.id, { bucket: { $in: ['open', 'done'] } });
    const ex = await StaffTask.find(filter).sort({ rank: 1, _id: 1 }).limit(50).explain('executionStats');
    expect(JSON.stringify(ex.queryPlanner.winningPlan)).toContain('staff_task_parent');
    expect(ex.executionStats.totalDocsExamined).toBe(5);
  });
});
