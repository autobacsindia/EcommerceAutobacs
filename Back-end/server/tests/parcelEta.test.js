/**
 * Expected delivery date on a parcel in transit (teamWorkflowService.setParcelEta)
 * and its morning chat reminder (services/parcelEtaReminders.js), driven through
 * the REAL workflow, shipment and chat services against an in-memory Mongo.
 * Time for the reminder is moved by passing a later `now`; the date itself is set
 * against the real clock, as the panel does.
 *
 * What must hold:
 *   - procurement, operations and the admin set / change it; sales, accounts and
 *     inactive staff cannot
 *   - not in the past, not more than ETA_MAX_DAYS ahead, a real calendar date
 *   - only on a parcel in transit; a stale "previous date" is refused, not overwritten
 *   - every change is kept (old → new, who, when), newest first, bounded
 *   - the reminder fires on the day, ONCE however often the job runs; changing
 *     the date moves it; a delivered parcel gets none
 *   - past the day, one OVERDUE follow-up each morning until delivered / re-dated
 *   - it goes to the setter's team space, @-mentioning them; an admin's to
 *     #operations; a setter who left → #operations with nobody mentioned
 *   - the deliveries list carries the counts and filters on them
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

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
const storageMock = {
  resourceTypeFor: () => 'image',
  putPrivateAsset: async ({ buffer, folder, basename }) => ({ publicId: `${folder}/${basename}`, provider: 'r2', bytes: buffer.length, resourceType: 'image', url: '' }),
  deletePrivateAsset: async () => true,
  readPrivateAsset: async () => Buffer.alloc(0),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const { default: Order } = await import('../models/Order.js');
const { default: User } = await import('../models/User.js');
const { default: ChatChannel } = await import('../models/ChatChannel.js');
const { default: ChatMessage } = await import('../models/ChatMessage.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const wf = await import('../services/teamWorkflowService.js');
const { postEtaReminders, reminderText } = await import('../services/parcelEtaReminders.js');
const { istDay, addDays, parseEtaDay, etaSummary, ETA_MAX_DAYS, MAX_ETA_HISTORY } = await import('../utils/parcelEta.js');
const { readListFilters, rowMatches } = await import('../utils/orderListFilters.js');
const { default: CronService } = await import('../services/cronService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };

let n = 0;
const person = (team, { isHead = false, active = true } = {}) => User.create({
  name: `${team} ${++n}`, email: `eta-${team}${n}@autobacs.test`, phone: '9000000001',
  passwordHash: 'x', role: 'staff', staff: { team, isHead, active },
});
const admin = () => User.create({ name: `Admin ${++n}`, email: `eta-admin${n}@autobacs.test`, passwordHash: 'x', role: 'admin' });

async function paidOrder() {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [
      { product: new mongoose.Types.ObjectId(), name: 'Seat cover', price: 5000, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'Floor mat', price: 1000, quantity: 1 },
    ],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 6000, totalAmount: 6000, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified' });
  if (!res?.success) throw new Error(res?.message);
  return Order.findById(order._id).lean();
}

/** A paid order dispatched from our warehouse: one parcel per item when `parcels` is 2. */
async function shippedOrder({ parcels = 1 } = {}) {
  const p = await person('procurement');
  const order = await paidOrder();
  const id = String(order._id);
  const [cover, mat] = order.items.map((i) => String(i._id));
  for (const i of [cover, mat]) await wf.setStock(p, id, i, { stock: 'own_stock' }, req);
  if (parcels === 1) {
    await wf.dispatchOwnStock(p, id, { courierName: 'Delhivery', trackingNumber: 'DL555' }, null, req);
  } else {
    await wf.dispatchOwnStock(p, id, { courierName: 'Delhivery', trackingNumber: 'DL555', itemIds: [cover] }, null, req);
    await wf.dispatchOwnStock(p, id, { courierName: 'Blue Dart', trackingNumber: 'BD9', itemIds: [mat] }, null, req);
  }
  const fresh = await Order.findById(id).lean();
  return { id, parcelIds: fresh.shipments.map((s) => String(s._id)) };
}

