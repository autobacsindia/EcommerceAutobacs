/**
 * HR system foundation (docs/ADR-hr-system.md).
 *
 * What must hold:
 *   - HR is a staff TEAM ('hr'); admins add it from the normal staff screen
 *   - every /hr route needs a valid token: none → 401, revoked (sessionVersion) → 401
 *   - an employee sees only their own profile; another employee's id is a 404,
 *     exactly like an id that doesn't exist (no probing)
 *   - a team head sees no profile of anyone (profile scope is HR/admin/self)
 *   - HR and admin can list, create and update; updates are CAS on rev (409 when stale)
 *   - PAN / bank / UPI are encrypted at rest, never returned, never in the audit log
 *   - lists are keyset-paged with no repeats or gaps
 *   - every HR model's indexes are named, buildable, and the idempotency keys hold
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
const { default: EmployeeProfile } = await import('../models/hr/EmployeeProfile.js');
const { default: HrAuditLog } = await import('../models/hr/HrAuditLog.js');
const { default: AttendancePunch } = await import('../models/hr/AttendancePunch.js');
const { default: LeaveLedgerEntry } = await import('../models/hr/LeaveLedgerEntry.js');
const { STAFF_TEAMS, STAFF_TEAM_LABELS } = await import('../config/staff.js');
const { categoriesFor } = await import('../config/expenseCategories.js');
const { canAccessEmployee, isHrUser } = await import('../middleware/hrAuth.js');
const { buildIndexes, loadHrModels } = await import('../scripts/create-hr-indexes.js');
const { decryptField, isEncrypted } = await import('../utils/fieldEncryption.js');

const PW = 'SecurePass123!';
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
    put: (u) => agent.put(u).set('X-XSRF-TOKEN', csrf),
  };
}
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase().replace(/\s/g, '')}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, agent: await signIn(email), id: String(user._id) };
};
const team = (t, x = {}) => ({ team: t, active: true, ...x });

describe('HR team', () => {
  test('exists, has a label, and is a valid staff team on User', () => {
    expect(STAFF_TEAMS.HR).toBe('hr');
    expect(STAFF_TEAM_LABELS.hr).toBe('HR');
    expect(User.schema.path('staff.team').enumValues).toContain('hr');
  });

  test('isHrUser needs an ACTIVE hr-team staff account', () => {
    expect(isHrUser({ role: 'staff', staff: { team: 'hr', active: true } })).toBe(true);
    expect(isHrUser({ role: 'staff', staff: { team: 'hr', active: false } })).toBe(false);
    expect(isHrUser({ role: 'staff', staff: { team: 'sales', active: true } })).toBe(false);
    expect(isHrUser({ role: 'customer', staff: { team: 'hr', active: true } })).toBe(false);
    expect(isHrUser(null)).toBe(false);
  });

  test('has its own expense categories', () => {
    expect(categoriesFor('hr').map((c) => c.value)).toEqual(expect.arrayContaining(['reimbursement', 'recruitment', 'other']));
  });
});

describe('canAccessEmployee (the access matrix)', () => {
  const uid = () => new mongoose.Types.ObjectId();
  const me = uid();
  const emp = { _id: uid(), user: me, team: 'sales' };
  const self = { _id: me, role: 'staff', staff: { team: 'sales', active: true } };
  const peer = { _id: uid(), role: 'staff', staff: { team: 'sales', active: true } };
  const head = { _id: uid(), role: 'staff', staff: { team: 'sales', active: true, isHead: true } };
  const otherHead = { _id: uid(), role: 'staff', staff: { team: 'procurement', active: true, isHead: true } };
  const hr = { _id: uid(), role: 'staff', staff: { team: 'hr', active: true } };
  const exHr = { _id: uid(), role: 'customer', staff: { team: 'hr', active: false } };
  const admin = { _id: uid(), role: 'admin' };
  const scopes = ['profile', 'attendance', 'leave', 'salary', 'documents', 'face'];

  test.each(scopes)('self, HR and admin may see %s', (scope) => {
    for (const actor of [self, hr, admin]) expect(canAccessEmployee(actor, emp, scope)).toBe(true);
  });

  test.each(scopes)('a teammate, another team head and a former HR may not see %s', (scope) => {
    for (const actor of [peer, otherHead, exHr]) expect(canAccessEmployee(actor, emp, scope)).toBe(false);
  });

  test('the team head sees attendance and leave only — never salary, face, documents or the profile', () => {
    expect(canAccessEmployee(head, emp, 'attendance')).toBe(true);
    expect(canAccessEmployee(head, emp, 'leave')).toBe(true);
    for (const scope of ['salary', 'face', 'documents', 'profile']) expect(canAccessEmployee(head, emp, scope)).toBe(false);
  });

  test('unknown scope or missing actor is always no', () => {
    expect(canAccessEmployee(admin, emp, 'everything')).toBe(false);
    expect(canAccessEmployee(null, emp, 'profile')).toBe(false);
  });
});

describe('HR API', () => {
  beforeAll(async () => {
    await dbHandler.connect();
    await Promise.all((await loadHrModels()).map((M) => M.init()));
  });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  let admin; let hr; let alice; let bob; let head; let customer; let aliceProfile; let bobProfile;
  beforeEach(async () => {
    admin = await makeUser('Admin', 'admin');
    hr = await makeUser('Hema HR', 'staff', team('hr'));
    alice = await makeUser('Alice', 'staff', team('sales'));
    bob = await makeUser('Bob', 'staff', team('sales'));
    head = await makeUser('Sales Head', 'staff', team('sales', { isHead: true }));
    customer = await makeUser('Shopper', 'customer');
    aliceProfile = (await hr.agent.post('/api/v1/hr/employees').send({ name: 'Alice', user: alice.id, pan: 'ABCDE1234F', bank: { accountNumber: '123456789012', ifsc: 'HDFC0001234', upi: 'alice@okhdfc' } })).body.employee;
    bobProfile = (await hr.agent.post('/api/v1/hr/employees').send({ name: 'Bob', user: bob.id })).body.employee;
  });

  describe('authentication', () => {
    test('no token → 401 on every kind of route', async () => {
      for (const path of ['/api/v1/hr/me', '/api/v1/hr/employees', `/api/v1/hr/employees/${bobProfile.id}`, '/api/v1/hr/settings']) {
        const r = await request(app).get(path);
        expect(r.status).toBe(401);
      }
    });

    test('a revoked session (sessionVersion bumped) → 401, not 200', async () => {
      await User.updateOne({ _id: alice.user._id }, { $inc: { sessionVersion: 1 } });
      const r = await alice.agent.get('/api/v1/hr/me');
      expect(r.status).toBe(401);
    });
  });

  describe('employee A cannot read employee B', () => {
    test('Alice reads her own profile via /me and by id', async () => {
      const me = await alice.agent.get('/api/v1/hr/me');
      expect(me.status).toBe(200);
      expect(me.body.employee).toMatchObject({ id: aliceProfile.id, name: 'Alice', panLast4: '234F' });
      const byId = await alice.agent.get(`/api/v1/hr/employees/${aliceProfile.id}`);
      expect(byId.status).toBe(200);
    });

    test("Bob's profile is a 404 for Alice — the same answer as an id that doesn't exist", async () => {
      const theirs = await alice.agent.get(`/api/v1/hr/employees/${bobProfile.id}`);
      const missing = await alice.agent.get(`/api/v1/hr/employees/${new mongoose.Types.ObjectId()}`);
      const garbage = await alice.agent.get('/api/v1/hr/employees/not-an-id');
      for (const r of [theirs, missing, garbage]) {
        expect(r.status).toBe(404);
        expect(r.body.employee).toBeUndefined();
      }
      const strip = ({ requestId, ...rest }) => rest;
      expect(strip(theirs.body)).toEqual(strip(missing.body));
    });

    test('employees, heads and customers cannot list, create, update or read settings', async () => {
      for (const who of [alice, head, customer]) {
        expect((await who.agent.get('/api/v1/hr/employees')).status).toBe(403);
        expect((await who.agent.post('/api/v1/hr/employees').send({ name: 'X' })).status).toBe(403);
        expect((await who.agent.patch(`/api/v1/hr/employees/${aliceProfile.id}`).send({ rev: 0, designation: 'Boss' })).status).toBe(403);
        expect((await who.agent.get('/api/v1/hr/settings')).status).toBe(403);
      }
    });

    test('a team head cannot open a team member’s profile', async () => {
      expect((await head.agent.get(`/api/v1/hr/employees/${aliceProfile.id}`)).status).toBe(404);
    });

    test('a customer without a profile gets a clear 404 on /me', async () => {
      const r = await customer.agent.get('/api/v1/hr/me');
      expect(r.status).toBe(404);
      expect(r.body.message).toMatch(/not set up/);
    });
  });

  describe('HR and admin manage profiles', () => {
    test('create assigns sequential codes, links the login, snapshots the team and seeds the checklist', async () => {
      expect(aliceProfile.employeeCode).toMatch(/^EMP-\d{4}$/);
      expect(bobProfile.employeeCode).not.toBe(aliceProfile.employeeCode);
      expect(aliceProfile).toMatchObject({ user: alice.id, team: 'sales', status: 'onboarding' });
      expect(aliceProfile.onboarding.map((i) => i.key)).toEqual(['offer_signed', 'pan', 'bank', 'face', 'login', 'welcome']);
    });

    test('a login can have only one profile; a customer login cannot be linked', async () => {
      const dup = await hr.agent.post('/api/v1/hr/employees').send({ name: 'Alice again', user: alice.id });
      expect(dup.status).toBe(409);
      const cust = await hr.agent.post('/api/v1/hr/employees').send({ name: 'Shopper', user: customer.id });
      expect(cust.status).toBe(400);
    });

    test('a new joiner can be created before they have a login', async () => {
      const r = await admin.agent.post('/api/v1/hr/employees').send({ name: 'Arjun', joinDate: '2026-12-11', designation: 'Fitter' });
      expect(r.status).toBe(201);
      expect(r.body.employee).toMatchObject({ user: null, joinDate: '2026-12-11' });
    });

    test('PAN, bank account and UPI are encrypted at rest and never returned', async () => {
      const raw = await EmployeeProfile.findById(aliceProfile.id).select('+panEnc +bank.accountEnc +bank.upiEnc').lean();
      expect(isEncrypted(raw.panEnc)).toBe(true);
      expect(decryptField(raw.panEnc)).toBe('ABCDE1234F');
      expect(isEncrypted(raw.bank.accountEnc)).toBe(true);
      expect(isEncrypted(raw.bank.upiEnc)).toBe(true);
      const shown = JSON.stringify((await hr.agent.get(`/api/v1/hr/employees/${aliceProfile.id}`)).body);
      for (const secret of ['ABCDE1234F', '123456789012', 'alice@okhdfc', 'enc:']) expect(shown).not.toContain(secret);
      expect(aliceProfile.bank).toEqual({ holderName: '', accountLast4: '9012', ifsc: 'HDFC0001234', hasUpi: true });
    });

    test('update is CAS on rev: the second writer with a stale rev gets 409', async () => {
      const first = await hr.agent.patch(`/api/v1/hr/employees/${aliceProfile.id}`).send({ rev: aliceProfile.rev, designation: 'GTM lead' });
      expect(first.status).toBe(200);
      expect(first.body.employee).toMatchObject({ designation: 'GTM lead', rev: aliceProfile.rev + 1 });
      const stale = await admin.agent.patch(`/api/v1/hr/employees/${aliceProfile.id}`).send({ rev: aliceProfile.rev, designation: 'Other' });
      expect(stale.status).toBe(409);
      expect((await EmployeeProfile.findById(aliceProfile.id).lean()).designation).toBe('GTM lead');
    });

    test('bad input is refused with a reason, and nothing is written', async () => {
      for (const body of [{ pan: 'BAD' }, { bank: { ifsc: 'X' } }, { joinDate: '2026-02-31x' }, { status: 'exited' }, { phone: 'abc' }]) {
        const r = await hr.agent.patch(`/api/v1/hr/employees/${aliceProfile.id}`).send({ rev: aliceProfile.rev, ...body });
        expect(r.status).toBe(400);
      }
      expect((await EmployeeProfile.findById(aliceProfile.id).lean()).rev).toBe(aliceProfile.rev);
    });

    test('Aadhaar: only the last four digits are stored', async () => {
      await hr.agent.patch(`/api/v1/hr/employees/${aliceProfile.id}`).send({ rev: aliceProfile.rev, aadhaar: '1234 5678 9012' });
      const raw = await EmployeeProfile.findById(aliceProfile.id).lean();
      expect(raw.aadhaarLast4).toBe('9012');
      expect(JSON.stringify(raw)).not.toContain('123456789012');
    });

    test('every change is audit-logged, with sensitive values masked', async () => {
      await hr.agent.patch(`/api/v1/hr/employees/${aliceProfile.id}`).send({ rev: aliceProfile.rev, pan: 'ZZZZZ9999Z', designation: 'Lead', reason: 'promotion' });
      const rows = await HrAuditLog.find({ subject: aliceProfile.id }).sort({ createdAt: 1 }).lean();
      expect(rows.map((r) => r.action)).toEqual(['employee.created', 'employee.updated']);
      const upd = rows[1];
      expect(upd).toMatchObject({ actorName: 'Hema HR', reason: 'promotion' });
      expect(upd.changes).toEqual(expect.arrayContaining([
        { field: 'designation', from: '', to: 'Lead' },
        { field: 'pan', from: '••••', to: '••••' },
      ]));
      expect(JSON.stringify(rows)).not.toMatch(/ZZZZZ9999Z|ABCDE1234F|123456789012|alice@okhdfc/);
    });

    test('the audit log is append-only', async () => {
      await expect(HrAuditLog.updateOne({}, { $set: { action: 'x' } })).rejects.toThrow(/append-only/);
      await expect(HrAuditLog.deleteMany({})).rejects.toThrow(/append-only/);
    });

    test('onboarding items can be ticked and unticked', async () => {
      const r = await hr.agent.put(`/api/v1/hr/employees/${aliceProfile.id}/onboarding/pan`).send({ done: true });
      expect(r.status).toBe(200);
      expect(r.body.employee.onboarding.find((i) => i.key === 'pan')).toMatchObject({ done: true });
      expect((await hr.agent.put(`/api/v1/hr/employees/${aliceProfile.id}/onboarding/nope`).send({ done: true })).status).toBe(404);
    });

    test('an exited employee is read-only', async () => {
      await EmployeeProfile.updateOne({ _id: aliceProfile.id }, { $set: { status: 'exited' } });
      const r = await hr.agent.patch(`/api/v1/hr/employees/${aliceProfile.id}`).send({ rev: aliceProfile.rev, designation: 'x' });
      expect(r.status).toBe(409);
    });
  });

  describe('list paging', () => {
    test('keyset pages by name: no repeats, no gaps, bounded size', async () => {
      for (const name of ['Chitra', 'Dev', 'Esha', 'Farhan', 'Gita']) {
        await hr.agent.post('/api/v1/hr/employees').send({ name });
      }
      const seen = [];
      let cursor = null;
      for (let i = 0; i < 10; i += 1) {
        const r = await hr.agent.get(`/api/v1/hr/employees?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        expect(r.status).toBe(200);
        expect(r.body.items.length).toBeLessThanOrEqual(3);
        seen.push(...r.body.items.map((x) => x.name));
        cursor = r.body.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual(['Alice', 'Bob', 'Chitra', 'Dev', 'Esha', 'Farhan', 'Gita']);
      // List rows never carry sensitive or bulky fields.
      const row = (await hr.agent.get('/api/v1/hr/employees?limit=1')).body.items[0];
      expect(Object.keys(row).sort()).toEqual(['designation', 'employeeCode', 'id', 'joinDate', 'name', 'phone', 'status', 'team', 'user']);
    });

    test('unknown filters are refused', async () => {
      expect((await hr.agent.get('/api/v1/hr/employees?status=bogus')).status).toBe(400);
      expect((await hr.agent.get('/api/v1/hr/employees?team=bogus')).status).toBe(400);
    });
  });

  describe('settings', () => {
    test('defaults are complete before anyone saves; update is CAS and validated', async () => {
      const g = await hr.agent.get('/api/v1/hr/settings');
      expect(g.status).toBe(200);
      expect(g.body.settings).toMatchObject({ pfEmployeeRate: 0.12, esiGrossThresholdPaise: 2100000, rev: 0 });
      expect(g.body.settings.onboardingItems).toHaveLength(6);

      const ok = await hr.agent.patch('/api/v1/hr/settings').send({ rev: 0, gpsMaxAccuracyM: 80, reason: 'tighter' });
      expect(ok.status).toBe(200);
      expect(ok.body.settings).toMatchObject({ gpsMaxAccuracyM: 80, rev: 1 });
      expect((await admin.agent.patch('/api/v1/hr/settings').send({ rev: 0, payday: 5 })).status).toBe(409);
      expect((await hr.agent.patch('/api/v1/hr/settings').send({ rev: 1, payday: 99 })).status).toBeGreaterThanOrEqual(400);
      expect((await hr.agent.get('/api/v1/hr/settings')).body.settings.payday).toBe(7);
    });
  });

  describe('data contracts the build sessions rely on', () => {
    test('the index script builds every named HR index, and a second run changes nothing', async () => {
      const first = await buildIndexes({ apply: true, log: () => {} });
      expect(first.length).toBeGreaterThan(30);
      const second = await buildIndexes({ apply: true, log: () => {} });
      expect(second.every(([, state]) => state === 'already there')).toBe(true);
    });

    test('a punch with the same clientPunchId is stored once', async () => {
      const base = {
        employee: aliceProfile.id, clientPunchId: 'uuid-1', type: 'in', at: new Date(), receivedAt: new Date(), date: '2026-12-01',
      };
      await AttendancePunch.create(base);
      await expect(AttendancePunch.create(base)).rejects.toMatchObject({ code: 11000 });
      // Another employee may use the same client id.
      await AttendancePunch.create({ ...base, employee: bobProfile.id });
    });

    test('a leave ledger key is written once, and the ledger is append-only', async () => {
      const row = {
        employee: aliceProfile.id, leaveType: new mongoose.Types.ObjectId(), year: 2026, deltaHalfDays: 16, reason: 'grant', key: 'grant:a:CL:2026',
      };
      await LeaveLedgerEntry.create(row);
      await expect(LeaveLedgerEntry.create(row)).rejects.toMatchObject({ code: 11000 });
      await expect(LeaveLedgerEntry.updateOne({}, { $set: { deltaHalfDays: 99 } })).rejects.toThrow(/append-only/);
    });
  });
});
