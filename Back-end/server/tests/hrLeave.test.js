/**
 * HR leave + holidays (docs/ADR-hr-system.md §4 Leave).
 *
 * What must hold:
 *   - the day count is the SERVER's: weekly offs, holidays of the employee's
 *     sites, half-day flags and the sandwich rule — a client-sent count is ignored
 *   - double submit (same clientRequestId, even in parallel) → ONE request
 *   - overlapping live requests and a paid balance below zero are refused, also
 *     when two DIFFERENT requests race each other
 *   - chain: team head → HR; a head (or a team with no head, or headStep off) → HR only
 *   - approve writes ONE ledger 'use' row even when approved twice at once;
 *     cancel after approval writes ONE 'restore' row
 *   - employee A cannot read B's leave or balances (404); a head sees only their team
 *   - grants, year-end carry/lapse and HR adjustments are idempotent
 *   - no token / revoked token → 401 on leave routes
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
const dbHandler = await import('./db-handler.js');
// One server bound to 127.0.0.1 for the whole file. supertest's default (a fresh
// listen(0) per request on '::') can collide with another process holding
// 127.0.0.1:<same port> on a shared machine, which answers with its own 404.
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const { default: User } = await import('../models/User.js');
const { default: LeaveLedgerEntry } = await import('../models/hr/LeaveLedgerEntry.js');
const { default: LeaveRequest } = await import('../models/hr/LeaveRequest.js');
const { default: LeaveType } = await import('../models/hr/LeaveType.js');
const { default: HrAuditLog } = await import('../models/hr/HrAuditLog.js');
const { default: HrShift } = await import('../models/hr/HrShift.js');
const { default: EmployeeProfile } = await import('../models/hr/EmployeeProfile.js');
const { loadHrModels } = await import('../scripts/create-hr-indexes.js');
const calendar = await import('../services/hr/leave/calendar.js');
const leaveApi = await import('../services/hr/leave/index.js');

const PW = 'SecurePass123!';
let n = 0;
async function signIn(email) {
  const agent = request.agent(server);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PW });
  expect([res.status, res.status === 200 ? '' : JSON.stringify(res.body)]).toEqual([200, '']);
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
const cid = () => `c-${new mongoose.Types.ObjectId()}`;

// ── Pure calendar maths ──────────────────────────────────────────────────────
describe('countLeave (server day count)', () => {
  // 2027-03-01 is a Monday. Sunday off.
  const base = { weeklyOff: [0], holidays: new Set() };
  test('a working week Mon–Fri is 10 half-days', () => {
    expect(calendar.countLeave({ ...base, from: '2027-03-01', to: '2027-03-05' }).halfDays).toBe(10);
  });
  test('half-day flags shave the edge days', () => {
    expect(calendar.countLeave({ ...base, from: '2027-03-01', to: '2027-03-02', firstHalfOnly: true }).halfDays).toBe(3);
    expect(calendar.countLeave({ ...base, from: '2027-03-01', to: '2027-03-02', firstHalfOnly: true, secondHalfOnly: true }).halfDays).toBe(2);
    expect(calendar.countLeave({ ...base, from: '2027-03-01', to: '2027-03-01', secondHalfOnly: true }).halfDays).toBe(1);
  });
  test('weekly offs and holidays inside the range cost nothing without the sandwich rule', () => {
    const r = calendar.countLeave({ weeklyOff: [0], holidays: new Set(['2027-03-02']), from: '2027-03-01', to: '2027-03-08' });
    expect(r.halfDays).toBe(12); // Mon, Wed, Thu, Fri, Sat, Mon (Tue holiday, Sun off)
    expect(r.days.map((d) => d.date)).not.toContain('2027-03-07');
  });
  test('the sandwich rule charges off days BETWEEN leave days, never at the edges', () => {
    expect(calendar.countLeave({ ...base, from: '2027-03-06', to: '2027-03-08', sandwich: true }).halfDays).toBe(6);
    expect(calendar.countLeave({ ...base, from: '2027-03-06', to: '2027-03-08', sandwich: false }).halfDays).toBe(4);
    // Range starting/ending on the off day: the off day is an edge, not charged.
    expect(calendar.countLeave({ ...base, from: '2027-03-07', to: '2027-03-08', sandwich: true }).halfDays).toBe(2);
  });
  test('a range of only off days is zero', () => {
    expect(calendar.countLeave({ ...base, from: '2027-03-07', to: '2027-03-07' })).toEqual({ halfDays: 0, days: [] });
  });
  test('a half-day flag on an off day is ignored', () => {
    expect(calendar.countLeave({ ...base, from: '2027-03-07', to: '2027-03-08', firstHalfOnly: true }).halfDays).toBe(2);
  });
});

describe('grants maths', () => {
  test('pro-rating: before the 16th counts the month; later joiners start next month; rounded down', () => {
    expect(calendar.proRatedQuota(16, 2027, '2026-05-01')).toBe(16);
    expect(calendar.proRatedQuota(16, 2027, '2027-01-15')).toBe(16);
    expect(calendar.proRatedQuota(16, 2027, '2027-07-10')).toBe(8); // 6 months
    expect(calendar.proRatedQuota(16, 2027, '2027-07-20')).toBe(6); // 5 months → 6.67 → 6
    expect(calendar.proRatedQuota(16, 2027, '2028-01-01')).toBe(0);
    expect(calendar.proRatedQuota(16, 2027, null)).toBe(16);
  });
  test('monthly shares add up to exactly the yearly quota', () => {
    for (const q of [24, 7, 13, 0]) {
      let sum = 0;
      for (let m = 1; m <= 12; m += 1) sum += calendar.monthlyShare(q, m);
      expect(sum).toBe(q);
    }
  });
  test('isValidDate rejects impossible days', () => {
    expect(calendar.isValidDate('2027-02-29')).toBe(false);
    expect(calendar.isValidDate('2028-02-29')).toBe(true);
    expect(calendar.isValidDate('2027-13-01')).toBe(false);
  });
});

// ── API ───────────────────────────────────────────────────────────────────────
describe('HR leave API', () => {
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

  let admin; let hr; let hr2; let alice; let bob; let head; let otherHead; let carol; let customer;
  let aliceP; let bobP; let headP; let carolP; let hrP; let types;
  const byCode = (c) => types.find((t) => t.code === c);

  beforeEach(async () => {
    // Clear rows but keep the indexes (the idempotency keys are what is under test).
    // Raw collection deletes: the ledger/audit models refuse deleteMany by design.
    const cols = await mongoose.connection.db.collections();
    await Promise.all(cols.map((c) => c.deleteMany({})));
    admin = await makeUser('Admin', 'admin');
    hr = await makeUser('Hema HR', 'staff', team('hr'));
    hr2 = await makeUser('Hari HR', 'staff', team('hr'));
    alice = await makeUser('Alice', 'staff', team('sales'));
    bob = await makeUser('Bob', 'staff', team('sales'));
    head = await makeUser('Sales Head', 'staff', team('sales', { isHead: true }));
    otherHead = await makeUser('Proc Head', 'staff', team('procurement', { isHead: true }));
    carol = await makeUser('Carol', 'staff', team('procurement'));
    customer = await makeUser('Shopper', 'customer');
    const mk = async (who, extra = {}) => (await hr.agent.post('/api/v1/hr/employees').send({ name: who.user.name, user: who.id, joinDate: '2025-01-01', ...extra })).body.employee;
    aliceP = await mk(alice);
    bobP = await mk(bob);
    headP = await mk(head);
    carolP = await mk(carol);
    hrP = await mk(hr);
    // Test types: no notice so dates are free; SL has the sandwich rule.
    for (const t of [
      { code: 'CL', name: 'Casual', annualQuotaHalfDays: 16 },
      { code: 'SL', name: 'Sick', annualQuotaHalfDays: 12, sandwich: true },
      { code: 'EL', name: 'Earned', annualQuotaHalfDays: 24, accrual: 'monthly', carryForwardMaxHalfDays: 10 },
      { code: 'LOP', name: 'Unpaid', paid: false, allowNegative: true },
    ]) {
      const r = await hr.agent.post('/api/v1/hr/leave-types').send(t);
      expect(r.status).toBe(201);
    }
    types = (await hr.agent.get('/api/v1/hr/leave-types')).body.items;
    expect((await hr.agent.post('/api/v1/hr/leave/grants').send({ year: 2027 })).status).toBe(200);
  });

  const apply = (who, body) => who.agent.post('/api/v1/hr/me/leave').send({ clientRequestId: cid(), leaveType: byCode('CL').id, ...body });
  const balanceOf = async (who, code, year = 2027) => {
    const r = await who.agent.get(`/api/v1/hr/me/leave/balances?year=${year}`);
    return r.body.items.find((i) => i.leaveType.code === code);
  };
  const approveAll = async (reqBody) => {
    let r = reqBody;
    if (r.status === 'pending_head') r = (await head.agent.post(`/api/v1/hr/leave/${r.id}/decide`).send({ decision: 'approved', rev: r.rev })).body.request;
    const fin = await hr.agent.post(`/api/v1/hr/leave/${r.id}/decide`).send({ decision: 'approved', rev: r.rev });
    expect(fin.status).toBe(200);
    return fin.body.request;
  };

  describe('authentication', () => {
    test('no token → 401; a revoked session → 401, never 200', async () => {
      for (const p of ['/api/v1/hr/me/leave', '/api/v1/hr/leave/inbox', '/api/v1/hr/holidays?year=2027', `/api/v1/hr/employees/${aliceP.id}/leave/balances`, '/api/v1/hr/leave-types']) {
        expect((await request(server).get(p)).status).toBe(401);
      }
      await User.updateOne({ _id: alice.user._id }, { $inc: { sessionVersion: 1 } });
      expect((await alice.agent.get('/api/v1/hr/me/leave/balances')).status).toBe(401);
      expect((await alice.agent.post('/api/v1/hr/me/leave').send({})).status).toBe(401);
    });
  });

  describe('leave types', () => {
    test('only HR/admin create and edit; employees see active ones; customers none', async () => {
      expect((await alice.agent.post('/api/v1/hr/leave-types').send({ code: 'X', name: 'X' })).status).toBe(403);
      expect((await head.agent.post('/api/v1/hr/leave-types/seed-defaults')).status).toBe(403);
      expect((await customer.agent.get('/api/v1/hr/leave-types')).status).toBe(403);
      const cl = byCode('CL');
      expect((await hr.agent.patch(`/api/v1/hr/leave-types/${cl.id}`).send({ rev: cl.rev, active: false })).status).toBe(200);
      const seen = (await alice.agent.get('/api/v1/hr/leave-types')).body.items.map((t) => t.code);
      expect(seen).not.toContain('CL');
      expect((await hr.agent.get('/api/v1/hr/leave-types')).body.items.map((t) => t.code)).toContain('CL');
    });

    test('duplicate code → 409; stale rev → 409; the code itself can never be changed', async () => {
      expect((await hr.agent.post('/api/v1/hr/leave-types').send({ code: 'cl', name: 'Again' })).status).toBe(409);
      const cl = byCode('CL');
      expect((await hr.agent.patch(`/api/v1/hr/leave-types/${cl.id}`).send({ rev: cl.rev, name: 'Casual leave' })).status).toBe(200);
      expect((await admin.agent.patch(`/api/v1/hr/leave-types/${cl.id}`).send({ rev: cl.rev, name: 'Other' })).status).toBe(409);
      await hr.agent.patch(`/api/v1/hr/leave-types/${cl.id}`).send({ rev: cl.rev + 1, code: 'ZZ', minNoticeDays: 1 });
      expect((await LeaveType.findById(cl.id).lean()).code).toBe('CL');
    });

    test('seed-defaults creates only the missing defaults and is idempotent, even pressed twice at once', async () => {
      const [a, b] = await Promise.all([
        hr.agent.post('/api/v1/hr/leave-types/seed-defaults'),
        admin.agent.post('/api/v1/hr/leave-types/seed-defaults'),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      // CL/SL/EL/LOP exist already from beforeEach, so nothing new.
      expect(await LeaveType.countDocuments()).toBe(4);
      await LeaveType.deleteMany({});
      const fresh = await hr.agent.post('/api/v1/hr/leave-types/seed-defaults');
      expect(fresh.body.created.map((t) => t.code).sort()).toEqual(['CL', 'EL', 'LOP', 'SL']);
      expect(fresh.body.types.find((t) => t.code === 'EL')).toMatchObject({ annualQuotaHalfDays: 24, carryForwardMaxHalfDays: 60 });
      expect((await hr.agent.post('/api/v1/hr/leave-types/seed-defaults')).body.created).toEqual([]);
      expect(await LeaveType.countDocuments()).toBe(4);
    });
  });

  describe('grants and balances', () => {
    test('the yearly grant is one row per employee/type/year, however often it runs', async () => {
      await hr.agent.post('/api/v1/hr/leave/grants').send({ year: 2027 });
      await Promise.all([leaveApi.yearlyGrant(2027), leaveApi.yearlyGrant(2027)]);
      const rows = await LeaveLedgerEntry.find({ employee: aliceP.id, year: 2027, reason: 'grant' }).lean();
      expect(rows).toHaveLength(2); // CL + SL (EL is monthly, LOP has no quota)
      expect(await balanceOf(alice, 'CL')).toMatchObject({ granted: 16, balance: 16, available: 16, used: 0 });
    });

    test('a joiner during the year is pro-rated', async () => {
      const late = await makeUser('Late Joiner', 'staff', team('sales'));
      await hr.agent.post('/api/v1/hr/employees').send({ name: 'Late', user: late.id, joinDate: '2027-07-20' });
      await hr.agent.post('/api/v1/hr/leave/grants').send({ year: 2027 });
      expect(await balanceOf(late, 'CL')).toMatchObject({ granted: 6 });
    });

    test('monthly accrual: idempotent per month, skips months before joining', async () => {
      await hr.agent.post('/api/v1/hr/leave/grants').send({ month: '2027-01' });
      await hr.agent.post('/api/v1/hr/leave/grants').send({ month: '2027-01' });
      await hr.agent.post('/api/v1/hr/leave/grants').send({ month: '2027-02' });
      expect(await balanceOf(alice, 'EL')).toMatchObject({ granted: 4 });
      expect((await hr.agent.post('/api/v1/hr/leave/grants').send({ month: '2027-13' })).status).toBe(400);
    });

    test('HR adjustment needs a reason, is idempotent on clientRequestId, and cannot push a paid type below zero', async () => {
      const url = `/api/v1/hr/employees/${aliceP.id}/leave/adjust`;
      expect((await hr.agent.post(url).send({ leaveType: byCode('CL').id, year: 2027, deltaHalfDays: 2 })).status).toBe(400);
      const body = { leaveType: byCode('CL').id, year: 2027, deltaHalfDays: 2, reason: 'comp off for Diwali sale', clientRequestId: 'adj-12345678' };
      const [a, b] = await Promise.all([hr.agent.post(url).send(body), hr.agent.post(url).send(body)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(await LeaveLedgerEntry.countDocuments({ employee: aliceP.id, reason: 'adjust' })).toBe(1);
      expect(await balanceOf(alice, 'CL')).toMatchObject({ balance: 18, adjusted: 2 });
      const neg = await hr.agent.post(url).send({ leaveType: byCode('CL').id, year: 2027, deltaHalfDays: -40, reason: 'correction' });
      expect(neg.status).toBe(422);
      expect((await alice.agent.post(url).send(body)).status).toBe(403);
      expect(await HrAuditLog.countDocuments({ action: 'leave.balance_adjusted' })).toBe(1);
    });

    test('year-end: carry the balance up to the cap into next year, lapse the rest; running it twice changes nothing', async () => {
      for (let m = 1; m <= 12; m += 1) await leaveApi.monthlyGrant(`2027-${String(m).padStart(2, '0')}`);
      expect(await balanceOf(alice, 'EL')).toMatchObject({ balance: 24 });
      const first = await hr.agent.post('/api/v1/hr/leave/year-end').send({ year: 2027 });
      expect(first.status).toBe(200);
      await hr.agent.post('/api/v1/hr/leave/year-end').send({ year: 2027 });
      expect(await balanceOf(alice, 'EL')).toMatchObject({ balance: 0, carriedOut: 10, lapsed: 14 });
      expect(await balanceOf(alice, 'EL', 2028)).toMatchObject({ balance: 10, carriedIn: 10 });
      // CL has no carry: all 16 lapse.
      expect(await balanceOf(alice, 'CL')).toMatchObject({ balance: 0, lapsed: 16 });
      expect(await LeaveLedgerEntry.countDocuments({ employee: aliceP.id, key: /^cf-in:/ })).toBe(1);
    });
  });

  describe('applying', () => {
    test('the server computes the days; a client-sent count is ignored', async () => {
      const r = await apply(alice, { from: '2027-03-01', to: '2027-03-08', halfDays: 1 });
      expect(r.status).toBe(201);
      expect(r.body.request).toMatchObject({ halfDays: 14, year: 2027, status: 'pending_head', approver: head.id });
      const stored = await LeaveRequest.findById(r.body.request.id).lean();
      expect(stored.days).toHaveLength(7); // Sunday 03-07 not charged
    });

    test('the employee\'s shift weekly offs and their site\'s holidays are used', async () => {
      const shift = await HrShift.create({ name: 'Sat-Sun off', start: '10:00', end: '19:00', weeklyOff: [0, 6], createdBy: admin.user._id });
      const site = new mongoose.Types.ObjectId();
      await EmployeeProfile.updateOne({ _id: aliceP.id }, { $set: { shift: shift._id, workSites: [site] } });
      await hr.agent.post('/api/v1/hr/holidays').send({ date: '2027-03-02', name: 'Store day', sites: [String(site)] });
      await hr.agent.post('/api/v1/hr/holidays').send({ date: '2027-03-03', name: 'Other site', sites: [String(new mongoose.Types.ObjectId())] });
      const r = await apply(alice, { from: '2027-03-01', to: '2027-03-08' });
      // Mon, Wed, Thu, Fri, Mon — Tue is her site's holiday, Sat/Sun off; Wed's holiday is another site's.
      expect(r.body.request.halfDays).toBe(10);
    });

    test('double submit — sequential or at the same moment — makes ONE request', async () => {
      const body = { clientRequestId: 'tap-twice-001', leaveType: byCode('CL').id, from: '2027-04-05', to: '2027-04-05' };
      const [a, b] = await Promise.all([alice.agent.post('/api/v1/hr/me/leave').send(body), alice.agent.post('/api/v1/hr/me/leave').send(body)]);
      const c = await alice.agent.post('/api/v1/hr/me/leave').send(body);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(c.status).toBe(200);
      expect(c.body.replay).toBe(true);
      expect(new Set([a.body.request.id, b.body.request.id, c.body.request.id]).size).toBe(1);
      expect(await LeaveRequest.countDocuments({ employee: aliceP.id })).toBe(1);
    });

    test('overlapping live requests are refused — also two different ones racing', async () => {
      expect((await apply(alice, { from: '2027-04-05', to: '2027-04-07' })).status).toBe(201);
      const clash = await apply(alice, { from: '2027-04-07', to: '2027-04-08' });
      expect(clash.status).toBe(409);
      const race = await Promise.all([
        apply(alice, { from: '2027-05-03', to: '2027-05-04' }),
        apply(alice, { from: '2027-05-04', to: '2027-05-05' }),
      ]);
      expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
      // Bob's dates are his own business.
      expect((await apply(bob, { from: '2027-04-05', to: '2027-04-07' })).status).toBe(201);
    });

    test('a paid type cannot go below zero (pending requests reserve days); LOP can', async () => {
      expect((await apply(alice, { from: '2027-03-01', to: '2027-03-06' })).status).toBe(201); // 12 of 16
      const over = await apply(alice, { from: '2027-03-15', to: '2027-03-17' }); // 6 > 4 left
      expect(over.status).toBe(422);
      expect(over.body.message).toMatch(/Not enough/);
      expect((await apply(alice, { from: '2027-03-15', to: '2027-03-16' })).status).toBe(201); // exactly 4
      const lop = await apply(alice, { leaveType: byCode('LOP').id, from: '2027-06-01', to: '2027-06-10' });
      expect(lop.status).toBe(201);
      expect(lop.body.request.paid).toBe(false);
    });

    test('bad input is refused with a reason', async () => {
      const cases = [
        [{ from: '2027-02-30', to: '2027-03-01' }, 400],
        [{ from: '2027-03-05', to: '2027-03-01' }, 400],
        [{ from: '2027-12-30', to: '2028-01-03' }, 400],
        [{ from: '2027-03-01', to: '2027-03-01', firstHalfOnly: true, secondHalfOnly: true }, 400],
        [{ from: '2027-03-07', to: '2027-03-07' }, 422], // only a Sunday
        [{ clientRequestId: 'x' }, 400],
        [{ leaveType: 'nope' }, 400],
        [{ from: '2027-01-01', to: '2027-03-15' }, 400], // > 62 days
      ];
      for (const [body, status] of cases) {
        const r = await apply(alice, { from: '2027-03-01', to: '2027-03-01', ...body });
        expect([body, r.status]).toEqual([body, status]);
      }
      expect(await LeaveRequest.countDocuments()).toBe(0);
    });

    test('minimum notice applies to the employee, not to HR applying on their behalf', async () => {
      const cl = byCode('CL');
      await hr.agent.patch(`/api/v1/hr/leave-types/${cl.id}`).send({ rev: cl.rev, minNoticeDays: 3 });
      const today = calendar.istToday();
      const tomorrow = calendar.addDays(today, 1);
      if (calendar.yearOf(tomorrow) !== calendar.yearOf(today)) return; // 31 Dec: nothing to prove today
      await leaveApi.yearlyGrant(calendar.yearOf(today));
      const own = await apply(alice, { from: tomorrow, to: tomorrow });
      expect(own.status).toBe(422);
      expect(own.body.message).toMatch(/notice/);
      const byHr = await hr.agent.post(`/api/v1/hr/employees/${aliceP.id}/leave`).send({ clientRequestId: cid(), leaveType: cl.id, from: tomorrow, to: tomorrow });
      if (calendar.weekdayOf(tomorrow) === 0) expect(byHr.status).toBe(422);
      else expect(byHr.body.request).toMatchObject({ status: 'pending_hr', requestedBy: hr.id });
    });

    test('a customer or someone with no HR profile cannot apply', async () => {
      expect((await apply(customer, { from: '2027-03-01', to: '2027-03-01' })).status).toBe(404);
      expect((await apply(otherHead, { from: '2027-03-01', to: '2027-03-01' })).status).toBe(404);
    });
  });

  describe('approval chain', () => {
    test('head → HR → approved writes one ledger use row and the audit, and the balance drops', async () => {
      const r = (await apply(alice, { from: '2027-03-01', to: '2027-03-02' })).body.request;
      expect((await head.agent.get('/api/v1/hr/leave/inbox')).body.items.map((i) => i.id)).toEqual([r.id]);
      expect((await hr.agent.get('/api/v1/hr/leave/inbox')).body.items).toEqual([]);
      const h = await head.agent.post(`/api/v1/hr/leave/${r.id}/decide`).send({ decision: 'approved', rev: r.rev });
      expect(h.body.request).toMatchObject({ status: 'pending_hr', approver: null });
      expect((await hr.agent.get('/api/v1/hr/leave/inbox')).body.items[0]).toMatchObject({ id: r.id, employeeName: 'Alice', leaveTypeCode: 'CL' });
      // Approved twice at the same moment by two HR people: one wins, ONE ledger row.
      const [x, y] = await Promise.all([
        hr.agent.post(`/api/v1/hr/leave/${r.id}/decide`).send({ decision: 'approved', rev: h.body.request.rev }),
        hr2.agent.post(`/api/v1/hr/leave/${r.id}/decide`).send({ decision: 'approved', rev: h.body.request.rev }),
      ]);
      expect([x.status, y.status].sort()).toEqual([200, 409]);
      // Same person clicking again → 200 replay, still one row.
      const winner = x.status === 200 ? hr : hr2;
      const again = await winner.agent.post(`/api/v1/hr/leave/${r.id}/decide`).send({ decision: 'approved', rev: h.body.request.rev });
      expect(again.status).toBe(200);
      expect(again.body.replay).toBe(true);
      expect(await LeaveLedgerEntry.countDocuments({ request: r.id, reason: 'use' })).toBe(1);
      expect(await balanceOf(alice, 'CL')).toMatchObject({ used: 4, balance: 12, pending: 0 });
      expect(await HrAuditLog.countDocuments({ entityId: r.id, action: /^leave\.(head|hr)_approved$/ })).toBe(2);
      expect(await leaveApi.leaveDaysInRange(aliceP.id, '2027-03-01', '2027-03-31')).toEqual([
        { date: '2027-03-01', halves: 2, paid: true, leaveType: byCode('CL').id, requestId: r.id },
        { date: '2027-03-02', halves: 2, paid: true, leaveType: byCode('CL').id, requestId: r.id },
      ]);
    });

    test('a head\'s own leave skips the head step; so does everyone when headStep is off', async () => {
      const own = (await apply(head, { from: '2027-03-01', to: '2027-03-01' })).body.request;
      expect(own).toMatchObject({ status: 'pending_hr', approver: null });
      const settings = (await hr.agent.get('/api/v1/hr/settings')).body.settings;
      expect((await hr.agent.patch('/api/v1/hr/settings').send({ rev: settings.rev, leaveHeadStep: false })).status).toBe(200);
      expect((await apply(alice, { from: '2027-03-03', to: '2027-03-03' })).body.request.status).toBe('pending_hr');
      // A team with no head goes straight to HR.
      const solo = await makeUser('Solo', 'staff', team('marketing'));
      await hr.agent.post('/api/v1/hr/employees').send({ name: 'Solo', user: solo.id, joinDate: '2025-01-01' });
      await leaveApi.yearlyGrant(2027);
      await hr.agent.patch('/api/v1/hr/settings').send({ rev: settings.rev + 1, leaveHeadStep: true });
      expect((await apply(solo, { from: '2027-03-03', to: '2027-03-03' })).body.request.status).toBe('pending_hr');
    });

    test('who may decide: not the employee, not another team\'s head, not HR on their own leave', async () => {
      const r = (await apply(alice, { from: '2027-03-01', to: '2027-03-01' })).body.request;
      for (const who of [alice, bob, otherHead, customer]) {
        expect((await who.agent.post(`/api/v1/hr/leave/${r.id}/decide`).send({ decision: 'approved', rev: r.rev })).status).toBe(404);
      }
      const hrOwn = (await apply(hr, { from: '2027-03-01', to: '2027-03-01' })).body.request;
      expect((await hr.agent.post(`/api/v1/hr/leave/${hrOwn.id}/decide`).send({ decision: 'approved', rev: hrOwn.rev })).status).toBe(403);
      expect((await hr2.agent.post(`/api/v1/hr/leave/${hrOwn.id}/decide`).send({ decision: 'approved', rev: hrOwn.rev })).status).toBe(200);
      expect((await otherHead.agent.get('/api/v1/hr/leave/inbox')).body.items).toEqual([]);
      expect((await alice.agent.get('/api/v1/hr/leave/inbox')).status).toBe(403);
    });

    test('stale rev → 409; reject needs a note and writes no ledger row', async () => {
      const r = (await apply(alice, { from: '2027-03-01', to: '2027-03-01' })).body.request;
      expect((await head.agent.post(`/api/v1/hr/leave/${r.id}/decide`).send({ decision: 'approved', rev: r.rev + 5 })).status).toBe(409);
      expect((await head.agent.post(`/api/v1/hr/leave/${r.id}/decide`).send({ decision: 'rejected', rev: r.rev })).status).toBe(400);
      const rej = await head.agent.post(`/api/v1/hr/leave/${r.id}/decide`).send({ decision: 'rejected', rev: r.rev, note: 'month-end closing' });
      expect(rej.body.request.status).toBe('rejected');
      expect((await hr.agent.post(`/api/v1/hr/leave/${r.id}/decide`).send({ decision: 'approved', rev: rej.body.request.rev })).status).toBe(409);
      expect(await LeaveLedgerEntry.countDocuments({ request: r.id })).toBe(0);
      // Rejected days are free again.
      expect((await apply(alice, { from: '2027-03-01', to: '2027-03-01' })).status).toBe(201);
    });

    test('final approval re-checks the balance (HR may have to adjust first)', async () => {
      const a = (await apply(alice, { from: '2027-03-01', to: '2027-03-06' })).body.request; // 12
      await hr.agent.post(`/api/v1/hr/employees/${aliceP.id}/leave/adjust`).send({ leaveType: byCode('CL').id, year: 2027, deltaHalfDays: -8, reason: 'opening balance fix' });
      const step = (await head.agent.post(`/api/v1/hr/leave/${a.id}/decide`).send({ decision: 'approved', rev: a.rev })).body.request;
      const fin = await hr.agent.post(`/api/v1/hr/leave/${a.id}/decide`).send({ decision: 'approved', rev: step.rev });
      expect(fin.status).toBe(422);
      expect((await LeaveRequest.findById(a.id).lean()).status).toBe('pending_hr');
      expect(await LeaveLedgerEntry.countDocuments({ request: a.id })).toBe(0);
    });
  });

  describe('cancelling', () => {
    test('cancel after approval restores the days once; cancelling twice is a no-op', async () => {
      const r = await approveAll((await apply(alice, { from: '2027-03-01', to: '2027-03-02' })).body.request);
      expect(await balanceOf(alice, 'CL')).toMatchObject({ balance: 12 });
      const [a, b] = await Promise.all([
        alice.agent.post(`/api/v1/hr/me/leave/${r.id}/cancel`).send({}),
        alice.agent.post(`/api/v1/hr/me/leave/${r.id}/cancel`).send({}),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(await LeaveLedgerEntry.countDocuments({ request: r.id, reason: 'restore' })).toBe(1);
      expect(await balanceOf(alice, 'CL')).toMatchObject({ balance: 16, used: 0 });
      expect(await leaveApi.leaveDaysInRange(aliceP.id, '2027-03-01', '2027-03-31')).toEqual([]);
    });

    test('someone else cannot cancel your leave (404); started leave needs HR', async () => {
      const r = (await apply(alice, { from: '2027-03-01', to: '2027-03-01' })).body.request;
      expect((await bob.agent.post(`/api/v1/hr/me/leave/${r.id}/cancel`).send({})).status).toBe(404);
      expect((await head.agent.post(`/api/v1/hr/leave/${r.id}/cancel`).send({})).status).toBe(403);
      // Backdated (sick-style) approved leave that already started: only HR cancels.
      const today = calendar.istToday();
      const y = calendar.yearOf(today);
      await leaveApi.yearlyGrant(y);
      let day = calendar.addDays(today, -1);
      if (calendar.weekdayOf(day) === 0) day = calendar.addDays(day, -1);
      if (calendar.yearOf(day) !== y) return;
      const past = (await apply(alice, { leaveType: byCode('SL').id, from: day, to: day })).body.request;
      const ok = await approveAll(past);
      expect((await alice.agent.post(`/api/v1/hr/me/leave/${ok.id}/cancel`).send({})).status).toBe(422);
      expect((await hr.agent.post(`/api/v1/hr/leave/${ok.id}/cancel`).send({ reason: 'came to work' })).status).toBe(200);
    });
  });

  describe('employee A cannot read employee B', () => {
    test('balances, list, ledger and a single request of another employee are 404 — same as a missing id', async () => {
      const r = (await apply(bob, { from: '2027-03-01', to: '2027-03-01' })).body.request;
      const missing = new mongoose.Types.ObjectId();
      for (const p of [`/employees/${bobP.id}/leave/balances`, `/employees/${bobP.id}/leave`, `/employees/${bobP.id}/leave/ledger`, `/leave/${r.id}`]) {
        const theirs = await alice.agent.get(`/api/v1/hr${p}`);
        expect([p, theirs.status]).toEqual([p, 404]);
        expect(theirs.body.items).toBeUndefined();
      }
      expect((await alice.agent.get(`/api/v1/hr/employees/${missing}/leave/balances`)).status).toBe(404);
      expect((await alice.agent.get(`/api/v1/hr/leave/${missing}`)).status).toBe(404);
      // Own data is fine.
      expect((await bob.agent.get(`/api/v1/hr/leave/${r.id}`)).body.request.days).toEqual([{ date: '2027-03-01', halves: 2 }]);
    });

    test('a head sees their own team\'s leave, not another team\'s', async () => {
      expect((await head.agent.get(`/api/v1/hr/employees/${aliceP.id}/leave/balances`)).status).toBe(200);
      expect((await head.agent.get(`/api/v1/hr/employees/${carolP.id}/leave/balances`)).status).toBe(404);
      expect((await otherHead.agent.get(`/api/v1/hr/employees/${aliceP.id}/leave`)).status).toBe(404);
      expect((await head.agent.post(`/api/v1/hr/employees/${aliceP.id}/leave/adjust`).send({})).status).toBe(403);
      expect((await head.agent.post(`/api/v1/hr/employees/${aliceP.id}/leave`).send({})).status).toBe(403);
    });
  });

  describe('lists', () => {
    test('own requests page by keyset with no repeats or gaps', async () => {
      const ids = [];
      for (let d = 1; d <= 5; d += 1) ids.push((await apply(alice, { leaveType: byCode('LOP').id, from: `2027-06-0${d}`, to: `2027-06-0${d}` })).body.request.id);
      const seen = [];
      let cursor = null;
      do {
        const r = await alice.agent.get(`/api/v1/hr/me/leave?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
        expect(r.body.items.length).toBeLessThanOrEqual(2);
        seen.push(...r.body.items.map((i) => i.id));
        cursor = r.body.nextCursor;
      } while (cursor);
      expect(seen).toEqual([...ids].reverse());
    });
  });

  describe('holidays', () => {
    test('HR creates and deletes; duplicates 409; staff read; customers and employees cannot write', async () => {
      const c = await hr.agent.post('/api/v1/hr/holidays').send({ date: '2027-10-29', name: 'Diwali' });
      expect(c.status).toBe(201);
      expect((await hr.agent.post('/api/v1/hr/holidays').send({ date: '2027-10-29', name: 'Diwali' })).status).toBe(409);
      expect((await hr.agent.post('/api/v1/hr/holidays').send({ date: '2027-02-30', name: 'Bad' })).status).toBe(400);
      expect((await alice.agent.post('/api/v1/hr/holidays').send({ date: '2027-11-01', name: 'X' })).status).toBe(403);
      expect((await customer.agent.get('/api/v1/hr/holidays?year=2027')).status).toBe(403);
      const list = await alice.agent.get('/api/v1/hr/holidays?year=2027');
      expect(list.body.items.map((h) => h.name)).toEqual(['Diwali']);
      expect((await alice.agent.delete(`/api/v1/hr/holidays/${c.body.holiday.id}`)).status).toBe(403);
      expect((await hr.agent.delete(`/api/v1/hr/holidays/${c.body.holiday.id}`)).status).toBe(200);
      expect((await hr.agent.delete(`/api/v1/hr/holidays/${c.body.holiday.id}`)).status).toBe(404);
      expect(await HrAuditLog.countDocuments({ action: /^holiday\./ })).toBe(2);
    });

    test('isHoliday respects site lists and ignores optional holidays', async () => {
      const s1 = new mongoose.Types.ObjectId();
      await hr.agent.post('/api/v1/hr/holidays').send({ date: '2027-01-26', name: 'Republic Day' });
      await hr.agent.post('/api/v1/hr/holidays').send({ date: '2027-04-14', name: 'Vishu', sites: [String(s1)] });
      await hr.agent.post('/api/v1/hr/holidays').send({ date: '2027-08-15', name: 'Pick one', optional: true });
      expect(await leaveApi.isHoliday('2027-01-26', [])).toBe(true);
      expect(await leaveApi.isHoliday('2027-04-14', [String(s1)])).toBe(true);
      expect(await leaveApi.isHoliday('2027-04-14', [String(new mongoose.Types.ObjectId())])).toBe(false);
      expect(await leaveApi.isHoliday('2027-08-15', [])).toBe(false);
      expect(await leaveApi.isHoliday('not-a-date', [])).toBe(false);
    });
  });
});
