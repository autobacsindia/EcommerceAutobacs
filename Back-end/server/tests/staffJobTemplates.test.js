/**
 * Job templates (services/staffJobTemplateService.js): save a project's shape,
 * start the next project from it. Mongo is real.
 *
 * What must hold:
 *   - only the project's owner or the admin saves; one template per name (any case)
 *   - a template keeps columns, lists and top-level live tasks — never people,
 *     sub-tasks, archived tasks, ticks, comments or job details — and each task's
 *     due date as days after the project's start
 *   - starting from it gives the same columns and lists, and every task for the
 *     project's owner in the same list and column, due that many days after the
 *     new start; a task in a Done column starts open
 *   - a retry (same clientId) is one project with one set of tasks, and a retry
 *     after a half-way failure adds only the missing tasks
 *   - a due date past what its priority allows is moved earlier and counted
 *   - every active staff member (and the admin) uses templates; customers and
 *     inactive staff do not; the admin or its author deletes one
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
const { default: StaffJobTemplate } = await import('../models/StaffJobTemplate.js');
const tasks = await import('../services/staffTaskService.js');
const projects = await import('../services/staffProjectService.js');
const templates = await import('../services/staffJobTemplateService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name: name || `${role} ${n}`, email: `jt${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const as = async (u) => {
  const fresh = await User.findById(u._id);
  await projects.loadProjectAccess(fresh);
  return fresh;
};
const status = (code, fn, msg) => expect(fn()).rejects.toMatchObject({ statusCode: code, ...(msg && { message: expect.stringMatching(msg) }) });
const d = (k = 0) => tasks.todayIST(new Date(Date.now() + k * 86400000));
const give = async (actor, over = {}) => (await tasks.createTask(await as(actor), { title: 'Job', dueOn: d(), ...over }, req)).task;
const edit = async (actor, t, patch) => tasks.updateTask(await as(actor), t.id, { rev: t.rev, ...patch }, req);
const start = async (actor, input) => (await projects.createProject(await as(actor), { name: 'Vicky’s Hilux', ...input }, req)).project;
const change = async (actor, p, patch) => projects.updateProject(await as(actor), p.id, { rev: p.rev, ...patch }, req);
const save = async (actor, p, name = 'Fitting job') => templates.saveJobTemplate(await as(actor), p.id, { name }, req);
const useIt = async (actor, t, over = {}) => templates.createProjectFromTemplate(await as(actor), { name: 'Arun’s Thar', templateId: t.id, clientId: 'newproj-0001', ...over }, req);
const projectTasks = (p) => StaffTask.find({ project: p.id }).sort({ number: 1 }).lean();

const COLUMNS = [
  { name: 'To do', type: 'todo', colour: 'gray' },
  { name: 'Garage 1', type: 'in_progress', colour: 'blue' },
  { name: 'Procurement', type: 'in_progress', colour: 'amber' },
  { name: 'Delivered', type: 'done', colour: 'green' },
];

let admin, head, otherHead, member;
beforeAll(async () => { await StaffTask.init(); await StaffProject.init(); await StaffJobTemplate.init(); });
beforeEach(async () => {
  admin = await person('admin', null, 'Vyshnav');
  head = await person('staff', { team: 'operations', isHead: true }, 'Nevin');
  otherHead = await person('staff', { team: 'marketing', isHead: true }, 'Meera');
  member = await person('staff', { team: 'operations' }, 'Arun');
});

/** "Vicky's Hilux": four columns, two lists, and the tasks a fitting job has. */
async function fittingJob() {
  const p0 = await start(head, { memberIds: [String(member._id)], startOn: d(0), lists: [{ name: 'Fitting' }, { name: 'Paperwork' }] });
  const p = await change(head, p0, { statuses: COLUMNS });
  const [, garage1, procurement, delivered] = p.statuses;
  const [fitting, paperwork] = p.lists;
  const parts = await give(head, {
    title: 'Order parts', assigneeId: String(member._id), projectId: p.id, projectListId: fitting.id, stageId: procurement.id,
    dueOn: d(1), checklist: ['Roof rack', 'Mud flaps'], tags: ['parts'],
  });
  await edit(member, parts, { checklist: [{ text: 'Roof rack', done: true }, { text: 'Mud flaps', done: false }] }).catch(() => {});
  const fit = await give(head, { title: 'Fit roof rack', assigneeId: String(member._id), projectId: p.id, projectListId: fitting.id, stageId: garage1.id, dueOn: d(3), priority: 'normal' });
  const rto = await give(head, { title: 'Letter to RTO', assigneeId: String(member._id), projectId: p.id, projectListId: paperwork.id, dueOn: d(5), priority: 'low' });
  await edit(member, rto, { stageId: delivered.id });
  // Not in a template: a sub-task and an archived task.
  await give(head, { title: 'Torque check', assigneeId: String(member._id), parentId: fit.id, dueOn: d(3) });
  const gone = await give(head, { title: 'Cancelled step', assigneeId: String(member._id), projectId: p.id, dueOn: d(2) });
  await edit(head, gone, { archived: true });
  return p;
}

