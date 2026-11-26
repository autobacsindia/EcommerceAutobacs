/**
 * Courier tracking sync — against a real (in-memory) database, every courier mocked.
 *
 * What only a real database proves: the once-only claim under two racing runs, that
 * a parcel staff already delivered is left alone, that a failing courier writes
 * nothing, and that the scan stays bounded. No customer message is ever sent: the
 * per-parcel notice is a jest spy, and REDIS_URL is unset in tests anyway.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

import Order from '../models/Order.js';
import shipmentService from '../services/shipmentService.js';
import { runCourierSync, planParcelUpdate, COURIER_SYNC_ACTOR } from '../services/courier/courierSyncService.js';
import { COURIER_STATUS } from '../services/courier/config.js';
import { resolveTracker } from '../services/courier/index.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-11-23T06:00:00Z');
const ENV = { COURIER_SYNC_DELAY_MS: '0' };

const seedShipped = async ({ carrier = { code: 'DTDC', name: 'DTDC' }, awb = 'R1002402870', workflow, createdAt } = {}) => {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Wax', price: 500, quantity: 1 }],
    shippingAddress: {
      fullName: 'Asha K', phone: '9999999999', addressLine1: '1 Road',
      city: 'Kochi', state: 'Kerala', postalCode: '682001',
    },
    subtotal: 500, totalAmount: 500, status: 'processing', paymentStatus: 'paid',
    ...(workflow && { workflow }),
    ...(createdAt && { createdAt }),
  });
  const res = await shipmentService.createShipment(order._id.toString(), { trackingNumber: awb, carrier });
  expect(res.success).toBe(true);
  return { orderId: order._id, shipmentId: res.shipment._id };
};

const parcelOf = async (orderId) => (await Order.findById(orderId).lean()).shipments[0];

/** A tracker whose answer each test sets. */
const fakeTracker = (impl) => ({ name: 'fake', isConfigured: () => true, track: jest.fn(impl) });
const deliveredAnswer = () => ({
  status: COURIER_STATUS.DELIVERED,
  lastScanAt: new Date(NOW - HOUR),
  deliveredAt: new Date(NOW - HOUR),
  events: [],
});

let notices;
beforeEach(() => {
  notices = jest.spyOn(shipmentService, '_enqueueShipmentEmail').mockImplementation(() => {});
});
afterEach(async () => {
  await Order.deleteMany({});
  jest.restoreAllMocks();
});

const deliveredNotices = () => notices.mock.calls.filter(([, , kind]) => kind === 'delivered');
const run = (trackers, extra = {}) => runCourierSync({ trackers, env: ENV, now: () => NOW, ...extra });

