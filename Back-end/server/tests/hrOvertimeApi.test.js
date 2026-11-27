/**
 * Overtime approval queue + the payroll month summary, end to end (real routes,
 * in-memory MongoDB, made-up people — no real employee data).
 *
 * What must hold:
 *   - GET /hr/overtime/pending: HR sees everyone, a head their own team only,
 *     anyone else 404; keyset pages never repeat or skip a row
 *   - POST /hr/attendance/:dayId/overtime/decide: HR or the own team head;
 *     head of another team / a colleague / yourself → 404 (same as a missing day)
 *   - deciding twice → the same row, ONE audit entry; a payroll-locked day → 409
 *   - monthAttendanceSummary: marks → LOP (3/6/7 → ½/1/1), unapproved OT = 0,
 *     approved OT counted, no writes
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

jest.setTimeout(180000);

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
const { default: User } = await import('../models/User.js');
const { default: EmployeeProfile } = await import('../models/hr/EmployeeProfile.js');
const { default: AttendanceDay } = await import('../models/hr/AttendanceDay.js');
const { default: HrAuditLog } = await import('../models/hr/HrAuditLog.js');
const { default: HrSettings } = await import('../models/hr/HrSettings.js');
const { loadHrModels } = await import('../scripts/create-hr-indexes.js');
const { monthAttendanceSummary, markMonthLocked } = await import('../services/hr/attendance/index.js');
const { istInstant } = await import('../services/hr/attendance/time.js');

// Bound to 127.0.0.1 explicitly (see tests/hrAttendanceApi.test.js for why).
const server = app.listen(0, '127.0.0.1');
const PW = 'SecurePass123!';
const API = '/api/v1/hr';
const MONTH = '2026-10'; // fully in the past; Sundays are 4, 11, 18, 25
const AFTER_MONTH = new Date('2026-11-01T06:00:00Z');

let n = 0;
async function signIn(email) {
  const agent = request.agent(server);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PW });
  if (res.status !== 200) throw new Error(`login ${res.status} ${JSON.stringify(res.body)}`);
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  const csrf = x ? x.split(';')[0].split('=')[1] : '';
  return {
    get: (u) => agent.get(u),
    post: (u) => agent.post(u).set('X-XSRF-TOKEN', csrf),
  };
}
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase().replace(/\s/g, '')}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, agent: await signIn(email), id: String(user._id) };
};
const team = (t, x = {}) => ({ team: t, active: true, ...x });
const uid = () => `p-${new mongoose.Types.ObjectId()}`;

/** HR records a day by hand: in/out at IST wall-clock times. Returns the stored AttendanceDay. */
async function workDay(employee, date, inAt, outAt) {
  for (const [type, hhmm] of [['in', inAt], ['out', outAt]]) {
    const r = await hr.agent.post(`${API}/employees/${employee._id}/punches`)
      .send({ clientPunchId: uid(), type, at: istInstant(date, hhmm).toISOString(), date });
    if (r.status !== 201) throw new Error(`punch ${r.status} ${JSON.stringify(r.body)}`);
  }
  return AttendanceDay.findOne({ employee: employee._id, date }).lean();
}
const decide = (who, dayId, body) => who.agent.post(`${API}/attendance/${dayId}/overtime/decide`).send(body);