const setEta = (actor, id, sid, date, previousDate) => wf.setParcelEta(actor, id, sid, { date, previousDate }, req);
const today = () => istDay();
/** 09:00 IST on the day `k` days from today. */
const morningIn = (k) => Date.parse(`${addDays(today(), k)}T03:30:00Z`);

async function reminders() {
  const channels = await ChatChannel.find({}).lean();
  const keyOf = new Map(channels.map((c) => [String(c._id), c.key]));
  const msgs = await ChatMessage.find({ kind: 'system', clientId: /^eta-/ }).sort({ createdAt: 1 }).lean();
  return msgs.map((m) => ({ space: keyOf.get(String(m.channel)), text: m.text, mentions: m.mentions.map(String), key: m.clientId }));
}

describe('who may set the expected delivery date', () => {
  it('procurement, operations and the admin can; the parcel shows it', async () => {
    const { id, parcelIds: [sid] } = await shippedOrder();
    for (const [i, actor] of [await person('procurement'), await person('operations'), await admin()].entries()) {
      const date = addDays(today(), 3 + i);
      const view = await setEta(actor, id, sid, date);
      expect(view.parcels[0]).toMatchObject({
        eta: { date, setBy: actor.name }, etaState: 'upcoming', canSetEta: true,
      });
    }
  });

  it('sales, accounts and inactive staff cannot', async () => {
    const { id, parcelIds: [sid] } = await shippedOrder();
    for (const actor of [await person('sales', { isHead: true }), await person('accounts'), await person('operations', { active: false })]) {
      await expect(setEta(actor, id, sid, addDays(today(), 2))).rejects.toMatchObject({ statusCode: 403 });
    }
    const accountsView = await wf.getOrder(await person('accounts'), id);
    expect(accountsView.parcels[0]).toMatchObject({ canSetEta: false, eta: null, etaState: 'none' });
    expect((await Order.findById(id).lean()).shipments[0].eta?.day).toBeUndefined();
  });
});