describe('saving a project as a template', () => {
  it('keeps its columns, lists and live top-level tasks with due dates as days after the start', async () => {
    const p = await fittingJob();
    const t = await save(head, p);
    expect(t).toMatchObject({ name: 'Fitting job', columns: COLUMNS.map((x) => x.name), lists: ['Fitting', 'Paperwork'], taskCount: 3, fromProject: p.code });
    const stored = await StaffJobTemplate.findById(t.id).lean();
    expect(stored.tasks.map((x) => [x.title, x.dueAfterDays, x.listIndex, x.stageIndex])).toEqual([
      ['Order parts', 1, 0, 2],
      ['Fit roof rack', 3, 0, 1],
      // It was in the Done column: a new project's copy starts open.
      ['Letter to RTO', 5, 1, null],
    ]);
    expect(stored.tasks[0]).toMatchObject({ checklist: ['Roof rack', 'Mud flaps'], tags: ['parts'] });
    expect(stored.tasks[2].priority).toBe('low');
    // Nothing about people.
    expect(JSON.stringify(stored)).not.toMatch(String(member._id));
  });

  it('only the owner or the admin saves; one template per name, in any case', async () => {
    const p = await fittingJob();
    await status(403, () => save(member, p), /owner or the admin/);
    await status(404, () => save(otherHead, p));
    await save(head, p);
    await status(409, () => save(admin, p, '  FITTING   job '), /already a template/);
    await status(400, () => save(head, p, '   '), /name/);
    expect(await StaffJobTemplate.countDocuments()).toBe(1);
  });
});

