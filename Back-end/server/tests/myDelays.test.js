/**
 * "My delays" v1 (services/myDelaysService.js, routes/followUps.js) against an
 * in-memory Mongo, through the real workflow services.
 *
 * What must hold:
 *   - office clock: nights, Sundays and holidays never count as late
 *   - owner = who moved THAT line into its stage; System / inactive → the stage team's head;
 *     no head → admins. A parcel belongs to whoever set its ETA (else who dispatched it)
 *   - a parcel with no ETA is flagged; outside-control reasons are told apart from inside ones
 *   - late → due today → pending order; tasks and projects included
 *   - access: no session → 401; plain staff never see anyone else (403, never 200);
 *     a head sees only their own team (the team filter cannot widen it); admin sees all
 *   - pagination: bounded limit (400 past the max), keyset pages never repeat or skip, bad cursor → 400
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  getMediaQueue: () => mockQueue,
  variantJobId: () => 'x',
  enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {},
  closeQueues: () => Promise.resolve(),
}));

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const { default: Order } = await import('../models/Order.js');
const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffProject } = await import('../models/StaffProject.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const wf = await import('../services/teamWorkflowService.js');
const svc = await import('../services/myDelaysService.js');
const { istDay, addDays } = await import('../utils/parcelEta.js');

jest.setTimeout(120000);
afterAll(() => {
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const DAY = 24 * 3600e3;
const ist = (s) => new Date(`${s}+05:30`);
const NO_HOLIDAYS = {};

let n = 0;
const PASSWORD = 'SecurePass123!';
let hash;
async function person(team, { isHead = false, active = true, name } = {}) {
  hash ??= await bcrypt.hash(PASSWORD, 4);
  n += 1;
  return User.create({
    name: name || `${team} ${n}`, email: `dl-${team}${n}@autobacs.test`, phone: '9000000001', passwordHash: hash,
    role: active ? 'staff' : 'customer', staff: { team, isHead, active },
  });
}
async function admin(name = `Admin ${++n}`) {
  hash ??= await bcrypt.hash(PASSWORD, 4);
  return User.create({ name, email: `dl-admin${++n}@autobacs.test`, passwordHash: hash, role: 'admin' });
}
async function auth(user) {
  const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
  const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='));
  return { Authorization: `Bearer ${cookie.split(';')[0].slice('accessToken='.length)}` };
}

async function paidOrder(name = 'Ravi') {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [
      { product: new mongoose.Types.ObjectId(), name: 'Seat cover', price: 5000, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'Floor mat', price: 1000, quantity: 1 },
    ],
    shippingAddress: { fullName: name, phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 6000, totalAmount: 6000, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified', paymentVerification: { source: 'razorpay', reference: 'pay_test' } });
  if (!res?.success) throw new Error(res?.message);
  return Order.findById(order._id).lean();
}

/** Moves every timestamp on an order `days` back, so live-clock API calls see it as late. */
async function age(orderId, days) {
  const o = await Order.findById(orderId).lean();
  const back = (d) => (d ? new Date(new Date(d).getTime() - days * DAY) : d);
  await Order.updateOne({ _id: orderId }, {
    $set: {
      'workflow.enteredAt': back(o.workflow.enteredAt),
      'workflow.history': o.workflow.history.map((h) => ({ ...h, at: back(h.at) })),
      shipments: (o.shipments || []).map((s) => ({ ...s, shippedAt: back(s.shippedAt), createdAt: back(s.createdAt) })),
    },
  });
}

const later = (days) => new Date(Date.now() + days * DAY);
const itemsFor = async (scope, now) => (await svc.collectDelays(scope, { now, env: NO_HOLIDAYS })).items;

