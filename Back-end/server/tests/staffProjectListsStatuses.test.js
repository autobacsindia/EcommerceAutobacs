/**
 * Lists inside a project, a project's own statuses, and the calendar's day range
 * (services/staffProjectService.js, services/staffTaskService.js). Mongo is real.
 *
 * What must hold:
 *   - only the project's owner or the admin changes its lists and statuses
 *   - list names and status names are unique per project; a status set always
 *     has a "not started" and a "done" kind
 *   - a task's list and status always belong to its own project: another
 *     project's list or status is refused, and moving project clears/re-places them
 *   - `status` always equals the kind of the task's project status, so open/done,
 *     counts and progress keep working; a done status finishes the task
 *   - deleting a list or a status, renaming one, or turning statuses on/off
 *     brings every task of the project in line — and running that again changes nothing
 *   - a stale list/status id on a task (the clean-up not yet run) reads as none, never an error
 *   - the calendar returns only open tasks due on the days asked, at most 45 days at once
 */
import { jest } from '@jest/globals';

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
const { default: StaffProject } = await import('../models/StaffProject.js');
const tasks = await import('../services/staffTaskService.js');
const projects = await import('../services/staffProjectService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name: name || `${role} ${n}`, email: `pls${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const as = async (u) => {
  const fresh = await User.findById(u._id);
  await projects.loadProjectAccess(fresh);
  return fresh;
};
const status = (code, fn, msg) => expect(fn()).rejects.toMatchObject({ statusCode: code, ...(msg && { message: expect.stringMatching(msg) }) });
const give = async (actor, over = {}) => (await tasks.createTask(await as(actor), { title: 'Job', ...over }, req)).task;
const edit = async (actor, t, patch) => tasks.updateTask(await as(actor), t.id, { rev: t.rev, ...patch }, req);
const fresh = async (actor, t) => tasks.getTask(await as(actor), t.id);
const start = async (actor, input) => (await projects.createProject(await as(actor), { name: 'Black Friday 2026', ...input }, req)).project;
const change = async (actor, p, patch) => projects.updateProject(await as(actor), p.id, { rev: p.rev, ...patch }, req);
const inList = async (actor, p, projectList, state = 'open') => (await tasks.listTasks(await as(actor), { view: 'project', project: p.id, projectList, state })).tasks;
const raw = (t) => StaffTask.findById(t.id).lean();

const STAGES = [
  { name: 'Ideas', type: 'todo', colour: 'gray' },
  { name: 'Designing', type: 'in_progress', colour: 'blue' },
  { name: 'Review', type: 'in_progress', colour: 'amber' },
  { name: 'Live', type: 'done', colour: 'green' },
];

let head, member, other;
beforeAll(async () => { await StaffTask.init(); await StaffProject.init(); });
beforeEach(async () => {

  head = await person('staff', { team: 'marketing', isHead: true }, 'Meera');
  member = await person('staff', { team: 'marketing' }, 'Jenna');
  other = await person('staff', { team: 'developer' }, 'Nidheesh');
});

