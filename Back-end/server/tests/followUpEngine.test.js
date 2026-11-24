/**
 * The order follow-up engine (services/followUp/*) against an in-memory Mongo.
 * Time is moved by passing `now` to the sweep, never by faking timers. Push is
 * mocked; nothing real is ever sent.
 *
 * What must hold:
 *   - each ladder level reaches people ONCE per cycle — same sweep twice, two
 *     sweeps at once (replicas), restarts
 *   - office time: no alert at night / Sunday / holiday; deadlines skip them
 *   - owner = the person who moved the line in (not a later annotator), frozen at
 *     the moment it went late; left → team head; no head → admins
 *   - a reason with a next date pauses the ladder; it restarts at `due` after it
 *   - shadow records everything and sends nothing; flipping to live does not
 *     replay what shadow already claimed
 *   - the row resolves (and its pop-ups clear) when the step moves on
 *   - the scan is bounded, and a truncated scan never resolves what it did not read
 *   - rows are append-only
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {},
  closeQueues: () => Promise.resolve(),
}));
const pushes = [];
const pushMock = {
  pushConfigured: () => true, publicKey: () => 'k', cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}),
  sendToUsers: async (recipients, message) => { pushes.push({ to: recipients.map((r) => String(r.userId)), urls: recipients.map((r) => r.url), ...message }); return recipients.length; },
  sendTest: async () => ({ sent: 1 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: Order } = await import('../models/Order.js');
const { default: User } = await import('../models/User.js');
const { default: FollowUpDelay } = await import('../models/FollowUpDelay.js');
const { default: StaffTaskInbox } = await import('../models/StaffTaskInbox.js');
const { default: orderRepository } = await import('../repositories/orderRepository.js');
const engine = await import('../services/followUp/index.js');
const { loadFollowUpConfig, resetFollowUpWarnings } = await import('../config/followUp.js');
const inbox = await import('../services/staffTaskInboxService.js');
const { buildIndexes } = await import('../scripts/create-followup-indexes.js');

const { runFollowUpSweep, giveReason, excuseDelay, listDelays } = engine;

/** A moment in India time: ist('2026-11-23 10:00'). 2026-11-23 is a Monday. */
const ist = (s) => new Date(`${s.replace(' ', 'T')}:00+05:30`);
const LIVE = Object.freeze({ FOLLOWUP_MODE: 'live', STAFF_HOLIDAYS: '' });
const SHADOW = Object.freeze({ FOLLOWUP_MODE: 'shadow', STAFF_HOLIDAYS: '' });
const sweep = (when, env = LIVE) => runFollowUpSweep({ now: ist(when), env });
const OFFICE = loadFollowUpConfig(LIVE).office;

