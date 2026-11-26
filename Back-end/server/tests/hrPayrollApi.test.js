/**
 * HR payroll API (docs/ADR-hr-system.md §4 Payroll) — the money path.
 *
 * What must hold:
 *   - salary rows: HR/admin add; same month twice = one row; employees read only
 *     their own; a team head or another employee gets 404
 *   - one run per month, even when "prepare" is clicked several times at once
 *   - money figures in a request body are ignored; the server computes everything
 *   - draft → locked (HR) → approved (ADMIN only); a locked run can't be
 *     recomputed or adjusted; stale rev → 409; inputs changed since computing → 409
 *   - locking flags the month's AttendanceDays payrollLocked
 *   - approve twice (also in parallel, also by two admins) → ONE PaymentRequest
 *     per employee
 *   - payslips are visible to the employee only after approval, only their own
 *     (404 otherwise), and download as PDF
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

// The attendance summary is the parallel session's function: payroll is tested
// against the contract shape. Lock/unlock use the REAL attendance exports.
const summaries = new Map();
const fullMonth = () => ({
  daysInMonth: 31, payableDays: 31, lopDays: 0, marks: 0, marksLopDays: 0, lateCount: 0, earlyCount: 0,
  otApprovedMinutes: 0, absentUnapproved: 0, unresolvedDays: 0, shiftMinutes: 540,
});
jest.unstable_mockModule('../services/hr/payroll/attendanceSource.js', async () => {
  const real = await import('../services/hr/attendance/index.js');
  return {
    monthAttendanceSummary: async (employeeId) => ({ ...fullMonth(), ...(summaries.get(String(employeeId)) || {}) }),
    markMonthLocked: real.markMonthLocked,
    markMonthUnlocked: real.markMonthUnlocked,
  };
});

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const { default: User } = await import('../models/User.js');
const { default: EmployeeProfile } = await import('../models/hr/EmployeeProfile.js');
const { default: AttendanceDay } = await import('../models/hr/AttendanceDay.js');
const { default: PayrollRun } = await import('../models/hr/PayrollRun.js');
const { default: Payslip } = await import('../models/hr/Payslip.js');
const { default: PayrollAdjustment } = await import('../models/hr/PayrollAdjustment.js');
const { default: SalaryStructure } = await import('../models/hr/SalaryStructure.js');
const { default: PaymentRequest } = await import('../models/PaymentRequest.js');
const { loadHrModels } = await import('../scripts/create-hr-indexes.js');

const PW = 'SecurePass123!';
const MONTH = '2025-10'; // a past month whatever the clock says (31 days)
const R = (rupees) => Math.round(rupees * 100);
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
  };
}
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase().replace(/\s/g, '')}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, agent: await signIn(email), id: String(user._id) };
};
const team = (t, x = {}) => ({ team: t, active: true, ...x });
const salary = (basic, hra, special, x = {}) => ({
  effectiveFrom: '2025-01', reason: 'Joining salary',
  components: [
    { code: 'basic', label: 'Basic', monthlyPaise: R(basic) },
    { code: 'hra', label: 'HRA', monthlyPaise: R(hra) },
    { code: 'special', label: 'Special', monthlyPaise: R(special) },
  ],
  ...x,
});

describe('HR payroll API', () => {
  beforeAll(async () => {
    await dbHandler.connect();
    await Promise.all((await loadHrModels()).map((M) => M.init()));
    await PaymentRequest.init();
  });
  afterAll(async () => {
    await new Promise((resolve) => { server.close(resolve); });
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  let admin; let admin2; let hr; let alice; let bob; let head; let customer;
  let aliceP; let bobP;

  beforeEach(async () => {
    const cols = await mongoose.connection.db.collections();
    await Promise.all(cols.map((c) => c.deleteMany({})));
    summaries.clear();
    admin = await makeUser('Admin', 'admin');
    admin2 = await makeUser('Second Admin', 'admin');
    hr = await makeUser('Hema HR', 'staff', team('hr'));
    alice = await makeUser('Alice', 'staff', team('sales'));
    bob = await makeUser('Bob', 'staff', team('sales'));
    head = await makeUser('Sales Head', 'staff', team('sales', { isHead: true }));
    customer = await makeUser('Shopper', 'customer');
    const mk = async (who) => {
      const r = await hr.agent.post('/api/v1/hr/employees').send({ name: who.user.name, user: who.id, joinDate: '2024-01-01' });
      expect(r.status).toBe(201);
      return r.body.employee;
    };
    aliceP = await mk(alice);
    bobP = await mk(bob);
    await mk(head);
    await EmployeeProfile.updateMany({}, { $set: { status: 'active' } });
  });

  const addSalary = async (emp, body, who = hr) => who.agent.post(`/api/v1/hr/employees/${emp.id}/salary`).send(body);
  const run = async () => (await hr.agent.get(`/api/v1/hr/payroll/${MONTH}`)).body.run;
  const slipOf = (r, emp) => r.payslips.find((p) => p.employee === emp.id);
  /** Alice ₹31,000, Bob ₹31,000 → one day in October = ₹1,000. */
  const setUpPaidMonth = async () => {
    expect((await addSalary(aliceP, salary(15500, 6200, 9300))).status).toBe(201);
    expect((await addSalary(bobP, salary(15500, 6200, 9300))).status).toBe(201);
    summaries.set(aliceP.id, { lopDays: 2, absentUnapproved: 2, marks: 4, lateCount: 3, earlyCount: 1, marksLopDays: 0.5, otApprovedMinutes: 120 });
  };
  const prepareAndLock = async () => {
    expect((await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/prepare`).send({})).status).toBe(201);
    const r = await run();
    const locked = await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/lock`).send({ rev: r.rev });
    expect([locked.status, locked.body.message]).toEqual([200, undefined]);
    return locked.body.run;
  };

  describe('auth', () => {
    test('no token → 401 on payroll and payslip routes', async () => {
      for (const p of ['/api/v1/hr/me/payslips', `/api/v1/hr/payroll/${MONTH}`, '/api/v1/hr/payroll', `/api/v1/hr/employees/${aliceP.id}/salary`]) {
        expect((await request(server).get(p)).status).toBe(401);
      }
    });
    test('a revoked session → 401, never 200', async () => {
      await User.updateOne({ _id: alice.user._id }, { $inc: { sessionVersion: 1 } });
      expect((await alice.agent.get('/api/v1/hr/me/payslips')).status).toBe(401);
    });
  });

  describe('salary structures', () => {
    test('HR adds; the same month twice is one row; different figures for that month → 409', async () => {
      const a = await addSalary(aliceP, salary(15000, 6000, 9000));
      expect(a.status).toBe(201);
      expect(a.body.structure.grossMonthlyPaise).toBe(R(30000));
      const again = await addSalary(aliceP, salary(15000, 6000, 9000));
      expect([again.status, again.body.replay]).toEqual([200, true]);
      const [p1, p2] = await Promise.all([addSalary(bobP, salary(1, 1, 1)), addSalary(bobP, salary(1, 1, 1))]);
      expect([p1.status, p2.status].sort()).toEqual([200, 201]);
      expect(await SalaryStructure.countDocuments({ employee: bobP.id })).toBe(1);
      expect((await addSalary(aliceP, salary(16000, 6000, 9000))).status).toBe(409);
      expect((await addSalary(aliceP, salary(16000, 6000, 9000, { effectiveFrom: '2025-04', reason: 'Raise' }))).status).toBe(201);
    });
    test('the employee sees their own salary; another employee, a head and a customer do not', async () => {
      await addSalary(aliceP, salary(15000, 6000, 9000));
      const mine = await alice.agent.get('/api/v1/hr/me/salary');
      expect(mine.status).toBe(200);
      expect(mine.body.items).toHaveLength(1);
      expect((await alice.agent.get(`/api/v1/hr/employees/${aliceP.id}/salary`)).status).toBe(200);
      expect((await bob.agent.get(`/api/v1/hr/employees/${aliceP.id}/salary`)).status).toBe(404);
      expect((await head.agent.get(`/api/v1/hr/employees/${aliceP.id}/salary`)).status).toBe(404);
      expect([403, 404]).toContain((await customer.agent.get(`/api/v1/hr/employees/${aliceP.id}/salary`)).status);
      expect((await addSalary(aliceP, salary(99999, 1, 1, { effectiveFrom: '2025-05' }), alice)).status).toBe(403);
    });
  });

  describe('a month, start to finish', () => {
    test('prepare ignores client totals and computes the worked example', async () => {
      await setUpPaidMonth();
      const p = await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/prepare`)
        .send({ grossPaise: 1, netPaise: 99999999, totals: { netPaise: 1 }, payslips: [{ employee: aliceP.id, netPaise: 1 }] });
      expect(p.status).toBe(201);
      const r = p.body.run;
      expect(r.status).toBe('draft');
      expect(r.employeeCount).toBe(2);
      // Head has no salary row: left out, and said so.
      expect(r.skipped.map((s) => s.reason)).toEqual(['No salary set for this month']);
      const a = await Payslip.findById(slipOf(r, aliceP).id).lean();
      const line = (c) => a.lines.find((l) => l.code === c)?.amountPaise;
      expect(line('lop')).toBe(R(2000)); // 2 × ₹31,000 ÷ 31
      expect(line('marks_lop')).toBe(R(500));
      expect(line('overtime')).toBe(44444); // 120/60 × (31,000 ÷ 31 ÷ 9) × 2
      expect(line('punctuality_bonus')).toBe(0);
      expect(line('pf')).toBe(R(1710)); // 12% of basic earned: ₹15,500 × 28.5/31 = ₹14,250
      expect(a.netPaise).toBe(a.grossPaise - a.deductionsPaise);
      expect(a.snapshot).toMatchObject({ name: 'Alice', employeeCode: aliceP.employeeCode });
      const b = slipOf(r, bobP);
      // Bob: full month + ₹500 bonus − PF ₹1,800 (ceiling ₹15,000).
      expect(b.netPaise).toBe(R(31000) + R(500) - R(1800));
      expect(r.totals.netPaise).toBe(a.netPaise + b.netPaise);
    });

    test('the same month prepared many times (also at once) is ONE run with one payslip each', async () => {
      await setUpPaidMonth();
      const results = await Promise.all([1, 2, 3].map(() => hr.agent.post(`/api/v1/hr/payroll/${MONTH}/prepare`).send({})));
      expect(results.every((x) => [200, 201].includes(x.status))).toBe(true);
      const again = await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/prepare`).send({});
      expect([again.status, again.body.created]).toEqual([200, false]);
      expect(await PayrollRun.countDocuments({ month: MONTH })).toBe(1);
      expect(await Payslip.countDocuments({ month: MONTH })).toBe(2);
    });

    test('a month that has not ended cannot be prepared', async () => {
      expect((await hr.agent.post('/api/v1/hr/payroll/2099-01/prepare').send({})).status).toBe(400);
      expect((await hr.agent.post('/api/v1/hr/payroll/2025-13/prepare').send({})).status).toBe(400);
    });

    test('only HR/admin run payroll; only ADMIN approves', async () => {
      await setUpPaidMonth();
      expect((await alice.agent.post(`/api/v1/hr/payroll/${MONTH}/prepare`).send({})).status).toBe(403);
      expect((await head.agent.get(`/api/v1/hr/payroll/${MONTH}`)).status).toBe(403);
      const locked = await prepareAndLock();
      expect((await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/approve`).send({ rev: locked.rev })).status).toBe(403);
      expect((await alice.agent.post(`/api/v1/hr/payroll/${MONTH}/approve`).send({ rev: locked.rev })).status).toBe(403);
      expect((await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/payouts`).send({})).status).toBe(403);
      expect(await PaymentRequest.countDocuments({})).toBe(0);
    });

    test('lock flags attendance; a locked run cannot be recomputed or adjusted', async () => {
      await setUpPaidMonth();
      await AttendanceDay.create({ employee: aliceP.id, date: '2025-10-06', month: MONTH, status: 'present' });
      const draft = (await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/prepare`).send({})).body.run;
      expect((await admin.agent.post(`/api/v1/hr/payroll/${MONTH}/approve`).send({ rev: draft.rev })).status).toBe(409); // not locked
      expect((await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/lock`).send({ rev: draft.rev + 5 })).status).toBe(409); // stale
      const locked = await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/lock`).send({ rev: draft.rev });
      expect(locked.status).toBe(200);
      expect((await AttendanceDay.findOne({ employee: aliceP.id, date: '2025-10-06' }).lean()).payrollLocked).toBe(true);
      const rev = locked.body.run.rev;
      expect((await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/recompute`).send({ rev })).status).toBe(409);
      expect((await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/adjustments`).send({ employeeId: aliceP.id, kind: 'bonus', amountPaise: 100, reason: 'late add' })).status).toBe(409);
      // Unlock needs a reason, then attendance is unflagged.
      expect((await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/unlock`).send({ rev })).status).toBe(400);
      const un = await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/unlock`).send({ rev, reason: 'Bob joined late, recheck' });
      expect([un.status, un.body.run.status]).toEqual([200, 'draft']);
      expect((await AttendanceDay.findOne({ employee: aliceP.id, date: '2025-10-06' }).lean()).payrollLocked).toBe(false);
    });

    test('approve twice — also at once, also by two admins — raises ONE payment request per employee', async () => {
      await setUpPaidMonth();
      const locked = await prepareAndLock();
      expect((await admin.agent.post(`/api/v1/hr/payroll/${MONTH}/approve`).send({ rev: locked.rev + 1 })).status).toBe(409); // stale rev
      const [x, y, z] = await Promise.all([
        admin.agent.post(`/api/v1/hr/payroll/${MONTH}/approve`).send({ rev: locked.rev }),
        admin2.agent.post(`/api/v1/hr/payroll/${MONTH}/approve`).send({ rev: locked.rev }),
        admin.agent.post(`/api/v1/hr/payroll/${MONTH}/payouts`).send({}),
      ]);
      expect([x.status, y.status, z.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(2);
      const again = await admin.agent.post(`/api/v1/hr/payroll/${MONTH}/approve`).send({ rev: locked.rev });
      expect([again.status, again.body.replay, again.body.payouts.created]).toEqual([200, true, 0]);
      await admin2.agent.post(`/api/v1/hr/payroll/${MONTH}/payouts`).send({});

      const reqs = await PaymentRequest.find({}).lean();
      expect(reqs).toHaveLength(2);
      const r = await run();
      expect(r.status).toBe('approved');
      expect(r.payoutsCount).toBe(2);
      for (const p of r.payslips) {
        const pr = reqs.find((q) => String(q._id) === p.payoutRequest);
        expect(pr).toMatchObject({ kind: 'expense', category: 'salary', team: 'hr', status: 'submitted', amount: p.netPaise / 100 });
        // Month and payslip number only — never the breakdown.
        expect(pr.description).toBe(`Salary ${MONTH} — payslip PS-${MONTH}-${p.employeeCode}`);
      }
      // Re-open after payment requests exist is refused (correct next month instead).
      expect((await admin.agent.post(`/api/v1/hr/payroll/${MONTH}/reopen`).send({ rev: r.rev, reason: 'oops wrong' })).status).toBe(409);
    });

    test('inputs that move after computing block lock and approval until recomputed', async () => {
      await setUpPaidMonth();
      const draft = (await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/prepare`).send({})).body.run;
      // An adjustment after computing: lock refuses.
      const adj = await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/adjustments`).send({ employeeId: bobP.id, kind: 'bonus', amountPaise: R(1000), reason: 'Diwali' });
      expect(adj.status).toBe(201);
      expect((await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/lock`).send({ rev: draft.rev })).status).toBe(409);
      const re = await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/recompute`).send({ rev: draft.rev });
      expect(re.status).toBe(200);
      expect(slipOf(re.body.run, bobP).grossPaise).toBe(R(31000) + R(500) + R(1000));
      const locked = await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/lock`).send({ rev: re.body.run.rev });
      expect(locked.status).toBe(200);
      // Attendance changes after lock: approve refuses.
      summaries.set(aliceP.id, { ...summaries.get(aliceP.id), otApprovedMinutes: 600 });
      const ap = await admin.agent.post(`/api/v1/hr/payroll/${MONTH}/approve`).send({ rev: locked.body.run.rev });
      expect(ap.status).toBe(409);
      expect(ap.body.message).toMatch(/Recompute/);
      expect(await PaymentRequest.countDocuments({})).toBe(0);
    });

    test('deductions above earnings block the lock', async () => {
      await setUpPaidMonth();
      await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/adjustments`).send({ employeeId: bobP.id, kind: 'advance_recovery', amountPaise: R(90000), reason: 'Advance' });
      const draft = (await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/prepare`).send({})).body.run;
      expect(draft.blockedCount).toBe(1);
      expect(slipOf(draft, bobP)).toMatchObject({ netPaise: 0, warnings: ['deductions_exceed_earnings'] });
      expect((await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/lock`).send({ rev: draft.rev })).status).toBe(409);
    });

    test('an adjustment submitted twice is saved once; cancel is idempotent', async () => {
      const body = { employeeId: aliceP.id, kind: 'bonus', amountPaise: R(750), reason: 'Referral', clientRequestId: 'adj-123456' };
      const [a, b] = await Promise.all([
        hr.agent.post(`/api/v1/hr/payroll/${MONTH}/adjustments`).send(body),
        hr.agent.post(`/api/v1/hr/payroll/${MONTH}/adjustments`).send(body),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(await PayrollAdjustment.countDocuments({})).toBe(1);
      const id = a.body.adjustment.id;
      expect((await hr.agent.post(`/api/v1/hr/adjustments/${id}/cancel`).send({ reason: 'dup' })).body.adjustment.cancelled).toBe(true);
      expect((await hr.agent.post(`/api/v1/hr/adjustments/${id}/cancel`).send({})).body.replay).toBe(true);
      expect((await hr.agent.post(`/api/v1/hr/payroll/${MONTH}/adjustments`).send({ ...body, clientRequestId: undefined, amountPaise: 10.5 })).status).toBe(400);
      expect((await alice.agent.post(`/api/v1/hr/payroll/${MONTH}/adjustments`).send(body)).status).toBe(403);
    });
  });

  describe('payslips for the employee', () => {
    test('hidden until approved; own only; other people get 404; PDF downloads', async () => {
      await setUpPaidMonth();
      const locked = await prepareAndLock();
      const aliceSlip = slipOf(locked, aliceP).id;
      const bobSlip = slipOf(locked, bobP).id;
      // Not released yet.
      expect((await alice.agent.get('/api/v1/hr/me/payslips')).body.items).toEqual([]);
      expect((await alice.agent.get(`/api/v1/hr/me/payslips/${aliceSlip}`)).status).toBe(404);
      expect((await alice.agent.get(`/api/v1/hr/employees/${aliceP.id}/payslips`)).body.items).toEqual([]);

      expect((await admin.agent.post(`/api/v1/hr/payroll/${MONTH}/approve`).send({ rev: locked.rev })).status).toBe(200);
      const list = await alice.agent.get('/api/v1/hr/me/payslips');
      expect(list.body.items.map((i) => i.id)).toEqual([aliceSlip]);
      expect(list.headers['cache-control']).toMatch(/no-store/);
      const one = await alice.agent.get(`/api/v1/hr/me/payslips/${aliceSlip}`);
      expect(one.status).toBe(200);
      expect(one.body.payslip.lines.find((l) => l.code === 'marks_lop')).toMatchObject({ calc: 'Late/early marks: 4 → ½ day LOP ₹500', basis: { marks: 4 } });

      const pdf = await alice.agent.get(`/api/v1/hr/me/payslips/${aliceSlip}/pdf`).buffer(true).parse((res, cb) => {
        const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c)));
      });
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
      expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');

      // Someone else's payslip, by id, from every door: 404.
      expect((await alice.agent.get(`/api/v1/hr/me/payslips/${bobSlip}`)).status).toBe(404);
      expect((await alice.agent.get(`/api/v1/hr/me/payslips/${bobSlip}/pdf`)).status).toBe(404);
      expect((await alice.agent.get(`/api/v1/hr/employees/${bobP.id}/payslips`)).status).toBe(404);
      expect((await alice.agent.get(`/api/v1/hr/employees/${aliceP.id}/payslips/${bobSlip}`)).status).toBe(404);
      expect((await head.agent.get(`/api/v1/hr/employees/${aliceP.id}/payslips`)).status).toBe(404);
      expect((await alice.agent.get('/api/v1/hr/me/payslips/not-an-id')).status).toBe(404);
      // HR sees it.
      expect((await hr.agent.get(`/api/v1/hr/employees/${aliceP.id}/payslips/${aliceSlip}`)).status).toBe(200);
    });

    test('an approved payslip is a snapshot: renaming the employee later changes nothing', async () => {
      await setUpPaidMonth();
      const locked = await prepareAndLock();
      await admin.agent.post(`/api/v1/hr/payroll/${MONTH}/approve`).send({ rev: locked.rev });
      await EmployeeProfile.updateOne({ _id: aliceP.id }, { $set: { name: 'Alice Renamed' } });
      await addSalary(aliceP, salary(50000, 1, 1, { effectiveFrom: '2025-10', reason: 'Backdated raise' }));
      const one = await alice.agent.get(`/api/v1/hr/me/payslips/${slipOf(locked, aliceP).id}`);
      expect(one.body.payslip.snapshot.name).toBe('Alice');
      expect(one.body.payslip.netPaise).toBe(slipOf(locked, aliceP).netPaise);
    });
  });
});