describe('office clock (Mon–Sat 09:30–18:30 IST)', () => {
  const office = svc.officeCalendar({ STAFF_HOLIDAYS: '2026-11-25' });
  it('counts only office minutes', () => {
    expect(svc.officeMinutesBetween(ist('2026-11-23T09:30:00'), ist('2026-11-23T18:30:00'), office)).toBe(540);
    expect(svc.officeMinutesBetween(ist('2026-11-23T18:00:00'), ist('2026-11-24T10:00:00'), office)).toBe(60); // night skipped
    expect(svc.officeMinutesBetween(ist('2026-11-21T18:00:00'), ist('2026-11-23T10:00:00'), office)).toBe(60); // Sunday skipped
    expect(svc.officeMinutesBetween(ist('2026-11-24T18:00:00'), ist('2026-11-26T10:00:00'), office)).toBe(60); // holiday skipped
    expect(svc.officeMinutesBetween(ist('2026-11-24T10:00:00'), ist('2026-11-24T09:00:00'), office)).toBe(0);
  });
  it('adds office minutes past nights, Sundays and holidays', () => {
    expect(svc.addOfficeMinutes(ist('2026-11-23T17:30:00'), 120, office)).toEqual(ist('2026-11-24T10:30:00'));
    expect(svc.addOfficeMinutes(ist('2026-11-21T20:00:00'), 30, office)).toEqual(ist('2026-11-23T10:00:00'));
    expect(svc.addOfficeMinutes(ist('2026-11-24T18:00:00'), 60, office)).toEqual(ist('2026-11-26T10:00:00'));
    expect(svc.addOfficeMinutes(ist('2026-11-23T07:00:00'), 0, office)).toEqual(ist('2026-11-23T09:30:00'));
  });
});

describe('who owns a step', () => {
  it('a line belongs to whoever moved it into its stage; an untouched line to the stage team head', async () => {
    const p = await person('procurement', { name: 'Aromal' });
    const head = await person('procurement', { isHead: true, name: 'Proc head' });
    const order = await paidOrder();
    const [cover, mat] = order.items.map((i) => String(i._id));
    await wf.setStock(p, String(order._id), cover, { stock: 'in_stock', supplierName: 'Acme' }, req);

    const items = await itemsFor({}, later(5));
    const coverStep = items.find((i) => i.key.endsWith(`:${cover}`));
    const matStep = items.find((i) => i.key.endsWith(`:${mat}`));
    expect(coverStep).toMatchObject({ kind: 'order_step', stage: 'to_ship', bucket: 'late', owner: { id: String(p._id), name: 'Aromal', via: 'moved' } });
    expect(matStep).toMatchObject({ stage: 'stock_check', owner: { id: String(head._id), via: 'head', team: 'procurement' } });
    expect(coverStep.minutesLate).toBeGreaterThan(0);
    expect(coverStep.reason).toBeNull();
  });

  it('an inactive mover falls back to the head; no head → admins', async () => {
    const gone = await person('procurement', { name: 'Left' });
    const order = await paidOrder();
    const [cover] = order.items.map((i) => String(i._id));
    await wf.setStock(gone, String(order._id), cover, { stock: 'in_stock' }, req);
    await User.updateOne({ _id: gone._id }, { $set: { role: 'customer', 'staff.active': false } });

    let step = (await itemsFor({}, later(5))).find((i) => i.key.endsWith(`:${cover}`));
    expect(step.owner).toMatchObject({ id: null, via: 'admins', team: 'procurement' });

    const head = await person('procurement', { isHead: true });
    step = (await itemsFor({}, later(5))).find((i) => i.key.endsWith(`:${cover}`));
    expect(step.owner).toMatchObject({ id: String(head._id), via: 'head' });
  });

  it('a parcel belongs to whoever set its ETA, else whoever dispatched it; no ETA is flagged', async () => {
    const p = await person('procurement', { name: 'Packer' });
    const ops = await person('operations', { name: 'Ops' });
    const order = await paidOrder();
    const id = String(order._id);
    const [cover, mat] = order.items.map((i) => String(i._id));
    for (const i of [cover, mat]) await wf.setStock(p, id, i, { stock: 'own_stock' }, req);
    await wf.dispatchOwnStock(p, id, { courierName: 'Delhivery', trackingNumber: 'DL1', itemIds: [cover] }, null, req);
    await wf.dispatchOwnStock(p, id, { courierName: 'Blue Dart', trackingNumber: 'BD2', itemIds: [mat] }, null, req);
    const [s1, s2] = (await Order.findById(id).lean()).shipments.map((s) => String(s._id));
    await wf.setParcelEta(ops, id, s1, { date: addDays(istDay(), 1) }, req);

    const items = await itemsFor({}, later(6));
    const withEta = items.find((i) => i.key === `parcel:${id}:${s1}`);
    const noEta = items.find((i) => i.key === `parcel:${id}:${s2}`);
    expect(withEta).toMatchObject({ kind: 'parcel', bucket: 'late', owner: { name: 'Ops', via: 'moved' }, flags: { noEta: false } });
    expect(noEta).toMatchObject({ owner: { name: 'Packer' }, flags: { noEta: true } });
    // The courier is stored as carrier.name — the title must show it (regression).
    expect(noEta.title).toMatch(/Parcel \(Blue Dart BD2\)$/);
  });
});

