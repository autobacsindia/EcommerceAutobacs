/**
 * Roav Points ledger + month close against a real MongoDB:
 * idempotency under retries and concurrency, verified-payment gate, returns
 * (in / out of the 30-day window, partial, after lock), refunds, recompute on a
 * flag change, lock → approve → CSV → reopen, rule versions, ratings, champion.
 */
import mongoose from 'mongoose';

process.env.INCENTIVES_START_MONTH = '2020-01';

const dbHandler = await import('./db-handler.js');
const { default: IncentiveLedgerEntry } = await import('../models/IncentiveLedgerEntry.js');
const { default: IncentiveMonth } = await import('../models/IncentiveMonth.js');
const { default: IncentiveOrderFlag } = await import('../models/IncentiveOrderFlag.js');
const { default: IncentiveRuleSet } = await import('../models/IncentiveRuleSet.js');
const { default: AuditLog } = await import('../models/AuditLog.js');
const ledger = await import('../services/incentives/ledgerService.js');
const months = await import('../services/incentives/monthService.js');
const ruleService = await import('../services/incentives/ruleService.js');
const { rulesCache } = ruleService;
const { INCENTIVE_DEFAULT_RULES } = await import('../config/incentiveDefaults.js');

const oid = () => new mongoose.Types.ObjectId();
const db = () => mongoose.connection.db;
const OCT = new Date('2026-10-10T06:00:00Z');
const NOV_NOW = new Date('2026-11-11T06:00:00Z');

const seller = { _id: oid(), name: 'Asha Seller' };
const seller2 = { _id: oid(), name: 'Bilal Seller' };

async function makeOrder({ total = 118000, tax = 18000, paidAt = OCT, salesUser = seller._id, lines = null, pay = 'razorpay', paymentStatus = 'paid', status = 'processing', ...over } = {}) {
  const _id = oid();
  const items = lines || [{ _id: oid(), product: oid(), quantity: 1, price: total }];
  await db().collection('orders').insertOne({
    _id, items, salesUser, totalAmount: total, subtotal: total, tax, discount: 0,
    paymentStatus, status, paidAt, listDate: paidAt, createdAt: paidAt, updatedAt: paidAt, ...over,
  });
  if (pay === 'razorpay') {
    await db().collection('payments').insertOne({ order: _id, amount: total, paymentGateway: 'razorpay', gatewayPaymentId: `pay_${_id}`, status: 'completed', createdAt: paidAt });
  } else if (pay === 'bank') {
    await db().collection('banktransfers').insertOne({ order: _id, amount: total, status: 'confirmed', reviewedAt: paidAt, paidOn: paidAt });
  } else if (pay === 'bank_pending') {
    await db().collection('banktransfers').insertOne({ order: _id, amount: total, status: 'pending', paidOn: paidAt });
  }
  return _id;
}

async function run(orderId, now = NOV_NOW) {
  const order = await db().collection('orders').findOne({ _id: orderId });
  const b = await ledger.loadBatchContext([order]);
  const k = String(orderId);
  return ledger.processOrder(order, {
    getRules: rulesCache(), months: ledger.monthStatusCache(), now, cache: {},
    payments: b.payments.get(k) || [], transfers: b.transfers.get(k) || [],
    returns: b.returns.get(k) || [], flag: b.flags.get(k) || null,
  });
}
const rowsFor = (orderId) => IncentiveLedgerEntry.find({ order: orderId }).sort({ _id: 1 }).lean();
const sum = (rows) => rows.reduce((a, r) => a + r.centi, 0);

beforeAll(async () => {
  await dbHandler.connect();
  await Promise.all([IncentiveLedgerEntry.init(), IncentiveMonth.init(), IncentiveOrderFlag.init(), IncentiveRuleSet.init()]);
});
// tests/setup.js empties every collection after each test, so seed the sellers before each.
beforeEach(async () => {
  await db().collection('users').insertMany([{ ...seller, role: 'staff', email: 'asha@t.test' }, { ...seller2, role: 'staff', email: 'bilal@t.test' }]);
});
afterAll(() => dbHandler.closeDatabase());
afterEach(async () => {
  for (const c of ['users', 'orders', 'payments', 'banktransfers', 'returnrequests', 'incentiveledgerentries', 'incentivemonths', 'incentiveorderflags', 'orderratings', 'auditlogs']) {
    await db().collection(c).deleteMany({});
  }
});

