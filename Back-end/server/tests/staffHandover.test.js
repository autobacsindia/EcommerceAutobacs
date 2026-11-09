/**
 * Start handover over HTTP, against the real Tasks and leads code. Push is a double.
 *
 * What must hold:
 *   - nothing moves until a manager presses Start; only managers can see or press it
 *   - open work moves; personal tasks, finished work and orders stay
 *   - others on a shared task stay on it
 *   - a moved quotation carries the new seller, so the new person gets the credit
 *   - pressing twice, or together, moves each thing once; the log has one line each
 *   - one failure doesn't stop the rest, and pressing again finishes the job
 *   - no replacement named: goes to the head; nobody at all: refused, nothing moved
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));
const pushed = [];
const pushMock = {
  pushConfigured: () => false, publicKey: () => null, cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}), sendToUsers: async (who, msg) => { pushed.push({ who, msg }); return 0; }, sendTest: async () => ({ sent: 0 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: StaffDeparture } = await import('../models/StaffDeparture.js');
const { default: StaffHandoverMove } = await import('../models/StaffHandoverMove.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffLesson } = await import('../models/StaffLesson.js');
const { default: SalesRep } = await import('../models/SalesRep.js');
const { default: Lead } = await import('../models/Lead.js');
const { default: SalesQuotation } = await import('../models/SalesQuotation.js');
const tasks = await import('../services/staffTaskService.js');

const BASE = '/api/v1/staff/departures';
const PW = 'SecurePass123!';
const csrfFrom = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='))?.split(';')[0].split('=')[1] ?? '';
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  const c = (r) => r.set('X-XSRF-TOKEN', csrf);
  return {
    get: (u) => agent.get(`${BASE}${u}`),
    post: (u, b = {}) => c(agent.post(`${BASE}${u}`)).send(b),
    patch: (u, b = {}) => c(agent.patch(`${BASE}${u}`)).send(b),
    del: (u) => c(agent.delete(`${BASE}${u}`)),
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, s: await signIn(email), id: String(user._id) };
};
const procurement = (x = {}) => ({ team: 'procurement', active: true, ...x });



describe('Start handover', () => {
  beforeAll(async () => { await dbHandler.connect(); await StaffDeparture.init(); await StaffHandoverMove.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  const sales = (x = {}) => ({ team: 'sales', active: true, gtmRole: 'lead', ...x });
  const req = { headers: {}, get: () => '', ip: '127.0.0.1', user: {} };
  let admin; let head; let leaver; let next; let peer; let rep; let q; let openLead; let closedLead;
  const lastDay = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);

  const quote = (user, status, number) => ({
    number, status, salesUser: user, customer: { name: 'Ravi', phone: '9876543210' }, shippingAddress: {}, items: [], subtotal: 100, totalAmount: 100,
  });
  const leadRow = (status, key) => ({ _id: new mongoose.Types.ObjectId(), name: `Lead ${key}`, identityKey: key, status, assignedRep: rep._id, primarySource: 'contact', sources: [], activities: [] });

  beforeEach(async () => {
    pushed.length = 0;
    admin = await makeUser('Admin', 'admin');
    head = await makeUser('Head', 'staff', sales({ isHead: true }));
    leaver = await makeUser('Leaver', 'staff', sales());
    next = await makeUser('Next', 'staff', sales());
    peer = await makeUser('Peer', 'staff', sales());
    rep = await SalesRep.create({ name: 'Leaver', user: leaver.user._id });
    openLead = leadRow('contacted', 'a'); closedLead = leadRow('won', 'b');
    await Lead.collection.insertMany([openLead, closedLead]);
    const r = await SalesQuotation.collection.insertMany([quote(leaver.user._id, 'open', 'Q-1'), quote(leaver.user._id, 'accepted', 'Q-2')]);
    q = { open: r.insertedIds[0], accepted: r.insertedIds[1] };
  });

  const give = (who, over = {}) => tasks.createTask(admin.user, { title: 'Call the supplier', assigneeIds: who, ...over }, req).then((r) => r.task ?? r);
  const record = async (over = {}) => {
    const r = await admin.s.post('', { userId: leaver.id, lastDay, successorId: next.id, ...over });
    expect(r.status).toBe(201);
    return r.body.departure;
  };
  const taskPeople = async (id) => (await StaffTask.findById(id).lean()).assignees.map((a) => String(a.user));

  test('shows the work and moves nothing until Start', async () => {
    const t = await give([leaver.id]);
    const d = await record();
    const r = await admin.s.get(`/${d.id}/work`);
    expect(r.body.work.tasks).toHaveLength(1);
    expect(r.body.work.leads).toHaveLength(1);
    expect(r.body.work.quotations).toHaveLength(1);
    expect(r.body.goesTo.id).toBe(next.id);
    expect(await taskPeople(t.id)).toEqual([leaver.id]);
  });

  test.each([['the team head', () => head, 403], ['the person leaving', () => leaver, 403], ['the replacement', () => next, 403], ['a teammate', () => peer, 404]])('%s cannot see or start it', async (_n, who, code) => {
    const d = await record();
    expect((await who().s.get(`/${d.id}/work`)).status).toBe(code);
    expect((await who().s.post(`/${d.id}/handover`)).status).toBe(code);
    expect((await SalesQuotation.findById(q.open).lean()).salesUser.toString()).toBe(leaver.id);
  });

  test('open work moves and finished work stays', async () => {
    const t = await give([leaver.id]);
    const d = await record();
    const r = await admin.s.post(`/${d.id}/handover`);
    expect(r.status).toBe(200);
    expect(r.body.result).toEqual({ moved: 3, failed: 0 });
    expect(await taskPeople(t.id)).toEqual([next.id]);
    const nextRep = await SalesRep.findOne({ user: next.user._id }).lean();
    expect(String((await Lead.findById(openLead._id).lean()).assignedRep)).toBe(String(nextRep._id));
    expect(String((await Lead.findById(closedLead._id).lean()).assignedRep)).toBe(String(rep._id));
    expect(String((await SalesQuotation.findById(q.open).lean()).salesUser)).toBe(next.id);
    expect(String((await SalesQuotation.findById(q.open).lean()).salesRep)).toBe(String(nextRep._id));
    expect(String((await SalesQuotation.findById(q.accepted).lean()).salesUser)).toBe(leaver.id);
  });

  test('the log keeps who started it', async () => {
    await record().then((d) => admin.s.post(`/${d.id}/handover`));
    const line = await StaffHandoverMove.findOne({ kind: 'quotation' }).lean();
    expect(line).toMatchObject({ fromName: 'Leaver', toName: 'Next', byName: 'Admin', state: 'moved' });
  });

  test('a personal task stays and a shared task keeps the others', async () => {
    const mine = await tasks.createTask(leaver.user, { title: 'Dentist', personal: true }, req).then((r) => r.task ?? r);
    const shared = await give([leaver.id, peer.id], { shared: true });
    const d = await record();
    await admin.s.post(`/${d.id}/handover`);
    expect(await taskPeople(shared.id)).toEqual(expect.arrayContaining([peer.id, next.id]));
    expect(await taskPeople(shared.id)).not.toContain(leaver.id);
    const kept = await StaffTask.findById(mine.id).lean();
    expect(String(kept.assignee)).toBe(leaver.id);
  });

  test('lessons go to the team head', async () => {
    const lesson = await StaffLesson.create({ title: 'How we quote', audience: 'sales', owner: leaver.user._id, createdBy: leaver.user._id, lastCheckedAt: new Date() });
    const d = await record();
    await admin.s.post(`/${d.id}/handover`);
    expect(String((await StaffLesson.findById(lesson._id).lean()).owner)).toBe(head.id);
  });

  test('pressing twice moves each thing once', async () => {
    await give([leaver.id]);
    const d = await record();
    await admin.s.post(`/${d.id}/handover`);
    const again = await admin.s.post(`/${d.id}/handover`);
    expect(again.body.result).toEqual({ moved: 0, failed: 0 });
    expect(await StaffHandoverMove.countDocuments({ departure: d.id })).toBe(3);
  });

  test('pressing together: one runs, the other is refused, and the work moves once', async () => {
    await give([leaver.id]);
    const d = await record();
    const res = await Promise.all([admin.s.post(`/${d.id}/handover`), admin.s.post(`/${d.id}/handover`)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await StaffHandoverMove.countDocuments({ departure: d.id, state: 'moved' })).toBe(3);
  });

  test('a failure leaves the rest moved, is listed, and pressing again finishes', async () => {
    const t = await give([leaver.id]);
    const nonSeller = await makeUser('Buyer', 'staff', { team: 'procurement', active: true });
    const d = (await admin.s.post('', { userId: leaver.id, lastDay, successorId: nonSeller.id })).body.departure;
    const first = await admin.s.post(`/${d.id}/handover`);
    expect(first.body.result).toEqual({ moved: 1, failed: 2 });
    expect(await taskPeople(t.id)).toEqual([nonSeller.id]);
    expect(first.body.moves.filter((m) => m.state === 'failed')[0].error).toContain('not a GTM seller');
    expect(String((await SalesQuotation.findById(q.open).lean()).salesUser)).toBe(leaver.id);
    const fresh = (await admin.s.get(`/${d.id}`)).body.departure;
    await admin.s.patch(`/${d.id}`, { rev: fresh.rev, successorId: next.id });
    const second = await admin.s.post(`/${d.id}/handover`);
    expect(second.body.result).toEqual({ moved: 2, failed: 0 });
    expect(await StaffHandoverMove.countDocuments({ departure: d.id, state: 'failed' })).toBe(0);
  });

  test('no replacement named: goes to the head', async () => {
    const d = await record({ successorId: '' });
    await admin.s.post(`/${d.id}/handover`);
    expect(String((await SalesQuotation.findById(q.open).lean()).salesUser)).toBe(head.id);
  });

  test('nobody to give it to: refused and nothing moves', async () => {
    const d = await record({ successorId: '' });
    await User.updateOne({ _id: head.user._id }, { 'staff.isHead': false });
    const r = await admin.s.post(`/${d.id}/handover`);
    expect(r.status).toBe(400);
    expect(String((await SalesQuotation.findById(q.open).lean()).salesUser)).toBe(leaver.id);
  });

  test('still works after access was removed; a cancelled record does not', async () => {
    const d = await record();
    await User.updateOne({ _id: leaver.user._id }, { role: 'customer', 'staff.active': false });
    await admin.s.get(`/${d.id}`);
    expect((await admin.s.post(`/${d.id}/handover`)).status).toBe(200);
    expect(String((await SalesQuotation.findById(q.open).lean()).salesUser)).toBe(next.id);
    await User.updateOne({ _id: leaver.user._id }, { role: 'staff', 'staff.active': true });
    const e = await record();
    await admin.s.post(`/${e.id}/cancel`);
    expect((await admin.s.post(`/${e.id}/handover`)).status).toBe(409);
  });
});