describe('reasons: outside vs inside control', () => {
  it('a courier delay is outside; no reason is inside; the control filter splits them', async () => {
    const p = await person('procurement');
    const order = await paidOrder();
    const id = String(order._id);
    const [cover, mat] = order.items.map((i) => String(i._id));
    for (const i of [cover, mat]) await wf.setStock(p, id, i, { stock: 'own_stock' }, req);
    await wf.dispatchOwnStock(p, id, { courierName: 'Delhivery', trackingNumber: 'DL1', itemIds: [cover] }, null, req);
    await wf.dispatchOwnStock(p, id, { courierName: 'Blue Dart', trackingNumber: 'BD2', itemIds: [mat] }, null, req);
    const [s1, s2] = (await Order.findById(id).lean()).shipments.map((s) => String(s._id));
    for (const s of [s1, s2]) await wf.setParcelEta(p, id, s, { date: addDays(istDay(), 1) }, req);
    const past = addDays(istDay(), -4);
    await Order.updateOne({ _id: id }, { $set: { 'shipments.$[].eta.day': past } });
    await wf.setParcelOverdueReason(p, id, s1, { code: 'courier_delay', note: 'hub', expectedDate: past }, req);
    await age(id, 6);

    const items = await itemsFor({}, new Date());
    const a = items.find((i) => i.key === `parcel:${id}:${s1}`);
    const b = items.find((i) => i.key === `parcel:${id}:${s2}`);
    expect(a).toMatchObject({ bucket: 'late', control: 'outside', reason: { code: 'courier_delay', label: 'Courier delay', note: 'hub', control: 'outside' } });
    expect(b).toMatchObject({ bucket: 'late', control: 'inside', reason: null });
    expect(svc.applyFilters(items, { control: 'outside' }).map((i) => i.key)).toEqual([a.key]);
    expect(svc.applyFilters(items, { control: 'inside' }).map((i) => i.key)).toContain(b.key);
    expect(svc.controlOf('supplier_delay')).toBe('inside');
  });
});

