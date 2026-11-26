/**
 * A project's Money box (GET /staff/tasks/projects/:projectId/payments,
 * services/projectMoneyService.js) over HTTP. Mongo, auth and CSRF are real.
 *
 * What must hold:
 *   - the totals are the server's: paid vs waiting, declined/cancelled counted apart,
 *     another project's payments never mixed in
 *   - the admin, Accounts and the owner see it; a member or a team head who can open
 *     the project gets 403, someone who cannot open it 404 — never a 200
 *   - the list is newest first, keyset-paged (exact page boundary, ties on createdAt,
 *     bad cursors refused), totals on the first page only
 *   - an archived project's money stays with its owner, the admin and Accounts
 *   - each row says what it was for, and whether this person may open it
 */
import { withoutMinimumMargin } from './helpers/marginRule.js';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: PaymentRequest } = await import('../models/PaymentRequest.js');
const { default: StaffProject } = await import('../models/StaffProject.js');
const projects = await import('../services/staffProjectService.js');
const { LOOKUP_PAGE_SIZE } = await import('../services/linkLookupService.js');
const { PURPOSE_MAX } = await import('../services/projectMoneyService.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };

async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PW });
  expect(res.status).toBe(200);
  return { get: (url) => agent.get(`${BASE}${url}`) };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, session: await signIn(email) };
};
const staff = (team, isHead = false) => ({ team, isHead, active: true });
const asUser = async (u) => { const fresh = await User.findById(u._id); await projects.loadProjectAccess(fresh); return fresh; };