describe('the date must make sense', () => {
  it('today and the last allowed day are fine; past, too far, or not a date are refused', async () => {
    const ops = await person('operations');
    const { id, parcelIds: [sid] } = await shippedOrder();
    await expect(setEta(ops, id, sid, addDays(today(), -1))).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/past/) });
    await expect(setEta(ops, id, sid, addDays(today(), ETA_MAX_DAYS + 1))).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/60 days/) });
    await expect(setEta(ops, id, sid, '2026-02-30')).rejects.toMatchObject({ statusCode: 400 });
    await expect(setEta(ops, id, sid, '28/10/2026')).rejects.toMatchObject({ statusCode: 400 });
    await expect(setEta(ops, id, sid, '')).rejects.toMatchObject({ statusCode: 400 });

    expect((await setEta(ops, id, sid, today())).parcels[0].etaState).toBe('due_today');
    expect((await setEta(ops, id, sid, addDays(today(), ETA_MAX_DAYS))).parcels[0].eta.date).toBe(addDays(today(), ETA_MAX_DAYS));
  });

  it('parseEtaDay accepts only real YYYY-MM-DD dates', () => {
    expect(parseEtaDay('2026-10-28')).toBe('2026-10-28');
    expect(parseEtaDay('2028-02-29')).toBe('2028-02-29');
    expect(parseEtaDay('2026-02-29')).toBeNull();
    expect(parseEtaDay('2026-13-01')).toBeNull();
    expect(parseEtaDay(null)).toBeNull();
  });

  it('only while the parcel is in transit', async () => {
    const ops = await person('operations');
    const { id, parcelIds: [sid] } = await shippedOrder();
    await wf.markDelivered(ops, id, { shipmentId: sid }, req);
    await expect(setEta(ops, id, sid, addDays(today(), 2))).rejects.toMatchObject({ statusCode: 409 });
    const view = await wf.getOrder(ops, id);
    expect(view.parcels[0]).toMatchObject({ canSetEta: false, etaState: null });
  });

  it('unknown order or parcel → 404', async () => {
    const ops = await person('operations');
    const { id } = await shippedOrder();
    await expect(setEta(ops, id, String(new mongoose.Types.ObjectId()), addDays(today(), 2))).rejects.toMatchObject({ statusCode: 404 });
    await expect(setEta(ops, String(new mongoose.Types.ObjectId()), String(new mongoose.Types.ObjectId()), addDays(today(), 2))).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('changes are kept, and never overwrite each other', () => {
  it('history: old → new, who, when — newest first; the order history notes it', async () => {
    const p = await person('procurement');
    const ops = await person('operations');
    const { id, parcelIds: [sid] } = await shippedOrder();
    const d1 = addDays(today(), 2);
    const d2 = addDays(today(), 5);
    await setEta(p, id, sid, d1, '');
    const view = await setEta(ops, id, sid, d2, d1);

    expect(view.parcels[0].etaHistory).toEqual([
      { from: d1, to: d2, by: ops.name, at: expect.any(Date) },
      { from: '', to: d1, by: p.name, at: expect.any(Date) },
    ]);
    const notes = view.history.filter((h) => h.action === 'Expected delivery date set').map((h) => h.note);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/^Parcel 1: \d\d\/\d\d\/\d{4} → \d\d\/\d\d\/\d{4}$/);
  });

  it('a stale "previous date" is refused; the same date again changes nothing', async () => {
    const p = await person('procurement');
    const { id, parcelIds: [sid] } = await shippedOrder();
    const d1 = addDays(today(), 2);
    await setEta(p, id, sid, d1, '');
    // Someone who still saw "no date" tries to set one: refused, not overwritten.
    await expect(setEta(p, id, sid, addDays(today(), 9), '')).rejects.toMatchObject({ statusCode: 409 });
    await setEta(p, id, sid, d1, d1); // double press
    const parcel = (await Order.findById(id).lean()).shipments[0];
    expect(parcel.eta.day).toBe(d1);
    expect(parcel.etaHistory).toHaveLength(1);
  });

  it('two people at once: one wins, the other is told to refresh', async () => {
    const { id, parcelIds: [sid] } = await shippedOrder();
    const [a, b] = [await person('procurement'), await person('operations')];
    const results = await Promise.allSettled([
      setEta(a, id, sid, addDays(today(), 2), ''),
      setEta(b, id, sid, addDays(today(), 4), ''),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason.statusCode).toBe(409);
    expect((await Order.findById(id).lean()).shipments[0].etaHistory).toHaveLength(1);
  });

  it(`keeps the newest ${MAX_ETA_HISTORY} changes`, async () => {
    const p = await person('procurement');
    const { id, parcelIds: [sid] } = await shippedOrder();
    for (let k = 1; k <= MAX_ETA_HISTORY + 3; k += 1) await setEta(p, id, sid, addDays(today(), k));
    const hist = (await Order.findById(id).lean()).shipments[0].etaHistory;
    expect(hist).toHaveLength(MAX_ETA_HISTORY);
    expect(hist[hist.length - 1].to).toBe(addDays(today(), MAX_ETA_HISTORY + 3));
  });
});

describe('the morning reminder', () => {
  it('fires on the day only, once however often the job runs, @-mentioning the setter in their team space', async () => {
    const p = await person('procurement');
    const { id, parcelIds: [sid] } = await shippedOrder();
    await setEta(p, id, sid, addDays(today(), 2));

    expect(await postEtaReminders(morningIn(0))).toMatchObject({ due: 0, posted: 0 });
    expect(await postEtaReminders(morningIn(1))).toMatchObject({ due: 0 });
    await postEtaReminders(morningIn(2));
    await postEtaReminders(morningIn(2) + 3600 * 1000); // second replica / restart / re-run
    const out = await reminders();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ space: 'team:procurement', mentions: [String(p._id)], key: `eta-${sid}-${addDays(today(), 2)}` });
    expect(out[0].text).toMatch(/^⏰ Please update the delivery status — today is the expected delivery date for order #\w+, parcel 1 \(Delhivery, tracking DL555\)\./);
    expect(out[0].text).toContain(`@${p.name}`);
  });

  it('changing the date moves the reminder', async () => {
    const ops = await person('operations');
    const { id, parcelIds: [sid] } = await shippedOrder();
    await setEta(ops, id, sid, addDays(today(), 2));
    await setEta(ops, id, sid, addDays(today(), 5));
    for (let k = 0; k <= 4; k += 1) await postEtaReminders(morningIn(k));
    expect(await reminders()).toHaveLength(0);
    await postEtaReminders(morningIn(5));
    const out = await reminders();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ space: 'team:operations', mentions: [String(ops._id)] });
  });

  it('a delivered parcel gets no reminder', async () => {
    const ops = await person('operations');
    const { id, parcelIds: [sid] } = await shippedOrder();
    await setEta(ops, id, sid, addDays(today(), 1));
    await wf.markDelivered(ops, id, { shipmentId: sid }, req);
    await postEtaReminders(morningIn(1));
    await postEtaReminders(morningIn(3));
    expect(await reminders()).toHaveLength(0);
  });

  it('past the day: one OVERDUE follow-up each morning, until it is delivered', async () => {
    const ops = await person('operations');
    const { id, parcelIds: [sid] } = await shippedOrder();
    await setEta(ops, id, sid, addDays(today(), 1));
    await postEtaReminders(morningIn(1));
    await postEtaReminders(morningIn(2));
    await postEtaReminders(morningIn(2));
    await postEtaReminders(morningIn(4));
    let out = await reminders();
    expect(out.map((m) => m.text.slice(0, 22))).toEqual([
      '⏰ Please update the de', '⚠️ OVERDUE by 1 day: o', '⚠️ OVERDUE by 3 days: ',
    ]);
    expect(out[1].text).toContain('is still in transit');

    await wf.markDelivered(ops, id, { shipmentId: sid }, req);
    await postEtaReminders(morningIn(5));
    out = await reminders();
    expect(out).toHaveLength(3);
  });

  it('each parcel is reminded on its own date; a parcel without a date is not', async () => {
    const p = await person('procurement');
    const { id, parcelIds: [a, b] } = await shippedOrder({ parcels: 2 });
    await setEta(p, id, a, addDays(today(), 1));
    expect(await postEtaReminders(morningIn(1))).toMatchObject({ due: 1, posted: 1 });
    await setEta(p, id, b, addDays(today(), 2));
    await postEtaReminders(morningIn(2));
    const out = await reminders();
    expect(out.map((m) => m.key)).toEqual([
      `eta-${a}-${addDays(today(), 1)}`, `eta-${a}-${addDays(today(), 2)}`, `eta-${b}-${addDays(today(), 2)}`,
    ]);
    expect(out[2].text).toContain('parcel 2 (Blue Dart, tracking BD9)');
  });

  it('an admin\'s date is reminded in #operations, mentioning the admin', async () => {
    const boss = await admin();
    const { id, parcelIds: [sid] } = await shippedOrder();
    await setEta(boss, id, sid, addDays(today(), 1));
    await postEtaReminders(morningIn(1));
    expect(await reminders()).toEqual([expect.objectContaining({ space: 'team:operations', mentions: [String(boss._id)] })]);
  });

  it('a setter who has left → #operations, nobody mentioned, the message says who set it', async () => {
    const p = await person('procurement');
    const { id, parcelIds: [sid] } = await shippedOrder();
    await setEta(p, id, sid, addDays(today(), 1));
    await User.updateOne({ _id: p._id }, { $set: { 'staff.active': false } });
    await postEtaReminders(morningIn(1));
    const [msg] = await reminders();
    expect(msg).toMatchObject({ space: 'team:operations', mentions: [] });
    expect(msg.text).toContain(`${p.name} set this date and is no longer on the team. Operations:`);
  });

  it('nothing due → nothing posted, nothing scanned past the open orders', async () => {
    expect(await postEtaReminders(morningIn(1))).toEqual({ due: 0, posted: 0, failed: 0 });
    expect(await reminders()).toHaveLength(0);
  });

  it('reminderText without courier details still reads cleanly', () => {
    const text = reminderText({
      order: { _id: new mongoose.Types.ObjectId() },
      parcel: { sequence: 2, eta: { day: '2026-10-28' } },
      overdueDays: 0,
    }, { name: 'Midhun' });
    expect(text).toMatch(/parcel 2\. @Midhun please check with the courier/);
  });
});