describe('order of the list, tasks and projects', () => {
  it('late → due today → pending, most late first', () => {
    const at = (h) => new Date(Date.now() + h * 3600e3);
    const rows = [
      { key: 'p', bucket: 'pending', minutesLate: 0, dueAt: at(48) },
      { key: 't', bucket: 'today', minutesLate: 0, dueAt: at(2) },
      { key: 'l1', bucket: 'late', minutesLate: 30, dueAt: at(-1) },
      { key: 'l2', bucket: 'late', minutesLate: 300, dueAt: at(-9) },
    ].sort(svc.compareItems);
    expect(rows.map((r) => r.key)).toEqual(['l2', 'l1', 't', 'p']);
  });

  it('includes late / due-today tasks (each assignee) and overdue projects with open work', async () => {
    const a = await person('marketing', { name: 'Mia' });
    const b = await person('marketing', { name: 'Ben' });
    const today = istDay();
    const yesterday = addDays(today, -1);
    const base = { createdBy: a._id, bucket: 'open', status: 'todo' };
    const t1 = await StaffTask.create({ ...base, number: 1, title: 'Post reel', dueOn: yesterday, rank: yesterday, assignee: a._id, assigneeName: 'Mia', team: 'marketing', assignees: [{ user: a._id, name: 'Mia', team: 'marketing' }, { user: b._id, name: 'Ben', team: 'marketing' }], teams: ['marketing'] });
    await StaffTask.create({ ...base, number: 2, title: 'Today', dueOn: today, rank: today, assignee: a._id, assigneeName: 'Mia', team: 'marketing', assignees: [{ user: a._id, name: 'Mia', team: 'marketing' }], teams: ['marketing'] });
    await StaffTask.create({ ...base, number: 3, title: 'Private', dueOn: yesterday, rank: yesterday, assignee: a._id, personal: true });
    const later3 = addDays(today, 3);
    await StaffTask.create({ ...base, number: 4, title: 'Not due', dueOn: later3, rank: later3, assignee: a._id, assignees: [{ user: a._id, name: 'Mia', team: 'marketing' }], teams: ['marketing'] });
    const prj = await StaffProject.create({ name: 'Diwali', owner: { user: a._id, name: 'Mia', team: 'marketing' }, people: [{ user: a._id, name: 'Mia', team: 'marketing' }], teams: ['marketing'], dueOn: yesterday, rank: yesterday, createdBy: a._id });
    await StaffTask.create({ ...base, number: 5, title: 'Open in project', project: prj._id, rank: '9999-12-31', assignee: b._id, assignees: [{ user: b._id, name: 'Ben', team: 'marketing' }], teams: ['marketing'] });
    await StaffProject.create({ name: 'Empty', owner: { user: a._id, name: 'Mia', team: 'marketing' }, teams: ['marketing'], dueOn: yesterday, rank: yesterday, createdBy: a._id });

    const mine = await itemsFor({ userId: String(a._id) }, new Date());
    const keys = mine.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining([`task:${t1._id}:${a._id}`, `project:${prj._id}`]));
    expect(mine.find((i) => i.key === `task:${t1._id}:${a._id}`)).toMatchObject({ bucket: 'late', task: { number: 1, rev: 1 } });
    expect(mine.find((i) => i.title.includes('Today'))).toMatchObject({ bucket: 'today' });
    expect(mine.some((i) => /Private|Not due|Empty/.test(i.title))).toBe(false);
    const bens = await itemsFor({ userId: String(b._id) }, new Date());
    expect(bens.map((i) => i.key)).toContain(`task:${t1._id}:${b._id}`);
  });
});