describe('runCourierSync — delivered', () => {
  it('courier says delivered → parcel delivered once through the existing path, recorded as by courier sync', async () => {
    const { orderId } = await seedShipped();
    const dtdc = fakeTracker(deliveredAnswer);

    const s = await run({ dtdc });
    expect(s.delivered).toBe(1);

    const p = await parcelOf(orderId);
    expect(p.status).toBe('delivered');
    expect(p.deliveredAt).toBeInstanceOf(Date);
    expect(p.courierSync.lastStatus).toBe('delivered');
    expect(p.courierSync.deliveredByCourierAt.getTime()).toBe(NOW - HOUR);
    expect(p.courierSync.noMovementSince).toBeUndefined();
    expect((await Order.findById(orderId)).status).toBe('delivered');
    expect(deliveredNotices()).toHaveLength(1);
  });

  it('delivered reported twice (second run) → one transition, one customer notice', async () => {
    const { orderId } = await seedShipped();
    const dtdc = fakeTracker(deliveredAnswer);

    await run({ dtdc });
    const s2 = await run({ dtdc }, { now: () => NOW + 2 * HOUR });

    expect(s2.delivered).toBe(0);
    expect(dtdc.track).toHaveBeenCalledTimes(1); // the delivered parcel is no longer in transit
    expect(deliveredNotices()).toHaveLength(1);
    expect((await parcelOf(orderId)).status).toBe('delivered');
  });

  it('two runs racing on the same parcel → one transition, one customer notice', async () => {
    const { orderId } = await seedShipped();
    const dtdc = fakeTracker(deliveredAnswer);

    const [a, b] = await Promise.all([run({ dtdc }), run({ dtdc })]);
    expect(a.delivered + b.delivered).toBe(1);
    expect(deliveredNotices()).toHaveLength(1);
    expect((await parcelOf(orderId)).status).toBe('delivered');
  });

  it('parcel staff already delivered → courier sync is a no-op (no call, no write, no notice)', async () => {
    const { orderId, shipmentId } = await seedShipped();
    await shipmentService.markShipmentDelivered(String(orderId), String(shipmentId));
    const before = await parcelOf(orderId);
    notices.mockClear();

    const dtdc = fakeTracker(deliveredAnswer);
    const s = await run({ dtdc });

    expect(s.parcelsSeen).toBe(0);
    expect(dtdc.track).not.toHaveBeenCalled();
    const after = await parcelOf(orderId);
    expect(after.courierSync).toBeUndefined();
    expect(after.deliveredAt.getTime()).toBe(before.deliveredAt.getTime());
    expect(deliveredNotices()).toHaveLength(0);
  });

  it('staff deliver between the courier read and the transition → claim released, no second notice', async () => {
    const { orderId, shipmentId } = await seedShipped();
    const dtdc = fakeTracker(async () => {
      await shipmentService.markShipmentDelivered(String(orderId), String(shipmentId), { userId: new mongoose.Types.ObjectId() });
      return deliveredAnswer();
    });

    const s = await run({ dtdc });
    expect(s.delivered).toBe(0);
    const p = await parcelOf(orderId);
    expect(p.status).toBe('delivered');
    expect(p.courierSync?.deliveredByCourierAt).toBeUndefined(); // staff did it, not the sync
    expect(deliveredNotices()).toHaveLength(1); // staff's
  });

  it('staff undo a courier delivery → the sync never re-delivers that parcel', async () => {
    const { orderId, shipmentId } = await seedShipped();
    const dtdc = fakeTracker(deliveredAnswer);
    await run({ dtdc });

    const undo = await shipmentService.undoShipmentDelivered(String(orderId), String(shipmentId));
    expect(undo.success).toBe(true);
    expect((await parcelOf(orderId)).status).toBe('shipped');

    const s = await run({ dtdc }, { now: () => NOW + 3 * HOUR });
    expect(s.delivered).toBe(0);
    expect((await parcelOf(orderId)).status).toBe('shipped');
    expect(deliveredNotices()).toHaveLength(1);
  });

  it('COURIER_SYNC_AUTO_DELIVER=false → records delivered but does not transition', async () => {
    const { orderId } = await seedShipped();
    const s = await run({ dtdc: fakeTracker(deliveredAnswer) }, { env: { ...ENV, COURIER_SYNC_AUTO_DELIVER: 'false' } });
    expect(s.delivered).toBe(0);
    const p = await parcelOf(orderId);
    expect(p.status).toBe('shipped');
    expect(p.courierSync.lastStatus).toBe('delivered');
    expect(deliveredNotices()).toHaveLength(0);
  });

  it('writes a team-history line by "Courier sync" for orders in the team workflow', async () => {
    const { orderId } = await seedShipped({ workflow: { enteredAt: new Date(NOW - 72 * HOUR), open: true } });
    await run({ dtdc: fakeTracker(deliveredAnswer) });
    const o = await Order.findById(orderId).lean();
    const ev = o.workflow.history.find((h) => h.action === 'delivered');
    expect(ev.byName).toBe(COURIER_SYNC_ACTOR);
    expect(ev.note).toMatch(/by courier sync/);
  });

  it('dry run (apply:false) calls the courier but writes nothing', async () => {
    const { orderId } = await seedShipped();
    const s = await run({ dtdc: fakeTracker(deliveredAnswer) }, { apply: false });
    expect(s.changes[0]).toMatchObject({ to: 'delivered', markDelivered: true });
    const p = await parcelOf(orderId);
    expect(p.status).toBe('shipped');
    expect(p.courierSync).toBeUndefined();
    expect(deliveredNotices()).toHaveLength(0);
  });
});

describe('runCourierSync — failures leave the parcel unchanged', () => {
  const failing = {
    timeout: () => new Promise(() => {}), // never answers
    '5xx': async () => { throw Object.assign(new Error('DTDC tracking error (HTTP 503)'), { code: 'HTTP_ERROR', status: 503 }); },
    'bad shape': async () => ({ status: 'shipped-ish' }),
  };

  it.each(Object.keys(failing))('%s → no write, counted as an error', async (kind) => {
    const { orderId } = await seedShipped();
    const before = await parcelOf(orderId);
    const s = await run({ dtdc: fakeTracker(failing[kind]) }, { env: { ...ENV, COURIER_SYNC_TIMEOUT_MS: '1000' } });

    expect(s.errors).toBe(1);
    expect(s.checked).toBe(0);
    const after = await parcelOf(orderId);
    expect(after.status).toBe('shipped');
    expect(after.courierSync).toBeUndefined();
    expect(after).toEqual(before);
    expect(deliveredNotices()).toHaveLength(0);
  }, 10_000);
});

