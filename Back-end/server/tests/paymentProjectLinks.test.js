/**
 * Linking payments to projects / other IDs, project IDs, and the admin's lookup
 * (routes/paymentRequests.js /links, routes/adminLookup.js) over HTTP. Mongo,
 * auth and CSRF are real; private storage and the job queue are doubles.
 *
 * What must hold:
 *   - a project is linked by its code, only if it exists, is live and (for anyone
 *     but admin / accounts) the person is in it; nothing is saved otherwise
 *   - the code and name are snapshotted; a rename or delete never rewrites a payment
 *   - a link never changes money; it is logged in the history; two at once → one wins
 *   - a double-submitted expense (same clientId) is saved once, and its spare files dropped
 *   - the lookup is admin-only, finds a project / order / other ID, pages every list
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));
const stored = new Map();
const storageMock = {
  resourceTypeFor: (t) => (String(t).startsWith('image/') ? 'image' : 'raw'),
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, resourceType: 'image', url: '' };
  },
  deletePrivateAsset: async ({ publicId }) => { stored.delete(publicId); return true; },
  readPrivateAsset: async (ref) => stored.get(ref.publicId),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: PaymentRequest } = await import('../models/PaymentRequest.js');
const { default: ChatMessage } = await import('../models/ChatMessage.js');
const { default: ChatChannel } = await import('../models/ChatChannel.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const wf = await import('../services/teamWorkflowService.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(300, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);
const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };

const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    form: (url, fields = {}, files = []) => {
      let r = agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      for (const f of files) r = r.attach(f.field, f.buffer, { filename: f.name, contentType: f.type });
      return r;
    },
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, session: await signIn(email) };
};
const staff = (team, isHead = false) => ({ team, isHead, active: true });

const UPI = { name: 'Fuel Station', method: 'upi', upiId: 'fuelstation@okaxis' };
const BANK = { name: 'ARB Supplies', method: 'bank', accountName: 'ARB Supplies Pvt Ltd', accountNumber: '123456789012', ifsc: 'HDFC0001234', bankName: 'HDFC' };
const expense = (s, over = {}, files = [{ field: 'bill', buffer: JPEG, name: 'bill.jpg', type: 'image/jpeg' }]) =>
  s.form('/payment-requests/expenses', { category: 'other', amount: 1250.5, description: 'Diesel for delivery van', payee: UPI, ...over }, files);

async function paidOrder(salesUser = null) {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(), salesUser,
    items: [
      { product: new mongoose.Types.ObjectId(), name: 'Lift kit', price: 50000, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'Floor mat', price: 2000, quantity: 1 },
    ],
    shippingAddress: { fullName: 'Ravi Kumar', phone: '9812345678', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 52000, totalAmount: 52000, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified', paymentVerification: { source: 'razorpay', reference: 'pay_test' } });
  if (!res?.success) throw new Error(res?.message);
  return Order.findById(order._id).lean();
}

const { default: StaffProject } = await import('../models/StaffProject.js');
const projects = await import('../services/staffProjectService.js');
const tasks = await import('../services/staffTaskService.js');

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const asUser = async (u) => { const fresh = await User.findById(u._id); await projects.loadProjectAccess(fresh); return fresh; };
const startProject = async (owner, input = {}) => (await projects.createProject(await asUser(owner), { name: 'Diwali launch', ...input }, req)).project;

describe('Payment links and the admin lookup', () => {
  beforeAll(async () => { await dbHandler.connect(); await StaffProject.init(); await PaymentRequest.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); await dbHandler.clearDatabase(); });

  let admin, accounts, ops, opsHead, ops2, marketing, procurement, project;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    ops = await makeUser('Omar', 'staff', staff('operations'));
    opsHead = await makeUser('Hari', 'staff', staff('operations', true));
    ops2 = await makeUser('Ola', 'staff', staff('operations'));
    marketing = await makeUser('Mira', 'staff', staff('marketing', true));
    procurement = await makeUser('Priya', 'staff', staff('procurement'));
    // Omar is in the project; Ola (same team) is not.
    project = await startProject(opsHead.user, { memberIds: [String(ops.user._id), String(procurement.user._id)] });
  });

  describe('linking on an expense', () => {
    it('a project ID links it, snapshotting code and name; an other ID is cleaned and kept', async () => {
      const res = await expense(ops.session, { project: project.code.toLowerCase(), reference: '  INV-2231 \n ' });
      expect(res.status).toBe(201);
      expect(res.body.request).toMatchObject({
        project: { id: project.id, code: project.code, name: 'Diwali launch' }, reference: 'INV-2231', amount: 1250.5,
        can: { linkProject: true },
      });
      expect(res.body.request.history[0].note).toBe(`for project ${project.code}`);
      // A rename later never rewrites what the payment says.
      await projects.updateProject(await asUser(opsHead.user), project.id, { rev: project.rev, name: 'Renamed' }, req);
      expect((await ops.session.get(`/payment-requests/${res.body.request.id}`)).body.request.project.name).toBe('Diwali launch');
    });

    it('empty means none; junk, unknown, deleted and not-my-project IDs are refused and nothing is saved', async () => {
      const none = await expense(ops.session, { project: '', reference: '' });
      expect(none.status).toBe(201);
      expect(none.body.request).toMatchObject({ project: null, reference: '' });
      const before = await PaymentRequest.countDocuments();

      expect((await expense(ops.session, { project: 'hello' })).body.message).toMatch(/like PRJ-0007/);
      expect((await expense(ops.session, { project: 'PRJ-9999' })).body.message).toMatch(/PRJ-9999 was not found/);
      // Ola is in operations but not in the project: as if it did not exist.
      expect((await expense(ops2.session, { project: project.code })).status).toBe(400);
      expect((await expense(ops.session, { reference: 'x'.repeat(61) })).status).toBe(400);
      expect(await PaymentRequest.countDocuments()).toBe(before);
      expect(stored.size).toBe(1); // only the first request's bill — refused ones stored nothing

      // Accounts and the admin may link any project.
      expect((await expense(accounts.session, { category: 'other', description: 'Courier', project: project.code })).status).toBe(201);
      // A deleted project takes no new links.
      await projects.updateProject(await asUser(opsHead.user), project.id, { rev: project.rev, archived: true }, req);
      expect((await expense(admin.session, { team: 'operations', project: project.code })).body.message).toMatch(/deleted/);
    });

    it('a double-clicked Submit (same clientId) raises one request, also when both land at once', async () => {
      const a = await expense(ops.session, { clientId: 'expense-click-0001' });
      const b = await expense(ops.session, { clientId: 'expense-click-0001' });
      expect(a.status).toBe(201);
      expect(b.body.request.id).toBe(a.body.request.id);
      const [c, d] = await Promise.all([expense(ops.session, { clientId: 'expense-click-0002' }), expense(ops.session, { clientId: 'expense-click-0002' })]);
      expect(c.body.request.id).toBe(d.body.request.id);
      expect(await PaymentRequest.countDocuments({ requestedBy: ops.user._id })).toBe(2);
      // The loser's uploaded bill is removed, not left orphaned in storage.
      expect(stored.size).toBe(2);
      // Another person may use the same id: it is per requester.
      expect((await expense(ops2.session, { clientId: 'expense-click-0001' })).body.request.id).not.toBe(a.body.request.id);
    });
  });

  describe('changing the links later', () => {
    it('set, change and remove — each in the history; money untouched', async () => {
      const r = (await expense(ops.session)).body.request;
      const other = await startProject(admin.user, { name: 'Website' });
      const linked = await ops.session.post(`/payment-requests/${r.id}/links`, { project: project.code, reference: 'AWB 778' });
      expect(linked.status).toBe(200);
      expect(linked.body.request).toMatchObject({ project: { code: project.code }, reference: 'AWB 778', amount: r.amount, status: 'submitted' });
      // Ops is not in "Website": refused. Accounts may move it there.
      expect((await ops.session.post(`/payment-requests/${r.id}/links`, { project: other.code })).status).toBe(400);
      const moved = await accounts.session.post(`/payment-requests/${r.id}/links`, { project: other.code });
      expect(moved.body.request.project.code).toBe(other.code);
      const cleared = await accounts.session.post(`/payment-requests/${r.id}/links`, { project: '', reference: '' });
      expect(cleared.body.request).toMatchObject({ project: null, reference: '' });
      const notes = cleared.body.request.history.map((h) => h.note);
      expect(notes).toEqual(expect.arrayContaining([
        `linked to project ${project.code}; other ID AWB 778`, `project ${project.code} → ${other.code}`, `project ${other.code} removed; other ID AWB 778 removed`,
      ]));
      // Nothing changed: no new history row.
      const same = await accounts.session.post(`/payment-requests/${r.id}/links`, { project: '' });
      expect(same.body.request.history.length).toBe(cleared.body.request.history.length);
    });

    it('who may: the raiser, their head, accounts, the admin — not a teammate, and other teams do not see it', async () => {
      const r = (await expense(ops.session)).body.request;
      expect((await ops2.session.post(`/payment-requests/${r.id}/links`, { reference: 'x' })).status).toBe(403);
      expect((await marketing.session.post(`/payment-requests/${r.id}/links`, { reference: 'x' })).status).toBe(404);
      expect((await opsHead.session.post(`/payment-requests/${r.id}/links`, { reference: 'y' })).status).toBe(200);
      expect((await admin.session.post(`/payment-requests/${r.id}/links`, { reference: 'z' })).status).toBe(200);
      expect((await ops.session.post(`/payment-requests/${r.id}/links`, { reference: 42 })).status).toBe(400);
    });

    it('a paid request can still be linked; a link to a project deleted later stays', async () => {
      const r = (await expense(ops.session, { project: project.code })).body.request;
      await accounts.session.post(`/payment-requests/${r.id}/approve`, {});
      const paid = await admin.session.form(`/payment-requests/${r.id}/pay`, { method: 'upi', reference: 'UTR123456' },
        [{ field: 'proof', buffer: JPEG, name: 'p.jpg', type: 'image/jpeg' }]);
      expect(paid.body.request.status).toBe('paid');
      await projects.updateProject(await asUser(opsHead.user), project.id, { rev: project.rev, archived: true }, req);
      const later = await admin.session.post(`/payment-requests/${r.id}/links`, { reference: 'INV-9' });
      expect(later.body.request).toMatchObject({ status: 'paid', reference: 'INV-9', project: { code: project.code } });
    });

    it('two changes at the same moment: one wins, the other is told to refresh', async () => {
      const r = (await expense(ops.session)).body.request;
      const out = await Promise.all(['A1', 'B2', 'C3', 'D4'].map((x) => accounts.session.post(`/payment-requests/${r.id}/links`, { reference: x })));
      expect(out.every((x) => [200, 409].includes(x.status))).toBe(true);
      const final = await PaymentRequest.findById(r.id).lean();
      const won = out.filter((x) => x.status === 200);
      expect(won.length).toBeGreaterThanOrEqual(1);
      // Every saved change is in the history once; a refused one left no trace.
      expect(final.history.filter((h) => h.action === 'edited').length).toBe(won.length);
    });
  });

  it('a supplier payment can carry a project; its order stays fixed', async () => {
    const order = await paidOrder();
    const [kit] = order.items.map((i) => String(i._id));
    await wf.setStock(procurement.user, String(order._id), kit, { stock: 'in_stock' }, req);
    const res = await procurement.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [kit], amount: 100, payee: BANK, project: project.code });
    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({ kind: 'supplier', project: { code: project.code }, can: { linkOrder: false, linkProject: true } });
    // A refused project stops the request before anything is held.
    const mat = String(order.items[1]._id);
    await wf.setStock(procurement.user, String(order._id), mat, { stock: 'in_stock' }, req);
    expect((await procurement.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [mat], amount: 5, payee: BANK, project: 'PRJ-9999' })).status).toBe(400);
    expect(await PaymentRequest.countDocuments({ kind: 'supplier' })).toBe(1);
  });

  describe('the admin lookup', () => {
    it('admin only', async () => {
      expect((await ops.session.get(`/admin/lookup?q=${project.code}`)).status).toBe(403);
      expect((await accounts.session.get(`/admin/lookup?q=${project.code}`)).status).toBe(403);
      expect((await request(app).get(`${BASE}/admin/lookup?q=x`)).status).toBe(401);
      expect((await admin.session.get('/admin/lookup?q=')).status).toBe(400);
    });

    it('a project ID: the project, its tasks, its payments with totals, and the orders they point at with their timeline', async () => {
      const order = await paidOrder();
      const t1 = (await tasks.createTask(await asUser(opsHead.user), { title: 'Book the hall', dueOn: today(), projectId: project.id, orderId: String(order._id) }, req)).task;
      const t2 = (await tasks.createTask(await asUser(opsHead.user), { title: 'Print banners', dueOn: today(), projectId: project.id }, req)).task;
      await tasks.updateTask(await asUser(opsHead.user), t2.id, { rev: t2.rev, status: 'done' }, req);
      const e1 = (await expense(ops.session, { project: project.code, orderId: String(order._id) })).body.request;
      await expense(ops.session, { project: project.code, amount: 100 });
      await expense(ops.session, { amount: 7 }); // not linked
      await accounts.session.post(`/payment-requests/${e1.id}/decline`, { note: 'Wrong bill' });

      for (const q of [project.code, project.code.toLowerCase().replace('-', ' '), String(Number(project.code.slice(4)))]) {
        const res = await admin.session.get(`/admin/lookup?q=${encodeURIComponent(q)}`);
        expect(res.status).toBe(200);
        expect(res.body.match).toBe('project');
      }
      const { body } = await admin.session.get(`/admin/lookup?q=${project.code}`);
      expect(body.project).toMatchObject({ code: project.code, name: 'Diwali launch' });
      expect(body.tasks.open.items.map((t) => t.code)).toEqual([t1.code]);
      expect(body.tasks.done.items.map((t) => t.code)).toEqual([t2.code]);
      expect(body.payments.items).toHaveLength(2);
      expect(body.payments.totals).toMatchObject({ waiting: { count: 1, amount: 100 }, closed: { count: 1 }, paid: { count: 0, amount: 0 } });
      expect(body.orders).toHaveLength(1);
      expect(body.orders[0]).toMatchObject({ id: String(order._id), status: 'processing', paymentStatus: 'paid' });
      expect(body.orders[0].timeline.map((x) => x.status)).toContain('processing');
      expect(body.orders[0]).not.toHaveProperty('phone');
    });

    it('lists page 20 at a time with a cursor; a bad cursor is a 400', async () => {
      for (let i = 0; i < 23; i += 1) await expense(ops.session, { project: project.code, amount: i + 1 });
      const first = (await admin.session.get(`/admin/lookup?q=${project.code}`)).body.payments;
      expect(first.items).toHaveLength(20);
      const next = (await admin.session.get(`/admin/lookup?q=${project.code}&section=payments&cursor=${first.nextCursor}`)).body.payments;
      expect(next.items).toHaveLength(3);
      expect(next.nextCursor).toBeNull();
      expect(new Set([...first.items, ...next.items].map((p) => p.id)).size).toBe(23);
      expect((await admin.session.get(`/admin/lookup?q=${project.code}&section=payments&cursor=nonsense`)).status).toBe(400);
      expect((await admin.session.get(`/admin/lookup?q=${project.code}&section=wat`)).status).toBe(400);
    });

    it('an order number: the order, its tasks, payments and projects', async () => {
      const order = await paidOrder();
      await tasks.createTask(await asUser(opsHead.user), { title: 'Call the customer', dueOn: today(), projectId: project.id, orderId: String(order._id) }, req);
      await expense(ops.session, { orderId: String(order._id) });
      const short = `#${String(order._id).slice(-8).toUpperCase()}`;
      const { body } = await admin.session.get(`/admin/lookup?q=${encodeURIComponent(short)}`);
      expect(body.match).toBe('order');
      expect(body.order).toMatchObject({ id: String(order._id), number: short, customer: 'Ravi Kumar' });
      expect(body.tasks.order.items.map((t) => t.title)).toEqual(['Call the customer']);
      expect(body.payments.items).toHaveLength(1);
      expect(body.projects).toEqual([expect.objectContaining({ code: project.code, name: 'Diwali launch' })]);
    });

    it('an other ID finds the payments carrying it; nothing matching says so; deleted projects are still found', async () => {
      await expense(ops.session, { reference: 'INV-2231' });
      const ref = (await admin.session.get('/admin/lookup?q=INV-2231')).body;
      expect(ref.match).toBe('reference');
      expect(ref.payments.items[0].reference).toBe('INV-2231');
      expect((await admin.session.get('/admin/lookup?q=NOPE-1')).body.match).toBe('none');
      expect((await admin.session.get('/admin/lookup?q=PRJ-9999')).body).toMatchObject({ match: 'none', message: 'No project PRJ-9999.' });
      await projects.updateProject(await asUser(opsHead.user), project.id, { rev: project.rev, archived: true }, req);
      expect((await admin.session.get(`/admin/lookup?q=${project.code}`)).body).toMatchObject({ match: 'project', project: { code: project.code } });
    });
  });
});