describe('earning', () => {
  test('a verified Razorpay order earns core + 200, in its paid month, with inputs snapshotted', async () => {
    const id = await makeOrder();
    expect(await run(id)).toEqual({ earned: 2, reversed: 0 });
    const rows = await rowsFor(id);
    expect(rows.map((r) => r.component).sort()).toEqual(['core', 'order']);
    expect(sum(rows)).toBe(196000 + 20000);
    expect(rows[0]).toMatchObject({ month: '2026-10', earnerKey: `u:${seller._id}`, earnerName: 'Asha Seller', rulesVersion: 1 });
    const coreRow = rows.find((r) => r.component === 'core');
    expect(coreRow.inputs).toMatchObject({ valueExGst: 100000, discountPercent: 0, discountKeep: 1, specialSourcing: false, paidVia: ['razorpay'] });
  });

  test('retry: running the same order 3× writes the rows once', async () => {
    const id = await makeOrder();
    await run(id); await run(id); await run(id);
    expect(await IncentiveLedgerEntry.countDocuments({ order: id })).toBe(2);
  });

  test('concurrency: 5 parallel runs still write the rows once', async () => {
    const id = await makeOrder();
    await Promise.all([1, 2, 3, 4, 5].map(() => run(id)));
    expect(await IncentiveLedgerEntry.countDocuments({ order: id })).toBe(2);
  });

  test('"paid" with no payment record (forced status) earns nothing', async () => {
    const id = await makeOrder({ pay: 'none' });
    expect(await run(id)).toEqual({ earned: 0, reversed: 0 });
  });

  test('a bank transfer counts only once accounts confirmed it', async () => {
    const pending = await makeOrder({ pay: 'bank_pending' });
    const confirmed = await makeOrder({ pay: 'bank' });
    expect((await run(pending)).earned).toBe(0);
    expect((await run(confirmed)).earned).toBe(2);
  });

  test('no seller → no points (website order)', async () => {
    const id = await makeOrder({ salesUser: null });
    expect((await run(id)).earned).toBe(0);
  });

  test('a name-only CRM rep is credited by rep id; a rep with a login by the login', async () => {
    const repId = oid(); const repWithLogin = oid();
    await db().collection('salesreps').insertMany([{ _id: repId, name: 'Rep Only' }, { _id: repWithLogin, name: 'Rep Login', user: seller2._id }]);
    const a = await makeOrder({ salesUser: null, salesRep: repId });
    const b = await makeOrder({ salesUser: null, salesRep: repWithLogin });
    await run(a); await run(b);
    expect((await rowsFor(a))[0].earnerKey).toBe(`r:${repId}`);
    expect((await rowsFor(b))[0].earnerKey).toBe(`u:${seller2._id}`);
    await db().collection('salesreps').deleteMany({});
  });

  test('ledger rows cannot be updated or deleted through the model', async () => {
    const id = await makeOrder();
    await run(id);
    await expect(IncentiveLedgerEntry.updateOne({ order: id }, { centi: 1 })).rejects.toThrow('append-only');
    await expect(IncentiveLedgerEntry.deleteMany({ order: id })).rejects.toThrow('append-only');
  });

  test('a payment landing after its month is locked goes to the current month', async () => {
    await IncentiveMonth.create({ month: '2026-10', status: 'locked' });
    const id = await makeOrder();
    await run(id);
    const rows = await rowsFor(id);
    expect(rows.every((r) => r.month === '2026-11')).toBe(true);
    expect(rows[0].inputs.landedLate).toBe(true);
  });
});