beforeAll(async () => {
  await Promise.all((await loadHrModels()).map((M) => M.init()));
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

let admin; let hr; let alice; let bob; let head; let otherHead; let aliceP; let bobP; let headP; let procP;
beforeEach(async () => {
  admin = await makeUser('Admin', 'admin');
  hr = await makeUser('Hema HR', 'staff', team('hr'));
  alice = await makeUser('Alice', 'staff', team('sales'));
  bob = await makeUser('Bob', 'staff', team('sales'));
  head = await makeUser('Sales Head', 'staff', team('sales', { isHead: true }));
  otherHead = await makeUser('Proc Head', 'staff', team('procurement', { isHead: true }));
  const mk = (name, user, t) => EmployeeProfile.create({
    name, user: user.user._id, team: t, status: 'active', employeeCode: `EMP-${name[0]}${n}`, createdBy: hr.user._id, joinDate: '2020-01-01',
  }).then((d) => d.toObject());
  aliceP = await mk('Alice', alice, 'sales');
  bobP = await mk('Bob', bob, 'sales');
  headP = await mk('Sam', head, 'sales');
  procP = await mk('Priya', otherHead, 'procurement');
});

describe('overtime approval queue', () => {
  test('pending list: HR all, head own team only, other head none, colleague 404', async () => {
    const a = await workDay(aliceP, '2026-10-05', '09:00', '21:00'); // 12 h → 180 OT
    await workDay(procP, '2026-10-05', '09:00', '20:00'); // 120 OT, procurement
    expect(a).toMatchObject({ overtimeMinutes: 180, overtimeStatus: 'pending', overtimeApprovedMinutes: 0 });

    const all = await hr.agent.get(`${API}/overtime/pending`);
    expect(all.status).toBe(200);
    expect(all.headers['cache-control']).toMatch(/no-store/);
    expect(all.body.items.map((i) => i.employee.name).sort()).toEqual(['Alice', 'Priya']);
    expect(all.body.items[0]).toMatchObject({ id: expect.any(String), day: { overtimeMinutes: expect.any(Number), overtimeStatus: 'pending' } });

    const sales = await head.agent.get(`${API}/overtime/pending?team=procurement`); // asks for another team: ignored
    expect(sales.body.items.map((i) => i.employee.name)).toEqual(['Alice']);
    const proc = await otherHead.agent.get(`${API}/overtime/pending`);
    expect(proc.body.items.map((i) => i.employee.name)).toEqual([]); // own overtime is never in your own queue
    expect((await bob.agent.get(`${API}/overtime/pending`)).status).toBe(404);
    expect((await request(server).get(`${API}/overtime/pending`)).status).toBe(401);
  });

  test('keyset pages: oldest first, no repeats, no skips', async () => {
    for (const d of ['2026-10-07', '2026-10-05', '2026-10-06']) await workDay(aliceP, d, '09:00', '20:00');
    const p1 = await hr.agent.get(`${API}/overtime/pending?limit=2`);
    expect(p1.body.items.map((i) => i.day.date)).toEqual(['2026-10-05', '2026-10-06']);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await hr.agent.get(`${API}/overtime/pending?limit=2&cursor=${p1.body.nextCursor}`);
    expect(p2.body.items.map((i) => i.day.date)).toEqual(['2026-10-07']);
    expect(p2.body.nextCursor).toBeNull();
    expect((await hr.agent.get(`${API}/overtime/pending?cursor=junk`)).status).toBe(400);
  });

  test('head of another team, a colleague, yourself, a bad id → 404; nothing changes', async () => {
    const a = await workDay(aliceP, '2026-10-05', '09:00', '21:00');
    const h = await workDay(headP, '2026-10-05', '09:00', '21:00');
    expect((await decide(otherHead, a._id, { decision: 'approve' })).status).toBe(404);
    expect((await decide(bob, a._id, { decision: 'approve' })).status).toBe(404);
    expect((await decide(alice, a._id, { decision: 'approve' })).status).toBe(404);
    expect((await decide(head, h._id, { decision: 'approve' })).status).toBe(404); // a head's own overtime goes to HR
    expect((await decide(hr, new mongoose.Types.ObjectId(), { decision: 'approve' })).status).toBe(404);
    expect((await decide(hr, 'not-an-id', { decision: 'approve' })).status).toBe(404);
    expect(await AttendanceDay.findById(a._id).lean()).toMatchObject({ overtimeStatus: 'pending', overtimeApprovedMinutes: 0 });
    expect(await HrAuditLog.countDocuments({ action: /^overtime\./ })).toBe(0);
  });

  test('own team head approves; deciding twice → same result, one audit row', async () => {
    const a = await workDay(aliceP, '2026-10-05', '09:00', '21:00');
    const r1 = await decide(head, a._id, { decision: 'approve', minutes: 120, note: 'stock count' });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ replay: false, day: { overtimeStatus: 'approved', overtimeApprovedMinutes: 120, overtimeMinutes: 180 } });
    const r2 = await decide(head, a._id, { decision: 'approve', minutes: 120 });
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ replay: true, day: r1.body.day });
    expect(await HrAuditLog.countDocuments({ action: 'overtime.approved', entityId: a._id })).toBe(1);
    // approved days leave the queue
    expect((await hr.agent.get(`${API}/overtime/pending`)).body.items).toEqual([]);
  });

  test('two identical decisions at once → one change, both 200', async () => {
    const a = await workDay(aliceP, '2026-10-05', '09:00', '21:00');
    const [x, y] = await Promise.all([decide(hr, a._id, { decision: 'approve' }), decide(head, a._id, { decision: 'approve' })]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect(x.body.day.overtimeApprovedMinutes).toBe(180);
    expect(y.body.day.overtimeApprovedMinutes).toBe(180);
    expect(await HrAuditLog.countDocuments({ action: 'overtime.approved', entityId: a._id })).toBe(1);
  });

  test('validation: minutes above the computed overtime / zero → 400; bad decision → 400; no overtime → 409', async () => {
    const a = await workDay(aliceP, '2026-10-05', '09:00', '21:00');
    expect((await decide(hr, a._id, { decision: 'approve', minutes: 181 })).status).toBe(400);
    expect((await decide(hr, a._id, { decision: 'approve', minutes: 0 })).status).toBe(400);
    expect((await decide(hr, a._id, { decision: 'maybe' })).status).toBe(400);
    expect((await decide(hr, a._id, { decision: 'approve', overtimeMinutes: 60 })).status).toBe(409); // hours changed since seen
    const normal = await workDay(bobP, '2026-10-05', '10:00', '19:00');
    expect((await decide(hr, normal._id, { decision: 'approve' })).status).toBe(409);
  });

  test('HR can reject after a head approved; a payroll-locked day → 409', async () => {
    const a = await workDay(aliceP, '2026-10-05', '09:00', '21:00');
    await decide(head, a._id, { decision: 'approve' });
    const rej = await decide(hr, a._id, { decision: 'reject', note: 'not asked for' });
    expect(rej.body.day).toMatchObject({ overtimeStatus: 'rejected', overtimeApprovedMinutes: 0 });
    await markMonthLocked(MONTH);
    const locked = await decide(hr, a._id, { decision: 'approve' });
    expect(locked.status).toBe(409);
    expect(await AttendanceDay.findById(a._id).lean()).toMatchObject({ overtimeStatus: 'rejected', overtimeApprovedMinutes: 0 });
    // the older per-employee HR route follows the same rule
    expect((await hr.agent.post(`${API}/employees/${aliceP._id}/attendance/2026-10-05/overtime`).send({ approvedMinutes: 60 })).status).toBe(409);
  });
});