describe('starting a project from a template', () => {
  it('makes the same columns and lists, and every task for the owner in its list and column, due after the new start', async () => {
    const t = await save(head, await fittingJob());
    const { project, duplicate, fromTemplate } = await useIt(head, t, { startOn: d(2) });
    expect(duplicate).toBe(false);
    expect(fromTemplate).toMatchObject({ name: 'Fitting job', tasks: 3, movedEarlier: 0, failed: [] });
    expect(project.statuses.map((x) => [x.name, x.type])).toEqual(COLUMNS.map((x) => [x.name, x.type]));
    expect(project.lists.map((x) => x.name)).toEqual(['Fitting', 'Paperwork']);
    const made = await projectTasks(project);
    expect(made.map((x) => x.title)).toEqual(['Order parts', 'Fit roof rack', 'Letter to RTO']);
    expect(made.map((x) => x.dueOn)).toEqual([d(3), d(5), d(7)]);
    for (const x of made) expect(String(x.assignee)).toBe(String(head._id));
    const [, garage1, procurement] = project.statuses;
    expect(made.map((x) => String(x.stage))).toEqual([procurement.id, garage1.id, project.statuses[0].id]);
    expect(made.map((x) => String(x.projectList))).toEqual([project.lists[0].id, project.lists[0].id, project.lists[1].id]);
    expect(made[0].checklist.map((c) => [c.text, c.done])).toEqual([['Roof rack', false], ['Mud flaps', false]]);
    expect(made.every((x) => x.bucket === 'open')).toBe(true);
  });

  it('a retry is one project with one set of tasks; after a half-way failure it adds only the missing ones', async () => {
    const t = await save(head, await fittingJob());
    const first = await useIt(head, t);
    const again = await useIt(head, t);
    expect(again.duplicate).toBe(true);
    expect(again.project.id).toBe(first.project.id);
    expect(await projectTasks(first.project)).toHaveLength(3);
    // As if the first attempt died after two tasks: the third is gone, a retry puts it back once.
    await StaffTask.deleteOne({ project: first.project.id, title: 'Letter to RTO' });
    await useIt(head, t);
    const made = await projectTasks(first.project);
    expect(made.map((x) => x.title).sort()).toEqual(['Fit roof rack', 'Letter to RTO', 'Order parts']);
    expect(await StaffProject.countDocuments({ name: 'Arun’s Thar' })).toBe(1);
  });

  it('a due date past what its priority allows is moved earlier, and counted', async () => {
    const p = await start(head, { startOn: d(0) });
    await give(head, { title: 'Book the bay', projectId: p.id, dueOn: d(1), priority: 'high' });
    await give(head, { title: 'Follow up', projectId: p.id, dueOn: d(1), priority: 'normal' });
    const t = await save(head, p, 'Quick job');
    const { fromTemplate, project } = await useIt(head, t, { startOn: d(5) });
    expect(fromTemplate).toMatchObject({ tasks: 2, movedEarlier: 1 });
    const made = await projectTasks(project);
    expect(made.map((x) => [x.title, x.dueOn])).toEqual([['Book the bay', d(1)], ['Follow up', d(6)]]);
  });

  it('every active staff member uses one; customers and inactive staff do not; a clientId and a real template are required', async () => {
    const t = await save(head, await fittingJob());
    const byMember = await useIt(member, t, { clientId: 'memberproj-0001' });
    expect(byMember.project.owner.id).toBe(String(member._id));
    expect(await projectTasks(byMember.project)).toHaveLength(3);
    const customer = await person('customer');
    const gone = await person('staff', { team: 'operations', active: false });
    await status(403, () => useIt(customer, t, { clientId: 'custproj-0001' }), /staff/);
    await status(403, () => useIt(gone, t, { clientId: 'goneproj-0001' }), /staff/);
    await status(400, () => useIt(head, t, { clientId: undefined }), /Reload/);
    await status(400, () => useIt(head, t, { clientId: 'x'.repeat(60) }), /Reload/);
    await status(400, () => useIt(head, { id: String(t.id).replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) }), /no longer exists/);
    const byAdmin = await useIt(admin, t, { clientId: 'adminproj-0001', ownerId: String(head._id) });
    expect(byAdmin.project.owner.id).toBe(String(head._id));
  });
});

describe('the template list and deleting', () => {
  it('all active staff and the admin see them; customers and inactive staff see none; the admin or its author deletes', async () => {
    const t = await save(head, await fittingJob());
    expect((await templates.listJobTemplates(await as(otherHead))).templates).toEqual([
      expect.objectContaining({ id: t.id, name: 'Fitting job', taskCount: 3, can: { delete: false } }),
    ]);
    expect((await templates.listJobTemplates(await as(head))).templates[0].can.delete).toBe(true);
    expect((await templates.listJobTemplates(await as(member))).templates).toEqual([
      expect.objectContaining({ id: t.id, can: { delete: false } }),
    ]);
    const customer = await person('customer');
    const gone = await person('staff', { team: 'operations', active: false });
    expect((await templates.listJobTemplates(await as(customer))).templates).toEqual([]);
    expect((await templates.listJobTemplates(await as(gone))).templates).toEqual([]);
    await status(403, async () => templates.deleteJobTemplate(await as(otherHead), t.id, req), /Only the admin/);
    await status(403, async () => templates.deleteJobTemplate(await as(member), t.id, req), /Only the admin/);
    await status(404, async () => templates.deleteJobTemplate(await as(customer), t.id, req));
    await templates.deleteJobTemplate(await as(admin), t.id, req);
    expect(await StaffJobTemplate.countDocuments()).toBe(0);
    await status(404, async () => templates.deleteJobTemplate(await as(head), t.id, req));
  });
});