describe('lists inside a project', () => {
  it('the owner adds, renames and orders lists; others may not; names are unique', async () => {
    const p = await start(head, { memberIds: [String(member._id)] });
    const withLists = await change(head, p, { lists: [{ name: 'Ads' }, { name: 'Website' }] });
    expect(withLists.lists.map((l) => l.name)).toEqual(['Ads', 'Website']);
    // Rename + reorder keeps the ids.
    const [ads, site] = withLists.lists;
    const renamed = await change(head, withLists, { lists: [{ id: site.id, name: 'Site' }, { id: ads.id, name: 'Ads' }] });
    expect(renamed.lists).toEqual([{ id: site.id, name: 'Site' }, { id: ads.id, name: 'Ads' }]);
    await status(400, () => change(head, renamed, { lists: [{ name: 'Ads' }, { name: 'ads' }] }), /two lists/);
    await status(400, () => change(head, renamed, { lists: [{ name: '  ' }] }), /name/);
    await status(400, () => change(head, renamed, { lists: Array.from({ length: 21 }, (_, i) => ({ name: `L${i}` })) }), /at most 20/);
    await status(403, () => change(member, renamed, { lists: [] }));
  });

  it('a task goes in a list of its own project only; the list filter shows just that list', async () => {
    const p = await change(head, await start(head), { lists: [{ name: 'Ads' }, { name: 'Emails' }] });
    const q = await change(head, await start(head, { name: 'Diwali' }), { lists: [{ name: 'Ads' }] });
    const [ads, emails] = p.lists;
    const a = await give(head, { assigneeId: String(member._id), projectId: p.id, projectListId: ads.id });
    const b = await give(head, { assigneeId: String(member._id), projectId: p.id });
    expect(a.projectList).toBe(ads.id);
    expect(b.projectList).toBeNull();
    // Another project's list, or a list with no project, is refused.
    await status(400, () => give(head, { assigneeId: String(member._id), projectId: p.id, projectListId: q.lists[0].id }), /no longer in the project/);
    await status(400, () => give(head, { assigneeId: String(member._id), projectListId: ads.id }), /project first/);
    expect((await inList(head, p, ads.id)).map((t) => t.id)).toEqual([a.id]);
    expect((await inList(head, p, 'none')).map((t) => t.id)).toEqual([b.id]);
    expect(await inList(head, p, emails.id)).toEqual([]);
    await status(400, () => inList(head, p, q.lists[0].id), /no longer in the project/);
    // Moving it to another list, then to another project, which empties the list.
    const moved = await edit(head, a, { projectListId: emails.id });
    expect(moved.projectList).toBe(emails.id);
    const elsewhere = await edit(head, moved, { projectId: q.id });
    expect(elsewhere.project).toBe(q.id);
    expect(elsewhere.projectList).toBeNull();
    // Leaving every project empties it too.
    const back = await edit(head, await edit(head, elsewhere, { projectId: p.id, projectListId: ads.id }), { projectId: null });
    expect(back.projectList).toBeNull();
    expect((await raw(back)).projectList).toBeNull();
  });

  it('only someone who may edit the task moves it between lists', async () => {
    const p = await change(head, await start(head, { memberIds: [String(member._id)] }), { lists: [{ name: 'Ads' }] });
    const t = await give(head, { assigneeId: String(member._id), projectId: p.id });
    // The person doing it may move its status, but not reorganise it.
    await status(403, () => edit(member, t, { projectListId: p.lists[0].id }));
  });

  it('deleting a list sends its tasks to "no list"; running the clean-up again changes nothing', async () => {
    const p = await change(head, await start(head), { lists: [{ name: 'Ads' }, { name: 'Emails' }] });
    const t = await give(head, { assigneeId: String(member._id), projectId: p.id, projectListId: p.lists[0].id });
    const keep = await give(head, { assigneeId: String(member._id), projectId: p.id, projectListId: p.lists[1].id });
    const after = await change(head, p, { lists: [p.lists[1]] });
    expect((await fresh(head, t)).projectList).toBeNull();
    expect((await fresh(head, keep)).projectList).toBe(p.lists[1].id);
    const revs = (await StaffTask.find({ project: p.id }).lean()).map((x) => x.rev).sort();
    await projects.reconcileProjectTasks(await StaffProject.findById(after.id).lean());
    expect((await StaffTask.find({ project: p.id }).lean()).map((x) => x.rev).sort()).toEqual(revs);
  });

  it('a task still pointing at a deleted list (clean-up not run yet) reads as no list', async () => {
    const p = await change(head, await start(head), { lists: [{ name: 'Ads' }] });
    const t = await give(head, { assigneeId: String(member._id), projectId: p.id, projectListId: p.lists[0].id });
    // The project row changes without the clean-up (a crash between the two writes).
    await StaffProject.updateOne({ _id: p.id }, { $set: { lists: [] } });
    expect((await inList(head, p, 'none'))).toEqual([]);
    // Editing it still works, and choosing "no list" clears the stale id.
    const cleared = await edit(head, await fresh(head, t), { projectListId: null });
    expect(cleared.projectList).toBeNull();
  });
});

