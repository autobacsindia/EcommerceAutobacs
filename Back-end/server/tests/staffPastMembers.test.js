/**
 * Past team members over HTTP, against the real access-removal code.
 *
 * What must hold:
 *   - only people whose access was removed are listed; current staff never are
 *   - active staff see their own team's past members only; admins see any team
 *   - anyone else gets 404 on a profile, so its existence does not leak
 *   - the profile shows real records: sales, finished tasks, training, lessons, handover
 *   - never shown: the resignation reason, customer details, personal tasks,
 *     tasks or lessons that belonged to another team
 *   - lists are cursor-paged with no repeats or gaps; a bad cursor is refused
 *   - people who left before resignations were recorded still have a profile
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
const { default: StaffDeparture } = await import('../models/StaffDeparture.js');
const { default: StaffHandoverMove } = await import('../models/StaffHandoverMove.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffLesson } = await import('../models/StaffLesson.js');
const { default: SalesRep } = await import('../models/SalesRep.js');
const { default: Lead } = await import('../models/Lead.js');
const { default: Order } = await import('../models/Order.js');
const { default: SalesQuotation } = await import('../models/SalesQuotation.js');
const { StaffTrainingAssignment } = await import('../models/StaffTraining.js');
const { default: userRepository } = await import('../repositories/userRepository.js');
const tasks = await import('../services/staffTaskService.js');

const BASE = '/api/v1/staff/past-members';
const PW = 'SecurePass123!';
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PW });
  expect(res.status).toBe(200);
  return { get: (u) => agent.get(`${BASE}${u}`) };
}
let n = 0;
const makeUser = async (name, role, staff, { login = true } = {}) => {
  n += 1;
  const email = `${name.toLowerCase().replace(/\s/g, '')}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, s: login ? await signIn(email) : null, id: String(user._id) };
};
const team = (t, x = {}) => ({ team: t, active: true, ...x });
const req = { headers: {}, get: () => '', ip: '127.0.0.1', user: {} };

describe('Past team members', () => {
  beforeAll(async () => { await dbHandler.connect(); await StaffDeparture.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  let admin; let head; let newJoiner; let otherTeam; let customer; let leaver;
  beforeEach(async () => {
    admin = await makeUser('Admin', 'admin');
    head = await makeUser('Head', 'staff', team('sales', { isHead: true }));
    newJoiner = await makeUser('New Joiner', 'staff', team('sales', { subRole: 'support' }));
    otherTeam = await makeUser('Other', 'staff', team('procurement', { isHead: true }));
    customer = await makeUser('Shopper', 'customer');
    leaver = await makeUser('Nevin', 'staff', team('sales', { addedAt: new Date('2026-01-01T05:00:00Z') }), { login: false });
  });

  const removeAccess = (who, at = new Date()) => userRepository.revokeStaff(who.user._id, admin.user._id, at);
  const finish = async (id, completedAt = new Date()) => {
    const { bucket, rank } = tasks.placeOf({ status: 'done', completedAt });
    await StaffTask.updateOne({ _id: id }, { $set: { status: 'done', completedAt, bucket, rank } });
  };
  const give = (actor, body) => tasks.createTask(actor, body, req).then((r) => r.task ?? r);

  describe('who can see the list', () => {
    test('teammates of any role see their team’s past members, and only after access is removed', async () => {
      expect((await newJoiner.s.get('')).body.members).toEqual([]);
      await removeAccess(leaver);
      for (const who of [head, newJoiner]) {
        const r = await who.s.get('');
        expect(r.status).toBe(200);
        expect(r.body.members.map((m) => m.name)).toEqual(['Nevin']);
        expect(r.body.members[0]).toMatchObject({ team: 'sales', teamLabel: 'GTM', roleLabel: 'GTM lead', joinedOn: '2026-01-01' });
      }
    });

    test('another team sees none of them, and cannot ask for this team', async () => {
      await removeAccess(leaver);
      const r = await otherTeam.s.get('?team=sales');
      expect(r.status).toBe(200);
      expect(r.body.team).toBe('procurement');
      expect(r.body.members).toEqual([]);
    });

    test('admin sees every team, or one team', async () => {
      const gone = await makeUser('Buyer Gone', 'staff', team('procurement'), { login: false });
      await removeAccess(leaver); await removeAccess(gone);
      expect((await admin.s.get('')).body.members).toHaveLength(2);
      expect((await admin.s.get('?team=procurement')).body.members.map((m) => m.name)).toEqual(['Buyer Gone']);
      expect((await admin.s.get('?team=nope')).status).toBe(400);
    });

    test('customers and former staff cannot open it at all', async () => {
      expect([401, 403]).toContain((await customer.s.get('')).status);
    });

    test('pages are newest-left first, with no repeats or gaps', async () => {
      const ids = [];
      for (let i = 0; i < 30; i += 1) {
        const p = await makeUser(`Gone ${i}`, 'staff', team('sales'), { login: false });
        // Some share a time, so the _id tie-break is exercised.
        await removeAccess(p, new Date(Date.UTC(2026, 5, 1 + Math.floor(i / 3))));
        ids.push(p.id);
      }
      // Someone removed before the date was recorded sorts last.
      const old = await makeUser('Long Gone', 'staff', team('sales'), { login: false });
      await User.collection.updateOne({ _id: old.user._id }, { $set: { role: 'customer', 'staff.active': false, 'staff.deactivatedAt': null } });
      const seen = [];
      let cursor = '';
      for (let guard = 0; guard < 5; guard += 1) {
        const r = await head.s.get(cursor ? `?cursor=${cursor}` : '');
        expect(r.status).toBe(200);
        seen.push(...r.body.members);
        cursor = r.body.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toHaveLength(31);
      expect(new Set(seen.map((m) => m.id)).size).toBe(31);
      expect(seen[30].name).toBe('Long Gone');
      const days = seen.slice(0, 30).map((m) => m.lastDay);
      expect([...days].sort().reverse()).toEqual(days);
    });

    test('a broken cursor is refused', async () => {
      expect((await head.s.get('?cursor=notacursor')).status).toBe(400);
      const forged = Buffer.from(JSON.stringify({ at: 'x', id: 'y' })).toString('base64url');
      expect((await head.s.get(`?cursor=${forged}`)).status).toBe(400);
    });
  });

  describe('a profile', () => {
    test('is 404 for current staff, other teams, customers and unknown ids', async () => {
      await removeAccess(leaver);
      expect((await head.s.get(`/${newJoiner.id}`)).status).toBe(404);
      expect((await otherTeam.s.get(`/${leaver.id}`)).status).toBe(404);
      expect((await head.s.get(`/${customer.id}`)).status).toBe(404);
      expect((await head.s.get(`/${new mongoose.Types.ObjectId()}`)).status).toBe(404);
      expect((await otherTeam.s.get(`/${leaver.id}/tasks`)).status).toBe(404);
      expect((await otherTeam.s.get(`/${leaver.id}/orders`)).status).toBe(404);
    });

    test('shows real records and keeps private things out', async () => {
      // Sales: two paid, one returned, one cancelled, one waiting.
      const order = (status, paymentStatus, totalAmount) => ({
        salesUser: leaver.user._id, status, paymentStatus, totalAmount, createdAt: new Date(), updatedAt: new Date(),
        shippingAddress: { name: 'Ravi Traders', phone: '9811111111', street: '12 MG Road' }, guestEmail: 'ravi@example.com',
      });
      await Order.collection.insertMany([
        order('delivered', 'paid', 1000), order('processing', 'paid', 500.5), order('returned', 'refunded', 300),
        order('cancelled', 'cancelled', 200), order('awaiting_payment', 'pending', 50),
      ]);
      const quote = (status, number) => ({ number, status, salesUser: leaver.user._id, customer: { name: 'Ravi', phone: '9811111111' }, shippingAddress: {}, items: [], subtotal: 1, totalAmount: 1 });
      await SalesQuotation.collection.insertMany([quote('accepted', 'Q-1'), quote('accepted', 'Q-2'), quote('cancelled', 'Q-3')]);
      const rep = await SalesRep.create({ name: 'Nevin', user: leaver.user._id });
      const lead = (status, key) => ({ name: `Lead ${key}`, identityKey: key, status, assignedRep: rep._id, primarySource: 'contact', sources: [], activities: [] });
      await Lead.collection.insertMany([lead('won', 'a'), lead('won', 'b'), lead('lost', 'c'), lead('contacted', 'd')]);

      // Tasks: one team task, one personal, one only another team could see.
      const teamTask = await give(admin.user, { title: 'Call Ravi', assigneeIds: [leaver.id] });
      const personal = await give(leaver.user, { title: 'Dentist', personal: true });
      const shared = await give(admin.user, { title: 'Supplier audit', assigneeIds: [otherTeam.id, leaver.id], shared: true });
      await StaffTask.updateOne({ _id: shared.id }, { $set: { teams: ['procurement'] } });
      for (const t of [teamTask, personal, shared]) await finish(t.id);

      // Training and lessons.
      await StaffTrainingAssignment.collection.insertMany([
        { path: new mongoose.Types.ObjectId(), pathTitle: 'GTM basics', team: 'sales', user: leaver.user._id, buddy: head.user._id, status: 'signed_off', signedOffByName: 'Head', signedOffAt: new Date(), assignedBy: head.user._id },
        { path: new mongoose.Types.ObjectId(), pathTitle: 'Dropped', team: 'sales', user: leaver.user._id, buddy: head.user._id, status: 'cancelled', assignedBy: head.user._id },
      ]);
      const lesson = (title, audience, archivedAt = null) => ({ title, audience, topic: 'x', body: '', owner: head.user._id, createdBy: leaver.user._id, createdByName: 'Nevin', archivedAt, files: [] });
      await StaffLesson.collection.insertMany([lesson('Closing a B2B order', 'sales'), lesson('For everyone', 'company'), lesson('Buying tips', 'procurement'), lesson('Old', 'sales', new Date())]);

      // Resignation with a private reason, a handover note and moves.
      const dep = await StaffDeparture.collection.insertOne({
        user: leaver.user._id, userName: 'Nevin', team: 'sales', wasHead: false, lastDay: '2026-10-31', reason: 'PRIVATE-REASON',
        successor: head.user._id, successorName: 'Head', note: '<p>Ravi likes calls</p>', noteByName: 'Nevin', noteAt: new Date(),
        status: 'open', active: true, createdBy: admin.user._id, createdByName: 'Admin', rev: 0, createdAt: new Date(),
      });
      await StaffHandoverMove.collection.insertMany([
        { departure: dep.insertedId, kind: 'lead', ref: new mongoose.Types.ObjectId(), label: 'Lead d', to: head.user._id, toName: 'Head', state: 'moved', at: new Date() },
        { departure: dep.insertedId, kind: 'task', ref: new mongoose.Types.ObjectId(), label: 'Broken', to: head.user._id, toName: 'Head', state: 'failed', at: new Date() },
      ]);
      await removeAccess(leaver);

      const r = await newJoiner.s.get(`/${leaver.id}`);
      expect(r.status).toBe(200);
      const m = r.body.member;
      expect(m).toMatchObject({ name: 'Nevin', teamLabel: 'GTM', lastDay: '2026-10-31', joinedOn: '2026-01-01', takenOverBy: 'Head' });
      expect(m.daysOnTeam).toBeGreaterThan(200);
      expect(m.sales).toEqual({
        orders: { paid: 2, paidValue: 1500.5, notPaid: 1, returned: 1, cancelled: 1 },
        quotations: { sent: 3, accepted: 2 },
        leads: { total: 4, won: 2, lost: 1 },
      });
      expect(m.tasksDone).toBe(1);
      expect(m.training).toEqual([expect.objectContaining({ title: 'GTM basics', status: 'signed_off', signedOffByName: 'Head' })]);
      expect(m.lessons.map((l) => l.title).sort()).toEqual(['Closing a B2B order', 'For everyone']);
      expect(m.handover.note).toBe('<p>Ravi likes calls</p>');
      expect(m.handover.moved).toEqual([expect.objectContaining({ kind: 'lead', label: 'Lead d', toName: 'Head' })]);

      const raw = JSON.stringify(r.body);
      for (const secret of ['PRIVATE-REASON', '9811111111', 'Ravi Traders', 'MG Road', 'ravi@example.com', 'Dentist']) expect(raw).not.toContain(secret);

      // The open record is closed now that the person has gone.
      expect((await StaffDeparture.findById(dep.insertedId).lean()).status).toBe('left');

      // Admin sees every non-personal task, including the other team's.
      const a = await admin.s.get(`/${leaver.id}`);
      expect(a.body.member.tasksDone).toBe(2);
      expect(a.body.member.lessons).toHaveLength(3);

      const t = await newJoiner.s.get(`/${leaver.id}/tasks`);
      expect(t.body.tasks.map((x) => x.title)).toEqual(['Call Ravi']);
      const o = await newJoiner.s.get(`/${leaver.id}/orders`);
      expect(o.body.orders).toHaveLength(5);
      expect(Object.keys(o.body.orders[0]).sort()).toEqual(['createdAt', 'id', 'number', 'paymentStatus', 'status', 'totalAmount']);
      expect(JSON.stringify(o.body)).not.toContain('9811111111');
    });

    test('someone who left before resignations were recorded still has a profile', async () => {
      const when = new Date('2026-03-15T12:00:00Z');
      await removeAccess(leaver, when);
      const r = await head.s.get(`/${leaver.id}`);
      expect(r.status).toBe(200);
      expect(r.body.member).toMatchObject({ lastDay: '2026-03-15', handover: null, takenOverBy: '', tasksDone: 0, training: [], lessons: [] });
      expect(r.body.member.sales.orders.paid).toBe(0);
    });

    test('a non-GTM profile has no sales section', async () => {
      const buyer = await makeUser('Buyer', 'staff', team('procurement'), { login: false });
      await removeAccess(buyer);
      const r = await otherTeam.s.get(`/${buyer.id}`);
      expect(r.status).toBe(200);
      expect(r.body.member.sales).toBeNull();
      expect((await otherTeam.s.get(`/${buyer.id}/orders`)).body.orders).toEqual([]);
    });

    test('a cancelled resignation is not used', async () => {
      await StaffDeparture.collection.insertOne({ user: leaver.user._id, userName: 'Nevin', team: 'sales', wasHead: false, lastDay: '2026-01-31', reason: '', note: '<p>stale</p>', status: 'cancelled', rev: 1, createdBy: admin.user._id });
      await removeAccess(leaver, new Date('2026-04-02T06:00:00Z'));
      const r = await head.s.get(`/${leaver.id}`);
      expect(r.body.member.lastDay).toBe('2026-04-02');
      expect(r.body.member.handover).toBeNull();
    });

    test('orders and tasks page with no repeats or gaps', async () => {
      const base = Date.UTC(2026, 6, 1);
      await Order.collection.insertMany(Array.from({ length: 45 }, (_, i) => ({
        salesUser: leaver.user._id, status: 'delivered', paymentStatus: 'paid', totalAmount: i,
        createdAt: new Date(base + Math.floor(i / 2) * 60000), updatedAt: new Date(),
      })));
      for (let i = 0; i < 23; i += 1) {
        const t = await give(admin.user, { title: `Task ${i}`, assigneeIds: [leaver.id] });
        await finish(t.id, new Date(base + Math.floor(i / 2) * 60000));
      }
      await removeAccess(leaver);
      const all = async (path, key) => {
        const out = [];
        let cursor = '';
        for (let guard = 0; guard < 6; guard += 1) {
          const r = await head.s.get(`/${leaver.id}/${path}${cursor ? `?cursor=${cursor}` : ''}`);
          expect(r.status).toBe(200);
          out.push(...r.body[key]);
          cursor = r.body.nextCursor;
          if (!cursor) break;
        }
        return out;
      };
      const orders = await all('orders', 'orders');
      expect(new Set(orders.map((x) => x.id)).size).toBe(45);
      expect(orders[0].totalAmount).toBeGreaterThanOrEqual(orders[44].totalAmount);
      const done = await all('tasks', 'tasks');
      expect(new Set(done.map((x) => x.id)).size).toBe(23);
      expect(new Date(done[0].completedAt) >= new Date(done[22].completedAt)).toBe(true);
    });
  });
});