let seq = 0;
/** Raw inserts, so createdAt is exactly what the test says (timestamps would overwrite it). */
async function pay(projectId, rows) {
  const docs = rows.map((r) => {
    seq += 1;
    return {
      _id: new mongoose.Types.ObjectId(),
      number: `PR-${String(seq).padStart(4, '0')}`,
      kind: 'expense', status: 'paid', team: 'operations',
      requestedBy: new mongoose.Types.ObjectId(), requestedByName: 'Omar',
      amount: 100, currency: 'INR', category: 'fuel', description: 'Diesel',
      payee: { name: 'Fuel Station', method: 'upi', upiId: 'fuel@okaxis' },
      project: projectId ? new mongoose.Types.ObjectId(projectId) : null,
      projectCode: 'PRJ-0001', projectName: "Vicky's Hilux",
      createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, seq)), updatedAt: new Date(),
      history: [],
      ...r,
    };
  });
  await PaymentRequest.collection.insertMany(docs);
  return docs;
}
const url = (id, cursor) => `/staff/tasks/projects/${id}/payments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;

describe("A project's Money box", () => {
  beforeAll(async () => { await dbHandler.connect(); await StaffProject.init(); await PaymentRequest.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let admin, accounts, owner, member, procHead, outsider, project;
  beforeEach(async () => {
    admin = await makeUser('Vyshnav', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    owner = await makeUser('Hari', 'staff', staff('operations', true));
    member = await makeUser('Anil', 'staff', staff('procurement'));
    procHead = await makeUser('Priya', 'staff', staff('procurement', true)); // head of a member's team: can open the project
    outsider = await makeUser('Ola', 'staff', staff('marketing'));
    project = (await projects.createProject(await asUser(owner.user), { name: "Vicky's Hilux", memberIds: [String(member.user._id)] }, req)).project;
  });

  it('sums paid and waiting on the server, keeps closed apart and ignores other projects', async () => {
    await pay(project.id, [
      { amount: 12000, status: 'paid' },
      { amount: 2200.5, status: 'paid' },
      { amount: 500, status: 'submitted' },
      { amount: 250, status: 'approved' },
      { amount: 100.25, status: 'on_hold' },
      { amount: 9999, status: 'declined' },
      { amount: 1, status: 'cancelled' },
    ]);
    const other = (await projects.createProject(await asUser(owner.user), { name: 'Other job' }, req)).project;
    await pay(other.id, [{ amount: 77777, status: 'paid' }]);
    await pay(null, [{ amount: 55555, status: 'paid' }]);

    const res = await admin.session.get(url(project.id));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.body.project).toMatchObject({ id: project.id, code: project.code, name: "Vicky's Hilux", archived: false });
    expect(res.body.totals).toEqual({
      paid: { count: 2, amount: 14200.5 },
      waiting: { count: 3, amount: 850.25 },
      closed: { count: 2 },
    });
    expect(res.body.payments.items).toHaveLength(7);
    expect(res.body.payments.nextCursor).toBeNull();
  });

  it('an empty project answers zeroes and an empty list', async () => {
    const res = await owner.session.get(url(project.id));
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ paid: { count: 0, amount: 0 }, waiting: { count: 0, amount: 0 }, closed: { count: 0 } });
    expect(res.body.payments).toEqual({ items: [], nextCursor: null });
  });

  it('the admin, Accounts and the owner see it; a member and a team head get 403; an outsider 404', async () => {
    await pay(project.id, [{ amount: 14200 }]);
    for (const who of [admin, accounts, owner]) {
      const res = await who.session.get(url(project.id));
      expect(res.status).toBe(200);
      expect(res.body.totals.paid.amount).toBe(14200);
    }
    for (const who of [member, procHead]) {
      const res = await who.session.get(url(project.id));
      expect(res.status).toBe(403);
      expect(res.body.totals).toBeUndefined();
      expect(res.body.payments).toBeUndefined();
    }
    const away = await outsider.session.get(url(project.id));
    expect(away.status).toBe(404);
    expect(JSON.stringify(away.body)).not.toMatch(/14200|Hilux/);
  });

  it('a missing project is 404, a junk id 400, and signed-out is 401', async () => {
    expect((await admin.session.get(url(new mongoose.Types.ObjectId().toString()))).status).toBe(404);
    expect((await admin.session.get(url('not-an-id'))).status).toBe(400);
    expect((await request(app).get(`${BASE}${url(project.id)}`)).status).toBe(401);
  });

  it('a past owner loses it the moment the admin hands the project on', async () => {
    const p = await StaffProject.findById(project.id).lean();
    await projects.updateProject(await asUser(admin.user), project.id, { rev: p.rev, ownerId: String(member.user._id), memberIds: [String(owner.user._id)] }, req);
    expect((await member.session.get(url(project.id))).status).toBe(200);
    expect((await owner.session.get(url(project.id))).status).toBe(403);
  });

  it('an archived project: owner, admin and Accounts still see it; the member is refused', async () => {
    await pay(project.id, [{ amount: 3000 }]);
    await projects.updateProject(await asUser(owner.user), project.id, { rev: project.rev, archived: true }, req);
    for (const who of [owner, admin, accounts]) {
      const res = await who.session.get(url(project.id));
      expect(res.status).toBe(200);
      expect(res.body.project.archived).toBe(true);
      expect(res.body.totals.paid.amount).toBe(3000);
    }
    // A member cannot open an archived project at all, so it is simply not there.
    expect((await member.session.get(url(project.id))).status).toBe(404);
  });

  it(`pages newest first: exactly ${LOOKUP_PAGE_SIZE} is one page, one more is two; ties on createdAt are neither lost nor repeated`, async () => {
    const exact = await pay(project.id, Array.from({ length: LOOKUP_PAGE_SIZE }, () => ({})));
    const one = await accounts.session.get(url(project.id));
    expect(one.body.payments.items).toHaveLength(LOOKUP_PAGE_SIZE);
    expect(one.body.payments.nextCursor).toBeNull();
    expect(one.body.payments.items[0].id).toBe(String(exact[exact.length - 1]._id));

    // Three more at the very same instant: the page break lands among them.
    const at = new Date(Date.UTC(2027, 0, 1));
    await pay(project.id, [{ createdAt: at }, { createdAt: at }, { createdAt: at }]);
    const first = await accounts.session.get(url(project.id));
    expect(first.body.payments.items).toHaveLength(LOOKUP_PAGE_SIZE);
    expect(first.body.payments.nextCursor).toEqual(expect.any(String));
    expect(first.body.totals.paid.count).toBe(LOOKUP_PAGE_SIZE + 3);

    const second = await accounts.session.get(url(project.id, first.body.payments.nextCursor));
    expect(second.status).toBe(200);
    expect(second.body.totals).toBeUndefined(); // totals ride the first page only
    expect(second.body.payments.items).toHaveLength(3);
    expect(second.body.payments.nextCursor).toBeNull();

    const ids = [...first.body.payments.items, ...second.body.payments.items].map((r) => r.id);
    expect(new Set(ids).size).toBe(LOOKUP_PAGE_SIZE + 3);
    const dates = [...first.body.payments.items, ...second.body.payments.items].map((r) => new Date(r.createdAt).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('a member cannot page with a cursor either, and a bad cursor is 400', async () => {
    await pay(project.id, Array.from({ length: LOOKUP_PAGE_SIZE + 1 }, () => ({})));
    const first = await owner.session.get(url(project.id));
    expect((await member.session.get(url(project.id, first.body.payments.nextCursor))).status).toBe(403);
    expect((await owner.session.get(url(project.id, '%%%not-a-cursor'))).status).toBe(400);
    const badId = Buffer.from(JSON.stringify({ c: new Date().toISOString(), i: 'x' })).toString('base64url');
    expect((await owner.session.get(url(project.id, badId))).status).toBe(400);
    const badDate = Buffer.from(JSON.stringify({ c: 'never', i: String(new mongoose.Types.ObjectId()) })).toString('base64url');
    expect((await owner.session.get(url(project.id, badDate))).status).toBe(400);
  });

  it('each row says what it was for (cut short) and whether this person may open it', async () => {
    const long = 'Wheel alignment and balancing '.repeat(20);
    await pay(project.id, [
      { team: 'operations', description: '  Diesel\n for   the van ', amount: 1500, category: 'fuel', status: 'paid' },
      { team: 'procurement', kind: 'supplier', category: 'supplier', description: '', itemNames: ['Lift kit', 'Floor mat'], amount: 52000, status: 'approved' },
      { team: 'marketing', description: long, amount: 10 },
    ]);
    const mine = await owner.session.get(url(project.id)); // operations
    const [lng, supplier, diesel] = mine.body.payments.items;
    expect(diesel).toMatchObject({ purpose: 'Diesel for the van', category: 'fuel', amount: 1500, status: 'paid', canOpen: true });
    expect(supplier).toMatchObject({ purpose: 'Lift kit, Floor mat', status: 'approved', canOpen: false });
    expect(lng.purpose.length).toBeLessThanOrEqual(PURPOSE_MAX);
    expect(lng.purpose.endsWith('…')).toBe(true);
    expect(lng.canOpen).toBe(false);
    // No bank details or files ride along.
    expect(JSON.stringify(mine.body)).not.toMatch(/okaxis|accountNumber|history/);
    // Accounts opens every one.
    expect((await accounts.session.get(url(project.id))).body.payments.items.every((r) => r.canOpen)).toBe(true);
  });

  it('the description is cut in the database: a 12,000-character note or none at all reads a short line, on the index', async () => {
    const [huge, bare] = await pay(project.id, [{ description: 'x'.repeat(12000) }, {}]);
    // An old record with neither field at all.
    await PaymentRequest.collection.updateOne({ _id: bare._id }, { $unset: { description: '', itemNames: '' } });

    const { default: repo } = await import('../repositories/paymentRequestRepository.js');
    const rows = await repo.pageLinked({ project: new mongoose.Types.ObjectId(project.id) }, { limit: 21, purposeChars: PURPOSE_MAX * 2 });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.description).toBeUndefined(); // the full text never leaves the database
      expect(String(r.purpose ?? '').length).toBeLessThanOrEqual(PURPOSE_MAX * 2);
    }
    expect(rows.find((r) => String(r._id) === String(huge._id)).purpose).toHaveLength(PURPOSE_MAX * 2);
    const plan = JSON.stringify((await repo.pageLinked({ project: new mongoose.Types.ObjectId(project.id) }, { limit: 21, purposeChars: 280 }).explain('queryPlanner')).queryPlanner.winningPlan);
    expect(plan).toContain('payment_request_project');
    expect(plan).not.toContain('COLLSCAN');

    const res = await owner.session.get(url(project.id));
    expect(res.status).toBe(200);
    const purposes = res.body.payments.items.map((r) => r.purpose);
    expect(purposes).toContain('');
    expect(purposes.find((x) => x.startsWith('x'))).toHaveLength(PURPOSE_MAX);
  });
});

// Older payment cases are not about the 30% minimum (tests/supplierMargin.test.js is).
withoutMinimumMargin();