describe('API access and pages', () => {
  async function world() {
    const pHead = await person('procurement', { isHead: true, name: 'Proc head' });
    const p1 = await person('procurement', { name: 'P one' });
    const p2 = await person('procurement', { name: 'P two' });
    const sHead = await person('sales', { isHead: true, name: 'GTM head' });
    const s1 = await person('sales', { name: 'Seller' });
    const boss = await admin('Owner');
    const orders = [];
    for (const [who, name] of [[p1, 'A'], [p1, 'B'], [p2, 'C']]) {
      const o = await paidOrder(name);
      for (const i of o.items) await wf.setStock(who, String(o._id), String(i._id), { stock: 'in_stock' }, req);
      await age(String(o._id), 5);
      orders.push(o);
    }
    // A sales-owned step: out of stock → the customer decides (moved by procurement, owned by them).
    const yesterday = addDays(istDay(), -1);
    await StaffTask.create({ number: 9, title: 'Call back', createdBy: sHead._id, bucket: 'open', status: 'todo', dueOn: yesterday, rank: yesterday, assignee: s1._id, assignees: [{ user: s1._id, name: 'Seller', team: 'sales' }], teams: ['sales'] });
    return { pHead, p1, p2, sHead, s1, boss, orders };
  }

  it('no session → 401; plain staff → 403 on the ranking and on anyone else', async () => {
    const w = await world();
    expect((await request(app).get('/api/v1/staff/delays/me')).status).toBe(401);
    const h = await auth(w.p1);
    expect((await request(app).get('/api/v1/staff/delays').set(h)).status).toBe(403);
    const other = await request(app).get(`/api/v1/staff/delays/people/${w.p2._id}`).set(h);
    expect(other.status).toBe(403);
    expect(other.body.items).toBeUndefined();
    const self = await request(app).get(`/api/v1/staff/delays/people/${w.p1._id}`).set(h);
    expect(self.status).toBe(200);
  });

  it('my list: only my steps, late first, with the summary and no-store caching', async () => {
    const w = await world();
    const res = await request(app).get('/api/v1/staff/delays/me').set(await auth(w.p1));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.body.items).toHaveLength(4); // 2 orders × 2 lines
    expect(res.body.items.every((i) => i.owner.id === String(w.p1._id) && i.bucket === 'late')).toBe(true);
    expect(res.body.summary).toMatchObject({ late: 4, noReason: 4 });
  });

  it('a head sees only their own team, even when asking for another; admin sees everyone', async () => {
    const w = await world();
    const head = await request(app).get('/api/v1/staff/delays?team=sales').set(await auth(w.pHead));
    expect(head.status).toBe(200);
    expect(head.body.scope.team).toBe('procurement');
    expect(head.body.people.map((p) => p.name)).toEqual(['P one', 'P two']); // ranked by late count
    expect(head.body.people[0]).toMatchObject({ late: 4 });
    expect((await request(app).get(`/api/v1/staff/delays/people/${w.s1._id}`).set(await auth(w.pHead))).status).toBe(403);
    expect((await request(app).get(`/api/v1/staff/delays/people/${w.p2._id}`).set(await auth(w.pHead))).body.items).toHaveLength(2);

    const all = await request(app).get('/api/v1/staff/delays').set(await auth(w.boss));
    expect(all.body.people.map((p) => p.name)).toEqual(expect.arrayContaining(['P one', 'P two', 'Seller']));
    const sales = await request(app).get('/api/v1/staff/delays?team=sales').set(await auth(w.boss));
    expect(sales.body.people.map((p) => p.name)).toEqual(['Seller']);
    const one = await request(app).get(`/api/v1/staff/delays?person=${w.p2._id}`).set(await auth(w.boss));
    expect(one.body.people.map((p) => p.name)).toEqual(['P two']);
    const person = await request(app).get(`/api/v1/staff/delays/people/${w.s1._id}`).set(await auth(w.boss));
    expect(person.body.items.map((i) => i.title)).toEqual(['T-9 · Call back']);
  });

  it('pages are bounded and keyset: no repeats, no gaps; bad input is a 400', async () => {
    const w = await world();
    const h = await auth(w.p1);
    const seen = [];
    let cursor = '';
    for (let guard = 0; guard < 10; guard += 1) {
      const res = await request(app).get(`/api/v1/staff/delays/me?limit=1${cursor ? `&cursor=${cursor}` : ''}`).set(h);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(1);
      seen.push(...res.body.items.map((i) => i.key));
      if (!res.body.nextCursor) break;
      cursor = res.body.nextCursor;
    }
    const full = await request(app).get('/api/v1/staff/delays/me').set(h);
    expect(seen).toEqual(full.body.items.map((i) => i.key));
    expect(new Set(seen).size).toBe(4);

    expect((await request(app).get('/api/v1/staff/delays/me?limit=101').set(h)).status).toBe(400);
    expect((await request(app).get('/api/v1/staff/delays/me?limit=0').set(h)).status).toBe(400);
    expect((await request(app).get('/api/v1/staff/delays/me?cursor=%25%25bad').set(h)).status).toBe(400);
    expect((await request(app).get('/api/v1/staff/delays/me?control=maybe').set(h)).status).toBe(400);
    expect((await request(app).get('/api/v1/staff/delays/people/nope').set(h)).status).toBe(400);
  });

  it('a date filter keeps only steps due in that window', async () => {
    const w = await world();
    const h = await auth(w.boss);
    const future = addDays(istDay(), 30);
    const res = await request(app).get(`/api/v1/staff/delays?from=${future}`).set(h);
    expect(res.status).toBe(200);
    expect(res.body.people).toEqual([]);
  });
});