let n = 0;
const person = (team, { isHead = false, role = 'staff', active = true } = {}) => User.create({
  name: `${team} ${++n}`, email: `fu${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
  ...(role === 'staff' ? { staff: { team, isHead, active } } : {}),
});
const ev = (who, action, itemId, at) => ({
  at: ist(at), by: who._id, byName: who.name, team: who.staff?.team || '', action, itemId,
});

/** An open order whose lines sit where `lines` says; `history(items)` writes its moves. */
async function openOrder({ lines = [{}], entered = '2026-11-23 09:40', history = () => [], shipments = () => [] } = {}) {
  const items = lines.map((_, i) => ({
    _id: new mongoose.Types.ObjectId(), product: new mongoose.Types.ObjectId(), name: `Part ${i + 1}`, price: 1000, quantity: 1,
  }));
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items,
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 1000 * items.length, totalAmount: 1000 * items.length, status: 'processing', paymentStatus: 'paid',
    shipments: shipments(items),
    workflow: {
      enteredAt: ist(entered),
      open: true,
      lines: lines.map((l, i) => ({ itemId: items[i]._id, stock: 'pending', ...l })),
      history: [{ at: ist(entered), action: 'entered' }, ...history(items)],
    },
  });
  return { order, items };
}

const rows = () => FollowUpDelay.find({}).sort({ _id: 1 }).lean();
const lines = (user) => StaffTaskInbox.find(user ? { user: user._id } : {}).sort({ _id: 1 }).lean();
const levelsOf = (row) => row.levelsReached.map((l) => l.level);

let buyer; let packer; let head; let admin; // procurement member, procurement head, admin
beforeAll(async () => {
  // The unique key is what makes concurrent sweeps safe: build it like prod does.
  await FollowUpDelay.init();
  await buildIndexes({ apply: true, log: () => {} });
});
beforeEach(async () => {
  pushes.length = 0;
  resetFollowUpWarnings();
  buyer = await person('procurement');
  packer = await person('procurement');
  head = await person('procurement', { isHead: true });
  admin = await person('admin', { role: 'admin' });
});

// ── Office time ────────────────────────────────────────────────────────────

describe('office clock', () => {
  const { isOfficeTime, addOfficeMinutes, officeMinutesBetween, snapToOffice } = engine;

  it('09:30–18:30 IST, Monday to Saturday', () => {
    expect(isOfficeTime(ist('2026-11-23 09:29'), OFFICE)).toBe(false);
    expect(isOfficeTime(ist('2026-11-23 09:30'), OFFICE)).toBe(true);
    expect(isOfficeTime(ist('2026-11-23 18:29'), OFFICE)).toBe(true);
    expect(isOfficeTime(ist('2026-11-23 18:30'), OFFICE)).toBe(false);
    expect(isOfficeTime(ist('2026-11-22 11:00'), OFFICE)).toBe(false); // Sunday
    expect(isOfficeTime(ist('2026-11-28 11:00'), OFFICE)).toBe(true); // Saturday
  });

  it('a deadline skips the night and Sunday', () => {
    // Saturday 17:30 + 2 office hours = 1 h on Saturday + 1 h on Monday.
    expect(addOfficeMinutes(ist('2026-11-21 17:30'), 120, OFFICE)).toEqual(ist('2026-11-23 10:30'));
    // Monday 22:00 + 30 min → Tuesday 10:00.
    expect(addOfficeMinutes(ist('2026-11-23 22:00'), 30, OFFICE)).toEqual(ist('2026-11-24 10:00'));
    expect(snapToOffice(ist('2026-11-22 08:00'), OFFICE)).toEqual(ist('2026-11-23 09:30'));
    expect(officeMinutesBetween(ist('2026-11-23 09:30'), ist('2026-11-24 09:30'), OFFICE)).toBe(540);
  });

  it('a holiday does not count', () => {
    const office = loadFollowUpConfig({ ...LIVE, STAFF_HOLIDAYS: '2026-11-24' }).office;
    expect(isOfficeTime(ist('2026-11-24 11:00'), office)).toBe(false);
    expect(addOfficeMinutes(ist('2026-11-23 18:00'), 60, office)).toEqual(ist('2026-11-25 10:00'));
  });

  it('the sweep does nothing at night, on Sunday or on a holiday', async () => {
    await openOrder({ entered: '2026-11-20 10:00' }); // long overdue
    expect((await sweep('2026-11-23 20:00')).skipped).toBe('outside_office');
    expect((await sweep('2026-11-22 12:00')).skipped).toBe('outside_office');
    expect((await runFollowUpSweep({ now: ist('2026-11-24 12:00'), env: { ...LIVE, STAFF_HOLIDAYS: '2026-11-24' } })).skipped).toBe('outside_office');
    expect(await rows()).toHaveLength(0);
    expect(pushes).toHaveLength(0);
  });
});

// ── Config ─────────────────────────────────────────────────────────────────

describe('config', () => {
  it('defaults: shadow, 09:30–18:30 Mon–Sat, the agreed SLAs', () => {
    const cfg = loadFollowUpConfig({});
    expect(cfg.mode).toBe('shadow');
    expect(cfg.office).toMatchObject({ startMinute: 570, endMinute: 1110, days: [1, 2, 3, 4, 5, 6] });
    expect(cfg.sla).toMatchObject({ stock_check: 120, own_stock: 540, to_ship: 240, with_supplier: 1620, shipped: 1620 });
    expect(cfg.problems).toEqual([]);
  });

  it('a bad value falls back to the default and is logged once', () => {
    const log = jest.fn();
    const env = { FOLLOWUP_MODE: 'loud', FOLLOWUP_OFFICE_START: '25:00', FOLLOWUP_SLA_TO_SHIP_MIN: '-3', FOLLOWUP_OFFICE_DAYS: '6-1' };
    const cfg = loadFollowUpConfig(env, log);
    expect(cfg.mode).toBe('shadow');
    expect(cfg.office.startMinute).toBe(570);
    expect(cfg.office.days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(cfg.sla.to_ship).toBe(240);
    expect(log).toHaveBeenCalledTimes(4);
    loadFollowUpConfig(env, log);
    expect(log).toHaveBeenCalledTimes(4);
  });

  it('good overrides apply', () => {
    const cfg = loadFollowUpConfig({ FOLLOWUP_MODE: 'LIVE', FOLLOWUP_OFFICE_START: '10:00', FOLLOWUP_OFFICE_DAYS: '1,2,3,4,5', FOLLOWUP_SLA_TO_SHIP_MIN: '60' });
    expect(cfg).toMatchObject({ mode: 'live', sla: expect.objectContaining({ to_ship: 60 }) });
    expect(cfg.office).toMatchObject({ startMinute: 600, days: [1, 2, 3, 4, 5] });
  });
});

// ── The ladder ─────────────────────────────────────────────────────────────

describe('ladder', () => {
  /** Buyer marks the line in stock at Monday 10:00 → "In Stock", 240 office minutes → due 14:00. */
  const inStock = () => openOrder({
    lines: [{ stock: 'in_stock' }],
    history: (items) => [ev(buyer, 'stock_in_stock', items[0]._id, '2026-11-23 10:00')],
  });

  it('remind → due → head → admin, each once, to the right people', async () => {
    await inStock();
    await sweep('2026-11-23 12:00'); // before the reminder (13:00)
    expect(await rows()).toHaveLength(0);

    await sweep('2026-11-23 13:05');
    let [row] = await rows();
    expect(row).toMatchObject({ stage: 'to_ship', team: 'procurement', lateAt: null, owner: { name: buyer.name, source: 'mover' } });
    expect(row.dueAt).toEqual(ist('2026-11-23 14:00'));
    expect(levelsOf(row)).toEqual(['remind']);
    expect((await lines(buyer)).map((l) => [l.kind, l.state])).toEqual([['followup_due', 'alert']]);
    expect(pushes).toHaveLength(0); // a reminder is panel-only

    await sweep('2026-11-23 14:05');
    [row] = await rows();
    expect(row.lateAt).toEqual(ist('2026-11-23 14:00'));
    expect(row.ownerAtLate).toMatchObject({ name: buyer.name, team: 'procurement', source: 'mover' });
    expect(pushes.map((p) => p.to)).toEqual([[String(buyer._id)]]);
    expect(pushes[0].urls).toEqual(['/team/orders']);

    await sweep('2026-11-23 18:05'); // due + 4 office hours = 18:00 → the head
    expect((await lines(head)).map((l) => l.kind)).toEqual(['followup_escalated']);

    await sweep('2026-11-24 14:05'); // due + 1 office day = Tuesday 14:00 → admins
    expect((await lines(admin)).map((l) => l.kind)).toEqual(['followup_escalated']);
    expect(pushes.at(-1).urls).toEqual([expect.stringMatching(/^\/admin\/orders\?order=/)]);

    [row] = await rows();
    expect(levelsOf(row)).toEqual(['remind', 'due', 'head', 'admin']);
    expect(row.levelsReached.every((l) => l.mode === 'live')).toBe(true);
    expect(pushes).toHaveLength(3);
  });

  it('the same sweep twice, and two at once (replicas), alert once per level', async () => {
    await inStock();
    await sweep('2026-11-23 14:05');
    await sweep('2026-11-23 14:05');
    await Promise.all([sweep('2026-11-23 18:05'), sweep('2026-11-23 18:05'), sweep('2026-11-23 18:06')]);
    await Promise.all([sweep('2026-11-24 14:05'), sweep('2026-11-24 14:05')]);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(levelsOf(all[0])).toEqual(['due', 'head', 'admin']); // the remind point was missed: never sent late
    expect(await lines(buyer)).toHaveLength(1);
    expect(await lines(head)).toHaveLength(1);
    expect(await lines(admin)).toHaveLength(1);
    expect(pushes).toHaveLength(3);
  });

  it('a step found late after a missed morning fires each reached level once, nobody twice', async () => {
    await inStock();
    await sweep('2026-11-24 15:00'); // due, head and admin are all past
    const [row] = await rows();
    expect(levelsOf(row)).toEqual(['due', 'head', 'admin']);
    expect(pushes.map((p) => p.to)).toEqual([[String(buyer._id)], [String(head._id)], [String(admin._id)]]);
  });

  it('a deadline that crosses Sunday is late on Monday, not before', async () => {
    await openOrder({
      lines: [{ stock: 'in_stock' }],
      entered: '2026-11-21 16:00',
      history: (items) => [ev(buyer, 'stock_in_stock', items[0]._id, '2026-11-21 17:00')],
    });
    // Saturday 17:00–18:30 = 90 min, then 150 on Monday → 12:00.
    await sweep('2026-11-23 11:55');
    expect((await rows())[0].lateAt).toBeNull();
    await sweep('2026-11-23 12:01');
    expect((await rows())[0].lateAt).toEqual(ist('2026-11-23 12:00'));
  });
});

// ── Owners ─────────────────────────────────────────────────────────────────

describe('owner', () => {
  it('is the person who moved the line in — a later note by someone else changes nothing', async () => {
    await openOrder({
      lines: [{ stock: 'in_stock' }],
      history: (items) => [
        ev(buyer, 'stock_in_stock', items[0]._id, '2026-11-23 10:00'),
        ev(packer, 'part_edited', items[0]._id, '2026-11-23 11:30'),
      ],
    });
    await sweep('2026-11-23 14:05');
    const [row] = await rows();
    expect(row.enteredAt).toEqual(ist('2026-11-23 10:00'));
    expect(row.ownerAtLate.user).toEqual(buyer._id);
  });

  it('stays the owner at the time it went late, even after they leave', async () => {
    await openOrder({
      lines: [{ stock: 'in_stock' }],
      history: (items) => [ev(buyer, 'stock_in_stock', items[0]._id, '2026-11-23 10:00')],
    });
    await sweep('2026-11-23 14:05');
    await User.updateOne({ _id: buyer._id }, { $set: { 'staff.active': false } });
    await sweep('2026-11-23 18:05');
    const [row] = await rows();
    expect(row.ownerAtLate).toMatchObject({ name: buyer.name, source: 'mover' });
    const page = await listDelays({ ownerId: String(buyer._id) });
    expect(page.items.map((d) => d.owner.name)).toEqual([buyer.name]);
  });

  it('owner left before it went late → the team head owns it', async () => {
    await User.updateOne({ _id: buyer._id }, { $set: { 'staff.active': false } });
    await openOrder({
      lines: [{ stock: 'in_stock' }],
      history: (items) => [ev(buyer, 'stock_in_stock', items[0]._id, '2026-11-23 10:00')],
    });
    await sweep('2026-11-23 14:05');
    const [row] = await rows();
    expect(row.ownerAtLate).toMatchObject({ name: head.name, source: 'team_head' });
    expect(pushes.map((p) => p.to)).toEqual([[String(head._id)]]);
    // The head level never goes to the owner themself: no other head → admins.
    await sweep('2026-11-23 18:05');
    expect(pushes.at(-1).to).toEqual([String(admin._id)]);
  });

  it('nobody moved it (a new order) and the team has no head → admins', async () => {
    await User.updateOne({ _id: head._id }, { $set: { 'staff.isHead': false } });
    await openOrder({ entered: '2026-11-23 09:40' }); // stock check, 120 min → 11:40
    await sweep('2026-11-23 11:45');
    const [row] = await rows();
    expect(row).toMatchObject({ stage: 'stock_check', ownerAtLate: { user: null, name: 'Admins', source: 'admins' } });
    expect(pushes.map((p) => p.to)).toEqual([[String(admin._id)]]);
    // Admins already heard in this cycle: the head and admin levels are claimed, nobody re-told.
    await sweep('2026-11-24 12:00');
    expect(levelsOf((await rows())[0])).toEqual(['due', 'head', 'admin']);
    expect(pushes).toHaveLength(1);
  });

  it('an admin moving a line does not make the admin its owner', async () => {
    await openOrder({
      lines: [{ stock: 'ordered' }],
      history: (items) => [ev(admin, 'stock_ordered', items[0]._id, '2026-11-23 10:00')],
    });
    await sweep('2026-11-26 10:00'); // 3 office days → Thursday 10:00
    expect((await rows())[0].ownerAtLate).toMatchObject({ name: head.name, source: 'team_head' });
  });

  it('a parcel belongs to whoever set its expected date; late the morning after the grace day', async () => {
    const ops = await person('operations');
    await openOrder({
      lines: [{ stock: 'in_stock' }],
      shipments: (items) => [{
        sequence: 1, status: 'shipped', shippedAt: ist('2026-11-20 12:00'), createdBy: packer._id,
        lines: [{ itemId: items[0]._id, quantity: 1 }],
        eta: { day: '2026-11-23', setBy: ops._id, setByName: ops.name, setByTeam: 'operations', setAt: ist('2026-11-20 12:00') },
      }],
    });
    await sweep('2026-11-25 09:35'); // ETA Mon + 1 day → due Wednesday 09:30
    const parcel = (await rows()).find((r) => r.itemKind === 'parcel');
    expect(parcel.dueAt).toEqual(ist('2026-11-25 09:30'));
    expect(parcel.ownerAtLate).toMatchObject({ name: ops.name, source: 'parcel' });
  });
});

// ── Reasons, shadow, resolution ────────────────────────────────────────────

describe('reasons pause the ladder', () => {
  it('a reason with a next date holds the head level; after the date it restarts at due', async () => {
    await openOrder({
      lines: [{ stock: 'in_stock' }],
      history: (items) => [ev(buyer, 'stock_in_stock', items[0]._id, '2026-11-23 10:00')],
    });
    await sweep('2026-11-23 14:05');
    let [row] = await rows();
    await giveReason(buyer, String(row._id), { code: 'stock_wait', note: 'Supplier restocks Tuesday', nextAt: ist('2026-11-24 11:00') }, { now: ist('2026-11-23 15:00'), env: LIVE });
    await sweep('2026-11-23 18:05');
    [row] = await rows();
    expect(levelsOf(row)).toEqual(['due']);
    expect(row.reasons[0]).toMatchObject({ code: 'stock_wait', control: 'inside', givenLate: true });

    await sweep('2026-11-24 11:05'); // next date passed → due again, a new cycle
    await sweep('2026-11-24 15:05'); // + 4 office hours → head
    [row] = await rows();
    expect(levelsOf(row)).toEqual(['due', 'due', 'head']);
    expect(await lines(buyer)).toHaveLength(2);
    expect((await lines(buyer))[1].text).toMatch(/^Next follow-up date/);
    expect(await lines(head)).toHaveLength(1);
  });

  it('rejects a bad reason and a stranger', async () => {
    await openOrder({ lines: [{ stock: 'in_stock' }], history: (items) => [ev(buyer, 'stock_in_stock', items[0]._id, '2026-11-23 10:00')] });
    await sweep('2026-11-23 14:05');
    const [row] = await rows();
    const at = { now: ist('2026-11-23 15:00'), env: LIVE };
    await expect(giveReason(buyer, String(row._id), { code: 'nope' }, at)).rejects.toMatchObject({ statusCode: 400 });
    await expect(giveReason(buyer, String(row._id), { code: 'other', note: '' }, at)).rejects.toMatchObject({ statusCode: 400 });
    await expect(giveReason(buyer, String(row._id), { code: 'stock_wait', nextAt: ist('2026-11-23 14:00') }, at)).rejects.toMatchObject({ statusCode: 400 });
    const sales = await person('sales');
    await expect(giveReason(sales, String(row._id), { code: 'stock_wait' }, at)).rejects.toMatchObject({ statusCode: 404 });
    // The head may answer for the team.
    await expect(giveReason(head, String(row._id), { code: 'courier_delay' }, at)).resolves.toMatchObject({ reasons: [expect.objectContaining({ control: 'outside' })] });
  });

  it('excused once, by a head or admin, never by the owner; the row stays', async () => {
    await openOrder({ lines: [{ stock: 'in_stock' }], history: (items) => [ev(buyer, 'stock_in_stock', items[0]._id, '2026-11-23 10:00')] });
    await sweep('2026-11-23 14:05');
    const [row] = await rows();
    await expect(excuseDelay(buyer, String(row._id), 'Not my fault')).rejects.toMatchObject({ statusCode: 403 });
    await expect(excuseDelay(head, String(row._id), 'Supplier strike')).resolves.toMatchObject({ excused: { note: 'Supplier strike' } });
    await expect(excuseDelay(admin, String(row._id), 'Again')).rejects.toMatchObject({ statusCode: 409 });
    expect(await FollowUpDelay.countDocuments({})).toBe(1);
  });
});

describe('shadow mode', () => {
  it('records everything, sends nothing; going live does not replay it', async () => {
    await openOrder({ lines: [{ stock: 'in_stock' }], history: (items) => [ev(buyer, 'stock_in_stock', items[0]._id, '2026-11-23 10:00')] });
    await sweep('2026-11-23 13:05', SHADOW);
    await sweep('2026-11-23 18:05', SHADOW);
    const [row] = await rows();
    expect(levelsOf(row)).toEqual(['remind', 'due', 'head']);
    expect(row.levelsReached.every((l) => l.mode === 'shadow' && l.sent === 0)).toBe(true);
    expect(row.levelsReached[1].recipients).toEqual([buyer._id]); // who WOULD have been told
    expect(await lines()).toHaveLength(0);
    expect(pushes).toHaveLength(0);

    await sweep('2026-11-23 18:10', LIVE);
    expect(pushes).toHaveLength(0);
    await sweep('2026-11-24 14:05', LIVE); // a new level after the flip does go out
    expect(pushes.map((p) => p.to)).toEqual([[String(admin._id)]]);
  });

  it('off does nothing at all', async () => {
    await openOrder({ entered: '2026-11-20 10:00' });
    expect((await runFollowUpSweep({ now: ist('2026-11-23 12:00'), env: { FOLLOWUP_MODE: 'off' } })).skipped).toBe('off');
    expect(await rows()).toHaveLength(0);
  });
});

describe('resolution', () => {
  it('when the line moves on, the row resolves (still listed as a delay) and its pop-ups clear', async () => {
    const { order, items } = await openOrder({ lines: [{ stock: 'in_stock' }], history: (its) => [ev(buyer, 'stock_in_stock', its[0]._id, '2026-11-23 10:00')] });
    await sweep('2026-11-23 14:05');
    expect((await inbox.recentAlerts(buyer, ist('2026-11-23 14:10'))).map((a) => [a.kind, a.href])).toEqual([['followup_due', '/team/orders']]);

    await Order.updateOne({ _id: order._id }, {
      $set: { 'workflow.lines.0.stock': 'ordered' },
      $push: { 'workflow.history': ev(buyer, 'stock_ordered', items[0]._id, '2026-11-23 15:00') },
    });
    const out = await sweep('2026-11-23 15:05');
    expect(out.resolved).toBe(1);
    const [row] = await rows();
    expect(row).toMatchObject({ open: false, resolvedHow: 'moved_on' });
    expect(row.lateAt).toEqual(ist('2026-11-23 14:00'));
    expect((await lines(buyer)).map((l) => l.state)).toEqual(['cleared']);
    expect(await inbox.recentAlerts(buyer, ist('2026-11-23 15:10'))).toEqual([]);
    expect((await listDelays({ ownerId: String(buyer._id), state: 'resolved' })).items).toHaveLength(1);
  });

  it('a closed order resolves its rows', async () => {
    const { order } = await openOrder({ entered: '2026-11-23 09:40' });
    await sweep('2026-11-23 11:45');
    await Order.updateOne({ _id: order._id }, { $set: { 'workflow.open': false, status: 'cancelled' } });
    await sweep('2026-11-23 11:50');
    expect((await rows())[0].open).toBe(false);
  });

  it('follow-up lines never reach the task Inbox list or its unread badge', async () => {
    await openOrder({ lines: [{ stock: 'in_stock' }], history: (its) => [ev(buyer, 'stock_in_stock', its[0]._id, '2026-11-23 10:00')] });
    await sweep('2026-11-23 14:05');
    expect(await lines(buyer)).toHaveLength(1);
    expect((await inbox.listInbox(buyer)).items).toEqual([]);
    expect(await inbox.countUnread(buyer)).toBe(0);
  });
});

describe('bounds and records', () => {
  it('stops at FOLLOWUP_MAX_ORDERS, and does not resolve what it did not read', async () => {
    const spy = jest.spyOn(orderRepository, 'findOpenWorkflowPage');
    const many = Array.from({ length: 105 }, () => ({
      user: new mongoose.Types.ObjectId(), items: [], status: 'processing', paymentStatus: 'paid',
      subtotal: 0, totalAmount: 0, workflow: { enteredAt: ist('2026-11-23 09:40'), open: true, lines: [] },
    }));
    await Order.collection.insertMany(many);
    // An open row for an order beyond the bound.
    const stray = await FollowUpDelay.create({
      key: 'order:x:stock_check:y:1', order: new mongoose.Types.ObjectId(), stage: 'stock_check', team: 'procurement',
      itemKind: 'line', itemId: new mongoose.Types.ObjectId(), enteredAt: new Date(), dueAt: new Date(), remindAt: new Date(),
      owner: { source: 'admins', name: 'Admins' },
    });
    const out = await runFollowUpSweep({ now: ist('2026-11-23 12:00'), env: { ...LIVE, FOLLOWUP_MAX_ORDERS: '100' } });
    expect(out).toMatchObject({ scanned: 100, truncated: true, resolved: 0 });
    expect(spy.mock.calls.every(([arg]) => arg.limit <= 100)).toBe(true);
    expect((await FollowUpDelay.findById(stray._id).lean()).open).toBe(true);

    const full = await runFollowUpSweep({ now: ist('2026-11-23 12:00'), env: LIVE });
    expect(full).toMatchObject({ scanned: 105, truncated: false, resolved: 1 });
  });

  it('rows cannot be deleted through the model', async () => {
    await expect(FollowUpDelay.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(FollowUpDelay.deleteOne({})).rejects.toThrow(/append-only/);
  });

  it('lists late steps newest first, by owner and team, page by page', async () => {
    for (const at of ['10:00', '10:30', '11:00']) {
      await openOrder({ lines: [{ stock: 'in_stock' }], history: (its) => [ev(buyer, 'stock_in_stock', its[0]._id, `2026-11-23 ${at}`)] });
    }
    await sweep('2026-11-23 16:00');
    const first = await listDelays({ ownerId: String(buyer._id), limit: 2 });
    expect(first.items.map((d) => d.lateAt)).toEqual([ist('2026-11-23 15:00'), ist('2026-11-23 14:30')]);
    const second = await listDelays({ ownerId: String(buyer._id), limit: 2, cursor: first.nextCursor });
    expect(second).toMatchObject({ items: [expect.objectContaining({ lateAt: ist('2026-11-23 14:00') })], nextCursor: null });
    expect((await listDelays({ team: 'procurement', state: 'open' })).items).toHaveLength(3);
    expect((await listDelays({ team: 'sales' })).items).toHaveLength(0);
    await expect(listDelays({ cursor: 'junk' })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('channels', () => {
  it('a registered channel (e.g. WhatsApp later) gets every live alert; one that throws does not stop the others', async () => {
    const seen = [];
    engine.registerFollowUpChannel({ name: 'test', send: async (a) => { seen.push(a.level); return 1; } });
    engine.registerFollowUpChannel({ name: 'broken', send: async () => { throw new Error('down'); } });
    try {
      await openOrder({ lines: [{ stock: 'in_stock' }], history: (its) => [ev(buyer, 'stock_in_stock', its[0]._id, '2026-11-23 10:00')] });
      await sweep('2026-11-23 14:05');
      expect(seen).toEqual(['due']);
      expect(pushes).toHaveLength(1);
      expect(await lines(buyer)).toHaveLength(1);
    } finally {
      engine.unregisterFollowUpChannel('test');
      engine.unregisterFollowUpChannel('broken');
    }
  });
});