describe('returns and refunds', () => {
  const twoLine = () => {
    const a = { _id: oid(), product: oid(), quantity: 2, price: 59000 };
    const b = { _id: oid(), product: oid(), quantity: 1, price: 59000 };
    return { lines: [a, b], a, b };
  };
  const refundedReturn = (order, items, createdAt) => db().collection('returnrequests').insertOne({
    order, status: 'refunded', createdAt, updatedAt: createdAt, items, refund: { completedAt: createdAt },
  });

  test('return within 30 days reverses that line by quantity; +200 stays', async () => {
    const { lines, a } = twoLine();
    const id = await makeOrder({ total: 177000, tax: 27000, lines });
    await run(id);
    const before = await rowsFor(id);
    const aCore = before.find((r) => r.lineId === String(a._id) && r.component === 'core');
    await refundedReturn(id, [{ orderItemId: a._id, product: a.product, quantity: 1, unitPrice: 59000 }], new Date('2026-10-20T06:00:00Z'));
    expect((await run(id)).reversed).toBe(1);
    const rev = (await rowsFor(id)).filter((r) => r.type === 'reverse');
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ reason: 'return', month: '2026-10', reverses: aCore.key, centi: -Math.round(aCore.centi / 2) });
    // retry: nothing more
    expect((await run(id)).reversed).toBe(0);
  });

  test('return raised after 30 days keeps its points', async () => {
    const id = await makeOrder();
    const line = (await db().collection('orders').findOne({ _id: id })).items[0];
    await refundedReturn(id, [{ orderItemId: line._id, product: line.product, quantity: 1, unitPrice: 118000 }], new Date('2026-11-10T06:00:00Z'));
    await db().collection('orders').updateOne({ _id: id }, { $set: { paymentStatus: 'refunded', status: 'returned' } });
    await run(id);
    expect((await rowsFor(id)).filter((r) => r.type === 'reverse')).toHaveLength(0);
  });

  test('every line returned → the +200 goes too, net zero', async () => {
    const id = await makeOrder();
    const line = (await db().collection('orders').findOne({ _id: id })).items[0];
    await run(id);
    await refundedReturn(id, [{ orderItemId: line._id, product: line.product, quantity: 1, unitPrice: 118000 }], new Date('2026-10-15T06:00:00Z'));
    await db().collection('orders').updateOne({ _id: id }, { $set: { paymentStatus: 'refunded', status: 'returned' } });
    await run(id);
    expect(sum(await rowsFor(id))).toBe(0);
  });

  test('return after the month is locked: reversal lands in the current month, the locked month is untouched', async () => {
    const id = await makeOrder();
    const line = (await db().collection('orders').findOne({ _id: id })).items[0];
    await run(id);
    await months.lockMonth('2026-10', { now: NOV_NOW });
    const locked = await IncentiveMonth.findOne({ month: '2026-10' }).lean();
    await refundedReturn(id, [{ orderItemId: line._id, product: line.product, quantity: 1, unitPrice: 118000 }], new Date('2026-11-02T06:00:00Z'));
    await run(id);
    const rev = (await rowsFor(id)).filter((r) => r.type === 'reverse');
    expect(rev.length).toBeGreaterThan(0);
    expect(rev.every((r) => r.month === '2026-11')).toBe(true);
    const after = await IncentiveMonth.findOne({ month: '2026-10' }).lean();
    expect(after.statements).toEqual(locked.statements);
    // approve still matches: nothing new in October
    await expect(months.approveMonth('2026-10', { user: { _id: oid(), name: 'Admin' } })).resolves.toMatchObject({ status: 'approved' });
  });

  test('a whole-order refund (not from a return) reverses everything', async () => {
    const id = await makeOrder();
    await run(id);
    await db().collection('orders').updateOne({ _id: id }, { $set: { paymentStatus: 'refunded' } });
    await run(id);
    expect(sum(await rowsFor(id))).toBe(0);
    expect((await rowsFor(id)).filter((r) => r.type === 'reverse').every((r) => r.reason === 'refund')).toBe(true);
  });

  test('a cancelled paid order reverses everything', async () => {
    const id = await makeOrder();
    await run(id);
    await db().collection('orders').updateOne({ _id: id }, { $set: { status: 'cancelled' } });
    await run(id); await run(id);
    expect(sum(await rowsFor(id))).toBe(0);
  });
});

