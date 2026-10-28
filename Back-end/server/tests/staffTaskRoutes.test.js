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
  beforeAll(async () => { await dbHandler.connect(); await StaffTask.init(); await StaffTaskComment.init(); });
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

  it('refuses what the rules refuse, with the right codes', async () => {
    expect((await member.session.post('/staff/tasks', { title: 'x', assigneeId: String(head.user._id) })).status).toBe(403);
    expect((await member.session.get('/staff/tasks?view=team')).status).toBe(403);
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
});
