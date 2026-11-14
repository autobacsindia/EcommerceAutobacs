/**
 * "My Roav Points" (routes/incentives.js /me, /me/orders, /me/ratings):
 * a salesperson's own month, order by order. Own data only, read-only, and the
 * per-order points add up to exactly the admin statement's ledger points.
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

jest.setTimeout(120000);
process.env.INCENTIVES_START_MONTH = '2020-01';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, enqueueMetaLeadSheetWrite: () => Promise.resolve(), closeQueues: () => Promise.resolve(),
}));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: OrderRating } = await import('../models/OrderRating.js');
const { default: IncentiveLedgerEntry } = await import('../models/IncentiveLedgerEntry.js');
const { default: IncentiveMonth } = await import('../models/IncentiveMonth.js');
const { monthOf, addMonths } = await import('../services/incentives/months.js');
const { ratingVisibility, orderStatus } = await import('../services/incentives/myStatement.js');

const BASE = '/api/v1/incentives';
const PW = 'SecurePass123!';
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PW });
  expect(res.status).toBe(200);
  return { get: (url) => agent.get(`${BASE}${url}`), post: (url) => agent.post(`${BASE}${url}`).send({}) };
}
let n = 0;
async function makeUser(name, role, staff) {
  n += 1;
  const email = `${name.toLowerCase().replace(/\s/g, '')}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, s: await signIn(email) };
}

const month = monthOf(new Date());
const oid = () => new mongoose.Types.ObjectId();
let k = 0;
const ledger = (user, order, centi, extra = {}) => {
  k += 1;
  return {
    key: `k:${k}:${oid()}`, type: 'earn', month, earnerKey: `u:${user._id}`, earnerUser: user._id,
    earnerName: user.name, share: 1, order, orderNumber: `#${String(order).slice(-8).toUpperCase()}`, component: 'core',
    centi, flatCenti: centi, rulesVersion: 1, eventAt: new Date(), inputs: {}, ...extra,
  };
};
const earnInputs = (value, extra = {}) => ({
  valueExGst: value, discountPercent: 5, discountKeep: 0.85, specialSourcing: false, sourcingKeep: 1, isB2B: false,
  portions: [{ from: 0, to: value, multiplier: 1 }], ...extra,
});
/** Raw order docs (the Order schema needs a full checkout; these routes read 4 fields). */
const insertOrder = (fields) => Order.collection.insertOne({
  _id: oid(), createdAt: new Date(), shippingAddress: { fullName: 'Ravi Kumar', phone: '9999999999', addressLine1: 'x', city: 'x', state: 'x', postalCode: '1' },
  ...fields,
}).then((r) => r.insertedId);