describe('the deliveries list', () => {
  it('carries the counts per order and filters on due today / overdue / no date', async () => {
    const ops = await person('operations');
    const due = await shippedOrder();
    const none = await shippedOrder();
    await setEta(ops, due.id, due.parcelIds[0], today());

    const { orders } = await wf.listQueue(ops, 'deliveries', {});
    const rowOf = (id) => orders.find((o) => o.id === id);
    expect(rowOf(due.id).eta).toEqual({ overdue: 0, dueToday: 1, missing: 0, earliest: today() });
    expect(rowOf(none.id).eta).toEqual({ overdue: 0, dueToday: 0, missing: 1, earliest: null });

    const ids = async (eta) => (await wf.listQueue(ops, 'deliveries', { eta })).orders.map((o) => o.id);
    expect(await ids('due_today')).toEqual([due.id]);
    expect(await ids('none')).toContain(none.id);
    expect(await ids('none')).not.toContain(due.id);
    expect(await ids('overdue')).not.toContain(due.id);
  });

  it('overdue is counted from the date, and an unknown filter is ignored', () => {
    const t = '2026-10-28';
    const s = etaSummary([
      { status: 'shipped', eta: { day: '2026-10-25' } },
      { status: 'shipped', eta: { day: '2026-10-30' } },
      { status: 'delivered', eta: { day: '2026-10-20' } },
    ], t);
    expect(s).toEqual({ overdue: 1, dueToday: 0, missing: 0, earliest: '2026-10-25' });
    expect(etaSummary([{ status: 'delivered' }], t)).toBeNull();
    expect(rowMatches({ eta: s }, readListFilters({ eta: 'overdue' }))).toBe(true);
    expect(rowMatches({ eta: null }, readListFilters({ eta: 'overdue' }))).toBe(false);
    expect(readListFilters({ eta: 'whenever' }).eta).toBeNull();
  });
});

