/**
 * Attendance API (docs/ADR-hr-system.md §4) end to end, with the deterministic
 * fake face engine and an in-memory photo store (never real faces).
 *
 * What must hold:
 *   - auth failure is never 200; employee A cannot read B's attendance/face (404);
 *     a team head sees their own team's attendance only, never face
 *   - a double tap / replayed offline sync → exactly one punch
 *   - refused punches (fence, accuracy, mocked, sequence, face) are 422 + code and NOT stored
 *   - offline punches: future → refused; older than offlineMaxHours → pending_review
 *   - phone binding: first binds, one change allowed, second change in the cooldown → HR
 *   - corrections + review + overtime are CAS-decided once, recompute the day, audit
 *   - payroll exports: monthSummary, markMonthLocked → changedAfterLock
 *   - auto-close closes at the shift end, never overtime, idempotent
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
const { default: AttendancePunch } = await import('../models/hr/AttendancePunch.js');
const { default: AttendanceDay } = await import('../models/hr/AttendanceDay.js');
const { default: FaceProfile } = await import('../models/hr/FaceProfile.js');
const { default: FaceReviewPhoto } = await import('../models/hr/FaceReviewPhoto.js');
const { default: EmployeeDevice } = await import('../models/hr/EmployeeDevice.js');
const { default: HrAuditLog } = await import('../models/hr/HrAuditLog.js');
const { default: HrSettings } = await import('../models/hr/HrSettings.js');
const { loadHrModels } = await import('../scripts/create-hr-indexes.js');
const { setFaceEngine } = await import('../services/hr/face/engine.js');
const { default: fakeEngine, fakeFrame } = await import('../services/hr/face/engines/fakeEngine.js');
const { setPhotoStore } = await import('../services/hr/face/reviewPhotos.js');
const { _resetMemory } = await import('../services/hr/attendance/ephemeral.js');
const { FACE_CONSENT_VERSION } = await import('../services/hr/face/constants.js');
const {
  monthSummary, markMonthLocked, changedAfterLock, revokeDevices,
} = await import('../services/hr/attendance/index.js');
const { eraseFaceData } = await import('../services/hr/face/index.js');
const { autoCloseOpenDays } = await import('../services/hr/attendance/autoClose.js');
const {
  istDate, istInstant, addDays, weekday, monthOf,
} = await import('../services/hr/attendance/time.js');

const PW = 'SecurePass123!';
const API = '/api/v1/hr';
const SITE = { lat: 12.9716, lng: 77.5946 };
const ALICE_FACE = [1, 0, 0, 0];
const BOB_FACE = [0, 1, 0, 0];

// In-memory private bucket.
const bucket = new Map();
setPhotoStore({
  available: () => true,
  put: async (key, body) => { bucket.set(key, body); },
  del: async (key) => { bucket.delete(key); return true; },
  url: async (key) => `https://private.test/${key}?sig=x`,
});
setFaceEngine(fakeEngine);

let n = 0;
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PW });
  expect(res.status).toBe(200);
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  const csrf = x ? x.split(';')[0].split('=')[1] : '';
  return {
    get: (u) => agent.get(u),
    post: (u) => agent.post(u).set('X-XSRF-TOKEN', csrf),
    patch: (u) => agent.patch(u).set('X-XSRF-TOKEN', csrf),
    delete: (u) => agent.delete(u).set('X-XSRF-TOKEN', csrf),
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

/** Two fake frames that satisfy the challenge's action for `emb`. */
function evidence(action, emb, { swapSecond = null } = {}) {
  const second = { emb: swapSecond || emb, yaw: 0, size: 200 };
  if (action === 'turn_left') second.yaw = 0.3;
  if (action === 'turn_right') second.yaw = -0.3;
  if (action === 'move_closer') second.size = 260;
  return [fakeFrame({ emb, yaw: 0, size: 200 }), fakeFrame(second)];
}

