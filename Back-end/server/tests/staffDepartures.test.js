/**
 * Resignations and handovers over HTTP. Push is a double; everything else is real.
 *
 * What must hold:
 *   - the reason reaches only admin and the person's head (admin only for a head)
 *   - the person leaving and the replacement see the record but never the reason
 *   - another team, and anyone unrelated, gets 404
 *   - recording this leaves access untouched
 *   - one open record per person, even when two arrive together
 *   - a stale edit is refused; a note is sanitised
 *   - once access is removed the record closes itself and the bell stops
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
const { countLastDaysForBell } = await import('../services/staffDepartureService.js');
const { todayIST } = await import('../services/staffTaskService.js');

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


describe('Departures', () => {
  beforeAll(async () => { await dbHandler.connect(); await StaffDeparture.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  let admin; let head; let leaver; let next; let peer; let outsider; let otherHead;
  beforeEach(async () => {
    pushed.length = 0;
    admin = await makeUser('Admin', 'admin');
    head = await makeUser('Head', 'staff', procurement({ isHead: true }));
    leaver = await makeUser('Leaver', 'staff', procurement());
    next = await makeUser('Next', 'staff', procurement());
    peer = await makeUser('Peer', 'staff', procurement());
    outsider = await makeUser('Outsider', 'staff', { team: 'sales', active: true });
    otherHead = await makeUser('OtherHead', 'staff', { team: 'sales', active: true, isHead: true });
  });

  const inDays = (n) => new Date(Date.parse(`${todayIST()}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const record = async (by = head, over = {}) => {
    const r = await by.s.post('', { userId: leaver.id, lastDay: inDays(20), reason: 'Moving city', successorId: next.id, ...over });
    expect(r.status).toBe(201);
    return r.body.departure;
  };

  test('the reason reaches only the head and admin', async () => {
    const d = await record();
    for (const who of [head, admin]) expect((await who.s.get(`/${d.id}`)).body.departure.reason).toBe('Moving city');
    for (const who of [leaver, next]) {
      const r = await who.s.get(`/${d.id}`);
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.body)).not.toContain('Moving city');
    }
    const mine = await next.s.get('/mine');
    expect(mine.body.departures[0].mine).toBe('taking_over');
    expect(JSON.stringify(mine.body)).not.toContain('Moving city');
  });

  test.each([['a teammate', () => peer], ['another team', () => outsider], ['another head', () => otherHead]])('%s gets 404', async (_n, who) => {
    const d = await record();
    expect((await who().s.get(`/${d.id}`)).status).toBe(404);
  });

  test('members cannot list or record', async () => {
    expect((await peer.s.get('')).status).toBe(403);
    expect((await peer.s.post('', { userId: leaver.id, lastDay: inDays(5) })).status).toBe(403);
  });

  test('a head cannot record for another team, for a head, or for themselves', async () => {
    expect((await otherHead.s.post('', { userId: leaver.id, lastDay: inDays(5) })).status).toBe(403);
    const second = await makeUser('SecondHead', 'staff', procurement({ isHead: true }));
    expect((await head.s.post('', { userId: second.id, lastDay: inDays(5) })).status).toBe(403);
    expect((await head.s.post('', { userId: head.id, lastDay: inDays(5) })).status).toBe(400);
  });

  test('a leaving head is visible to admin only, including the same-team head and the list', async () => {
    const d = (await admin.s.post('', { userId: head.id, lastDay: inDays(5), reason: 'Private' })).body.departure;
    const second = await makeUser('SecondHead', 'staff', procurement({ isHead: true }));
    expect((await second.s.get(`/${d.id}`)).status).toBe(404);
    expect((await second.s.get('')).body.departures).toHaveLength(0);
    expect(JSON.stringify((await head.s.get(`/${d.id}`)).body)).not.toContain('Private');
  });

  test('recording leaves access alone', async () => {
    await record();
    const u = await User.findById(leaver.id).lean();
    expect(u.role).toBe('staff');
    expect(u.staff.active).toBe(true);
    expect((await leaver.s.get('/mine')).status).toBe(200);
  });

  test('only one open record, even when two arrive together', async () => {
    const body = { userId: leaver.id, lastDay: inDays(9) };
    const res = await Promise.all([head.s.post('', body), admin.s.post('', body)]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await StaffDeparture.countDocuments({ user: leaver.id })).toBe(1);
  });

  test.each([['not a date', 'soon'], ['impossible', '2026-02-31'], ['far past', '2020-01-01'], ['far future', '2099-01-01']])('rejects a last day that is %s', async (_n, lastDay) => {
    expect((await head.s.post('', { userId: leaver.id, lastDay })).status).toBe(400);
  });

  test('the replacement must be someone else, active, and in the team for a head', async () => {
    expect((await head.s.post('', { userId: leaver.id, lastDay: inDays(5), successorId: leaver.id })).status).toBe(400);
    expect((await head.s.post('', { userId: leaver.id, lastDay: inDays(5), successorId: outsider.id })).status).toBe(403);
    expect((await admin.s.post('', { userId: leaver.id, lastDay: inDays(5), successorId: outsider.id })).status).toBe(201);
  });

  test('a replacement can be named later and is told', async () => {
    const d = await record(head, { successorId: '' });
    expect(d.successor).toBeNull();
    expect(pushed).toHaveLength(0);
    const r = await head.s.patch(`/${d.id}`, { rev: d.rev, successorId: next.id });
    expect(r.body.departure.successor.id).toBe(next.id);
    expect(pushed).toHaveLength(1);
  });

  test('the leaver writes the note; the replacement cannot; script is stripped', async () => {
    const d = await record();
    const r = await leaver.s.patch(`/${d.id}`, { rev: d.rev, note: '<p>Call Ravi</p><script>x()</script>' });
    expect(r.status).toBe(200);
    expect(r.body.departure.note).toContain('Call Ravi');
    expect(r.body.departure.note).not.toContain('script');
    expect((await next.s.get(`/${d.id}`)).body.departure.note).toContain('Call Ravi');
    expect((await next.s.patch(`/${d.id}`, { rev: r.body.departure.rev, note: 'x' })).status).toBe(403);
    expect((await leaver.s.patch(`/${d.id}`, { rev: r.body.departure.rev, lastDay: inDays(1) })).status).toBe(403);
  });

  test('a stale edit is refused', async () => {
    const d = await record();
    expect((await head.s.patch(`/${d.id}`, { rev: d.rev, reason: 'One' })).status).toBe(200);
    expect((await admin.s.patch(`/${d.id}`, { rev: d.rev, reason: 'Two' })).status).toBe(409);
  });

  test('cancelled: can be recorded again, and cannot be cancelled twice', async () => {
    const d = await record();
    expect((await head.s.post(`/${d.id}/cancel`)).status).toBe(200);
    expect((await head.s.post(`/${d.id}/cancel`)).status).toBe(409);
    await record();
  });

  describe('bell and closing', () => {
    test('only within 3 days, and only for the right people', async () => {
      await record(head, { lastDay: inDays(4) });
      expect(await countLastDaysForBell(head.user)).toBe(0);
      await StaffDeparture.updateOne({ user: leaver.id }, { lastDay: inDays(3) });
      expect(await countLastDaysForBell(head.user)).toBe(1);
      expect(await countLastDaysForBell(admin.user)).toBe(1);
      expect(await countLastDaysForBell(otherHead.user)).toBe(0);
      expect(await countLastDaysForBell(peer.user)).toBe(0);
    });

    test('a past last day keeps reminding until access is removed, then closes', async () => {
      const d = await record(head, { lastDay: inDays(-2) });
      expect(await countLastDaysForBell(head.user)).toBe(1);
      await User.updateOne({ _id: leaver.id }, { role: 'customer', 'staff.active': false });
      expect(await countLastDaysForBell(head.user)).toBe(0);
      expect((await StaffDeparture.findById(d.id).lean()).status).toBe('left');
      const r = await head.s.get(`/${d.id}`);
      expect(r.body.departure.status).toBe('left');
      expect(r.body.departure.can).toEqual({ manage: false, writeNote: false });
    });

    test('the list shows someone who has lost access as left', async () => {
      await record();
      await User.updateOne({ _id: leaver.id }, { role: 'customer', 'staff.active': false });
      expect((await head.s.get('')).body.departures[0].status).toBe('left');
    });
  });

  test('pages with a cursor', async () => {
    const people = [];
    for (let i = 0; i < 26; i += 1) people.push({ user: leaver.user._id, userName: `P${i}`, team: 'procurement', lastDay: inDays(20), status: 'cancelled', wasHead: false, createdBy: admin.user._id });
    await StaffDeparture.collection.insertMany(people);
    const first = await head.s.get('');
    expect(first.body.departures).toHaveLength(24);
    const second = await head.s.get(`?cursor=${first.body.nextCursor}`);
    expect(second.body.departures).toHaveLength(2);
    expect(second.body.nextCursor).toBeNull();
  });

  test('a bad cursor is a 400', async () => {
    expect((await head.s.get('?cursor=nope')).status).toBe(400);
  });
});