describe('a project’s own statuses', () => {
  it('needs a "not started" and a "done" kind; names unique; only the owner sets them', async () => {
    const p = await start(head, { memberIds: [String(member._id)] });
    await status(400, () => change(head, p, { statuses: [{ name: 'Ideas', type: 'todo' }] }), /Done/);
    await status(400, () => change(head, p, { statuses: [{ name: 'Live', type: 'done' }] }), /Not started/);
    await status(400, () => change(head, p, { statuses: [{ name: 'A', type: 'todo' }, { name: 'a', type: 'done' }] }), /two statuses/);
    await status(400, () => change(head, p, { statuses: [{ name: 'A', type: 'todo' }, { name: 'B', type: 'blocked' }] }), /not started, active or done/);
    await status(403, () => change(member, p, { statuses: STAGES }));
    const set = await change(head, p, { statuses: STAGES });
    expect(set.statuses.map((x) => [x.name, x.type])).toEqual(STAGES.map((x) => [x.name, x.type]));
  });

  it('turning them on places every task by its kind, without moving any between open and done', async () => {
    const p = await start(head, { memberIds: [String(member._id)] });
    const todo = await give(head, { assigneeId: String(member._id), projectId: p.id });
    const doing = await edit(head, await give(head, { assigneeId: String(member._id), projectId: p.id }), { status: 'in_progress' });
    const done = await edit(head, await give(head, { assigneeId: String(member._id), projectId: p.id }), { status: 'done' });
    // No "active" status at all: active tasks go to the first not-started one.
    const p2 = await change(head, p, { statuses: [{ name: 'Ideas', type: 'todo' }, { name: 'Live', type: 'done' }] });
    const [ideas, live] = p2.statuses;
    expect(await fresh(head, todo)).toMatchObject({ stage: ideas.id, statusLabel: 'Ideas', status: 'todo', bucket: 'open' });
    expect(await fresh(head, doing)).toMatchObject({ stage: ideas.id, status: 'todo', bucket: 'open' });
    expect(await fresh(head, done)).toMatchObject({ stage: live.id, statusLabel: 'Live', status: 'done', bucket: 'done' });
    // Progress still counts by kind.
    expect((await projects.getProject(await as(head), p.id)).progress).toMatchObject({ total: 3, done: 1 });
  });

  it('moving a task to a status sets its kind; a done status finishes it and an open one reopens it', async () => {
    const p = await change(head, await start(head, { memberIds: [String(member._id), String(other._id)] }), { statuses: STAGES });
    const [ideas, , review, live] = p.statuses;
    const t = await give(head, { assigneeId: String(member._id), projectId: p.id });
    expect(t).toMatchObject({ stage: ideas.id, statusLabel: 'Ideas', status: 'todo' });
    // The person doing it may move it; a project member who isn't may not.
    const r = await edit(member, t, { stageId: review.id });
    expect(r).toMatchObject({ stage: review.id, statusLabel: 'Review', status: 'in_progress', bucket: 'open' });
    await status(403, () => edit(other, r, { stageId: live.id }));
    const finished = await edit(member, r, { stageId: live.id });
    expect(finished).toMatchObject({ status: 'done', bucket: 'done', statusLabel: 'Live' });
    expect(finished.completedAt).toBeTruthy();
    const reopened = await edit(member, finished, { stageId: review.id });
    expect(reopened).toMatchObject({ status: 'in_progress', bucket: 'open', completedAt: null });
    expect(reopened.history.find((h) => h.action === 'status')).toMatchObject({ from: 'Live', to: 'Review' });
    // Another project's status is refused.
    const q = await change(head, await start(head, { name: 'Other' }), { statuses: STAGES });
    await status(400, () => edit(member, reopened, { stageId: q.statuses[0].id }), /no longer in the project/);
  });

  it('a plain status (from My tasks or a bulk change) lands on the first status of that kind', async () => {
    const p = await change(head, await start(head), { statuses: STAGES });
    const t = await give(head, { assigneeId: String(member._id), projectId: p.id });
    const doing = await edit(member, t, { status: 'in_progress' });
    expect(doing).toMatchObject({ stage: p.statuses[1].id, statusLabel: 'Designing' });
    const done = await edit(member, doing, { status: 'done' });
    expect(done).toMatchObject({ stage: p.statuses[3].id, bucket: 'done' });
    const bulk = await tasks.bulkUpdate(await as(head), { items: [{ id: done.id, rev: done.rev }], changes: { status: 'todo' } }, req);
    expect(bulk.results?.[0]?.ok ?? true).toBeTruthy();
    expect(await fresh(head, done)).toMatchObject({ stage: p.statuses[0].id, status: 'todo', bucket: 'open' });
  });

  it('a new task starts in the status asked for (never a done one), else the first not-started', async () => {
    const p = await change(head, await start(head), { statuses: STAGES });
    expect(await give(head, { assigneeId: String(member._id), projectId: p.id, stageId: p.statuses[2].id }))
      .toMatchObject({ stage: p.statuses[2].id, status: 'in_progress' });
    expect(await give(head, { assigneeId: String(member._id), projectId: p.id, status: 'in_progress' }))
      .toMatchObject({ stage: p.statuses[1].id });
    await status(400, () => give(head, { assigneeId: String(member._id), projectId: p.id, stageId: p.statuses[3].id }), /isn’t done/);
    await status(400, () => give(head, { assigneeId: String(member._id), stageId: p.statuses[0].id }), /no statuses/);
  });

  // Regression: the list read has its own field list (LIST_PROJECTION), which once
  // left these out — the board, list and calendar then showed every task in the
  // first status of its kind and in no list, while the task page was right.
  it('a list read carries each task’s status and list, the same as the task page', async () => {
    const p = await change(head, await start(head), { statuses: STAGES, lists: [{ name: 'Ads' }] });
    const a = await give(head, { assigneeId: String(member._id), projectId: p.id, stageId: p.statuses[2].id, projectListId: p.lists[0].id });
    const [row] = await inList(head, p);
    expect(row).toMatchObject({ id: a.id, stage: p.statuses[2].id, statusLabel: 'Review', projectList: p.lists[0].id });
    const page = await fresh(head, a);
    for (const k of ['stage', 'statusLabel', 'projectList']) expect(row[k]).toEqual(page[k]);
  });

  it('renaming or deleting a status, or turning them off, brings the tasks in line', async () => {
    const p = await change(head, await start(head), { statuses: STAGES });
    const [ideas, designing, review, live] = p.statuses;
    const inReview = await edit(member, await give(head, { assigneeId: String(member._id), projectId: p.id }), { stageId: review.id });
    const shipped = await edit(member, await give(head, { assigneeId: String(member._id), projectId: p.id }), { stageId: live.id });
    // Rename Review → "Checking"; delete Live in favour of a new done status.
    const p2 = await change(head, p, {
      statuses: [ideas, designing, { id: review.id, name: 'Checking', type: 'in_progress' }, { name: 'Shipped', type: 'done' }],
    });
    expect(await fresh(head, inReview)).toMatchObject({ stage: review.id, statusLabel: 'Checking' });
    expect(await fresh(head, shipped)).toMatchObject({ stage: p2.statuses[3].id, statusLabel: 'Shipped', bucket: 'done' });
    // Turning them off: everyone back on the usual three, by kind.
    await change(head, p2, { statuses: [] });
    expect(await fresh(head, inReview)).toMatchObject({ stage: null, statusLabel: 'In progress', status: 'in_progress' });
    expect((await raw(shipped)).stage).toBeUndefined();
  });

  it('moving a task to another project re-places it in that project’s statuses, or none', async () => {
    const p = await change(head, await start(head), { statuses: STAGES });
    const plain = await start(head, { name: 'Plain' });
    const t = await edit(member, await give(head, { assigneeId: String(member._id), projectId: p.id }), { stageId: p.statuses[2].id });
    const moved = await edit(head, t, { projectId: plain.id });
    expect(moved).toMatchObject({ stage: null, statusLabel: 'In progress', status: 'in_progress' });
    const q = await change(head, await start(head, { name: 'Q' }), { statuses: [{ name: 'Backlog', type: 'todo' }, { name: 'Doing', type: 'in_progress' }, { name: 'Done!', type: 'done' }] });
    const into = await edit(head, moved, { projectId: q.id });
    expect(into).toMatchObject({ stage: q.statuses[1].id, statusLabel: 'Doing' });
  });
});

