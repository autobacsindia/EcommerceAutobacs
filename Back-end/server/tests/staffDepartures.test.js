/**
 * Resignations and handovers over HTTP. Push is a double; everything else is real.
 *
 * What must hold:
 *   - only HR or an admin records, edits or cancels (never their own); a head is refused and can only read
 *   - the reason reaches only admin and the person's head (admin only for a head)
 *   - the person leaving, the replacement and the rest of the team see the record,
 *     the note and the responsibilities, but never the reason
 *   - teammates never see a cancelled record; another team gets 404
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
const { default: AuditLog } = await import('../models/AuditLog.js');
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
  const record = async (by = admin, over = {}) => {
    const r = await by.s.post('', { resignedOn: inDays(0), userId: leaver.id, lastDay: inDays(20), reason: 'Moving city', successorId: next.id, ...over });
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

  test.each([['another team', () => outsider], ['another head', () => otherHead]])('%s gets 404', async (_n, who) => {
    const d = await record();
    expect((await who().s.get(`/${d.id}`)).status).toBe(404);
    expect((await who().s.get('')).body.departures).toHaveLength(0);
  });

  test('a teammate sees the record, note and responsibilities, never the reason, and changes nothing', async () => {
    const d = await record();
    const w = await leaver.s.patch(`/${d.id}`, { rev: d.rev, note: '<p>Call Ravi</p>', responsibilities: '<p>Supplier payments every Friday</p>' });
    expect(w.status).toBe(200);
    const r = await peer.s.get(`/${d.id}`);
    expect(r.status).toBe(200);
    expect(r.body.departure).toMatchObject({ note: '<p>Call Ravi</p>', responsibilities: '<p>Supplier payments every Friday</p>', successor: { id: next.id } });
    expect(r.body.departure.can).toEqual({ manage: false, writeNote: false, handover: false });
    expect(JSON.stringify(r.body)).not.toContain('Moving city');
    const list = await peer.s.get('');
    expect(list.status).toBe(200);
    expect(list.body.canRecord).toBe(false);
    expect(list.body.departures.map((x) => x.id)).toEqual([d.id]);
    expect(JSON.stringify(list.body)).not.toContain('Moving city');
    const rev = w.body.departure.rev;
    expect((await peer.s.patch(`/${d.id}`, { rev, responsibilities: 'x' })).status).toBe(403);
    expect((await peer.s.patch(`/${d.id}`, { rev, note: 'x' })).status).toBe(403);
    expect((await peer.s.patch(`/${d.id}`, { rev, lastDay: inDays(1) })).status).toBe(403);
    expect((await peer.s.post(`/${d.id}/cancel`)).status).toBe(403);
    expect((await peer.s.post('', { resignedOn: inDays(0), userId: leaver.id, lastDay: inDays(5) })).status).toBe(403);
    expect((await StaffDeparture.findById(d.id).lean()).rev).toBe(rev);
  });

  test('teammates lose sight of a cancelled record; admin keeps it', async () => {
    const d = await record();
    expect((await admin.s.post(`/${d.id}/cancel`)).status).toBe(200);
    expect((await peer.s.get(`/${d.id}`)).status).toBe(404);
    expect((await peer.s.get('')).body.departures).toHaveLength(0);
    expect((await head.s.get(`/${d.id}`)).status).toBe(200);
    expect((await admin.s.get('')).body.departures).toHaveLength(1);
  });

  test('responsibilities are sanitised and bounded', async () => {
    const d = await record();
    const r = await leaver.s.patch(`/${d.id}`, { rev: d.rev, responsibilities: '<p>Stock count</p><script>x()</script>' });
    expect(r.body.departure.responsibilities).toContain('Stock count');
    expect(r.body.departure.responsibilities).not.toContain('script');
    expect((await leaver.s.patch(`/${d.id}`, { rev: r.body.departure.rev, responsibilities: `<p>${'a'.repeat(20001)}</p>` })).status).toBe(400);
  });

  test('the list holds only my team\'s records and no notes', async () => {
    await record();
    await admin.s.post('', { resignedOn: inDays(0), userId: outsider.id, lastDay: inDays(5) });
    const list = await peer.s.get('');
    expect(list.body.departures.map((x) => x.user.id)).toEqual([leaver.id]);
    expect(list.body.departures[0].note).toBeUndefined();
    expect(list.body.departures[0].responsibilities).toBeUndefined();
  });

  test('a team head can read their team but is refused every change, even by direct call', async () => {
    const refused = await head.s.post('', { resignedOn: inDays(0), userId: leaver.id, lastDay: inDays(5) });
    expect(refused.status).toBe(403);
    expect(await StaffDeparture.countDocuments({})).toBe(0);
    const d = await record();
    const seen = await head.s.get(`/${d.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.departure.can).toEqual({ manage: false, writeNote: false, handover: false });
    const list = await head.s.get('');
    expect(list.body.departures).toHaveLength(1);
    expect(list.body.canRecord).toBe(false);
    expect((await head.s.patch(`/${d.id}`, { rev: d.rev, lastDay: inDays(1) })).status).toBe(403);
    expect((await head.s.patch(`/${d.id}`, { rev: d.rev, note: 'x' })).status).toBe(403);
    expect((await head.s.post(`/${d.id}/cancel`)).status).toBe(403);
    expect((await StaffDeparture.findById(d.id).lean()).rev).toBe(d.rev);
  });

  test('an admin records, edits and cancels', async () => {
    const d = await record();
    const e = await admin.s.patch(`/${d.id}`, { rev: d.rev, lastDay: inDays(2) });
    expect(e.status).toBe(200);
    expect((await admin.s.post(`/${d.id}/cancel`)).status).toBe(200);
    expect((await admin.s.get('')).body.canRecord).toBe(true);
  });

  test('a leaving head: the team sees the handover, only admin sees the reason', async () => {
    const d = (await admin.s.post('', { resignedOn: inDays(0), userId: head.id, lastDay: inDays(5), reason: 'Private' })).body.departure;
    const second = await makeUser('SecondHead', 'staff', procurement({ isHead: true }));
    for (const who of [second, peer]) {
      const r = await who.s.get(`/${d.id}`);
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.body)).not.toContain('Private');
      expect((await who.s.get('')).body.departures).toHaveLength(1);
    }
    expect(JSON.stringify((await head.s.get(`/${d.id}`)).body)).not.toContain('Private');
    expect((await admin.s.get(`/${d.id}`)).body.departure.reason).toBe('Private');
  });

  test('recording leaves access alone', async () => {
    await record();
    const u = await User.findById(leaver.id).lean();
    expect(u.role).toBe('staff');
    expect(u.staff.active).toBe(true);
    expect((await leaver.s.get('/mine')).status).toBe(200);
  });

  test('only one open record, even when two arrive together', async () => {
    const body = { resignedOn: inDays(0), userId: leaver.id, lastDay: inDays(9) };
    const res = await Promise.all([admin.s.post('', body), admin.s.post('', body)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(res[0].body.departure.id).toBe(res[1].body.departure.id);
    expect(await StaffDeparture.countDocuments({ user: leaver.id })).toBe(1);
  });

  test.each([['not a date', 'soon'], ['impossible', '2026-02-31'], ['far past', '2020-01-01'], ['far future', '2099-01-01']])('rejects a last day that is %s', async (_n, lastDay) => {
    expect((await admin.s.post('', { resignedOn: inDays(0), userId: leaver.id, lastDay })).status).toBe(400);
  });

  test('the replacement must be someone else and active', async () => {
    expect((await admin.s.post('', { resignedOn: inDays(0), userId: leaver.id, lastDay: inDays(5), successorId: leaver.id })).status).toBe(400);
    expect((await admin.s.post('', { resignedOn: inDays(0), userId: leaver.id, lastDay: inDays(5), successorId: outsider.id })).status).toBe(201);
  });

  test('a replacement can be named later and is told', async () => {
    const d = await record(admin, { successorId: '' });
    expect(d.successor).toBeNull();
    expect(pushed).toHaveLength(0);
    const r = await admin.s.patch(`/${d.id}`, { rev: d.rev, successorId: next.id });
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
    expect((await admin.s.patch(`/${d.id}`, { rev: d.rev, reason: 'One' })).status).toBe(200);
    expect((await admin.s.patch(`/${d.id}`, { rev: d.rev, reason: 'Two' })).status).toBe(409);
  });

  test('cancelled: can be recorded again, and cannot be cancelled twice', async () => {
    const d = await record();
    expect((await admin.s.post(`/${d.id}/cancel`)).status).toBe(200);
    expect((await admin.s.post(`/${d.id}/cancel`)).status).toBe(409);
    await record();
  });

  describe('bell and closing', () => {
    test('only within 3 days, and only for the right people', async () => {
      await record(admin, { lastDay: inDays(4) });
      expect(await countLastDaysForBell(head.user)).toBe(0);
      await StaffDeparture.updateOne({ user: leaver.id }, { lastDay: inDays(3) });
      expect(await countLastDaysForBell(head.user)).toBe(1);
      expect(await countLastDaysForBell(admin.user)).toBe(1);
      expect(await countLastDaysForBell(otherHead.user)).toBe(0);
      expect(await countLastDaysForBell(peer.user)).toBe(0);
    });

    test('a past last day keeps reminding until access is removed, then closes', async () => {
      const d = await record(admin, { resignedOn: inDays(-5), lastDay: inDays(-2) });
      expect(await countLastDaysForBell(head.user)).toBe(1);
      await User.updateOne({ _id: leaver.id }, { role: 'customer', 'staff.active': false });
      expect(await countLastDaysForBell(head.user)).toBe(0);
      expect((await StaffDeparture.findById(d.id).lean()).status).toBe('left');
      const r = await admin.s.get(`/${d.id}`);
      expect(r.body.departure.status).toBe('left');
      expect(r.body.departure.can).toEqual({ manage: false, writeNote: false, handover: true });
    });

    test('the list shows someone who has lost access as left', async () => {
      await record();
      await User.updateOne({ _id: leaver.id }, { role: 'customer', 'staff.active': false });
      expect((await admin.s.get('')).body.departures[0].status).toBe('left');
    });
  });

  test('pages with a cursor', async () => {
    const people = [];
    for (let i = 0; i < 26; i += 1) people.push({ user: leaver.user._id, userName: `P${i}`, team: 'procurement', lastDay: inDays(20), status: 'cancelled', wasHead: false, createdBy: admin.user._id });
    await StaffDeparture.collection.insertMany(people);
    const first = await admin.s.get('');
    expect(first.body.departures).toHaveLength(24);
    const second = await admin.s.get(`?cursor=${first.body.nextCursor}`);
    expect(second.body.departures).toHaveLength(2);
    expect(second.body.nextCursor).toBeNull();
  });

  test('a bad cursor is a 400', async () => {
    expect((await admin.s.get('?cursor=nope')).status).toBe(400);
  });

  describe('HR records resignations', () => {
    let hr; let hrHead;
    beforeEach(async () => {
      hr = await makeUser('Hema', 'staff', { team: 'hr', active: true });
      hrHead = await makeUser('HrHead', 'staff', { team: 'hr', active: true, isHead: true });
    });
    // The audit write is fire-and-forget, so wait a moment for it.
    const logged = async (q) => {
      for (let i = 0; i < 40; i += 1) {
        const row = await AuditLog.findOne(q).lean();
        if (row) return row;
        await new Promise((ok) => { setTimeout(ok, 25); });
      }
      return null;
    };
    const valid = (over = {}) => ({ userId: leaver.id, resignedOn: inDays(-3), lastDay: inDays(27), reason: 'Higher studies', successorId: next.id, ...over });

    test('HR records it: dates and reason are kept, the team sees it, and the log says who', async () => {
      const r = await hr.s.post('', valid());
      expect(r.status).toBe(201);
      const d = r.body.departure;
      expect(d).toMatchObject({ resignedOn: inDays(-3), lastDay: inDays(27), reason: 'Higher studies', createdByName: 'Hema', can: { manage: true, handover: true } });
      const seen = (await peer.s.get(`/${d.id}`)).body.departure;
      expect(seen.resignedOn).toBe(inDays(-3));
      expect(seen.reason).toBeUndefined();
      expect(pushed).toHaveLength(1);
      const log = await logged({ resource: 'StaffDeparture', resourceId: d.id, action: 'CREATE' });
      expect(String(log.user)).toBe(hr.id);
      expect(log.createdAt).toBeInstanceOf(Date);
      expect(JSON.stringify(log.details)).not.toContain('Higher studies');
    });

    test('HR sees every team and the people to choose from; others cannot', async () => {
      await hr.s.post('', valid());
      await hr.s.post('', valid({ userId: outsider.id, successorId: '' }));
      const list = await hr.s.get('');
      expect(list.body.canRecord).toBe(true);
      expect(list.body.departures).toHaveLength(2);
      const people = (await hr.s.get('/people')).body.people;
      expect(people.map((p) => p.id)).toEqual(expect.arrayContaining([leaver.id, outsider.id, hrHead.id]));
      expect(people.map((p) => p.id)).not.toContain(hr.id);
      expect(people.map((p) => p.id)).not.toContain(admin.id);
      for (const who of [head, peer, leaver]) {
        expect((await who.s.get('/people')).status).toBe(403);
        expect((await who.s.get('')).body.canRecord).toBe(false);
      }
    });

    test('roles: a head, a teammate, another team or the person leaving cannot record; nobody records their own', async () => {
      for (const who of [head, peer, outsider, otherHead, leaver]) expect((await who.s.post('', valid())).status).toBe(403);
      expect((await hr.s.post('', valid({ userId: hr.id, successorId: '' }))).status).toBe(403);
      expect((await admin.s.post('', valid({ userId: hr.id, successorId: '' }))).status).toBe(201);
      expect(await StaffDeparture.countDocuments({ user: leaver.id })).toBe(0);
    });

    test('HR cannot open, change or cancel their own record', async () => {
      const d = (await hrHead.s.post('', valid({ userId: hr.id, successorId: '' }))).body.departure;
      const own = await hr.s.get(`/${d.id}`);
      expect(own.status).toBe(200);
      expect(own.body.departure.reason).toBeUndefined();
      expect(own.body.departure.can.manage).toBe(false);
      expect((await hr.s.patch(`/${d.id}`, { rev: d.rev, lastDay: inDays(90) })).status).toBe(403);
      expect((await hr.s.post(`/${d.id}/cancel`)).status).toBe(403);
    });

    test.each([
      ['missing', { resignedOn: undefined }],
      ['not a date', { resignedOn: 'yesterday' }],
      ['in the future', { resignedOn: inDays(2) }],
      ['too far back', { resignedOn: inDays(-400) }],
      ['after the last day', { resignedOn: inDays(-1), lastDay: inDays(-5) }],
      ['last day impossible', { lastDay: '2026-02-30' }],
      ['last day too far ahead', { lastDay: inDays(400) }],
    ])('refuses a resignation date or last day that is %s', async (_n, over) => {
      const r = await hr.s.post('', valid(over));
      expect(r.status).toBe(400);
      expect(r.body.success).toBe(false);
      expect(await StaffDeparture.countDocuments({ user: leaver.id })).toBe(0);
    });

    test('an edit cannot move the last day before the resignation date', async () => {
      const d = (await hr.s.post('', valid())).body.departure;
      expect((await hr.s.patch(`/${d.id}`, { rev: d.rev, lastDay: inDays(-10) })).status).toBe(400);
      const ok = await hr.s.patch(`/${d.id}`, { rev: d.rev, lastDay: inDays(10), resignedOn: inDays(-1) });
      expect(ok.status).toBe(200);
      expect(ok.body.departure).toMatchObject({ lastDay: inDays(10), resignedOn: inDays(-1) });
    });

    test('recording the same thing twice keeps one record and tells the replacement once', async () => {
      const first = await hr.s.post('', valid());
      const again = await hr.s.post('', valid());
      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.body.created).toBe(false);
      expect(again.body.departure.id).toBe(first.body.departure.id);
      expect(await StaffDeparture.countDocuments({ user: leaver.id })).toBe(1);
      expect(pushed).toHaveLength(1);
      expect(await logged({ resource: 'StaffDeparture', resourceId: first.body.departure.id, action: 'CREATE' })).toBeTruthy();
      expect(await AuditLog.countDocuments({ resource: 'StaffDeparture', resourceId: first.body.departure.id, action: 'CREATE' })).toBe(1);
    });

    test('a different resignation for someone already leaving is refused', async () => {
      await hr.s.post('', valid());
      const r = await admin.s.post('', valid({ lastDay: inDays(40) }));
      expect(r.status).toBe(409);
      expect(await StaffDeparture.countDocuments({ user: leaver.id })).toBe(1);
    });

    test('withdrawn: HR cancels it, the log says who, the team stops seeing it, and it can be recorded again later', async () => {
      const d = (await hr.s.post('', valid())).body.departure;
      const c = await hr.s.post(`/${d.id}/cancel`);
      expect(c.status).toBe(200);
      expect(c.body.departure).toMatchObject({ status: 'cancelled', cancelledByName: 'Hema' });
      expect(c.body.departure.cancelledAt).toBeTruthy();
      expect((await hr.s.post(`/${d.id}/cancel`)).status).toBe(409);
      expect((await hr.s.patch(`/${d.id}`, { rev: c.body.departure.rev, lastDay: inDays(5) })).status).toBe(409);
      expect((await peer.s.get(`/${d.id}`)).status).toBe(404);
      expect((await peer.s.get('')).body.departures).toHaveLength(0);
      const log = await logged({ resource: 'StaffDeparture', resourceId: d.id, action: 'UPDATE' });
      expect(String(log.user)).toBe(hr.id);
      expect(log.details).toMatchObject({ change: 'cancelled' });
      const again = await hr.s.post('', valid({ lastDay: inDays(50) }));
      expect(again.status).toBe(201);
      expect(again.body.departure.id).not.toBe(d.id);
    });
  });
});
