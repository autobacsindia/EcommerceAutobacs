/**
 * Staff tasks over HTTP (routes/staffTasks.js, mounted in routes/staff.js):
 * auth, CSRF, validation and status codes are real; push is a double. The
 * rules themselves are in staffTasks.test.js — this proves the wiring.
 */
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));
const pushMock = {
  pushConfigured: () => false, publicKey: () => null, cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}), sendToUsers: async () => 0, sendTest: async () => ({ sent: 0 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffTaskComment } = await import('../models/StaffTaskComment.js');
const { default: StaffTaskInbox } = await import('../models/StaffTaskInbox.js');
const { default: StaffTaskTime } = await import('../models/StaffTaskTime.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';

const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    patch: (url, body = {}) => agent.patch(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf),
    postNoCsrf: (url, body = {}) => agent.post(`${BASE}${url}`).send(body),
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, session: await signIn(email) };
};

describe('Staff task routes', () => {
  beforeAll(async () => { await dbHandler.connect(); await StaffTask.init(); await StaffTaskComment.init(); await StaffTaskInbox.init(); await StaffTaskTime.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let head, member;
  beforeEach(async () => {
    head = await makeUser('Priya', 'staff', { team: 'procurement', isHead: true, active: true });
    member = await makeUser('Arun', 'staff', { team: 'procurement', isHead: false, active: true });
  });

  it('a head gives a task, the member sees it, moves it and comments; a retry is not a second task', async () => {
    const body = { title: 'Call Bosch about the order', assigneeId: String(member.user._id), priority: 'high', dueOn: '2030-01-15', clientId: 'route-12345678' };
    const created = await head.session.post('/staff/tasks', body);
    expect(created.status).toBe(201);
    expect(created.body.task).toMatchObject({ title: body.title, priority: 'high', dueOn: '2030-01-15', assignee: { name: 'Arun' } });
    const retry = await head.session.post('/staff/tasks', body);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ duplicate: true, task: { id: created.body.task.id } });

    const id = created.body.task.id;
    const mine = await member.session.get('/staff/tasks?view=mine');
    expect(mine.status).toBe(200);
    expect(mine.body.tasks.map((t) => t.id)).toEqual([id]);
    expect(mine.body.nextCursor).toBeNull();

    const moved = await member.session.patch(`/staff/tasks/${id}`, { rev: 1, status: 'in_progress' });
    expect(moved.status).toBe(200);
    expect(moved.body.task.status).toBe('in_progress');
    const stale = await head.session.patch(`/staff/tasks/${id}`, { rev: 1, title: 'Old view' });
    expect(stale.status).toBe(409);
    expect(stale.body.message).toMatch(/changed this task just now/);

    const comment = await member.session.post(`/staff/tasks/${id}/comments`, { text: 'Bosch says Friday' });
    expect(comment.status).toBe(201);
    const comments = await head.session.get(`/staff/tasks/${id}/comments`);
    expect(comments.body.comments.map((c) => c.text)).toEqual(['Bosch says Friday']);
    expect((await head.session.get(`/staff/tasks/${id}`)).body.task.commentCount).toBe(1);
  });

  it('the Inbox: the head gives a task, the member reads it, marks it, and cannot touch anyone else\'s', async () => {
    const created = await head.session.post('/staff/tasks', { title: 'Ring the courier', assigneeId: String(member.user._id) });
    expect(created.status).toBe(201);

    const list = await member.session.get('/staff/tasks/inbox');
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ unread: 1, nextCursor: null });
    const [item] = list.body.items;
    expect(item).toMatchObject({ kind: 'assigned', read: false, canOpen: true, task: { id: created.body.task.id, title: 'Ring the courier' }, by: { name: 'Priya' } });
    expect((await head.session.get('/staff/tasks/inbox')).body.items).toEqual([]);

    expect((await member.session.get('/staff/tasks/inbox?state=old')).status).toBe(400);
    expect((await member.session.get('/staff/tasks/inbox?cursor=nope')).status).toBe(400);
    expect((await member.session.patch(`/staff/tasks/inbox/${item.id}`, { state: 'gone' })).status).toBe(400);
    expect((await head.session.patch(`/staff/tasks/inbox/${item.id}`, { state: 'read' })).status).toBe(404);
    expect((await member.session.post('/staff/tasks/inbox/read-all', {})).status).toBe(400);

    const read = await member.session.patch(`/staff/tasks/inbox/${item.id}`, { state: 'read' });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ state: 'read', unread: 0 });
    await member.session.patch(`/staff/tasks/inbox/${item.id}`, { state: 'unread' });
    const all = await member.session.post('/staff/tasks/inbox/read-all', { upTo: item.id });
    expect(all.body).toMatchObject({ marked: 1, unread: 0 });
    expect((await member.session.get('/staff/tasks/inbox?state=unread')).body.items).toEqual([]);
  });

  it('refuses what the rules refuse, with the right codes', async () => {
    // A member may give a task to their head (anyone in the panel)…
    expect((await member.session.post('/staff/tasks', { title: 'x', assigneeId: String(head.user._id) })).status).toBe(201);
    // …and sees the team's tasks, like a chat space.
    expect((await member.session.get('/staff/tasks?view=team')).status).toBe(200);
    const own = await member.session.post('/staff/tasks', { title: 'My own' });
    expect(own.status).toBe(201);
    // The head of the member's team sees a member's own task; an outsider does not.
    expect((await head.session.get(`/staff/tasks/${own.body.task.id}`)).status).toBe(200);
    const outsider = await makeUser('Sam', 'staff', { team: 'sales', isHead: true, active: true });
    expect((await outsider.session.get(`/staff/tasks/${own.body.task.id}`)).status).toBe(404);
  });

  it('validates input', async () => {
    expect((await head.session.post('/staff/tasks', {})).status).toBe(400);
    expect((await head.session.post('/staff/tasks', { title: 'x', priority: 'asap' })).status).toBe(400);
    expect((await head.session.post('/staff/tasks', { title: 'x', assigneeId: 'nope' })).status).toBe(400);
    expect((await head.session.post('/staff/tasks', { title: 'x', assigneeIds: ['nope'] })).status).toBe(400);
    expect((await head.session.post('/staff/tasks', { title: 'x', assigneeIds: 'not-a-list' })).status).toBe(400);
    const both = await head.session.post('/staff/tasks', { title: 'Both', assigneeIds: [String(head.user._id), String(member.user._id)] });
    expect(both.status).toBe(201);
    expect(both.body.tasks.map((t) => t.assignee.name)).toEqual(['Priya', 'Arun']);
    expect((await head.session.get('/staff/tasks?view=everything')).status).toBe(400);
    expect((await head.session.get('/staff/tasks?state=deleted')).status).toBe(400);
    expect((await head.session.get('/staff/tasks/not-an-id')).status).toBe(400);
    const t = await head.session.post('/staff/tasks', { title: 'x' });
    expect((await head.session.patch(`/staff/tasks/${t.body.task.id}`, { title: 'no rev' })).status).toBe(400);
    expect((await head.session.patch(`/staff/tasks/${t.body.task.id}`, { rev: 1, status: 'finished' })).status).toBe(400);
  });

  it('checklist steps over HTTP: add, tick, remove; the member may tick but not add', async () => {
    const t = (await head.session.post('/staff/tasks', { title: 'Ship', assigneeId: String(member.user._id), checklist: ['Pack'] })).body.task;
    const step = t.checklistItems[0].id;
    expect((await member.session.post(`/staff/tasks/${t.id}/checklist`, { text: 'Label' })).status).toBe(403);
    const ticked = await member.session.patch(`/staff/tasks/${t.id}/checklist/${step}`, { done: true });
    expect(ticked.status).toBe(200);
    expect(ticked.body.task.checklist).toEqual({ done: 1, total: 1 });
    expect((await head.session.post(`/staff/tasks/${t.id}/checklist`, { text: 'Label' })).body.task.checklist.total).toBe(2);
    expect((await head.session.patch(`/staff/tasks/${t.id}/checklist/not-an-id`, { done: true })).status).toBe(400);
    expect((await head.session.patch(`/staff/tasks/${t.id}/checklist/${step}`, { done: 'maybe' })).status).toBe(400);
    const gone = await head.session.del(`/staff/tasks/${t.id}/checklist/${step}`);
    expect(gone.status).toBe(200);
    expect(gone.body.task.checklist).toEqual({ done: 0, total: 1 });
  });

  it('header counts, search and filters over HTTP', async () => {
    await head.session.post('/staff/tasks', { title: 'Late one', assigneeId: String(member.user._id), dueOn: '2020-01-01' });
    const sum = await member.session.get('/staff/tasks/summary');
    expect(sum.status).toBe(200);
    expect(sum.body).toMatchObject({ late: 1, today: 0 });
    expect((await member.session.get('/staff/tasks?q=late')).body.tasks).toHaveLength(1);
    expect((await member.session.get('/staff/tasks?due=week')).status).toBe(200);
    expect((await member.session.get('/staff/tasks?priority=asap')).status).toBe(400);
    expect((await member.session.get(`/staff/tasks?q=${'x'.repeat(101)}`)).status).toBe(400);
    expect((await member.session.post('/staff/tasks', { title: 'x', status: 'done' })).status).toBe(400);
  });

  it('tags, start dates, order and bulk changes over HTTP', async () => {
    const a = (await head.session.post('/staff/tasks', {
      title: 'Count Kochi', assigneeId: String(member.user._id), tags: ['Kochi'], startOn: '2030-01-10', dueOn: '2030-01-15',
    })).body.task;
    expect(a).toMatchObject({ tags: ['kochi'], startOn: '2030-01-10' });
    const b = (await head.session.post('/staff/tasks', { title: 'Count Kochi 2', assigneeId: String(member.user._id) })).body.task;
    expect((await head.session.post('/staff/tasks', { title: 'x', tags: 'kochi' })).status).toBe(400);
    expect((await head.session.post('/staff/tasks', { title: 'x', startOn: '2030-01-16', dueOn: '2030-01-15' })).status).toBe(400);
    expect((await member.session.get('/staff/tasks?tag=KOCHI')).body.tasks.map((t) => t.id)).toEqual([a.id]);
    expect((await member.session.get('/staff/tasks?sort=newest')).body.tasks.map((t) => t.id)).toEqual([b.id, a.id]);
    expect((await member.session.get('/staff/tasks?sort=updated')).body.sort).toBe('updated');

    const res = await head.session.post('/staff/tasks/bulk', {
      items: [{ id: a.id, rev: a.rev }, { id: b.id, rev: b.rev }], changes: { status: 'in_progress', priority: 'high' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changed: 2, failed: 0 });
    // The doer may move the status but not the priority: per-task refusals, still a 200.
    const mixed = await member.session.post('/staff/tasks/bulk', { items: [{ id: a.id, rev: a.rev + 1 }], changes: { priority: 'low' } });
    expect(mixed.status).toBe(200);
    expect(mixed.body.results[0]).toMatchObject({ ok: false, status: 403 });
    expect((await head.session.post('/staff/tasks/bulk', { items: [], changes: { priority: 'low' } })).status).toBe(400);
    expect((await head.session.post('/staff/tasks/bulk', { items: [{ id: 'nope', rev: 1 }], changes: { priority: 'low' } })).status).toBe(400);
    expect((await head.session.post('/staff/tasks/bulk', { items: [{ id: a.id, rev: 1 }], changes: { status: 'finished' } })).status).toBe(400);
    // 'waiting' is retired (like ClickUp): nobody can pick it any more.
    expect((await head.session.post('/staff/tasks/bulk', { items: [{ id: a.id, rev: 1 }], changes: { status: 'waiting' } })).status).toBe(400);
    expect((await head.session.patch(`/staff/tasks/${a.id}`, { rev: 1, status: 'waiting' })).status).toBe(400);
    expect((await head.session.post('/staff/tasks', { title: 'x', status: 'waiting' })).status).toBe(400);
    expect((await head.session.postNoCsrf('/staff/tasks/bulk', { items: [{ id: a.id, rev: 1 }], changes: { priority: 'low' } })).status).toBe(403);
    expect((await request(app).post(`${BASE}/staff/tasks/bulk`).send({})).status).toBe(403);
  });

  it('one shared task, its people and its followers over HTTP', async () => {
    const other = await makeUser('Sam', 'staff', { team: 'sales', isHead: false, active: true });
    const created = await head.session.post('/staff/tasks', {
      title: 'Shared', assigneeIds: [String(member.user._id), String(other.user._id)], shared: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.tasks).toHaveLength(1);
    const { id, rev } = created.body.task;
    expect((await other.session.get('/staff/tasks?view=mine')).body.tasks.map((t) => t.id)).toEqual([id]);

    const changed = await head.session.patch(`/staff/tasks/${id}`, { rev, assigneeIds: [String(other.user._id)] });
    expect(changed.status).toBe(200);
    expect(changed.body.task.assignees.map((p) => p.name)).toEqual(['Sam']);
    expect((await head.session.patch(`/staff/tasks/${id}`, { rev: rev + 1, assigneeIds: [] })).status).toBe(400);
    expect((await head.session.patch(`/staff/tasks/${id}`, { rev: rev + 1, assigneeIds: ['nope'] })).status).toBe(400);

    const follow = await member.session.patch(`/staff/tasks/${id}/followers`, { add: [String(member.user._id)] });
    expect(follow.status).toBe(404); // taken off the task: they no longer see it
    const added = await head.session.patch(`/staff/tasks/${id}/followers`, { add: [String(member.user._id)] });
    expect(added.status).toBe(200);
    expect(added.body.task.followers.map((p) => p.name)).toEqual(['Arun']);
    expect((await member.session.get('/staff/tasks?view=following')).body.tasks.map((t) => t.id)).toEqual([id]);
    const off = await member.session.patch(`/staff/tasks/${id}/followers`, { remove: [String(member.user._id)] });
    expect(off.status).toBe(200);
    expect(off.body.task).toBeNull();
    expect((await head.session.patch(`/staff/tasks/${id}/followers`, { add: ['nope'] })).status).toBe(400);
    expect((await head.session.patch(`/staff/tasks/${id}/followers`, { add: 'not-a-list' })).status).toBe(400);
    expect((await head.session.post('/staff/tasks', { title: 'x', shared: 'maybe' })).status).toBe(400);
  });

  it('sub-tasks over HTTP: make one, list them, turn a step into one, archive with the parent', async () => {
    const parent = (await head.session.post('/staff/tasks', { title: 'Diwali stock check', checklist: ['Count wipers'] })).body.task;
    const made = await head.session.post('/staff/tasks', {
      title: 'Count Bosch pads', parentId: parent.id, assigneeIds: [String(member.user._id)], shared: true, clientId: 'route-sub-0001',
    });
    expect(made.status).toBe(201);
    expect(made.body.task.parent).toMatchObject({ id: parent.id, code: parent.code });
    expect((await head.session.post('/staff/tasks', { title: 'x', parentId: 'nope' })).status).toBe(400);
    expect((await head.session.post('/staff/tasks', { title: 'deeper', parentId: made.body.task.id })).status).toBe(400);

    const step = (await head.session.get(`/staff/tasks/${parent.id}`)).body.task.checklistItems[0];
    const fromStep = await head.session.post(`/staff/tasks/${parent.id}/checklist/${step.id}/subtask`, { clientId: 'route-sub-0002' });
    expect(fromStep.status).toBe(200);
    expect(fromStep.body.subtask.title).toBe('Count wipers');
    expect(fromStep.body.task.checklistItems).toEqual([]);
    expect((await head.session.post(`/staff/tasks/${parent.id}/checklist/${step.id}/subtask`, {})).status).toBe(400);

    const list = await member.session.get(`/staff/tasks/${parent.id}/subtasks`);
    expect(list.status).toBe(200); // Arun is on a sub-task, and in the parent's team
    const all = await head.session.get(`/staff/tasks/${parent.id}/subtasks`);
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ total: 2, done: 0 });
    expect(all.body.subtasks.map((t) => t.title).sort()).toEqual(['Count Bosch pads', 'Count wipers']);

    const rev = (await head.session.get(`/staff/tasks/${parent.id}`)).body.task.rev;
    expect((await head.session.patch(`/staff/tasks/${parent.id}`, { rev, archived: true })).status).toBe(200);
    expect((await member.session.get('/staff/tasks?view=mine')).body.tasks).toEqual([]);
  });

  it('time over HTTP: start, switch, stop, add by hand, correct, delete — with the right codes', async () => {
    const a = (await head.session.post('/staff/tasks', { title: 'Count pads', assigneeId: String(member.user._id) })).body.task;
    const b = (await head.session.post('/staff/tasks', { title: 'Ring courier', assigneeId: String(member.user._id) })).body.task;
    expect((await member.session.get('/staff/tasks/time/current')).body).toMatchObject({ timer: null, autoStopped: null });
    expect((await member.session.post('/staff/tasks/time/stop')).body).toMatchObject({ success: true, entry: null });

    const started = await member.session.post(`/staff/tasks/${a.id}/time/start`);
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ timer: { task: { id: a.id, code: a.code, title: 'Count pads' } }, stopped: null });
    const current = await member.session.get('/staff/tasks/time/current');
    expect(current.body.timer.id).toBe(started.body.timer.id);
    const switched = await member.session.post(`/staff/tasks/${b.id}/time/start`);
    expect(switched.body).toMatchObject({ timer: { task: { id: b.id } }, stopped: { id: started.body.timer.id, running: false } });
    expect((await member.session.post('/staff/tasks/time/stop')).body.entry).toMatchObject({ running: false, source: 'timer' });

    const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    const add = { minutes: 90, on: today, note: 'Called supplier', clientId: 'time-route-123' };
    const added = await member.session.post(`/staff/tasks/${a.id}/time`, add);
    expect(added.status).toBe(201);
    expect(added.body.entry).toMatchObject({ seconds: 5400, source: 'manual', note: 'Called supplier', can: { edit: true, delete: true } });
    const again = await member.session.post(`/staff/tasks/${a.id}/time`, add);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, entry: { id: added.body.entry.id } });

    expect((await member.session.post(`/staff/tasks/${a.id}/time`, { ...add, clientId: undefined, minutes: 0 })).status).toBe(400);
    expect((await member.session.post(`/staff/tasks/${a.id}/time`, { minutes: 30, on: '2999-01-01' })).status).toBe(400);
    expect((await member.session.get(`/staff/tasks/${a.id}/time?cursor=nope`)).status).toBe(400);
    expect((await head.session.patch(`/staff/tasks/${a.id}/time/${added.body.entry.id}`, { minutes: 5 })).status).toBe(403);
    const outsider = await makeUser('Sam', 'staff', { team: 'sales', isHead: true, active: true });
    expect((await outsider.session.post(`/staff/tasks/${a.id}/time/start`)).status).toBe(404);

    const fixed = await member.session.patch(`/staff/tasks/${a.id}/time/${added.body.entry.id}`, { minutes: 60 });
    expect(fixed.body.entry).toMatchObject({ seconds: 3600, edited: true });
    const list = await head.session.get(`/staff/tasks/${a.id}/time`);
    expect(list.status).toBe(200);
    expect(list.body.entries).toHaveLength(2);
    expect(list.body.total.people).toEqual([expect.objectContaining({ name: 'Arun' })]);
    expect((await member.session.get('/staff/tasks?view=mine')).body.tasks.find((t) => t.id === a.id).timeSeconds)
      .toBe(list.body.total.seconds);
    expect((await member.session.del(`/staff/tasks/${a.id}/time/${added.body.entry.id}`)).status).toBe(200);
    expect((await member.session.del(`/staff/tasks/${a.id}/time/${added.body.entry.id}`)).status).toBe(404);
    expect((await member.session.postNoCsrf(`/staff/tasks/${a.id}/time/start`)).status).toBe(403);
  });

  it('lists who you may give to', async () => {
    const res = await head.session.get('/staff/tasks/assignees');
    expect(res.status).toBe(200);
    expect(res.body.people.map((p) => p.name).sort()).toEqual(['Arun', 'Priya']);
  });

  it('needs a signed-in staff member, and a CSRF token to write', async () => {
    expect((await request(app).get(`${BASE}/staff/tasks`)).status).toBe(401);
    const customer = await makeUser('Cust', 'customer');
    expect((await customer.session.get('/staff/tasks')).status).toBe(403);
    expect((await head.session.postNoCsrf('/staff/tasks', { title: 'x' })).status).toBe(403);
    expect(await StaffTask.countDocuments({})).toBe(0);
  });
  it('folders and lists over HTTP: the head arranges, the member reads and files nothing; a list filters', async () => {
    const folder = await head.session.post('/staff/tasks/space/items', { kind: 'folder', name: 'Suppliers' });
    expect(folder.status).toBe(201);
    const list = await head.session.post('/staff/tasks/space/items', { kind: 'list', name: 'Bosch orders', folderId: folder.body.item.id, colour: 'red' });
    expect(list.status).toBe(201);
    expect((await member.session.post('/staff/tasks/space/items', { kind: 'list', name: 'x' })).status).toBe(403);
    expect((await head.session.post('/staff/tasks/space/items', { kind: 'list', name: 'Bosch orders', folderId: folder.body.item.id })).status).toBe(409);
    expect((await head.session.post('/staff/tasks/space/items', { kind: 'nope', name: 'x' })).status).toBe(400);

    const task = await head.session.post('/staff/tasks', { title: 'Call Bosch', assigneeId: String(member.user._id), listId: list.body.item.id });
    expect(task.status).toBe(201);
    expect(task.body.task.list).toBe(list.body.item.id);

    const space = await member.session.get('/staff/tasks/space');
    expect(space.status).toBe(200);
    expect(space.body.space.folders[0].lists[0]).toMatchObject({ name: 'Bosch orders', open: 1 });
    expect((await member.session.get('/staff/tasks/space?team=sales')).status).toBe(403);
    expect((await member.session.get(`/staff/tasks?view=team&list=${list.body.item.id}`)).body.tasks).toHaveLength(1);
    expect((await member.session.get('/staff/tasks?view=team&list=none')).body.tasks).toHaveLength(0);
    expect((await member.session.get('/staff/tasks?view=team&list=bogus')).status).toBe(400);

    const renamed = await head.session.patch(`/staff/tasks/space/items/${list.body.item.id}`, { rev: 1, name: 'Bosch' });
    expect(renamed.body.item.name).toBe('Bosch');
    expect((await head.session.patch(`/staff/tasks/space/items/${list.body.item.id}`, { name: 'no rev' })).status).toBe(400);
    const gone = await head.session.del(`/staff/tasks/space/items/${folder.body.item.id}`);
    expect(gone.body).toMatchObject({ tasksMoved: 1 });
    expect((await member.session.get('/staff/tasks?view=team&list=none')).body.tasks).toHaveLength(1);
  });

  it('projects: a head starts one, a member of another team reads its task over HTTP, an outsider gets 404', async () => {
    const dev = await makeUser('Dev', 'staff', { team: 'developer', isHead: false, active: true });
    const outsider = await makeUser('Sita', 'staff', { team: 'sales', isHead: false, active: true });
    expect((await member.session.post('/staff/tasks/projects', { name: 'Nope' })).status).toBe(403);
    const made = await head.session.post('/staff/tasks/projects', { name: 'Diwali launch', memberIds: [String(dev.user._id)], dueOn: '2030-10-25', clientId: 'route-proj-0001' });
    expect(made.status).toBe(201);
    const again = await head.session.post('/staff/tasks/projects', { name: 'Diwali launch', clientId: 'route-proj-0001' });
    expect(again.status).toBe(200);
    expect(again.body.project.id).toBe(made.body.project.id);
    const pid = made.body.project.id;

    const t = await head.session.post('/staff/tasks', { title: 'Order wiper sets', assigneeId: String(member.user._id), projectId: pid });
    expect(t.status).toBe(201);
    const tid = t.body.task.id;

    const list = await dev.session.get('/staff/tasks/projects');
    expect(list.body.projects).toEqual([expect.objectContaining({ id: pid, progress: expect.objectContaining({ total: 1, done: 0 }) })]);
    expect((await dev.session.get(`/staff/tasks?view=project&project=${pid}`)).body.tasks.map((x) => x.id)).toEqual([tid]);
    const seen = await dev.session.get(`/staff/tasks/${tid}`);
    expect(seen.status).toBe(200);
    expect(seen.body.task.can).toMatchObject({ comment: true, edit: false });
    expect((await dev.session.post(`/staff/tasks/${tid}/comments`, { text: 'Need the photo' })).status).toBe(201);
    expect((await dev.session.patch(`/staff/tasks/${tid}`, { rev: seen.body.task.rev, title: 'x' })).status).toBe(403);

    expect((await outsider.session.get('/staff/tasks/projects')).body.projects).toEqual([]);
    expect((await outsider.session.get(`/staff/tasks/projects/${pid}`)).status).toBe(404);
    expect((await outsider.session.get(`/staff/tasks?view=project&project=${pid}`)).status).toBe(404);
    expect((await outsider.session.get(`/staff/tasks/${tid}`)).status).toBe(404);
    expect((await outsider.session.get('/staff/tasks/projects/pick')).body.projects).toEqual([]);
    expect((await dev.session.get('/staff/tasks?view=project&project=nonsense')).status).toBe(400);
  });
});