describe('the calendar’s days', () => {
  it('returns open tasks due within the days asked, and refuses a backwards or too-long range', async () => {
    const mine = async (dueFrom, dueTo) => (await tasks.listTasks(await as(member), { view: 'mine', dueFrom, dueTo })).tasks.map((t) => t.title);
    await give(head, { title: 'Before', assigneeId: String(member._id), dueOn: '2026-11-15' });
    await give(head, { title: 'First', assigneeId: String(member._id), dueOn: '2026-11-16', dueTime: '09:30' });
    await give(head, { title: 'Last', assigneeId: String(member._id), dueOn: '2026-11-30' });
    await give(head, { title: 'After', assigneeId: String(member._id), dueOn: '2026-12-01' });
    await give(head, { title: 'No date', assigneeId: String(member._id) });
    const finished = await give(head, { title: 'Done one', assigneeId: String(member._id), dueOn: '2026-11-20' });
    await edit(member, finished, { status: 'done' });
    expect(await mine('2026-11-16', '2026-11-30')).toEqual(['First', 'Last']);
    await status(400, () => mine('2026-11-30', '2026-11-16'), /days/);
    await status(400, () => mine('2026-11-01', '2026-12-31'), /at most 45/);
    await status(400, () => mine('2026-11-01', undefined), /days/);
  });
});