describe('My Roav Points — own statement, order by order', () => {
  let asha; let bilal; let shopper; let orderA; let orderB; let orderC;
  beforeAll(async () => {
    await dbHandler.connect();
    await Promise.all([IncentiveLedgerEntry.init(), IncentiveMonth.init()]);
  });
  beforeEach(async () => {
    ratingVisibility.staffSeeOwnDetails = true; // the owner's answer, 2026-11-14
    asha = await makeUser('Asha', 'staff', { team: 'sales', subRole: 'lead', active: true });
    bilal = await makeUser('Bilal', 'staff', { team: 'sales', subRole: 'lead', active: true });
    shopper = await makeUser('Shopper', 'customer');
    orderA = await insertOrder({ salesUser: asha.user._id, paymentStatus: 'paid', listDate: new Date() });
    orderB = await insertOrder({ salesUser: asha.user._id, paymentStatus: 'paid', listDate: new Date(), shippingAddress: { fullName: 'Meena S', phone: '8888888888' } });
    orderC = await insertOrder({ salesUser: bilal.user._id, paymentStatus: 'paid', listDate: new Date() });
    await IncentiveLedgerEntry.insertMany([
      // A: earned in full, with the +200 paid-order bonus
      ledger(asha.user, orderA, 196000, { inputs: earnInputs(100000) }),
      ledger(asha.user, orderA, 20000, { component: 'order' }),
      // B: earned, then returned in full
      ledger(asha.user, orderB, 98000, { inputs: earnInputs(50000, { specialSourcing: true, sourcingKeep: 0.75 }) }),
      ledger(asha.user, orderB, -98000, { type: 'reverse', reason: 'return', inputs: { fraction: 1, earnMonth: month } }),
      // C: Bilal's — must never show for Asha
      ledger(bilal.user, orderC, 500000, { inputs: earnInputs(250000) }),
    ]);
  });
  afterAll(async () => {
    ratingVisibility.staffSeeOwnDetails = true;
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  test('lists only my orders, with points, bonus, status and the inputs', async () => {
    const res = await asha.s.get(`/me/orders?month=${month}`);
    expect(res.status).toBe(200);
    expect(res.body.orders.map((o) => o.order).sort()).toEqual([String(orderA), String(orderB)].sort());
    const a = res.body.orders.find((o) => o.order === String(orderA));
    expect(a).toMatchObject({
      customerName: 'Ravi Kumar', valueExGst: 100000, discountPercent: 5, discountKeep: 0.85,
      basePoints: 1960, bonusPoints: 200, points: 2160, status: 'counted', specialSourcing: false,
    });
    expect(a.lines).toHaveLength(2);
    const b = res.body.orders.find((o) => o.order === String(orderB));
    expect(b).toMatchObject({ points: 0, status: 'reversed', specialSourcing: true, sourcingKeep: 0.75 });
    expect(b.lines.map((l) => [l.type, l.reason, l.points])).toEqual([['earn', null, 980], ['reverse', 'return', -980]]);
    // No customer contact details leave the server.
    expect(JSON.stringify(res.body)).not.toMatch(/9999999999|8888888888|phone/);
  });

  test('per-order points add up to exactly the statement the admin sees', async () => {
    const [me, orders] = await Promise.all([asha.s.get(`/me?month=${month}`), asha.s.get(`/me/orders?month=${month}`)]);
    const sum = orders.body.orders.reduce((t, o) => t + o.points, 0);
    expect(sum).toBeCloseTo(me.body.statement.ledgerPoints, 2);
    expect(me.body.bonusOrders).toBe(1);
    expect(me.body.policy.rating).toMatchObject({ minCount: 3, highMultiplier: 1.05, lowMultiplier: 0.9 });
  });

  test('another person\'s points cannot be read by changing an id', async () => {
    // A person parameter on /me/* is ignored: it is always the caller.
    const sneaky = await asha.s.get(`/me/orders?month=${month}&earnerKey=u:${bilal.user._id}`);
    expect(sneaky.body.orders.map((o) => o.order)).not.toContain(String(orderC));
    expect((await asha.s.get(`/people/u:${bilal.user._id}`)).status).toBe(403);
    expect((await asha.s.get(`/people/u:${bilal.user._id}/rows`)).status).toBe(403);
    expect((await shopper.s.get('/me/orders')).status).toBe(403);
  });

  test('read-only: staff cannot lock, recompute or approve', async () => {
    const past = addMonths(month, -1);
    for (const a of ['lock', 'recompute', 'approve']) {
      expect((await asha.s.post(`/months/${past}/${a}`)).status).toBe(403);
    }
  });

  test('an empty month is empty, not an error', async () => {
    const empty = addMonths(month, -14);
    const [me, orders] = await Promise.all([asha.s.get(`/me?month=${empty}`), asha.s.get(`/me/orders?month=${empty}`)]);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ points: 0, statement: null, bonusOrders: 0, ratingsExcluded: 0 });
    expect(orders.body).toMatchObject({ orders: [], nextCursor: null, pending: [] });
  });

  test('a locked month shows its snapshot', async () => {
    const past = addMonths(month, -1);
    await IncentiveMonth.create({
      month: past, status: 'approved', rulesVersion: 1, lockedAt: new Date(), approvedAt: new Date(),
      statements: [{
        earnerKey: `u:${asha.user._id}`, name: 'Asha', orders: 3, returnedOrders: 0, ratingCount: 3, ratingAvg: 4.7,
        centi: 1200000, flatCenti: 1200000, rows: 4, ledgerPoints: 12000, returnRate: 0, returnFactor: 1,
        ratingFactor: 1.05, finalPoints: 12600, slab: 'Crank', ratePerPoint: 0.28, payoutPaise: 352800,
      }],
    });
    const me = await asha.s.get(`/me?month=${past}`);
    expect(me.body).toMatchObject({ status: 'approved', points: 12600, slab: 'Crank', payout: 3528 });
    // Bilal has no line in the snapshot.
    expect((await bilal.s.get(`/me?month=${past}`)).body).toMatchObject({ status: 'approved', points: 0, statement: null });
  });

  test('cursor pages through orders without repeats', async () => {
    const p1 = await asha.s.get(`/me/orders?month=${month}&limit=1`);
    expect(p1.body.orders).toHaveLength(1);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await asha.s.get(`/me/orders?month=${month}&limit=1&cursor=${p1.body.nextCursor}`);
    expect(p2.body.orders).toHaveLength(1);
    expect(p2.body.orders[0].order).not.toBe(p1.body.orders[0].order);
    expect(p2.body.nextCursor).toBeNull();
    expect(p2.body.pending).toEqual([]); // pending rides on the first page only
    expect((await asha.s.get(`/me/orders?month=${month}&cursor=nope`)).status).toBe(400);
    expect((await asha.s.get('/me/orders?month=2026-13')).status).toBe(400);
  });

  test('a paid order with no points yet shows as waiting for the payment check', async () => {
    const waiting = await insertOrder({ salesUser: asha.user._id, paymentStatus: 'paid', listDate: new Date(), wpId: 9001 });
    await insertOrder({ salesUser: asha.user._id, paymentStatus: 'pending', listDate: new Date() });
    const res = await asha.s.get(`/me/orders?month=${month}`);
    expect(res.body.pending).toEqual([expect.objectContaining({ order: String(waiting), orderNumber: '#9001', status: 'pending' })]);
  });

  test('ratings switched off: count + average only; same-network ones are left out', async () => {
    ratingVisibility.staffSeeOwnDetails = false;
    const at = new Date();
    await OrderRating.collection.insertMany([
      { order: orderA, salesperson: asha.user._id, stars: 5, comment: 'Great help', createdAt: at },
      { order: orderB, salesperson: asha.user._id, stars: 4, comment: '', createdAt: at },
      { order: oid(), salesperson: asha.user._id, stars: 1, comment: 'self', sameNetworkAsSender: true, createdAt: at },
    ]);
    const me = await asha.s.get(`/me?month=${month}`);
    expect(me.body.statement).toMatchObject({ ratingCount: 2, ratingAvg: 4.5 });
    expect(me.body.ratingsExcluded).toBe(1);
    // With the switch off, stars and comments stay hidden.
    expect((await asha.s.get(`/me/ratings?month=${month}`)).body).toMatchObject({ visible: false, ratings: [] });
    const orders = await asha.s.get(`/me/orders?month=${month}`);
    expect(orders.body.ratingDetails).toBe(false);
    expect(orders.body.orders.every((o) => o.rating === null)).toBe(true);
    expect(JSON.stringify(orders.body)).not.toMatch(/Great help/);
  });

  test('ratings (owner said yes): my own stars and comments show, the left-out one marked, nobody else\'s', async () => {
    expect(ratingVisibility.staffSeeOwnDetails).toBe(true);
    const at = new Date();
    await OrderRating.collection.insertMany([
      { order: orderA, salesperson: asha.user._id, stars: 5, comment: 'Great help', createdAt: at },
      { order: orderB, salesperson: asha.user._id, stars: 2, comment: 'self', sameNetworkAsSender: true, createdAt: at },
      { order: orderC, salesperson: bilal.user._id, stars: 1, comment: 'not hers', createdAt: at },
    ]);
    const r = await asha.s.get(`/me/ratings?month=${month}`);
    expect(r.body.visible).toBe(true);
    expect(r.body.ratings.map((x) => [x.stars, x.counted]).sort()).toEqual([[2, false], [5, true]]);
    expect(JSON.stringify(r.body)).not.toMatch(/not hers/);
    const orders = await asha.s.get(`/me/orders?month=${month}`);
    expect(orders.body.orders.find((o) => o.order === String(orderB)).rating).toMatchObject({ stars: 2, counted: false });
  });

  test('order status words', () => {
    expect(orderStatus({ netCenti: 100, reversals: 0 })).toBe('counted');
    expect(orderStatus({ netCenti: 0, reversals: 1, recomputeOnly: false })).toBe('reversed');
    expect(orderStatus({ netCenti: 50, reversals: 1, recomputeOnly: false })).toBe('partly_reversed');
    expect(orderStatus({ netCenti: 100, reversals: 2, recomputeOnly: true })).toBe('counted');
  });
});