describe('special-sourcing flag', () => {
  test('toggling it after earning reverses rev 0 and earns rev 1 at 75%, net = the 75% figure', async () => {
    const id = await makeOrder();
    await run(id);
    await IncentiveOrderFlag.create({ order: id, specialSourcing: true, rev: 1 });
    await run(id); await run(id);
    const rows = await rowsFor(id);
    expect(sum(rows)).toBe(147000 + 20000);
    expect(rows.filter((r) => r.type === 'reverse').every((r) => r.reason === 'recompute')).toBe(true);
  });
});

describe('month close', () => {
  const admin = { _id: oid(), name: 'Owner' };
  const req = { user: admin, headers: {} };

  test('lock snapshots statements; approve; CSV; reopen needs a reason and is audited', async () => {
    const id = await makeOrder();
    await run(id);
    await expect(months.lockMonth('2026-11', { now: NOV_NOW })).rejects.toThrow(/after it ends/);
    const locked = await months.lockMonth('2026-10', { now: NOV_NOW, user: admin, req });
    expect(locked.status).toBe('locked');
    expect(locked.statements).toHaveLength(1);
    expect(locked.statements[0]).toMatchObject({ name: 'Asha Seller', orders: 1, finalPoints: 2160, slab: null, payoutPaise: 0 });
    await expect(months.exportCsv('2026-10')).rejects.toThrow(/Approve/);
    await months.approveMonth('2026-10', { user: admin, req });
    const csv = await months.exportCsv('2026-10');
    expect(csv.split('\r\n')[1]).toContain('Asha Seller');
    expect(csv).not.toMatch(/@|\+91|address/i);
    await expect(months.reopenMonth('2026-10', { user: admin, reason: '', req })).rejects.toThrow(/why/);
    const reopened = await months.reopenMonth('2026-10', { user: admin, reason: 'Wrong special-sourcing flag', req });
    expect(reopened.status).toBe('open');
    expect(reopened.history.map((h) => h.action)).toEqual(['locked', 'approved', 'reopened']);
    expect(await AuditLog.countDocuments({ action: 'REOPEN', resourceId: '2026-10' })).toBe(1);
    // auto-close does not re-lock a month an admin re-opened
    expect(await months.closePreviousMonth(NOV_NOW)).toBeNull();
  });

  test('approve refuses if the ledger moved after the lock; recompute fixes it', async () => {
    const id = await makeOrder();
    await run(id);
    await months.lockMonth('2026-10', { now: NOV_NOW });
    // a late row squeezed into October (a sweep that read the month as open)
    await IncentiveLedgerEntry.create({
      key: 'late', type: 'earn', month: '2026-10', earnerKey: `u:${seller._id}`, earnerUser: seller._id, earnerName: 'Asha Seller',
      share: 1, order: oid(), component: 'order', centi: 20000, flatCenti: 20000, rulesVersion: 1, eventAt: OCT,
    });
    await expect(months.approveMonth('2026-10', { user: admin })).rejects.toThrow(/Recompute/);
    await months.recomputeLocked('2026-10', { now: NOV_NOW });
    await expect(months.approveMonth('2026-10', { user: admin })).resolves.toMatchObject({ status: 'approved' });
  });

  test('auto-close locks last month once', async () => {
    await makeOrder().then(run);
    expect((await months.closePreviousMonth(NOV_NOW)).status).toBe('locked');
    expect(await months.closePreviousMonth(NOV_NOW)).toBeNull();
  });

  test('ratings (OrderRating) and returns move the month total; champion tie → higher rating', async () => {
    // two sellers, same points
    const a = await makeOrder({ salesUser: seller._id });
    const b = await makeOrder({ salesUser: seller2._id });
    await run(a); await run(b);
    const at = new Date('2026-10-20T06:00:00Z');
    await db().collection('orderratings').insertMany([
      ...[5, 5, 4].map((stars) => ({ order: a, salesperson: seller._id, stars, createdAt: at })), // 4.67 → ×1.05
      ...[4, 4, 4].map((stars) => ({ order: b, salesperson: seller2._id, stars, createdAt: at })), // 4.0 → ×1
    ]);
    const { statements } = await months.computeStatements('2026-10');
    const asha = statements.find((s) => s.name === 'Asha Seller');
    expect(asha.ratingFactor).toBe(1.05);
    expect(asha.finalPoints).toBe(Math.round(2160 * 1.05));
    expect(statements[0].name).toBe('Asha Seller');

    // equal final points → higher average rating wins
    const tie = [
      { name: 'X', finalPoints: 100, ratingAvg: 4.1, orders: 1 },
      { name: 'Y', finalPoints: 100, ratingAvg: 4.8, orders: 1 },
    ].sort(months.rankStatements);
    expect(tie[0].name).toBe('Y');
  });

  test('no OrderRating collection → no rating effect', async () => {
    await makeOrder().then(run);
    const { statements } = await months.computeStatements('2026-10');
    expect(statements[0]).toMatchObject({ ratingCount: 0, ratingFactor: 1 });
  });

  test('champion banner shows last month during the first days only', async () => {
    await makeOrder().then(run);
    await months.lockMonth('2026-10', { now: NOV_NOW });
    const day1 = await months.currentChampion(new Date('2026-11-01T03:00:00Z'));
    expect(day1).toMatchObject({ month: '2026-10', name: 'Asha Seller', showBanner: true });
    expect((await months.currentChampion(new Date('2026-11-20T03:00:00Z'))).showBanner).toBe(false);
  });

  test('statement rows are cursor-paginated', async () => {
    for (let i = 0; i < 3; i += 1) await makeOrder().then(run); // 6 rows
    const p1 = await months.statementRows('2026-10', `u:${seller._id}`, { limit: 4 });
    expect(p1.rows).toHaveLength(4);
    const p2 = await months.statementRows('2026-10', `u:${seller._id}`, { limit: 4, cursor: p1.nextCursor });
    expect(p2.rows).toHaveLength(2);
    expect(p2.nextCursor).toBeNull();
    expect(new Set([...p1.rows, ...p2.rows].map((r) => String(r._id))).size).toBe(6);
  });
});

