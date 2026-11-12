/**
 * Staff task projects (services/staffProjectService.js) and filing tasks in them
 * (services/staffTaskService.js). Mongo is real; push is a double.
 *
 * What must hold:
 *   - only the admin and team heads start projects; only the owner and the admin change one
 *   - a project is seen by the admin, its people, and heads of its people's teams — nobody else
 *   - whoever sees a project reads and comments on every task in it, but edits none
 *     they could not edit before
 *   - LEAK 1: nobody outside a project gets at its tasks through it — not its page,
 *     not a task's page, comments, timer or the project list — and leaving a project
 *     (or it being deleted) takes that away on the next request
 *   - LEAK 2: the progress numbers count only tasks each viewer of the project may
 *     open: never personal or archived tasks, and the project's card is shown
 *     to nobody who could not open its tasks
 *   - only someone who may edit a task, and who sees the project, files it there
 *   - a double-clicked create makes one project; a stale rev is refused
 *   - status: on track / at risk / late / done from tasks and deadline, or the owner's word
 *   - the list is keyset-paged, soonest deadline first
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

const { default: mongoose } = await import('mongoose');
const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffProject } = await import('../models/StaffProject.js');
const tasks = await import('../services/staffTaskService.js');
const projects = await import('../services/staffProjectService.js');
const time = await import('../services/staffTaskTimeService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name: name || `${role} ${n}`, email: `pj${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
/** A fresh request as `u`: their user re-read and their project access loaded, as the router does. */
const as = async (u) => {
  const fresh = await User.findById(u._id);
  await projects.loadProjectAccess(fresh);
  return fresh;
};
const status = (code, fn, msg) => expect(fn()).rejects.toMatchObject({ statusCode: code, ...(msg && { message: expect.stringMatching(msg) }) });
const give = async (actor, over = {}) => (await tasks.createTask(await as(actor), { title: 'Job', ...over }, req)).task;
const edit = async (actor, t, patch) => tasks.updateTask(await as(actor), t.id, { rev: t.rev, ...patch }, req);
const start = async (actor, input) => (await projects.createProject(await as(actor), { name: 'Diwali launch', ...input }, req)).project;
const projectTasks = async (actor, project, state = 'open') => (await tasks.listTasks(await as(actor), { view: 'project', project: project.id, state })).tasks;
const myProjects = async (actor) => (await projects.listProjects(await as(actor))).projects;

const DAY = 86400000;
const ist = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600000 + offsetDays * DAY).toISOString().slice(0, 10);

let admin, mkHead, mkMember, prHead, prMember, devMember, salesHead, salesMember;
beforeAll(async () => { await StaffTask.init(); await StaffProject.init(); });
beforeEach(async () => {
  admin = await person('admin', null, 'Owner');
  mkHead = await person('staff', { team: 'marketing', isHead: true }, 'Meera');
  mkMember = await person('staff', { team: 'marketing' }, 'Kiran');
  prHead = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
  prMember = await person('staff', { team: 'procurement' }, 'Arun');
  devMember = await person('staff', { team: 'developer' }, 'Dev');
  salesHead = await person('staff', { team: 'sales', isHead: true }, 'Sam');
  salesMember = await person('staff', { team: 'sales' }, 'Sita');
});

