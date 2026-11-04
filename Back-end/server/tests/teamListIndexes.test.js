/**
 * The team lists' date sorts must be served by an index, not by reading every row
 * and sorting it in memory. Measured on 100,000 orders / 20,000 quotations
 * (measure-pr4, MongoDB 7.0 as in production), before this was fixed:
 *   - Order processing / Delivered read ~50,000 orders per page (120 ms): the
 *     $or picking sales-panel and workflow orders sat under the other conditions,
 *     where MongoDB cannot use the two partial indexes it was written for (and as
 *     a top-level $or, which half got which index depended on the data — hence
 *     one find per half, see findEachBranch);
 *   - a seller's own orders read all 100,000 (`{ salesUser: id }` does not imply
 *     the index's `$type` filter, so the partial index was never a candidate);
 *   - the head's All quotations read all 20,000 and sorted them;
 *   - page 2 of any of them: the cursor's `a < x or (a = x and _id < y)` was split
 *     into index scans and every row found sorted in memory (16,000 orders read).
 *
 * This reads what the list services actually send (the database profiler), so a
 * change to a sort spec or a query shape that loses the index fails here. If it
 * does, compare ORDER_LIST_SORTS / QUOTATION_SORTS and the query builders against
 * the indexes in models/Order.js and models/SalesQuotation.js.
 *
 * Amount sorts are not covered: no index serves them (they sort the matching rows
 * in memory, measured ~105 ms at 50,000 paid orders) — a deliberate choice, noted
 * in listPaidSalesOrders.
 */
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));

const dbHandler = await import('./db-handler.js');
const { default: Order } = await import('../models/Order.js');
const { default: SalesQuotation } = await import('../models/SalesQuotation.js');
const quotes = await import('../services/salesQuotationService.js');
const sales = await import('../services/salesOrderService.js');
const attribution = await import('../services/orderAttributionService.js');
const wf = await import('../services/teamWorkflowService.js');
const { getAllOrdersAdmin } = await import('../controllers/orderController.js');
const { default: OrderPin } = await import('../models/OrderPin.js');

const oid = () => new mongoose.Types.ObjectId();
const staff = (team, isHead = false) => ({ _id: oid(), role: 'staff', name: team, staff: { active: true, team, isHead } });
const sellers = Array.from({ length: 5 }, () => staff('sales'));
const [rep] = sellers;
const head = staff('sales', true);
const accounts = staff('accounts');
const marketing = staff('marketing');
const procurement = staff('procurement');
const adminUser = { _id: oid(), role: 'admin', name: 'Admin' };
const t0 = Date.UTC(2025, 0, 1);
const HOUR = 3600e3;
const ORDERS = Number(process.env.TEAM_LIST_ORDERS || 1200);
const idAt = (date) => new mongoose.Types.ObjectId(mongoose.mongo.ObjectId.generate(Math.floor(date.getTime() / 1000)));

/** Run `fn` with the profiler on; return the plan summary of each find it sent to `collection`. */
async function plansOf(collection, fn) {
  const db = mongoose.connection.db;
  await db.command({ profile: 0 });
  await db.collection('system.profile').drop().catch(() => {});
  await db.command({ profile: 2 });
  try { await fn(); } finally { await db.command({ profile: 0 }); }
  const entries = await db.collection('system.profile').find({ ns: `${db.databaseName}.${collection}`, 'command.find': collection }).toArray();
  return entries.map((e) => ({ plan: e.planSummary, sortsInMemory: Boolean(e.hasSortStage), read: e.docsExamined }));
}