describe('rule versions', () => {
  test('a new version may start next month at the earliest; past months keep their rules', async () => {
    const rules = structuredClone(INCENTIVE_DEFAULT_RULES);
    rules.perOrderBonus = 500;
    await expect(ruleService.saveVersion({ _id: oid(), name: 'Owner' }, { rules, effectiveFrom: '2026-11' }, NOV_NOW)).rejects.toThrow(/2026-12/);
    const v = await ruleService.saveVersion({ _id: oid(), name: 'Owner' }, { rules }, NOV_NOW);
    expect(v).toMatchObject({ version: 2, effectiveFrom: '2026-12' });
    expect((await ruleService.rulesForMonth('2026-11')).rules.perOrderBonus).toBe(200);
    expect((await ruleService.rulesForMonth('2027-01')).rules.perOrderBonus).toBe(500);
    await db().collection('incentiverulesets').deleteMany({ version: { $gt: 1 } });
  });

  test('the sweep finds sales orders and is idempotent end to end', async () => {
    await makeOrder({ paidAt: new Date('2026-11-05T06:00:00Z') });
    await makeOrder({ paidAt: new Date('2026-11-06T06:00:00Z'), salesUser: null }); // website
    const first = await ledger.runSweep({ now: NOV_NOW });
    expect(first).toMatchObject({ orders: 1, earned: 2, failed: 0 });
    const second = await ledger.runSweep({ now: NOV_NOW });
    expect(second).toMatchObject({ orders: 1, earned: 0, reversed: 0 });
  });
});