describe('monthAttendanceSummary (payroll input)', () => {
  test('marks: 09:11-style lateness and early leaving → 3/6/7 marks = ½/1/1 LOP days', async () => {
    // FALLBACK shift 10:00–19:00, 10 min grace each side.
    await workDay(aliceP, '2026-10-05', '10:10', '19:00'); // on time (10:10)
    await workDay(aliceP, '2026-10-06', '10:11', '19:00'); // late
    await workDay(aliceP, '2026-10-07', '10:00', '18:49'); // early
    await workDay(aliceP, '2026-10-08', '10:11', '19:00'); // late
    let s = await monthAttendanceSummary(aliceP._id, MONTH, { now: AFTER_MONTH });
    expect(s).toMatchObject({
      lateCount: 2, earlyCount: 1, marks: 3, marksPerHalfDayLop: 3, marksLopDays: 0.5, daysInMonth: 31, shiftMinutes: 540,
    });

    await workDay(aliceP, '2026-10-09', '10:20', '18:40'); // late + early = 2 marks (500 min worked: still a full day)
    await workDay(aliceP, '2026-10-10', '10:15', '19:00'); // late → 6
    s = await monthAttendanceSummary(aliceP._id, MONTH, { now: AFTER_MONTH });
    expect(s).toMatchObject({ marks: 6, marksLopDays: 1 });

    await workDay(aliceP, '2026-10-12', '10:30', '19:00'); // late → 7
    await workDay(aliceP, '2026-10-13', '13:00', '17:00'); // half day: late and early but NOT a mark
    s = await monthAttendanceSummary(aliceP._id, MONTH, { now: AFTER_MONTH });
    expect(s).toMatchObject({ marks: 7, marksLopDays: 1, lateCount: 5, earlyCount: 2 });
    expect(s.breakdown.halfDays).toBe(1);
    expect(s.payableDays + s.lopDays).toBe(s.employedDays);
    expect(s.employedDays).toBe(31);
    // Sundays are paid weekly offs; days nobody punched are unapproved absences.
    expect(s.breakdown.weeklyOffDays).toBe(4);
    expect(s.absentUnapproved).toBe(31 - 4 - 8);
  });

  test('HR settings change the marks rule', async () => {
    await HrSettings.create({ key: 'default', marksPerHalfDayLop: 2 });
    await workDay(aliceP, '2026-10-06', '10:11', '19:00');
    await workDay(aliceP, '2026-10-07', '10:11', '19:00');
    expect(await monthAttendanceSummary(aliceP._id, MONTH, { now: AFTER_MONTH })).toMatchObject({ marks: 2, marksLopDays: 0.5 });
  });

  test('overtime: unapproved = 0, approved minutes counted; the summary writes nothing', async () => {
    const a = await workDay(aliceP, '2026-10-05', '09:00', '21:00');
    const rowsBefore = await AttendanceDay.countDocuments({});
    expect((await monthAttendanceSummary(aliceP._id, MONTH, { now: AFTER_MONTH })).otApprovedMinutes).toBe(0);
    expect((await monthAttendanceSummary(aliceP._id, MONTH, { now: AFTER_MONTH })).otPendingDays).toBe(1);
    await decide(hr, a._id, { decision: 'approve', minutes: 120 });
    const s = await monthAttendanceSummary(aliceP._id, MONTH, { now: AFTER_MONTH });
    expect(s).toMatchObject({ otApprovedMinutes: 120, otPendingDays: 0 });
    expect(await AttendanceDay.countDocuments({})).toBe(rowsBefore);
  });

  test('bad month → 400, unknown employee → 404', async () => {
    await expect(monthAttendanceSummary(aliceP._id, '2026-1')).rejects.toMatchObject({ statusCode: 400 });
    await expect(monthAttendanceSummary(new mongoose.Types.ObjectId(), MONTH)).rejects.toMatchObject({ statusCode: 404 });
  });
});