describe('starting and changing a project', () => {
  it('the admin and heads start projects; members may not', async () => {
    const p = await start(mkHead, { memberIds: [String(prMember._id)], dueOn: '2030-10-25', startOn: '2030-10-01' });
    expect(p).toMatchObject({
      name: 'Diwali launch', owner: { name: 'Meera' }, startOn: '2030-10-01', dueOn: '2030-10-25',
      status: 'on_track', progress: { total: 0, done: 0, percent: 0 }, can: { edit: true },
    });
    expect(p.people.map((x) => x.name)).toEqual(['Meera', 'Arun']);
    expect(p.teams.map((t) => t.value).sort()).toEqual(['marketing', 'procurement']);
    await start(admin, { name: 'Website relaunch', ownerId: String(devMember._id) });
    await status(403, () => start(mkMember), /admin and team heads/);
  });

  it('refuses a bad name, a start after the deadline, and people outside the panel', async () => {
    await status(400, () => start(mkHead, { name: '   ' }), /name/);
    await status(400, () => start(mkHead, { startOn: '2030-10-26', dueOn: '2030-10-25' }), /start date/);
    await status(400, () => start(mkHead, { dueOn: '2030-02-31' }), /valid deadline/);
    const customer = await person('customer', null, 'Cust');
    await status(400, () => start(mkHead, { memberIds: [String(customer._id)] }), /no longer in the staff panel/);
  });

  it('a double-clicked create makes one project', async () => {
    const actor = await as(mkHead);
    const [a, b] = await Promise.all([
      projects.createProject(actor, { name: 'Twice', clientId: 'proj-client-0001' }, req),
      projects.createProject(actor, { name: 'Twice', clientId: 'proj-client-0001' }, req),
    ]);
    expect(a.project.id).toBe(b.project.id);
    expect(await StaffProject.countDocuments({ name: 'Twice' })).toBe(1);
  });

  it('only the owner and the admin change it; a stale rev is refused; only the admin hands it over', async () => {
    const p = await start(mkHead, { memberIds: [String(prMember._id)] });
    await status(403, async () => projects.updateProject(await as(prMember), p.id, { rev: p.rev, name: 'x' }, req), /owner or the admin/);
    await status(403, async () => projects.updateProject(await as(prHead), p.id, { rev: p.rev, name: 'x' }, req), /owner or the admin/);
    const renamed = await projects.updateProject(await as(mkHead), p.id, { rev: p.rev, name: 'Diwali 2030' }, req);
    expect(renamed.name).toBe('Diwali 2030');
    await status(409, async () => projects.updateProject(await as(admin), p.id, { rev: p.rev, name: 'Old' }, req), /just now/);
    await status(403, async () => projects.updateProject(await as(mkHead), p.id, { rev: renamed.rev, ownerId: String(mkMember._id) }, req), /Only the admin/);
    const handed = await projects.updateProject(await as(admin), p.id, { rev: renamed.rev, ownerId: String(mkMember._id) }, req);
    expect(handed.owner.name).toBe('Kiran');
    // Members stay; the new owner is first.
    expect(handed.people.map((x) => x.name)).toEqual(['Kiran', 'Meera', 'Arun']);
  });
});

describe('who sees a project', () => {
  it('the admin, its people, and heads of its people’s teams — nobody else', async () => {
    const p = await start(mkHead, { memberIds: [String(prMember._id)] });
    for (const u of [admin, mkHead, prMember, prHead]) {
      expect((await myProjects(u)).map((x) => x.id)).toContain(p.id);
      await expect(projects.getProject(await as(u), p.id)).resolves.toMatchObject({ id: p.id });
    }
    // Another member of a team in it is not in it: Kiran is in marketing but not a member.
    for (const u of [mkMember, salesHead, salesMember, devMember]) {
      expect(await myProjects(u)).toEqual([]);
      await status(404, async () => projects.getProject(await as(u), p.id), /not found/);
    }
  });
});