describe('runCourierSync — routing & bounds', () => {
  it('unknown / custom couriers and parcels without an AWB are skipped (stay manual)', async () => {
    await seedShipped({ carrier: { code: 'OTHER', name: 'Local Courier Co' } });
    await seedShipped({ carrier: { code: 'VRL', name: 'VRL' } });
    await seedShipped({ awb: '' });
    await seedShipped(); // DTDC with an AWB — the only one tracked
    const dtdc = fakeTracker(deliveredAnswer);

    const s = await run({ dtdc });
    expect(dtdc.track).toHaveBeenCalledTimes(1);
    expect(s.skipped.unknown_courier).toBe(2);
    expect(s.skipped.no_awb).toBe(1);
  });

  it('free-text "Other: DTDC" resolves to the DTDC tracker', () => {
    const dtdc = { isConfigured: () => true };
    const r = resolveTracker({ trackingNumber: 'X1', carrier: { code: 'OTHER', name: 'dtdc' } },
      { trackers: { dtdc }, config: { shiprocketCarriers: [] } });
    expect(r.tracker).toBe(dtdc);
  });

  it('DTDC without credentials → not_configured; Shiprocket only for listed carriers', () => {
    const off = { isConfigured: () => false };
    const sr = { isConfigured: () => true };
    const parcel = (code) => ({ trackingNumber: 'A1', carrier: { code } });
    expect(resolveTracker(parcel('DTDC'), { trackers: { dtdc: off, shiprocket: sr }, config: { shiprocketCarriers: [] } }).skip).toBe('not_configured');
    expect(resolveTracker(parcel('DTDC'), { trackers: { dtdc: off, shiprocket: sr }, config: { shiprocketCarriers: ['DTDC'] } }).tracker).toBe(sr);
    expect(resolveTracker(parcel('DELHIVERY'), { trackers: { dtdc: off, shiprocket: sr }, config: { shiprocketCarriers: ['*'] } }).tracker).toBe(sr);
    expect(resolveTracker(parcel('DELHIVERY'), { trackers: { dtdc: off, shiprocket: sr }, config: { shiprocketCarriers: [] } }).skip).toBe('unknown_courier');
  });

  it('bounded: never more than COURIER_SYNC_MAX_PARCELS courier calls per run, across pages', async () => {
    for (let i = 0; i < 7; i += 1) {
      await seedShipped({ awb: `R10024028${70 + i}`, createdAt: new Date(NOW - (10 - i) * HOUR) });
    }
    const dtdc = fakeTracker(async () => ({ status: 'in_transit', lastScanAt: new Date(NOW - HOUR), events: [] }));
    const sleeps = [];
    const s = await run({ dtdc }, {
      env: { ...ENV, COURIER_SYNC_MAX_PARCELS: '3', COURIER_SYNC_PAGE_SIZE: '2', COURIER_SYNC_DELAY_MS: '250' },
      sleepImpl: async (ms) => { sleeps.push(ms); },
    });
    expect(dtdc.track).toHaveBeenCalledTimes(3);
    expect(s.checked).toBe(3);
    expect(s.skipped.cap_reached).toBeGreaterThanOrEqual(1);
    expect(sleeps).toEqual([250, 250]); // polite gap between calls, none before the first

    // The next run picks up the rest (the first three were just checked).
    const s2 = await run({ dtdc }, { env: { ...ENV, COURIER_SYNC_MAX_PARCELS: '10', COURIER_SYNC_PAGE_SIZE: '2' } });
    expect(s2.checked).toBe(4);
    expect(s2.skipped.recently_checked).toBe(3);
  });

  it('bounded: never reads more than COURIER_SYNC_MAX_SCAN_ORDERS orders, even when every parcel is skipped', async () => {
    for (let i = 0; i < 5; i += 1) await seedShipped({ carrier: { code: 'VRL', name: 'VRL' }, awb: `V${1000 + i}` });
    const s = await run({ dtdc: fakeTracker(deliveredAnswer) }, {
      env: { ...ENV, COURIER_SYNC_MAX_SCAN_ORDERS: '3', COURIER_SYNC_PAGE_SIZE: '2' },
    });
    expect(s.ordersScanned).toBe(3);
    expect(s.skipped.unknown_courier).toBe(3);
  });
});

describe('no movement for 48 h', () => {
  it('flags noMovementSince when the courier\'s last scan is 48 h+ old, clears it when a scan arrives', async () => {
    const { orderId } = await seedShipped();
    const oldScan = new Date(NOW - 50 * HOUR);
    const dtdc = fakeTracker(async () => ({ status: 'in_transit', lastScanAt: oldScan, events: [] }));
    const s = await run({ dtdc });
    expect(s.noMovement).toBe(1);
    let p = await parcelOf(orderId);
    expect(p.courierSync.noMovementSince.getTime()).toBe(oldScan.getTime());
    expect(p.courierSync.lastScanAt.getTime()).toBe(oldScan.getTime());

    dtdc.track.mockImplementation(async () => ({ status: 'out_for_delivery', lastScanAt: new Date(NOW + HOUR), events: [] }));
    await run({ dtdc }, { now: () => NOW + 2 * HOUR });
    p = await parcelOf(orderId);
    expect(p.courierSync.noMovementSince).toBeUndefined();
    expect(p.courierSync.lastStatus).toBe('out_for_delivery');
  });

  it('no scans at all → measured from shippedAt', () => {
    const shippedAt = new Date(NOW - 49 * HOUR);
    const plan = planParcelUpdate({ shippedAt }, { status: 'unknown', lastScanAt: null }, { now: NOW, noMovementHours: 48 });
    expect(plan.noMovementSince.getTime()).toBe(shippedAt.getTime());
    const fresh = planParcelUpdate({ shippedAt: new Date(NOW - 47 * HOUR) }, { status: 'unknown', lastScanAt: null }, { now: NOW, noMovementHours: 48 });
    expect(fresh.noMovementSince).toBeNull();
  });
});