beforeAll(async () => {
  await dbHandler.connect();
  await Promise.all([Order.syncIndexes(), SalesQuotation.syncIndexes(), OrderPin.syncIndexes()]);
});
afterAll(async () => { await dbHandler.closeDatabase(); });
// tests/setup.js empties every collection after each test; the indexes stay.
beforeEach(async () => {
  // ORDERS orders: a fifth by salesmen, half of the rest website orders in the
  // team workflow, the remainder website orders never paid.
  await Order.collection.insertMany(Array.from({ length: ORDERS }, (_, i) => {
    const createdAt = new Date(t0 + i * HOUR);
    const bySeller = i % 5 === 0;
    const inWorkflow = !bySeller && i % 2 === 0;
    const paid = bySeller ? i % 3 !== 0 : inWorkflow;
    return {
      _id: oid(), user: oid(), source: bySeller ? 'offline' : 'web', salesUser: bySeller ? sellers[(i / 5) % sellers.length]._id : null,
      items: [{ product: oid(), name: 'Floor mat', price: 1000, quantity: 1 }],
      shippingAddress: { fullName: `Buyer ${i}`, phone: '9700000000', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      subtotal: 1000, totalAmount: 200 + ((i * 7919) % 50000),
      // Most paid orders have been delivered, as in the real data.
      status: paid ? ['processing', 'shipped', 'delivered', 'delivered', 'delivered', 'delivered'][(i * 7) % 6] : 'awaiting_payment',
      paymentStatus: paid ? 'paid' : 'pending', salesHold: null,
      ...(inWorkflow ? { workflow: { enteredAt: createdAt, open: true } } : {}),
      // The list date (utils/orderListDate.js): paid an hour after creation, or created.
      ...(paid ? { paidAt: new Date(createdAt.getTime() + HOUR / 2) } : {}),
      listDate: paid ? new Date(createdAt.getTime() + HOUR / 2) : createdAt,
      createdAt, updatedAt: createdAt,
    };
  }));
  await SalesQuotation.collection.insertMany(Array.from({ length: 600 }, (_, i) => {
    const createdAt = new Date(t0 + i * HOUR);
    return {
      _id: idAt(createdAt), number: `Q-${i}`, version: 1, status: ['open', 'open', 'accepted', 'cancelled'][i % 4],
      customer: { name: `C ${i}`, email: '', phone: '9800000000' }, items: [], subtotal: 1000,
      totalAmount: 200 + ((i * 7919) % 50000), salesUser: sellers[i % sellers.length]._id, hold: null,
      createdAt, updatedAt: createdAt,
    };
  }));
});

const indexed = (index) => expect.objectContaining({ plan: expect.stringContaining(`IXSCAN { ${index}`), sortsInMemory: false });
/** Page 1 and page 2 of `list(params)`, profiled. */
const twoPages = (collection, list, params) => plansOf(collection, async () => {
  const first = await list(params);
  expect(first.nextCursor).toBeTruthy();
  await list({ ...params, cursor: first.nextCursor });
});

describe('Order processing / Delivered', () => {
  it.each([
    ['Order processing, newest', { stage: 'processing' }],
    ['Delivered, oldest', { stage: 'delivered', sort: 'oldest' }],
    ['Order processing, newest, with dates', { stage: 'processing', from: '2025-01-05', to: '2025-02-20' }],
  ])('%s reads each half from its own partial index, in date order, page 1 and page 2', async (_, params) => {
    // One find per half (sales-panel orders, workflow orders) per page.
    const plans = await twoPages('orders', (p) => sales.listPaidSalesOrders(accounts, p), params);
    expect(plans).toHaveLength(4);
    for (const p of plans) {
      expect(p.plan).toMatch(/^IXSCAN \{ paymentStatus: 1, listDate: -1, _id: -1 \}(, IXSCAN \{ paymentStatus: 1, listDate: -1, _id: -1 \})*$/);
      expect(p.sortsInMemory).toBe(false);
      // 26 rows a page; the stage (status) is checked on each row the index
      // walk passes, so Order processing also steps over the delivered ones
      // (two thirds here): about three reads per row shown, plus the planner's
      // trial run (up to 101) — never the ~700 paid orders as before.
      expect(p.read).toBeLessThan(200);
    }
  });
});

describe('My orders', () => {
  // MongoDB 7.0 does not count `{ $eq: id, $type }` as one value for sorting, so
  // it still sorts in memory — but only that one seller's orders, read from their
  // index, never the whole collection.
  const ownOrders = ORDERS / 5 / sellers.length;
  it.each([
    ['a seller, newest', rep, {}],
    ['a seller, oldest', rep, { sort: 'oldest' }],
    ['the head, one salesman', head, { seller: String(rep._id) }],
  ])('%s reads only that seller\'s orders, from { salesUser, listDate }, page 1 and page 2', async (_, actor, params) => {
    const plans = await twoPages('orders', (p) => sales.listSalesOrders(actor, p), params);
    expect(plans).toHaveLength(2);
    for (const p of plans) {
      expect(p.plan).toBe('IXSCAN { salesUser: 1, listDate: -1, _id: -1 }');
      expect(p.read).toBeLessThanOrEqual(ownOrders);
    }
  });
});

describe('Paid-date lists outside the sales service (utils/orderListDate.js)', () => {
  it('Marketing (website orders) reads team_workflow_paid_list_date in order, page 1 and page 2', async () => {
    const plans = await twoPages('orders', (p) => attribution.listWebsiteOrders(marketing, p), {});
    expect(plans).toEqual([indexed('paymentStatus: 1, listDate: -1, _id: -1'), indexed('paymentStatus: 1, listDate: -1, _id: -1')]);
    for (const p of plans) expect(p.read).toBeLessThan(200);
  });

  it('Admin Orders, default sort, reads order_list_date in order (page 1 and page 2)', async () => {
    const run = (page) => plansOf('orders', async () => {
      const res = { json(b) { this.body = b; return this; }, status() { return this; } };
      await getAllOrdersAdmin({ query: { page: String(page) }, user: adminUser }, res);
      expect(res.body.orders.length).toBe(20);
    });
    for (const page of [1, 2]) {
      const [p] = await run(page);
      expect(p).toEqual(indexed('listDate: -1, _id: -1'));
      expect(p.read).toBeLessThan(200);
    }
  });

  it('a work queue walks team_workflow_open_list_date in order', async () => {
    const plans = await plansOf('orders', () => wf.listQueue(procurement, 'procurement', {}));
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) expect(p).toEqual(indexed('workflow.open: 1, listDate: 1, _id: 1'));
  });

  it('with pins: the pinned rows are one small id lookup; the page read keeps its index', async () => {
    const pinned = await Order.find({ salesUser: { $type: 'objectId' }, paymentStatus: 'paid' }).select('_id').limit(5).lean();
    await OrderPin.insertMany(pinned.map((o, i) => ({ user: accounts._id, order: o._id, pinnedAt: new Date(t0 + i) })));
    const plans = await twoPages('orders', (p) => sales.listPaidSalesOrders(accounts, p), { stage: 'processing' });
    const lookups = plans.filter((p) => !/listDate/.test(p.plan));
    expect(lookups).toHaveLength(1); // page 1 only
    expect(lookups[0].read).toBeLessThanOrEqual(5);
    for (const p of plans.filter((x) => /listDate/.test(x.plan))) expect(p.sortsInMemory).toBe(false);
  });
});

describe('Quotations', () => {
  it.each([
    ['a seller, All, newest', rep, {}, 'salesUser: 1, _id: -1'],
    ['a seller, Open, oldest', rep, { status: 'open', sort: 'oldest' }, 'salesUser: 1, _id: -1'],
    ['the head, Open, newest', head, { status: 'open' }, 'status: 1, _id: -1'],
    ['the head, All, newest', head, {}, '_id: 1'],
  ])('%s is read in index order, page 1 and page 2', async (_, actor, params, index) => {
    const plans = await twoPages('salesquotations', (p) => quotes.listQuotations(actor, p), params);
    expect(plans).toEqual([indexed(index), indexed(index)]);
  });
});