describe('LEAK 1 — tasks never reach someone outside the project through it', () => {
  it('a member reads and comments on another team’s task in the project, but cannot change it', async () => {
    const p = await start(mkHead, { memberIds: [String(devMember._id)] });
    // A procurement task the developer could never see before.
    const t = await give(prHead, { title: 'Order 200 wiper sets', assigneeIds: [String(prMember._id)] });
    await status(404, async () => tasks.getTask(await as(devMember), t.id));
    // Priya (procurement head) is not in the project, so cannot file Priya's task there.
    await status(400, () => edit(prHead, t, { projectId: p.id }), /no longer exists/);
    // The project's owner cannot even see Priya's task, so cannot pull it in either.
    await status(404, () => edit(mkHead, t, { projectId: p.id }));

    const prInProject = await projects.updateProject(await as(mkHead), p.id, { rev: p.rev, memberIds: [String(devMember._id), String(prHead._id)] }, req);
    const filed = await edit(prHead, t, { projectId: prInProject.id });
    expect(filed.project).toBe(p.id);

    const dev = await as(devMember);
    const seen = await tasks.getTask(dev, t.id);
    expect(seen).toMatchObject({ title: 'Order 200 wiper sets', can: { comment: true, edit: false, status: false, archive: false } });
    await expect(tasks.addComment(dev, t.id, { text: 'Banner needs the wiper photo' }, req)).resolves.toBeTruthy();
    await status(403, () => tasks.updateTask(dev, t.id, { rev: filed.rev, title: 'Hijacked' }, req));
    await status(403, () => tasks.updateTask(dev, t.id, { rev: filed.rev, status: 'done' }, req));
    // The timer, which checks the same rule from another service, agrees.
    await expect(time.startTimer(dev, t.id)).resolves.toBeTruthy();
  });

  it('outsiders get nothing: not the project list, the task list, the task, or its comments', async () => {
    const p = await start(mkHead, { memberIds: [String(prMember._id)] });
    const t = await give(mkHead, { title: 'Design banners', assigneeIds: [String(mkHead._id)], projectId: p.id });
    expect(t.project).toBe(p.id);
    for (const u of [salesHead, salesMember, devMember]) {
      await status(404, async () => tasks.listTasks(await as(u), { view: 'project', project: p.id }), /Project not found/);
      await status(404, async () => tasks.getTask(await as(u), t.id), /Task not found/);
      await status(404, async () => tasks.listComments(await as(u), t.id, {}), /Task not found/);
      await status(404, async () => tasks.addComment(await as(u), t.id, { text: 'hi' }, req), /Task not found/);
    }
  });

  it('leaving the project, or the project being deleted, ends access on the next request', async () => {
    const p = await start(mkHead, { memberIds: [String(salesMember._id)] });
    const t = await give(mkHead, { title: 'Design banners', assigneeIds: [String(mkHead._id)], projectId: p.id });
    const before = await as(salesMember);
    await expect(tasks.getTask(before, t.id)).resolves.toMatchObject({ id: t.id });

    const removed = await projects.updateProject(await as(mkHead), p.id, { rev: p.rev, memberIds: [] }, req);
    await status(404, async () => tasks.getTask(await as(salesMember), t.id));
    await status(404, async () => projects.getProject(await as(salesMember), p.id));

    const back = await projects.updateProject(await as(mkHead), p.id, { rev: removed.rev, memberIds: [String(salesMember._id)] }, req);
    await expect(tasks.getTask(await as(salesMember), t.id)).resolves.toBeTruthy();
    const deleted = await projects.updateProject(await as(mkHead), p.id, { rev: back.rev, archived: true }, req);
    expect(deleted.archivedAt).toBeTruthy();
    await status(404, async () => tasks.getTask(await as(salesMember), t.id));
    expect(await myProjects(salesMember)).toEqual([]);
    // Nothing is lost: the task keeps its project, and restoring brings access back.
    expect(String((await StaffTask.findById(t.id).lean()).project)).toBe(p.id);
    await projects.updateProject(await as(mkHead), p.id, { rev: deleted.rev, archived: false }, req);
    await expect(tasks.getTask(await as(salesMember), t.id)).resolves.toBeTruthy();
  });

  it('a project task moved out of the project is no longer visible through it', async () => {
    const p = await start(mkHead, { memberIds: [String(salesMember._id)] });
    const t = await give(mkHead, { assigneeIds: [String(mkHead._id)], projectId: p.id });
    const out = await edit(mkHead, t, { projectId: null });
    expect(out.project).toBeNull();
    expect(out.history[0]).toMatchObject({ action: 'project', from: 'Diwali launch', to: '' });
    await status(404, async () => tasks.getTask(await as(salesMember), t.id));
  });

  it('a personal task can never join a project', async () => {
    const p = await start(mkHead);
    await status(400, () => give(mkHead, { personal: true, projectId: p.id }), /personal task/);
    const mine = await give(mkHead, { personal: true });
    await status(400, () => edit(mkHead, mine, { projectId: p.id }), /personal task/);
  });

  it('a request that did not load project access fails closed', async () => {
    const p = await start(mkHead, { memberIds: [String(salesMember._id)] });
    const t = await give(mkHead, { assigneeIds: [String(mkHead._id)], projectId: p.id });
    const unloaded = await User.findById(salesMember._id);
    await status(404, () => tasks.getTask(unloaded, t.id));
  });
});

describe('LEAK 2 — progress numbers only count tasks the viewer may open', () => {
  it('counts open and done tasks; never personal or archived ones', async () => {
    const p = await start(mkHead, { memberIds: [String(prMember._id), String(salesMember._id)] });
    const a = await give(mkHead, { assigneeIds: [String(mkHead._id)], projectId: p.id });
    await give(mkHead, { assigneeIds: [String(prMember._id)], projectId: p.id });
    const c = await give(mkHead, { assigneeIds: [String(mkMember._id)], projectId: p.id });
    await edit(mkHead, a, { status: 'done' });
    await edit(mkHead, c, { archived: true });
    // A personal task forced into the project behind the service's back is still not counted.
    const secret = await give(mkHead, { personal: true, title: 'Private note' });
    await StaffTask.updateOne({ _id: secret.id }, { $set: { project: new mongoose.Types.ObjectId(p.id) } });

    for (const u of [admin, mkHead, prMember, salesMember, prHead]) {
      const [card] = await myProjects(u);
      expect(card.progress).toMatchObject({ total: 2, done: 1, percent: 50 });
      // Every task counted is one this viewer may open, and the project list shows exactly them.
      const open = await projectTasks(u, p);
      const done = await projectTasks(u, p, 'done');
      expect(open.length + done.length).toBe(card.progress.total);
      expect(done.length).toBe(card.progress.done);
      expect([...open, ...done].map((x) => x.title)).not.toContain('Private note');
      for (const x of [...open, ...done]) await expect(tasks.getTask(await as(u), x.id)).resolves.toMatchObject({ id: x.id });
    }
    // Nobody else even gets the card with its numbers.
    for (const u of [mkMember, devMember]) expect(await myProjects(u)).toEqual([]);
  });

  it('the personal task forced in stays private even to the admin and the project', async () => {
    const p = await start(mkHead, { memberIds: [String(salesMember._id)] });
    const secret = await give(mkMember, { personal: true, title: 'Private note' });
    await StaffTask.updateOne({ _id: secret.id }, { $set: { project: new mongoose.Types.ObjectId(p.id) } });
    for (const u of [admin, mkHead, salesMember]) {
      await status(404, async () => tasks.getTask(await as(u), secret.id));
      const all = [...await projectTasks(u, p), ...await projectTasks(u, p, 'done')];
      expect(all).toEqual([]);
    }
  });
});