describe('once per day (cron wrapper)', () => {
  it('a second run the same IST day does not scan again; the next day does', async () => {
    const cronService = new CronService();
    const store = new Map();
    cronService.redis = {
      set: async (k, v, nx) => { if (nx === 'NX' && store.has(k)) return null; store.set(k, v); return 'OK'; },
      del: async (k) => { store.delete(k); return 1; },
    };
    const ops = await person('operations');
    const { id, parcelIds: [sid] } = await shippedOrder();
    await setEta(ops, id, sid, addDays(today(), 1));

    expect(await cronService.runEtaRemindersOnce(morningIn(1))).toMatchObject({ due: 1, posted: 1 });
    expect(await cronService.runEtaRemindersOnce(morningIn(1) + 2 * 3600 * 1000)).toBeNull();
    expect(await cronService.runEtaRemindersOnce(morningIn(2))).toMatchObject({ due: 1, posted: 1 });
    expect((await reminders()).map((m) => /OVERDUE/.test(m.text))).toEqual([false, true]);
  });

  it('is scheduled Monday–Saturday at 09:00 India time', () => {
    const cronService = new CronService();
    cronService.scheduleEtaReminders();
    const task = cronService.scheduledTasks.find((t) => t.name === 'etaReminders');
    expect(task.schedule).toBe('0 9 * * 1-6');
    task.task.stop();
  });
});
