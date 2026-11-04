/**
 * Staff tasks: folders and lists in a team's space (services/staffTaskListService.js)
 * and filing tasks in them (services/staffTaskService.js). Mongo is real; push is a double.
 *
 * What must hold:
 *   - everyone in a team sees its space; only its head and the admin arrange it
 *   - one name per kind per place (any case); a deleted one frees its name
 *   - folders hold lists, never folders; a list moves only to a folder of its space
 *   - a task goes only in a list of a team it is in; only its editors move it;
 *     given to another team, it drops out of the list
 *   - deleting a list (or its folder) puts its tasks back in "Other tasks", bumping
 *     their rev and saying so in their history — nothing is lost
 *   - the sidebar counts and the list filter agree
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
const { default: StaffTaskList } = await import('../models/StaffTaskList.js');
const tasks = await import('../services/staffTaskService.js');
const lists = await import('../services/staffTaskListService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name: name || `${role} ${n}`, email: `tl${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const status = (code, fn, msg) => expect(fn()).rejects.toMatchObject({ statusCode: code, ...(msg && { message: expect.stringMatching(msg) }) });
const add = (actor, input) => lists.createListItem(actor, { team: 'procurement', kind: 'list', ...input }, req);
const give = (actor, over = {}) => tasks.createTask(actor, { title: 'Call Bosch', ...over }, req).then((r) => r.task);
const edit = (actor, t, patch) => tasks.updateTask(actor, t.id, { rev: t.rev, ...patch }, req);
const raw = (id) => StaffTask.findById(id).lean();

let admin, priya, arun, bala, sam;
beforeAll(async () => { await StaffTask.init(); await StaffTaskList.init(); });
beforeEach(async () => {
  admin = await person('admin', null, 'Owner');
  priya = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
  arun = await person('staff', { team: 'procurement' }, 'Arun');
  bala = await person('staff', { team: 'procurement' }, 'Bala');
  sam = await person('staff', { team: 'sales', isHead: true }, 'Sam');
});

describe('arranging a space', () => {
  it('the head and the admin make folders and lists; members and other heads may not', async () => {
    const folder = await lists.createListItem(priya, { kind: 'folder', name: 'Suppliers' }, req);
    expect(folder).toMatchObject({ kind: 'folder', name: 'Suppliers', colour: 'gray', folderId: null });
    const bosch = await add(admin, { name: 'Bosch orders', folderId: folder.id, colour: 'red' });
    expect(bosch).toMatchObject({ kind: 'list', folderId: folder.id, colour: 'red' });

    await status(403, () => add(arun, { name: 'Mine' }), /team head or the admin/);
    await status(403, () => add(sam, { name: 'Theirs' }), /own team/);
    await status(403, () => lists.updateListItem(arun, bosch.id, { rev: bosch.rev, name: 'x' }, req));
    // Another team's head does not even see it.
    await status(404, () => lists.deleteListItem(sam, bosch.id, req));
  });

  it('one name per place, whatever the case; the same name elsewhere is fine; a deleted name is free again', async () => {
    const a = await lists.createListItem(priya, { kind: 'folder', name: 'Suppliers' }, req);
    const b = await lists.createListItem(priya, { kind: 'folder', name: 'Stock' }, req);
    await add(priya, { name: 'Follow-ups', folderId: a.id });
    await status(409, () => add(priya, { name: '  follow-UPS ', folderId: a.id }), /already a list/);
    await add(priya, { name: 'Follow-ups', folderId: b.id });
    await status(409, () => lists.createListItem(priya, { kind: 'folder', name: 'stock' }, req));
    await lists.deleteListItem(priya, b.id, req);
    expect(await lists.createListItem(priya, { kind: 'folder', name: 'Stock' }, req)).toMatchObject({ name: 'Stock' });
    // Renaming onto a taken name is refused too.
    const c = await add(priya, { name: 'Other', folderId: a.id });
    await status(409, () => lists.updateListItem(priya, c.id, { rev: c.rev, name: 'FOLLOW-UPS' }, req));
  });

  it('refuses a folder in a folder, a list in another team\'s folder, bad names and colours, and too many', async () => {
    const f = await lists.createListItem(priya, { kind: 'folder', name: 'Suppliers' }, req);
    await status(400, () => lists.createListItem(priya, { kind: 'folder', name: 'Inner', folderId: f.id }, req));
    const salesFolder = await lists.createListItem(sam, { team: 'sales', kind: 'folder', name: 'Leads' }, req);
    await status(400, () => add(admin, { name: 'x', folderId: salesFolder.id }), /folder no longer exists/);
    await status(400, () => add(priya, { name: '   ' }));
    await status(400, () => add(priya, { name: 'x'.repeat(61) }));
    await status(400, () => add(priya, { name: 'x', colour: 'chartreuse' }));
    await status(400, () => lists.createListItem(priya, { kind: 'board', name: 'x' }, req));

    await StaffTaskList.insertMany(Array.from({ length: lists.LISTS_MAX - 1 }, (_, i) => ({
      team: 'procurement', kind: 'list', name: `L${i}`, nameKey: `l${i}`,
    })));
    await status(400, () => add(priya, { name: 'one too many' }), /at most 100/);
  });

  it('rename, recolour and move a list between folders against its rev; a stale rev is refused', async () => {
    const f = await lists.createListItem(priya, { kind: 'folder', name: 'Suppliers' }, req);
    let l = await add(priya, { name: 'Bosch' });
    l = await lists.updateListItem(priya, l.id, { rev: l.rev, name: 'Bosch orders', colour: 'blue', folderId: f.id }, req);
    expect(l).toMatchObject({ name: 'Bosch orders', colour: 'blue', folderId: f.id, rev: 2 });
    await status(409, () => lists.updateListItem(priya, l.id, { rev: 1, name: 'Old' }, req));
    l = await lists.updateListItem(priya, l.id, { rev: l.rev, folderId: null }, req);
    expect(l.folderId).toBeNull();
    // Sending what it already is changes nothing.
    expect((await lists.updateListItem(priya, l.id, { rev: l.rev, name: 'Bosch orders' }, req)).rev).toBe(l.rev);
  });
});

describe('seeing a space', () => {
  it('everyone in the team sees the tree and the counts; the admin any team; nobody another team', async () => {
    const f = await lists.createListItem(priya, { kind: 'folder', name: 'Suppliers' }, req);
    const bosch = await add(priya, { name: 'Bosch orders', folderId: f.id });
    const loose = await add(priya, { name: 'Weekly stock check' });
    await give(priya, { assigneeId: String(arun._id), listId: bosch.id });
    await give(priya, { assigneeId: String(bala._id), listId: bosch.id });
    const done = await give(priya, { assigneeId: String(arun._id), listId: loose.id });
    await edit(priya, done, { status: 'done' });
    await give(priya, { assigneeId: String(arun._id) });

    const space = await lists.getSpace(arun);
    expect(space).toMatchObject({ team: 'procurement', teamLabel: 'Procurement', canManage: false, other: 1 });
    expect(space.folders).toEqual([expect.objectContaining({ name: 'Suppliers', lists: [expect.objectContaining({ name: 'Bosch orders', open: 2 })] })]);
    expect(space.lists).toEqual([expect.objectContaining({ name: 'Weekly stock check', open: 0 })]);
    expect((await lists.getSpace(priya)).canManage).toBe(true);
    expect((await lists.getSpace(admin, 'procurement')).canManage).toBe(true);
    await status(403, () => lists.getSpace(arun, 'sales'));
    await status(400, () => lists.getSpace(admin));
  });

  it('the list filter shows one list, or the tasks in none, inside the team only', async () => {
    const bosch = await add(priya, { name: 'Bosch orders' });
    await give(priya, { assigneeId: String(arun._id), listId: bosch.id, title: 'in bosch' });
    await give(priya, { assigneeId: String(bala._id), title: 'loose' });
    await give(sam, { title: 'sales loose' });
    const titles = async (u, list, team) => (await tasks.listTasks(u, { view: 'team', list, team })).tasks.map((t) => t.title);
    expect(await titles(bala, bosch.id)).toEqual(['in bosch']);
    expect(await titles(arun, 'none')).toEqual(['loose']);
    expect(await titles(admin, 'none', 'procurement')).toEqual(['loose']);
    // The admin's "all teams" has no single space to look in.
    await status(400, () => tasks.listTasks(admin, { view: 'team', list: 'none' }));
    // A sales head asking for procurement's list sees nothing from it.
    expect(await titles(sam, bosch.id)).toEqual([]);
  });
});

describe('filing a task', () => {
  it('a new task goes in a list of its team, every copy too; another team\'s person is refused', async () => {
    const bosch = await add(priya, { name: 'Bosch orders' });
    const t = await give(priya, { assigneeId: String(arun._id), listId: bosch.id });
    expect(t.list).toBe(bosch.id);
    const { tasks: copies } = await tasks.createTask(priya, { title: 'Each', assigneeIds: [String(arun._id), String(bala._id)], listId: bosch.id }, req);
    expect(copies.map((c) => c.list)).toEqual([bosch.id, bosch.id]);
    await status(400, () => give(priya, { assigneeId: String(sam._id), listId: bosch.id }), /in Procurement/);
    await status(400, () => tasks.createTask(priya, { title: 'Each', assigneeIds: [String(arun._id), String(sam._id)], listId: bosch.id }, req));
    // A shared task with someone from procurement on it is in the space.
    expect((await give(priya, { assigneeIds: [String(arun._id), String(sam._id)], shared: true, listId: bosch.id })).list).toBe(bosch.id);
    // A folder is not a list.
    const f = await lists.createListItem(priya, { kind: 'folder', name: 'Suppliers' }, req);
    await status(400, () => give(priya, { assigneeId: String(arun._id), listId: f.id }));
  });

  it('only its editors move a task between lists; the history says so; the same list again is nothing', async () => {
    const a = await add(priya, { name: 'Bosch orders' });
    const b = await add(priya, { name: 'Price follow-ups' });
    let t = await give(priya, { assigneeId: String(arun._id), listId: a.id });
    await status(403, () => edit(arun, t, { listId: b.id }));
    await status(403, () => edit(bala, t, { listId: b.id }));
    t = await edit(priya, t, { listId: b.id });
    expect(t.list).toBe(b.id);
    expect(t.history.find((h) => h.action === 'list')).toMatchObject({ from: 'Bosch orders', to: 'Price follow-ups' });
    expect((await edit(priya, t, { listId: b.id })).rev).toBe(t.rev);
    t = await edit(priya, t, { listId: null });
    expect(t.list).toBeNull();
  });

  it('given to someone in another team, the task leaves the list', async () => {
    const bosch = await add(priya, { name: 'Bosch orders' });
    let t = await give(priya, { assigneeId: String(arun._id), listId: bosch.id });
    t = await edit(priya, t, { assigneeIds: [String(bala._id)] });
    expect(t.list).toBe(bosch.id);
    t = await edit(priya, t, { assigneeIds: [String(sam._id)] });
    expect(t.list).toBeNull();
    expect(t.history.find((h) => h.action === 'list')).toMatchObject({ from: 'Bosch orders', to: '' });
  });
});

describe('deleting', () => {
  it('a list: its tasks go back to "Other tasks" with a new rev and a history line', async () => {
    const bosch = await add(priya, { name: 'Bosch orders' });
    const t = await give(priya, { assigneeId: String(arun._id), listId: bosch.id });
    const res = await lists.deleteListItem(priya, bosch.id, req);
    expect(res).toMatchObject({ deleted: [bosch.id], tasksMoved: 1 });
    const after = await raw(t.id);
    expect(after.list).toBeNull();
    expect(after.rev).toBe(t.rev + 1);
    expect(after.history.at(-1)).toMatchObject({ action: 'list', from: 'Bosch orders', to: '' });
    // An edit made against the old rev is refused, not applied on top.
    await status(409, () => edit(priya, t, { title: 'stale' }));
    expect((await lists.getSpace(priya)).other).toBe(1);
    // Gone: a second delete, or filing a task in it, is refused.
    await status(404, () => lists.deleteListItem(priya, bosch.id, req));
    await status(400, () => give(priya, { assigneeId: String(arun._id), listId: bosch.id }), /no longer exists/);
  });

  it('a folder takes its lists with it; their tasks stay, in "Other tasks"', async () => {
    const f = await lists.createListItem(priya, { kind: 'folder', name: 'Suppliers' }, req);
    const a = await add(priya, { name: 'Bosch', folderId: f.id });
    const b = await add(priya, { name: 'Denso', folderId: f.id });
    const keep = await add(priya, { name: 'Weekly' });
    await give(priya, { assigneeId: String(arun._id), listId: a.id });
    await give(priya, { assigneeId: String(arun._id), listId: b.id });
    const stays = await give(priya, { assigneeId: String(arun._id), listId: keep.id });
    const res = await lists.deleteListItem(admin, f.id, req);
    expect(res.deleted.sort()).toEqual([f.id, a.id, b.id].sort());
    expect(res.tasksMoved).toBe(2);
    const space = await lists.getSpace(priya);
    expect(space.folders).toEqual([]);
    expect(space.lists.map((l) => l.name)).toEqual(['Weekly']);
    expect(space).toMatchObject({ other: 2 });
    expect((await raw(stays.id)).list).toEqual(expect.anything());
  });
});