describe('status and order', () => {
  it('done, late, at risk and on track from the tasks; the owner’s word wins', async () => {
    const statusOf = projects.statusOf;
    const today = '2030-10-10';
    expect(statusOf({ dueOn: '2030-12-31' }, { total: 0, done: 0, overdue: 0 }, today)).toBe('on_track');
    expect(statusOf({ dueOn: '2030-12-31' }, { total: 3, done: 3, overdue: 0 }, today)).toBe('done');
    expect(statusOf({ dueOn: '2030-10-09' }, { total: 3, done: 1, overdue: 0 }, today)).toBe('late');
    expect(statusOf({ dueOn: '2030-12-31' }, { total: 3, done: 1, overdue: 1 }, today)).toBe('at_risk');
    expect(statusOf({ dueOn: '2030-10-15' }, { total: 10, done: 5, overdue: 0 }, today)).toBe('at_risk');
    expect(statusOf({ dueOn: '2030-10-15' }, { total: 10, done: 8, overdue: 0 }, today)).toBe('on_track');
    expect(statusOf({ dueOn: '2030-10-30' }, { total: 10, done: 1, overdue: 0 }, today)).toBe('on_track');
    expect(statusOf({ dueOn: null }, { total: 2, done: 0, overdue: 0 }, today)).toBe('on_track');
    expect(statusOf({ dueOn: '2030-10-09', statusOverride: 'on_track' }, { total: 3, done: 1, overdue: 2 }, today)).toBe('on_track');
  });

  it('counts an overdue task, and the owner can set and clear the status', async () => {
    const p = await start(mkHead, { dueOn: ist(60) });
    await give(mkHead, { assigneeIds: [String(mkHead._id)], projectId: p.id, dueOn: ist(-2) });
    const read = await projects.getProject(await as(mkHead), p.id);
    expect(read).toMatchObject({ status: 'at_risk', statusLabel: 'At risk', progress: { total: 1, overdue: 1 } });
    const set = await projects.updateProject(await as(mkHead), p.id, { rev: read.rev, statusOverride: 'on_track' }, req);
    expect(set).toMatchObject({ status: 'on_track', statusOverride: 'on_track' });
    const auto = await projects.updateProject(await as(mkHead), p.id, { rev: set.rev, statusOverride: 'auto' }, req);
    expect(auto).toMatchObject({ status: 'at_risk', statusOverride: null });
  });

  it('pages soonest deadline first, no deadline last, with no row twice or missed', async () => {
    const actor = await as(admin);
    const days = Array.from({ length: 23 }, (_, i) => `2031-01-${String((i % 9) + 10).padStart(2, '0')}`);
    for (const [i, dueOn] of days.entries()) await projects.createProject(actor, { name: `P${i}`, dueOn }, req);
    await projects.createProject(actor, { name: 'No deadline' }, req);
    const first = await projects.listProjects(actor);
    expect(first.projects).toHaveLength(projects.PROJECT_PAGE_SIZE);
    const second = await projects.listProjects(actor, { cursor: first.nextCursor });
    expect(second.nextCursor).toBeNull();
    const all = [...first.projects, ...second.projects];
    expect(new Set(all.map((x) => x.id)).size).toBe(24);
    const dues = all.map((x) => x.dueOn ?? '9999');
    expect(dues).toEqual([...dues].sort());
    expect(all.at(-1).name).toBe('No deadline');
    await status(400, () => projects.listProjects(actor, { cursor: 'nonsense' }), /cursor/);
  });

  it('the task picker offers only the projects you see', async () => {
    const p = await start(mkHead, { memberIds: [String(prMember._id)] });
    await start(salesHead, { name: 'Sales push' });
    expect((await projects.pickableProjects(await as(prMember))).projects.map((x) => x.id)).toEqual([p.id]);
    expect((await projects.pickableProjects(await as(admin))).projects).toHaveLength(2);
  });
});