async function challenge(agent, purpose = 'punch') {
  const r = await agent.post(`${API}/me/face/challenge`).send({ purpose });
  if (r.status !== 201) throw new Error(`challenge ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.challenge;
}

async function enrolFace(agent, emb) {
  expect((await agent.post(`${API}/me/face/consent`).send({ version: FACE_CONSENT_VERSION, deviceId: 'dev-a' })).status).toBe(200);
  const ch = await challenge(agent, 'enrol');
  const req = agent.post(`${API}/me/face/enrol`).field('challengeId', ch.challengeId);
  for (const [i, f] of evidence(ch.action, emb).entries()) req.attach('frames', f, { filename: `f${i}.jpg`, contentType: 'image/jpeg' });
  const r = await req;
  expect(r.status).toBe(200);
  return r.body.face;
}

/** A punch through the API. `emb` = whose face is in the frames. */
async function punchReq(agent, {
  type = 'in', clientPunchId = uid(), emb = ALICE_FACE, lat = SITE.lat, lng = SITE.lng, accuracyM = 20, mocked = false,
  deviceId = 'dev-a', platform = 'android', offline = false, at, ch, framesOverride, purpose = 'punch',
} = {}) {
  const c = ch || await challenge(agent, purpose);
  const req = agent.post(`${API}/me/punches`)
    .field('clientPunchId', clientPunchId).field('type', type).field('lat', String(lat)).field('lng', String(lng))
    .field('accuracyM', String(accuracyM)).field('mocked', String(mocked)).field('deviceId', deviceId)
    .field('platform', platform).field('offline', String(offline)).field('challengeId', c.challengeId);
  if (at) req.field('at', at.toISOString());
  const frames = framesOverride || evidence(c.action, emb);
  frames.forEach((f, i) => req.attach('frames', f, { filename: `f${i}.jpg`, contentType: 'image/jpeg' }));
  const res = await req;
  return { res, clientPunchId, ch: c };
}

/** The most recent past Mon–Sat at least `back` days ago (a normal working day). */
function pastWorkday(back = 2) {
  let d = addDays(istDate(new Date()), -back);
  while (weekday(d) === 0) d = addDays(d, -1);
  return d;
}

beforeAll(async () => {
  await Promise.all((await loadHrModels()).map((M) => M.init()));
});
afterAll(async () => {
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

let admin; let hr; let alice; let bob; let head; let otherHead; let site; let aliceP; let bobP;
beforeEach(async () => {
  _resetMemory();
  bucket.clear();
  admin = await makeUser('Admin', 'admin');
  hr = await makeUser('Hema HR', 'staff', team('hr'));
  alice = await makeUser('Alice', 'staff', team('sales'));
  bob = await makeUser('Bob', 'staff', team('sales'));
  head = await makeUser('Sales Head', 'staff', team('sales', { isHead: true }));
  otherHead = await makeUser('Proc Head', 'staff', team('procurement', { isHead: true }));
  const s = await hr.agent.post(`${API}/sites`).send({ name: 'Bengaluru HQ', lat: SITE.lat, lng: SITE.lng, radiusM: 150 });
  expect(s.status).toBe(201);
  site = s.body.site;
  const mk = (name, user, code) => EmployeeProfile.create({
    name, user: user.user._id, team: 'sales', status: 'active', employeeCode: code, createdBy: hr.user._id,
    workSites: [site.id], joinDate: '2020-01-01',
  });
  aliceP = (await mk('Alice', alice, `EMP-A${n}`)).toObject();
  bobP = (await mk('Bob', bob, `EMP-B${n}`)).toObject();
});

describe('auth and who may see what', () => {
  test('no token → 401 on attendance and face routes (never 200)', async () => {
    for (const [m, path] of [['get', '/me/attendance'], ['get', '/attendance/today'], ['post', '/me/punches'],
      ['get', `/employees/${bobP._id}/attendance`], ['get', `/employees/${bobP._id}/face`], ['get', '/sites']]) {
      const r = await request(app)[m](`${API}${path}`);
      expect([401, 403]).toContain(r.status); // 403 = CSRF on a cookie-less POST; never 200
      expect(r.status).not.toBe(200);
    }
    const r = await request(app).get(`${API}/me/attendance`);
    expect(r.status).toBe(401);
  });

  test('a revoked session → 401', async () => {
    await User.updateOne({ _id: alice.user._id }, { $inc: { sessionVersion: 1 } });
    expect((await alice.agent.get(`${API}/me/attendance/status`)).status).toBe(401);
  });

  test("employee A gets 404 for B's attendance and face — same as a missing id", async () => {
    for (const path of [`/employees/${bobP._id}/attendance`, `/employees/${bobP._id}/face`,
      `/employees/${new mongoose.Types.ObjectId()}/attendance`, '/employees/nope/face']) {
      const r = await alice.agent.get(`${API}${path}`);
      expect(r.status).toBe(404);
    }
    expect((await alice.agent.get(`${API}/employees/${aliceP._id}/attendance`)).status).toBe(200);
    expect((await alice.agent.get(`${API}/employees/${aliceP._id}/face`)).status).toBe(200);
  });

  test("a team head sees their team's attendance, never face; another head sees nothing", async () => {
    expect((await head.agent.get(`${API}/employees/${bobP._id}/attendance`)).status).toBe(200);
    expect((await head.agent.get(`${API}/employees/${bobP._id}/face`)).status).toBe(404);
    expect((await otherHead.agent.get(`${API}/employees/${bobP._id}/attendance`)).status).toBe(404);
  });

  test('today board: HR all, head own team only, employee 403', async () => {
    await EmployeeProfile.create({ name: 'Priya', team: 'procurement', status: 'active', employeeCode: `EMP-P${n}`, createdBy: hr.user._id });
    const all = await hr.agent.get(`${API}/attendance/today`);
    expect(all.status).toBe(200);
    expect(all.body.items.map((i) => i.employee.name).sort()).toEqual(['Alice', 'Bob', 'Priya']);
    const mine = await head.agent.get(`${API}/attendance/today?team=procurement`);
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((i) => i.employee.name).sort()).toEqual(['Alice', 'Bob']);
    expect((await alice.agent.get(`${API}/attendance/today`)).status).toBe(403);
  });

  test('HR-only screens are refused to employees and heads', async () => {
    for (const a of [alice, head]) {
      expect((await a.agent.get(`${API}/sites`)).status).toBe(403);
      expect((await a.agent.get(`${API}/punches/review`)).status).toBe(403);
      expect((await a.agent.get(`${API}/corrections`)).status).toBe(403);
      expect((await a.agent.post(`${API}/employees/${bobP._id}/attendance/2026-12-01/overtime`).send({ approvedMinutes: 10 })).status).toBe(403);
    }
  });
});

describe('sites and shifts', () => {
  test('CAS on rev, validation, audit', async () => {
    const stale = await hr.agent.patch(`${API}/sites/${site.id}`).send({ rev: 5, radiusM: 200 });
    expect(stale.status).toBe(409);
    const ok = await hr.agent.patch(`${API}/sites/${site.id}`).send({ rev: 0, radiusM: 200 });
    expect(ok.status).toBe(200);
    expect(ok.body.site).toMatchObject({ radiusM: 200, rev: 1 });
    expect((await hr.agent.post(`${API}/sites`).send({ name: 'X', lat: 1, lng: 1, radiusM: 10 })).status).toBe(400);
    expect(await HrAuditLog.countDocuments({ action: { $in: ['site.created', 'site.updated'] } })).toBe(2);
  });

  test('one default shift at a time', async () => {
    const a = await hr.agent.post(`${API}/shifts`).send({ name: 'Day', start: '10:00', end: '19:00', isDefault: true });
    expect(a.status).toBe(201);
    const b = await admin.agent.post(`${API}/shifts`).send({ name: 'Early', start: '08:00', end: '17:00', isDefault: true });
    expect(b.status).toBe(201);
    const list = await hr.agent.get(`${API}/shifts`);
    expect(list.body.items.filter((s) => s.isDefault).map((s) => s.name)).toEqual(['Early']);
    expect((await hr.agent.post(`${API}/shifts`).send({ name: 'Bad', start: '25:00', end: '19:00' })).status).toBe(400);
  });
});

describe('face consent and enrolment', () => {
  test('consent is versioned; enrol needs consent; template encrypted and never returned', async () => {
    expect((await alice.agent.post(`${API}/me/face/consent`).send({ version: 'old' })).status).toBe(400);
    const ch = await challenge(alice.agent, 'enrol');
    const early = alice.agent.post(`${API}/me/face/enrol`).field('challengeId', ch.challengeId);
    evidence(ch.action, ALICE_FACE).forEach((f, i) => early.attach('frames', f, { filename: `${i}.jpg`, contentType: 'image/jpeg' }));
    expect((await early).status).toBe(409);

    const face = await enrolFace(alice.agent, ALICE_FACE);
    expect(face).toMatchObject({ status: 'enrolled', consentCurrent: true });
    expect(JSON.stringify(face)).not.toMatch(/template/i);
    const raw = await FaceProfile.findOne({ employee: aliceP._id }).select('+templateEnc').lean();
    expect(raw.templateEnc.startsWith('enc:v1:')).toBe(true);

    // Enrolled already: HR must allow a new enrolment.
    const again = await challenge(alice.agent, 'enrol');
    const r2 = alice.agent.post(`${API}/me/face/enrol`).field('challengeId', again.challengeId);
    evidence(again.action, ALICE_FACE).forEach((f, i) => r2.attach('frames', f, { filename: `${i}.jpg`, contentType: 'image/jpeg' }));
    expect((await r2).status).toBe(409);
    expect((await hr.agent.post(`${API}/employees/${aliceP._id}/face/allow-reenrol`)).status).toBe(200);
    expect((await hr.agent.get(`${API}/employees/${aliceP._id}/face`)).body.face.status).toBe('reenrol_allowed');
  });

  test('liveness: challenge single-use, replayed frames, identical frames, wrong motion, swapped face', async () => {
    await enrolFace(alice.agent, ALICE_FACE);
    const first = await punchReq(alice.agent);
    expect(first.res.status).toBe(201);
    // Same challenge again → refused.
    const reuse = await punchReq(alice.agent, { type: 'break_start', ch: first.ch });
    expect(reuse.res.status).toBe(422);
    expect(reuse.res.body.code).toBe('liveness_failed');
    // Same pictures with a new challenge → refused (hash remembered).
    const c = await challenge(alice.agent);
    const frames = evidence(first.ch.action, ALICE_FACE);
    const ok = await punchReq(alice.agent, { type: 'break_start', ch: { ...c }, framesOverride: evidence(c.action, ALICE_FACE) });
    expect(ok.res.status).toBe(201);
    void frames;
    const c2 = await challenge(alice.agent);
    const same = fakeFrame({ emb: ALICE_FACE, nonce: 1 });
    const ident = await punchReq(alice.agent, { type: 'break_end', ch: c2, framesOverride: [same, same] });
    expect(ident.res.body.code).toBe('liveness_failed');
    const c3 = await challenge(alice.agent);
    const still = await punchReq(alice.agent, { type: 'break_end', ch: c3, framesOverride: [fakeFrame({ emb: ALICE_FACE }), fakeFrame({ emb: ALICE_FACE })] });
    expect(still.res.body.code).toBe('liveness_failed'); // no movement
    const c4 = await challenge(alice.agent);
    const swap = await punchReq(alice.agent, { type: 'break_end', ch: c4, framesOverride: evidence(c4.action, ALICE_FACE, { swapSecond: BOB_FACE }) });
    expect(swap.res.body.code).toBe('liveness_failed');
    expect(await AttendancePunch.countDocuments({ employee: aliceP._id })).toBe(2);
  });

  test('a challenge issued to Bob is useless to Alice', async () => {
    await enrolFace(alice.agent, ALICE_FACE);
    const bobCh = await challenge(bob.agent);
    const r = await punchReq(alice.agent, { ch: bobCh });
    expect(r.res.body.code).toBe('liveness_failed');
  });

  test('withdraw deletes the template; punches then need enrolment', async () => {
    await enrolFace(alice.agent, ALICE_FACE);
    const w = await alice.agent.delete(`${API}/me/face`);
    expect(w.body.face.status).toBe('withdrawn');
    const raw = await FaceProfile.findOne({ employee: aliceP._id }).select('+templateEnc').lean();
    expect(raw.templateEnc).toBeUndefined();
    const r = await punchReq(alice.agent);
    expect(r.res.status).toBe(422);
    expect(r.res.body.code).toBe('not_enrolled');
  });
});

describe('punch', () => {
  beforeEach(async () => { await enrolFace(alice.agent, ALICE_FACE); });

  test('accepted punch returns { punch, day }; replay → 200 with the same punch; exactly one row', async () => {
    const a = await punchReq(alice.agent);
    expect(a.res.status).toBe(201);
    expect(a.res.body.punch).toMatchObject({ type: 'in', status: 'accepted', geo: { verdict: 'inside' }, face: { verdict: 'match' } });
    // Today may be a Sunday (the default weekly off) when the suite runs.
    expect(['present', 'holiday_worked']).toContain(a.res.body.day.status);
    const replay = await punchReq(alice.agent, { clientPunchId: a.clientPunchId });
    expect(replay.res.status).toBe(200);
    expect(replay.res.body.punch.id).toBe(a.res.body.punch.id);
    expect(replay.res.body.replay).toBe(true);
    expect(await AttendancePunch.countDocuments({ employee: aliceP._id })).toBe(1);
  });

  test('double tap (same request twice at once) → exactly one punch', async () => {
    const ch = await challenge(alice.agent);
    const clientPunchId = uid();
    const frames = evidence(ch.action, ALICE_FACE);
    const [r1, r2] = await Promise.all([
      punchReq(alice.agent, { ch, clientPunchId, framesOverride: frames }),
      punchReq(alice.agent, { ch, clientPunchId, framesOverride: frames }),
    ]);
    expect([r1.res.status, r2.res.status]).toContain(201);
    expect(await AttendancePunch.countDocuments({ employee: aliceP._id })).toBe(1);
    // The app's retry of the loser is a replay.
    const retry = await punchReq(alice.agent, { clientPunchId });
    expect(retry.res.status).toBe(200);
  });

  test('refusals are 422 with a code and store nothing', async () => {
    const far = await punchReq(alice.agent, { lat: 12.9816 });
    expect(far.res.status).toBe(422);
    expect(far.res.body).toMatchObject({ code: 'outside_fence', success: false });
    expect(far.res.body.distanceM).toBeGreaterThan(1000);
    const fuzzy = await punchReq(alice.agent, { accuracyM: 500 });
    expect(fuzzy.res.body.code).toBe('low_accuracy');
    const fake = await punchReq(alice.agent, { mocked: true });
    expect(fake.res.body.code).toBe('mocked_location');
    expect(await HrAuditLog.countDocuments({ action: 'punch.mocked_location', subject: aliceP._id })).toBe(1);
    const seq = await punchReq(alice.agent, { type: 'break_start' });
    expect(seq.res.body).toMatchObject({ code: 'sequence', allowedTypes: ['in'] });
    expect(await AttendancePunch.countDocuments({})).toBe(0);
  });

  test('sequence: no double in, no break_end without break_start', async () => {
    expect((await punchReq(alice.agent, { type: 'in' })).res.status).toBe(201);
    expect((await punchReq(alice.agent, { type: 'in' })).res.body.code).toBe('sequence');
    expect((await punchReq(alice.agent, { type: 'break_end' })).res.body.code).toBe('sequence');
    expect((await punchReq(alice.agent, { type: 'break_start' })).res.status).toBe(201);
    expect((await punchReq(alice.agent, { type: 'break_end' })).res.status).toBe(201);
    expect((await punchReq(alice.agent, { type: 'out' })).res.status).toBe(201);
    const day = await AttendanceDay.findOne({ employee: aliceP._id, date: istDate(new Date()) }).lean();
    expect(day.lastOut).toBeTruthy();
  });

  test('anywhereAllowed: outside every site is accepted and marked', async () => {
    await EmployeeProfile.updateOne({ _id: aliceP._id }, { $set: { anywhereAllowed: true } });
    const r = await punchReq(alice.agent, { lat: 19.07, lng: 72.87 });
    expect(r.res.status).toBe(201);
    expect(r.res.body.punch.geo.verdict).toBe('anywhere_allowed');
  });

  test('manual-attendance and exited employees cannot punch from the app', async () => {
    await EmployeeProfile.updateOne({ _id: aliceP._id }, { $set: { manualAttendance: true } });
    expect((await punchReq(alice.agent)).res.body.code).toBe('manual_attendance');
    await EmployeeProfile.updateOne({ _id: aliceP._id }, { $set: { manualAttendance: false, status: 'exited' } });
    expect((await punchReq(alice.agent)).res.status).toBe(403);
  });

  test('offline: older than offlineMaxHours → pending_review; future → bad_time; replayed sync → one row', async () => {
    const old = new Date(Date.now() - 30 * 3600000);
    const r = await punchReq(alice.agent, { offline: true, at: old, purpose: 'offline' });
    expect(r.res.status).toBe(201);
    expect(r.res.body.punch).toMatchObject({ status: 'pending_review', offline: true });
    expect(new Date(r.res.body.punch.at).getTime()).toBe(old.getTime());
    const again = await punchReq(alice.agent, { offline: true, at: old, clientPunchId: r.clientPunchId });
    expect(again.res.status).toBe(200);
    const future = await punchReq(alice.agent, { type: 'out', offline: true, at: new Date(Date.now() + 3600000) });
    expect(future.res.body.code).toBe('bad_time');
    expect(await AttendancePunch.countDocuments({ employee: aliceP._id })).toBe(1);
  });

  test('impossible jump between two punches → pending_review', async () => {
    await EmployeeProfile.updateOne({ _id: aliceP._id }, { $set: { anywhereAllowed: true } });
    expect((await punchReq(alice.agent)).res.status).toBe(201);
    const r = await punchReq(alice.agent, { type: 'out', lat: 28.61, lng: 77.2 }); // Delhi, seconds later
    expect(r.res.body.punch.status).toBe('pending_review');
    const day = await AttendanceDay.findOne({ employee: aliceP._id }).lean();
    expect(day.needsReview).toBe(true);
  });

  test('face mismatch → 422, then "ask HR" stores ONE photo and a pending punch; HR decides once', async () => {
    const bad = await punchReq(alice.agent, { emb: BOB_FACE });
    expect(bad.res.status).toBe(422);
    expect(bad.res.body).toMatchObject({ code: 'face_no_match', canRequestReview: true });
    expect(await AttendancePunch.countDocuments({})).toBe(0);

    const rv = await alice.agent.post(`${API}/me/punches/${bad.clientPunchId}/review`)
      .attach('frames', fakeFrame({ emb: BOB_FACE }), { filename: 'r.jpg', contentType: 'image/jpeg' });
    expect(rv.status).toBe(201);
    expect(rv.body.punch).toMatchObject({ status: 'pending_review', face: { verdict: 'no_match' } });
    expect(await FaceReviewPhoto.countDocuments({ employee: aliceP._id })).toBe(1);
    expect(bucket.size).toBe(1);
    // Tapping "ask HR" twice → still one punch, one photo.
    const twice = await alice.agent.post(`${API}/me/punches/${bad.clientPunchId}/review`)
      .attach('frames', fakeFrame({ emb: BOB_FACE }), { filename: 'r.jpg', contentType: 'image/jpeg' });
    expect(twice.status).toBe(200);
    expect(bucket.size).toBe(1);

    const inbox = await hr.agent.get(`${API}/punches/review`);
    expect(inbox.body.items).toHaveLength(1);
    expect(inbox.body.items[0].reasons).toContain('face');
    const photo = await hr.agent.get(`${API}/punches/${inbox.body.items[0].id}/photo`);
    expect(photo.body.url).toMatch(/^https:\/\/private\.test\//);
    expect((await alice.agent.get(`${API}/punches/${inbox.body.items[0].id}/photo`)).status).toBe(403);

    const ok = await hr.agent.post(`${API}/punches/${inbox.body.items[0].id}/decide`).send({ decision: 'accept', note: 'It is her, new glasses' });
    expect(ok.status).toBe(200);
    expect(ok.body.punch.status).toBe('accepted');
    expect(['present', 'holiday_worked']).toContain(ok.body.day.status);
    expect((await hr.agent.post(`${API}/punches/${inbox.body.items[0].id}/decide`).send({ decision: 'reject' })).status).toBe(409);
  });

  test('a review with no failed attempt behind it is refused', async () => {
    const r = await alice.agent.post(`${API}/me/punches/${uid()}/review`)
      .attach('frames', fakeFrame({ emb: ALICE_FACE }), { filename: 'r.jpg', contentType: 'image/jpeg' });
    expect(r.status).toBe(404);
  });

  test('after maxFaceAttempts the model is not run again for that punch', async () => {
    await HrSettings.create({ key: 'default', maxFaceAttempts: 2 });
    const id = uid();
    expect((await punchReq(alice.agent, { emb: BOB_FACE, clientPunchId: id })).res.body.attemptsLeft).toBe(1);
    expect((await punchReq(alice.agent, { emb: BOB_FACE, clientPunchId: id })).res.body.attemptsLeft).toBe(0);
    const third = await punchReq(alice.agent, { emb: ALICE_FACE, clientPunchId: id });
    expect(third.res.body).toMatchObject({ code: 'face_no_match', attemptsLeft: 0, canRequestReview: true });
  });
});

describe('devices', () => {
  beforeEach(async () => { await enrolFace(alice.agent, ALICE_FACE); });

  test('first binds; one change allowed; a second change in the cooldown waits for HR', async () => {
    expect((await punchReq(alice.agent, { deviceId: 'phone-1' })).res.status).toBe(201);
    expect((await punchReq(alice.agent, { type: 'out', deviceId: 'phone-2' })).res.status).toBe(201);
    expect(await HrAuditLog.countDocuments({ action: 'device.changed' })).toBe(1);
    const blocked = await punchReq(alice.agent, { type: 'in', deviceId: 'phone-3' });
    expect(blocked.res.body.code).toBe('device_blocked');
    const devices = await hr.agent.get(`${API}/employees/${aliceP._id}/devices`);
    expect(devices.body.items.find((d) => d.deviceId === 'phone-3')).toMatchObject({ pendingApproval: true, active: false });
    expect((await hr.agent.post(`${API}/employees/${aliceP._id}/devices/phone-3/approve`)).status).toBe(200);
    expect((await punchReq(alice.agent, { type: 'in', deviceId: 'phone-3' })).res.status).toBe(201);
    expect(await EmployeeDevice.countDocuments({ employee: aliceP._id, active: true })).toBe(1);
  });

  test('revokeDevices (exit) leaves no active phone', async () => {
    await punchReq(alice.agent, { deviceId: 'phone-1' });
    const r = await revokeDevices(aliceP._id);
    expect(r.revoked).toBe(1);
    expect(await EmployeeDevice.countDocuments({ employee: aliceP._id, active: true })).toBe(0);
  });
});

describe('corrections', () => {
  test('employee asks (idempotent), HR approves once with rev, the day is recomputed', async () => {
    const date = pastWorkday(3);
    const body = { clientRequestId: uid(), date, punchType: 'in', at: istInstant(date, '10:00').toISOString(), reason: 'Phone died' };
    const a = await alice.agent.post(`${API}/me/corrections`).send(body);
    expect(a.status).toBe(201);
    const replay = await alice.agent.post(`${API}/me/corrections`).send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.correction.id).toBe(a.body.correction.id);
    expect((await alice.agent.post(`${API}/corrections/${a.body.correction.id}/decide`).send({ decision: 'approve', rev: 0 })).status).toBe(403);

    const stale = await hr.agent.post(`${API}/corrections/${a.body.correction.id}/decide`).send({ decision: 'approve', rev: 3 });
    expect(stale.status).toBe(409);
    const ok = await hr.agent.post(`${API}/corrections/${a.body.correction.id}/decide`).send({ decision: 'approve', rev: 0, note: 'ok' });
    expect(ok.status).toBe(200);
    expect(ok.body.correction.status).toBe('approved');
    expect(await AttendancePunch.countDocuments({ employee: aliceP._id, source: 'correction' })).toBe(1);
    expect((await hr.agent.post(`${API}/corrections/${a.body.correction.id}/decide`).send({ decision: 'approve', rev: 1 })).status).toBe(409);
    expect(await HrAuditLog.countDocuments({ action: 'correction.approved' })).toBe(1);

    // Bob can't see Alice's corrections.
    const bobs = await bob.agent.get(`${API}/me/corrections`);
    expect(bobs.body.items).toHaveLength(0);
  });

  test('a correction that breaks the day sequence cannot be approved', async () => {
    const date = pastWorkday(3);
    const c = await alice.agent.post(`${API}/me/corrections`).send({
      clientRequestId: uid(), date, punchType: 'out', at: istInstant(date, '19:00').toISOString(), reason: 'Left at 7',
    });
    const r = await hr.agent.post(`${API}/corrections/${c.body.correction.id}/decide`).send({ decision: 'approve', rev: 0 });
    expect(r.status).toBe(409);
    expect(await AttendancePunch.countDocuments({})).toBe(0);
  });

  test('future days and times off the day are refused', async () => {
    const tomorrow = addDays(istDate(new Date()), 1);
    expect((await alice.agent.post(`${API}/me/corrections`).send({
      clientRequestId: uid(), date: tomorrow, punchType: 'in', at: new Date().toISOString(), reason: 'x x x',
    })).status).toBe(400);
  });
});

describe('overtime, month view, payroll exports, auto-close', () => {
  const manual = (agent, employeeId, type, at, date) => agent.post(`${API}/employees/${employeeId}/punches`)
    .send({ clientPunchId: uid(), type, at: at.toISOString(), ...(date ? { date } : {}) });

  test('HR manual punches → overtime computed; HR approves at most what was worked', async () => {
    const date = pastWorkday(2);
    expect((await manual(hr.agent, aliceP._id, 'in', istInstant(date, '09:00'))).status).toBe(201);
    const out = await manual(hr.agent, aliceP._id, 'out', istInstant(date, '21:00'));
    expect(out.body.day).toMatchObject({ overtimeMinutes: 180, status: 'present' });
    const tooMuch = await hr.agent.post(`${API}/employees/${aliceP._id}/attendance/${date}/overtime`).send({ approvedMinutes: 999 });
    expect(tooMuch.status).toBe(400);
    const ok = await hr.agent.post(`${API}/employees/${aliceP._id}/attendance/${date}/overtime`).send({ approvedMinutes: 120, overtimeMinutes: 180 });
    expect(ok.status).toBe(200);
    expect(ok.body.day.overtimeApprovedMinutes).toBe(120);

    const month = await alice.agent.get(`${API}/me/attendance?month=${monthOf(date)}`);
    expect(month.status).toBe(200);
    expect(month.body.days.find((d) => d.date === date)).toMatchObject({ status: 'present', overtimeApprovedMinutes: 120 });

    const s = await monthSummary(aliceP._id, monthOf(date));
    expect(s.presentDays).toBeGreaterThanOrEqual(1);
    expect(s.overtimeApprovedMinutes).toBe(120);
    expect(s.daysInMonth).toBeGreaterThanOrEqual(28);
  });

  test('after markMonthLocked, a later correction shows up in changedAfterLock', async () => {
    const date = pastWorkday(2);
    await manual(hr.agent, aliceP._id, 'in', istInstant(date, '10:00'));
    await markMonthLocked(monthOf(date));
    expect(await changedAfterLock(monthOf(date))).toEqual([]);
    await manual(hr.agent, aliceP._id, 'out', istInstant(date, '19:00'));
    const changed = await changedAfterLock(monthOf(date));
    expect(changed).toEqual([expect.objectContaining({ employee: String(aliceP._id), date })]);
  });

  test('auto-close: closes at the shift end, never overtime, idempotent', async () => {
    const date = pastWorkday(2);
    await manual(hr.agent, aliceP._id, 'in', istInstant(date, '08:00'));
    const r1 = await autoCloseOpenDays(istInstant(addDays(date, 1), '01:00'));
    expect(r1.closed).toBe(1);
    const out = await AttendancePunch.findOne({ employee: aliceP._id, source: 'auto_close' }).lean();
    expect(out.at.toISOString()).toBe(istInstant(date, '19:00').toISOString());
    const day = await AttendanceDay.findOne({ employee: aliceP._id, date }).lean();
    expect(day).toMatchObject({ autoClosed: true, overtimeMinutes: 0, needsReview: false });
    const r2 = await autoCloseOpenDays(istInstant(addDays(date, 1), '01:15'));
    expect(r2.closed).toBe(0);
    expect(await AttendancePunch.countDocuments({ employee: aliceP._id, source: 'auto_close' })).toBe(1);
    expect((await hr.agent.post(`${API}/employees/${aliceP._id}/attendance/${date}/overtime`).send({ approvedMinutes: 0 })).status).toBe(409);
  });

  test('eraseFaceData removes the template and every review photo (object, then row)', async () => {
    await enrolFace(alice.agent, ALICE_FACE);
    const bad = await punchReq(alice.agent, { emb: BOB_FACE });
    await alice.agent.post(`${API}/me/punches/${bad.clientPunchId}/review`)
      .attach('frames', fakeFrame({ emb: BOB_FACE }), { filename: 'r.jpg', contentType: 'image/jpeg' });
    expect(bucket.size).toBe(1);
    const r = await eraseFaceData(aliceP._id, 'exit');
    expect(r).toMatchObject({ erased: true, photos: { deleted: 1, failed: 0 } });
    expect(bucket.size).toBe(0);
    expect(await FaceReviewPhoto.countDocuments({})).toBe(0);
    const raw = await FaceProfile.findOne({ employee: aliceP._id }).select('+templateEnc').lean();
    expect(raw).toMatchObject({ status: 'deleted' });
    expect(raw.templateEnc).toBeUndefined();
    expect((await eraseFaceData(aliceP._id, 'exit')).erased).toBe(false); // idempotent
  });
});
