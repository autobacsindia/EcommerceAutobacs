/**
 * Notes on past team members over HTTP.
 *
 * What must hold:
 *   - everyone who may open the profile reads the notes, newest first
 *   - only the member's team head and admins write; members and other heads cannot
 *   - only the author edits; the author or any admin deletes
 *   - a stale edit is refused (409), nothing overwritten
 *   - empty, too long, or script-laden notes are refused or cleaned
 *   - another team gets 404, so notes never leak across teams
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
const pushMock = {
  pushConfigured: () => false, publicKey: () => null, cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}), sendToUsers: async () => 0, sendTest: async () => ({ sent: 0 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: userRepository } = await import('../repositories/userRepository.js');
const { default: StaffPastMemberNote } = await import('../models/StaffPastMemberNote.js');

const BASE = '/api/v1/staff/past-members';
const PW = 'SecurePass123!';
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='))?.split(';')[0].split('=')[1] ?? '';
  const c = (r) => r.set('X-XSRF-TOKEN', csrf);
  return {
    get: (u) => agent.get(`${BASE}${u}`),
    post: (u, b = {}) => c(agent.post(`${BASE}${u}`)).send(b),
    patch: (u, b = {}) => c(agent.patch(`${BASE}${u}`)).send(b),
    del: (u) => c(agent.delete(`${BASE}${u}`)),
  };
}
let n = 0;
const makeUser = async (name, role, staff, { login = true } = {}) => {
  n += 1;
  const email = `${name.toLowerCase().replace(/\s/g, '')}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, s: login ? await signIn(email) : null, id: String(user._id) };
};
const team = (t, x = {}) => ({ team: t, active: true, ...x });

describe('Notes on past team members', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  let admin; let admin2; let head; let member; let otherHead; let leaver; let path;
  beforeEach(async () => {
    admin = await makeUser('Admin', 'admin');
    admin2 = await makeUser('Second Admin', 'admin');
    head = await makeUser('Head', 'staff', team('sales', { isHead: true }));
    member = await makeUser('Member', 'staff', team('sales'));
    otherHead = await makeUser('Other', 'staff', team('procurement', { isHead: true }));
    leaver = await makeUser('Nevin', 'staff', team('sales'), { login: false });
    await userRepository.revokeStaff(leaver.user._id, admin.user._id);
    path = `/${leaver.id}/notes`;
  });

  const add = async (who, body = '<p>Ravi Motors trusted Nevin. Call them first.</p>') => {
    const r = await who.s.post(path, { body });
    expect(r.status).toBe(201);
    return r.body.note;
  };

  test('the team head writes; the whole team reads, with author and date', async () => {
    const n = await add(head);
    expect(n).toMatchObject({ authorName: 'Head', can: { edit: true, delete: true } });
    const r = await member.s.get(path);
    expect(r.status).toBe(200);
    expect(r.body.canWrite).toBe(false);
    expect(r.body.notes).toEqual([expect.objectContaining({ id: n.id, body: '<p>Ravi Motors trusted Nevin. Call them first.</p>', authorName: 'Head', can: { edit: false, delete: false } })]);
    expect(r.body.notes[0].createdAt).toBeTruthy();
    expect((await head.s.get(path)).body.canWrite).toBe(true);
  });

  test('members cannot write; another team cannot even see', async () => {
    expect((await member.s.post(path, { body: 'hi' })).status).toBe(403);
    expect((await otherHead.s.post(path, { body: 'hi' })).status).toBe(404);
    await add(head);
    expect((await otherHead.s.get(path)).status).toBe(404);
    expect(await StaffPastMemberNote.countDocuments()).toBe(1);
  });

  test('no notes on current staff or unknown people', async () => {
    expect((await head.s.post(`/${member.id}/notes`, { body: 'hi' })).status).toBe(404);
    expect((await admin.s.get(`/${new mongoose.Types.ObjectId()}/notes`)).status).toBe(404);
  });

  test('only the author edits; a stale edit is refused', async () => {
    const n = await add(head);
    expect((await admin.s.patch(`${path}/${n.id}`, { body: 'x', rev: n.rev })).status).toBe(403);
    const ok = await head.s.patch(`${path}/${n.id}`, { body: '<p>Updated</p>', rev: n.rev });
    expect(ok.status).toBe(200);
    expect(ok.body.note).toMatchObject({ body: '<p>Updated</p>', rev: n.rev + 1 });
    expect(ok.body.note.editedAt).toBeTruthy();
    const stale = await head.s.patch(`${path}/${n.id}`, { body: '<p>Lost?</p>', rev: n.rev });
    expect(stale.status).toBe(409);
    expect((await StaffPastMemberNote.findById(n.id).lean()).body).toBe('<p>Updated</p>');
  });

  test('the author or any admin deletes; nobody else', async () => {
    const a = await add(head);
    const b = await add(head);
    const c = await add(admin);
    expect((await member.s.del(`${path}/${a.id}`)).status).toBe(403);
    expect((await head.s.del(`${path}/${c.id}`)).status).toBe(403);
    expect((await head.s.del(`${path}/${a.id}`)).status).toBe(200);
    expect((await admin2.s.del(`${path}/${b.id}`)).status).toBe(200);
    expect((await admin2.s.del(`${path}/${b.id}`)).status).toBe(404);
    expect((await member.s.get(path)).body.notes.map((n) => n.id)).toEqual([c.id]);
  });

  test('a head who loses the role can no longer change their notes', async () => {
    const n = await add(head);
    await User.updateOne({ _id: head.user._id }, { $set: { 'staff.isHead': false } });
    expect((await head.s.patch(`${path}/${n.id}`, { body: 'x', rev: n.rev })).status).toBe(403);
    expect((await head.s.get(path)).body.notes[0].can).toEqual({ edit: false, delete: false });
  });

  test('a note id from another person is not found', async () => {
    const other = await makeUser('Gone Two', 'staff', team('sales'), { login: false });
    await userRepository.revokeStaff(other.user._id, admin.user._id);
    const n = await add(head);
    expect((await head.s.patch(`/${other.id}/notes/${n.id}`, { body: 'x', rev: 0 })).status).toBe(404);
    expect((await head.s.del(`/${other.id}/notes/${n.id}`)).status).toBe(404);
  });

  test('empty, too long and unsafe notes', async () => {
    expect((await head.s.post(path, { body: '<p>   </p>' })).status).toBe(400);
    expect((await head.s.post(path, {})).status).toBe(400);
    expect((await head.s.post(path, { body: 'x'.repeat(5001) })).status).toBe(400);
    const n = await add(head, '<p>Safe</p><script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(n.body).not.toMatch(/script|onerror/);
    expect(n.body).toContain('Safe');
  });

  test('notes page newest first with no repeats', async () => {
    const ids = [];
    for (let i = 0; i < 25; i += 1) ids.push((await add(head, `<p>Note ${i}</p>`)).id);
    const first = await member.s.get(path);
    expect(first.body.notes).toHaveLength(20);
    const second = await member.s.get(`${path}?cursor=${first.body.nextCursor}`);
    expect(second.body.nextCursor).toBeNull();
    expect([...first.body.notes, ...second.body.notes].map((n) => n.id)).toEqual(ids.reverse());
    expect((await member.s.get(`${path}?cursor=bad`)).status).toBe(400);
  });
});
