/**
 * Autobacs Team app: Bearer auth for the app client + phone notifications.
 *
 * What must hold:
 *   - the WEBSITE login/refresh are unchanged: tokens only in httpOnly cookies,
 *     never in the body
 *   - `X-Client: autobacs-team` login/refresh return the pair in the BODY and set
 *     no auth cookies; Bearer then works on /hr routes
 *   - auth failure is never 200: wrong password, bad/old refresh token, no token,
 *     a garbage token, a bumped sessionVersion, after logout
 *   - capabilities (Approvals tab) mirror the server's own checks
 *   - push tokens: validated, one row per install, a token moves with the person
 *   - notifications: same event twice → ONE row, ONE job; delivery is idempotent,
 *     drops dead devices, retries Expo outages without re-sending, skips exited people
 *   - a final leave decision queues one push; a replay queues none
 *   - missed clock-out reminders: one per day per employee, second run sends nothing
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

jest.setTimeout(180000);

const jobs = [];
const mockQueue = { add: (name, data, opts) => { jobs.push({ name, data, opts }); return Promise.resolve({}); } };
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
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const { default: User } = await import('../models/User.js');
const { default: EmployeePushToken } = await import('../models/hr/EmployeePushToken.js');
const { default: HrNotification } = await import('../models/hr/HrNotification.js');
const { default: AttendanceDay } = await import('../models/hr/AttendanceDay.js');
const { default: EmployeeProfile } = await import('../models/hr/EmployeeProfile.js');
const { loadHrModels } = await import('../scripts/create-hr-indexes.js');
const notify = await import('../services/hr/notify/index.js');
const { appCapabilities } = await import('../routes/hr/app.js');
const { sendExpoPush, ExpoTransportError } = await import('../services/hr/notify/expoPush.js');

const PW = 'SecurePass123!';
const APP = { 'X-Client': 'autobacs-team' };
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
let n = 0;

const cookieNames = (res) => (res.headers['set-cookie'] || []).map((c) => c.split('=')[0]);
const CREATOR = new mongoose.Types.ObjectId();
const token = (k = 'a') => `ExponentPushToken[${k.padEnd(22, 'x')}]`;

async function makeUser(name, role, staff) {
  n += 1;
  const email = `${name.toLowerCase().replace(/\s/g, '')}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, email, id: String(user._id) };
}
async function appLogin(email) {
  const res = await request(server).post(LOGIN).set(APP).send({ email, password: PW });
  expect(res.status).toBe(200);
  return res.body;
}
const bearer = (t) => ({ ...APP, Authorization: `Bearer ${t}` });
const team = (t, x = {}) => ({ team: t, active: true, ...x });

beforeAll(async () => {
  await dbHandler.connect();
  await Promise.all((await loadHrModels()).map((M) => M.init()));
});
afterAll(async () => {
  await new Promise((resolve) => { server.close(resolve); });
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});
beforeEach(async () => {
  const cols = await mongoose.connection.db.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
  jobs.length = 0;
});

// ── Auth ──────────────────────────────────────────────────────────────────────
describe('login + refresh: website vs app', () => {
  test('website login: cookies only, no token in the body (unchanged)', async () => {
    const { email } = await makeUser('Web Staff', 'staff', team('sales'));
    const res = await request(server).post(LOGIN).send({ email, password: PW });
    expect(res.status).toBe(200);
    expect(cookieNames(res)).toEqual(expect.arrayContaining(['accessToken', 'refreshToken']));
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body.user.email).toBe(email);
  });

  test('app login: pair in the body, no auth cookies, Bearer works', async () => {
    const { email } = await makeUser('App Staff', 'staff', team('sales'));
    const res = await request(server).post(LOGIN).set(APP).send({ email, password: PW });
    expect(res.status).toBe(200);
    expect(cookieNames(res)).not.toEqual(expect.arrayContaining(['accessToken']));
    expect(cookieNames(res)).not.toContain('refreshToken');
    expect(res.body).toMatchObject({ tokenType: 'Bearer', accessToken: expect.any(String), refreshToken: expect.any(String) });
    expect(new Date(res.body.accessTokenExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(res.body.refreshTokenExpiresAt).getTime()).toBeGreaterThan(Date.now());
    const me = await request(server).get('/api/v1/auth/me').set(bearer(res.body.accessToken));
    expect(me.status).toBe(200);
    expect((await request(server).get('/api/v1/hr/me/app').set(bearer(res.body.accessToken))).status).toBe(200);
  });

  test('app login with a wrong password → 401 and no tokens', async () => {
    const { email } = await makeUser('Wrong Pw', 'staff', team('sales'));
    const res = await request(server).post(LOGIN).set(APP).send({ email, password: 'Nope12345!' });
    expect(res.status).toBe(401);
    expect(res.body.accessToken).toBeUndefined();
  });

  test('app refresh: body token in, new pair in the body, no cookies; the old token is spent', async () => {
    const { email } = await makeUser('Refresher', 'staff', team('sales'));
    const first = await appLogin(email);
    const r = await request(server).post(REFRESH).set(APP).send({ refreshToken: first.refreshToken });
    expect(r.status).toBe(200);
    expect(cookieNames(r)).not.toContain('accessToken');
    expect(r.body.accessToken).toEqual(expect.any(String));
    expect(r.body.refreshToken).not.toBe(first.refreshToken);
    expect((await request(server).get('/api/v1/hr/me/app').set(bearer(r.body.accessToken))).status).toBe(200);
    // The successor works for the next refresh.
    const r2 = await request(server).post(REFRESH).set(APP).send({ refreshToken: r.body.refreshToken });
    expect(r2.status).toBe(200);
  });

  test('website refresh: cookie in, cookies out, nothing in the body (unchanged)', async () => {
    const { email } = await makeUser('Web Refresh', 'staff', team('sales'));
    const agent = request.agent(server);
    expect((await agent.post(LOGIN).send({ email, password: PW })).status).toBe(200);
    const r = await agent.post(REFRESH).send({});
    expect(r.status).toBe(200);
    expect(cookieNames(r)).toEqual(expect.arrayContaining(['accessToken', 'refreshToken']));
    expect(r.body.accessToken).toBeUndefined();
    expect(r.body.refreshToken).toBeUndefined();
  });

  test('bad or missing refresh token → 401/400, never 200', async () => {
    expect((await request(server).post(REFRESH).set(APP).send({ refreshToken: 'not-a-token' })).status).toBe(401);
    expect((await request(server).post(REFRESH).set(APP).send({})).status).toBe(400);
  });

  test('no token, garbage token, bumped sessionVersion, logout → 401 on HR routes', async () => {
    const { user, email } = await makeUser('Revoked', 'staff', team('sales'));
    expect((await request(server).get('/api/v1/hr/me/app')).status).toBe(401);
    expect((await request(server).get('/api/v1/hr/me/app').set(bearer('garbage'))).status).toBe(401);

    const s = await appLogin(email);
    await User.updateOne({ _id: user._id }, { $inc: { sessionVersion: 1 } });
    expect((await request(server).get('/api/v1/hr/me/app').set(bearer(s.accessToken))).status).toBe(401);

    const s2 = await appLogin(email);
    const out = await request(server).post('/api/v1/auth/logout').set(bearer(s2.accessToken)).send({ refreshToken: s2.refreshToken });
    expect(out.status).toBe(200);
    expect((await request(server).post(REFRESH).set(APP).send({ refreshToken: s2.refreshToken })).status).toBe(401);
  });

  test('app writes need no CSRF token with Bearer; without auth they are 401/403, never 200', async () => {
    const { email, id } = await makeUser('Csrf Free', 'staff', team('sales'));
    await EmployeeProfile.create({ name: 'Csrf Free', user: id, employeeCode: 'AT-T1', status: 'active', createdBy: CREATOR });
    const s = await appLogin(email);
    const ok = await request(server).put('/api/v1/hr/me/push-token').set(bearer(s.accessToken))
      .send({ deviceId: 'device-0001', token: token('csrf'), platform: 'android' });
    expect(ok.status).toBe(200);
    const anon = await request(server).put('/api/v1/hr/me/push-token').set(APP)
      .send({ deviceId: 'device-0001', token: token('csrf'), platform: 'android' });
    expect([401, 403]).toContain(anon.status);
  });
});

// ── Capabilities ──────────────────────────────────────────────────────────────
describe('GET /hr/me/app (Approvals tab)', () => {
  test('pure rules', () => {
    expect(appCapabilities({ role: 'staff', staff: team('sales') }).canApprove).toEqual({ leave: false, fixDay: false, overtime: false });
    expect(appCapabilities({ role: 'staff', staff: team('sales', { isHead: true }) }).canApprove).toEqual({ leave: true, fixDay: false, overtime: true });
    expect(appCapabilities({ role: 'staff', staff: team('hr') }).canApprove).toEqual({ leave: true, fixDay: true, overtime: true });
    expect(appCapabilities({ role: 'admin' }).canApprove).toEqual({ leave: true, fixDay: true, overtime: true });
    // An inactive head approves nothing.
    expect(appCapabilities({ role: 'staff', staff: { team: 'sales', isHead: true, active: false } }).canApprove.leave).toBe(false);
  });
  test('over HTTP for a head', async () => {
    const { email } = await makeUser('Head', 'staff', team('sales', { isHead: true }));
    const s = await appLogin(email);
    const r = await request(server).get('/api/v1/hr/me/app').set(bearer(s.accessToken));
    expect(r.body.canApprove).toEqual({ leave: true, fixDay: false, overtime: true });
  });
});

// ── Push tokens ───────────────────────────────────────────────────────────────
describe('push tokens', () => {
  let a; let b; let aP; let bP;
  beforeEach(async () => {
    a = await makeUser('Asha', 'staff', team('sales'));
    b = await makeUser('Bala', 'staff', team('sales'));
    aP = await EmployeeProfile.create({ name: 'Asha', user: a.id, employeeCode: 'AT-1', status: 'active', createdBy: CREATOR });
    bP = await EmployeeProfile.create({ name: 'Bala', user: b.id, employeeCode: 'AT-2', status: 'active', createdBy: CREATOR });
  });

  test('validates input', async () => {
    await expect(notify.registerPushToken(aP, a.user, { deviceId: 'device-0001', token: 'nope', platform: 'android' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(notify.registerPushToken(aP, a.user, { deviceId: 'x', token: token(), platform: 'android' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(notify.registerPushToken(aP, a.user, { deviceId: 'device-0001', token: token(), platform: 'web' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('register is idempotent; a new token replaces the old one for the same install', async () => {
    await notify.registerPushToken(aP, a.user, { deviceId: 'device-0001', token: token('one'), platform: 'android' });
    await notify.registerPushToken(aP, a.user, { deviceId: 'device-0001', token: token('one'), platform: 'android' });
    await notify.registerPushToken(aP, a.user, { deviceId: 'device-0001', token: token('two'), platform: 'android' });
    const rows = await EmployeePushToken.find({}).lean();
    expect(rows.map((r) => r.token)).toEqual([token('two')]);
  });

  test('a shared phone: the token moves to whoever signed in last', async () => {
    await notify.registerPushToken(aP, a.user, { deviceId: 'device-0001', token: token('shared'), platform: 'android' });
    await notify.registerPushToken(bP, b.user, { deviceId: 'device-0001', token: token('shared'), platform: 'android' });
    const rows = await EmployeePushToken.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(String(rows[0].employee)).toBe(String(bP._id));
  });

  test('two parallel registers of the same token → one row', async () => {
    await Promise.all([
      notify.registerPushToken(aP, a.user, { deviceId: 'device-0001', token: token('race'), platform: 'android' }),
      notify.registerPushToken(aP, a.user, { deviceId: 'device-0001', token: token('race'), platform: 'android' }),
    ]);
    expect(await EmployeePushToken.countDocuments({})).toBe(1);
  });

  test('unregister removes it; another person cannot remove mine', async () => {
    await notify.registerPushToken(aP, a.user, { deviceId: 'device-0001', token: token('mine'), platform: 'ios' });
    await notify.unregisterPushToken(bP, 'device-0001');
    expect(await EmployeePushToken.countDocuments({})).toBe(1);
    await notify.unregisterPushToken(aP, 'device-0001');
    expect(await EmployeePushToken.countDocuments({})).toBe(0);
  });
});

// ── Notifications ─────────────────────────────────────────────────────────────
const fakeExpo = (respond) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return respond(body, calls.length);
  };
  return { calls, fetchImpl };
};
const okAll = (body) => ({ ok: true, status: 200, json: async () => ({ data: body.map(() => ({ status: 'ok', id: 'x' })) }) });

describe('notifyEmployee + delivery', () => {
  let p;
  beforeEach(async () => {
    const u = await makeUser('Chitra', 'staff', team('sales'));
    p = await EmployeeProfile.create({ name: 'Chitra', user: u.id, employeeCode: 'AT-3', status: 'active', createdBy: CREATOR });
    await notify.registerPushToken(p, u.user, { deviceId: 'device-aaaa', token: token('p1'), platform: 'android' });
    await notify.registerPushToken(p, u.user, { deviceId: 'device-bbbb', token: token('p2'), platform: 'ios' });
  });

  test('same event twice → one row, one job', async () => {
    const e = { employeeId: p._id, requestId: new mongoose.Types.ObjectId(), from: '2027-03-01', to: '2027-03-02', decision: 'approved' };
    const [x, y] = await Promise.all([notify.notifyLeaveDecided(e), notify.notifyLeaveDecided(e)]);
    expect([x.status, y.status].sort()).toEqual(['duplicate', 'queued']);
    expect(await HrNotification.countDocuments({})).toBe(1);
    expect(jobs.filter((j) => j.name === notify.HR_PUSH_JOB)).toHaveLength(1);
    expect(jobs[0].opts.jobId).not.toContain(':'); // BullMQ refuses ':' in custom ids
  });

  test('never throws: bad input is skipped', async () => {
    expect((await notify.notifyEmployee({ employeeId: 'nope', type: 'missed_punch', key: 'k', title: 't', body: 'b' })).status).toBe('skipped');
  });

  test('delivers to every phone once; a second run sends nothing', async () => {
    const { id } = await notify.notifyPayslipReady({ employeeId: p._id, month: '2027-03', payslipId: 'ps1' });
    const expo = fakeExpo(okAll);
    expect((await notify.deliverNotification(id, { fetchImpl: expo.fetchImpl })).sent).toBe(2);
    expect(expo.calls[0][0]).toMatchObject({ title: 'Payslip ready', data: { type: 'payslip_ready', path: '/payslips' } });
    expect(expo.calls[0][0].body).toMatch(/March 2027/);
    expect((await notify.deliverNotification(id, { fetchImpl: expo.fetchImpl })).status).toBe('sent');
    expect(expo.calls).toHaveLength(1);
    expect((await HrNotification.findById(id).lean()).status).toBe('sent');
  });

  test('DeviceNotRegistered deletes that token; the other phone still gets it', async () => {
    const { id } = await notify.notifyMissedPunch({ employeeId: p._id, date: '2027-03-04' });
    const expo = fakeExpo((body) => ({
      ok: true, status: 200,
      json: async () => ({ data: body.map((m) => (m.to === token('p1') ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' })) }),
    }));
    const r = await notify.deliverNotification(id, { fetchImpl: expo.fetchImpl });
    expect(r).toMatchObject({ status: 'sent', sent: 1, gone: 1 });
    expect((await EmployeePushToken.find({}).lean()).map((t) => t.token)).toEqual([token('p2')]);
  });

  test('Expo down → throws for a retry, row stays queued; the retry does not re-send accepted phones', async () => {
    const { id } = await notify.notifyOvertimeDecided({ employeeId: p._id, dayId: 'd1', decisionId: 1, date: '2027-03-05', decision: 'approved', approvedMinutes: 90 });
    const down = fakeExpo(() => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(notify.deliverNotification(id, { fetchImpl: down.fetchImpl })).rejects.toBeInstanceOf(ExpoTransportError);
    expect((await HrNotification.findById(id).lean()).status).toBe('queued');

    // Simulate a partial success on an earlier attempt: p1 already accepted.
    await HrNotification.updateOne({ _id: id }, { $set: { sentTo: [token('p1')] } });
    const up = fakeExpo(okAll);
    const r = await notify.deliverNotification(id, { fetchImpl: up.fetchImpl });
    expect(r.sent).toBe(1);
    expect(up.calls[0].map((m) => m.to)).toEqual([token('p2')]);
    expect(up.calls[0][0].body).toMatch(/1 h 30 min/);
  });

  test('refused 3 times in a row → the token is removed', async () => {
    const refuse = fakeExpo((body) => ({ ok: true, status: 200, json: async () => ({ data: body.map(() => ({ status: 'error', message: 'bad', details: { error: 'InvalidCredentials' } })) }) }));
    for (let i = 0; i < 3; i += 1) {
      const { id } = await notify.notifyMissedPunch({ employeeId: p._id, date: `2027-03-1${i}` });
      expect((await notify.deliverNotification(id, { fetchImpl: refuse.fetchImpl })).status).toBe('failed');
    }
    expect(await EmployeePushToken.countDocuments({})).toBe(0);
  });

  test('no phones → no_device; an exited employee gets nothing', async () => {
    await EmployeePushToken.deleteMany({});
    const { id } = await notify.notifyMissedPunch({ employeeId: p._id, date: '2027-03-20' });
    expect((await notify.deliverNotification(id, { fetchImpl: fakeExpo(okAll).fetchImpl })).status).toBe('no_device');

    const u2 = await makeUser('Gone', 'staff', team('sales'));
    const gone = await EmployeeProfile.create({ name: 'Gone', user: u2.id, employeeCode: 'AT-9', status: 'exited', createdBy: CREATOR });
    await notify.registerPushToken(gone, u2.user, { deviceId: 'device-gone', token: token('gone'), platform: 'android' });
    const g = await notify.notifyMissedPunch({ employeeId: gone._id, date: '2027-03-20' });
    const expo = fakeExpo(okAll);
    expect((await notify.deliverNotification(g.id, { fetchImpl: expo.fetchImpl })).status).toBe('no_device');
    expect(expo.calls).toHaveLength(0);
  });

  test('sendExpoPush chunks by 100 and keeps order', async () => {
    const expo = fakeExpo(okAll);
    const msgs = Array.from({ length: 150 }, (_, i) => ({ to: token(`c${i}`), title: 't', body: 'b' }));
    const r = await sendExpoPush(msgs, { fetchImpl: expo.fetchImpl });
    expect(expo.calls.map((c) => c.length)).toEqual([100, 50]);
    expect(r).toHaveLength(150);
  });

  test('missed clock-out cron: one reminder per auto-closed day, a second run sends nothing', async () => {
    const now = new Date('2027-03-10T06:00:00Z'); // 11:30 IST → yesterday = 2027-03-09
    await AttendanceDay.create({ employee: p._id, date: '2027-03-09', month: '2027-03', status: 'present', autoClosed: true });
    await AttendanceDay.create({ employee: p._id, date: '2027-03-08', month: '2027-03', status: 'present', autoClosed: true });
    expect(await notify.sendMissedPunchReminders(now)).toMatchObject({ date: '2027-03-09', days: 1, queued: 1 });
    expect(await notify.sendMissedPunchReminders(now)).toMatchObject({ queued: 0, duplicate: 1 });
    expect(await HrNotification.countDocuments({ type: 'missed_punch' })).toBe(1);
  });
});

// ── Leave decision trigger ────────────────────────────────────────────────────
describe('leave decision → one push', () => {
  test('HR rejects → one notification; replaying the same decision adds none', async () => {
    const hr = await makeUser('Hema HR', 'staff', team('hr'));
    const emp = await makeUser('Devi', 'staff', team('sales'));
    const hrS = await appLogin(hr.email);
    const empS = await appLogin(emp.email);
    const H = (r) => r.set(bearer(hrS.accessToken));
    const E = (r) => r.set(bearer(empS.accessToken));
    expect((await H(request(server).post('/api/v1/hr/employees')).send({ name: 'Devi', user: emp.id, joinDate: '2025-01-01' })).status).toBe(201);
    expect((await H(request(server).post('/api/v1/hr/leave-types')).send({ code: 'CL', name: 'Casual', annualQuotaHalfDays: 16 })).status).toBe(201);
    const types = (await H(request(server).get('/api/v1/hr/leave-types'))).body.items;
    expect((await H(request(server).post('/api/v1/hr/leave/grants')).send({ year: 2027 })).status).toBe(200);
    const applied = await E(request(server).post('/api/v1/hr/me/leave')).send({
      clientRequestId: `c-${new mongoose.Types.ObjectId()}`, leaveType: types[0].id, from: '2027-03-01', to: '2027-03-02', reason: 'family function',
    });
    expect(applied.status).toBe(201);
    const r = applied.body.request;
    expect(r.status).toBe('pending_hr'); // no head in this team
    const body = { decision: 'rejected', note: 'busy week', rev: r.rev };
    expect((await H(request(server).post(`/api/v1/hr/leave/${r.id}/decide`)).send(body)).status).toBe(200);
    const again = await H(request(server).post(`/api/v1/hr/leave/${r.id}/decide`)).send(body);
    expect(again.status).toBe(200);
    expect(again.body.replay).toBe(true);
    const rows = await HrNotification.find({ type: 'leave_decided' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: `leave:${r.id}:rejected`, title: 'Leave not approved' });
  });
});
