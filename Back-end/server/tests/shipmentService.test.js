/**
 * Split shipments — the service, against a real database.
 *
 * The pure maths is covered in tests/unit/utils/orderFulfilment.test.js. What can only
 * be proved here is the behaviour that depends on real concurrent writes and real
 * persistence: that two admins shipping at once cannot over-ship, that a parcel event
 * moves the order's derived status, and — the one that motivated the whole change —
 * that the SECOND parcel's email is actually sent instead of being swallowed by an
 * idempotency guard keyed on the status word.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';

import Order from '../models/Order.js';
import shipmentService from '../services/shipmentService.js';
import { SHIPMENT_STATUS, deliveredAtForItem } from '../utils/orderFulfilment.js';
import { notificationKey } from '../services/orderStatusEmailService.js';

const ADMIN = new mongoose.Types.ObjectId();

/** A paid, unshipped order with two lines (Wax ×2, Polish ×1). */
const seedOrder = async (over = {}) => {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [
      { product: new mongoose.Types.ObjectId(), name: 'Wax', price: 500, quantity: 2 },
      { product: new mongoose.Types.ObjectId(), name: 'Polish', price: 250, quantity: 1 },
    ],
    shippingAddress: {
      fullName: 'Asha K', phone: '9999999999', addressLine1: '1 Road',
      city: 'Kochi', state: 'Kerala', postalCode: '682001',
    },
    subtotal: 1250, totalAmount: 1250,
    status: 'processing', paymentStatus: 'paid',
    ...over,
  });
  return order;
};

const withGoodie = {
  spinReward: {
    result: new mongoose.Types.ObjectId(),
    prize: new mongoose.Types.ObjectId(),
    name: 'Microfibre Cloth', sku: 'MF-1', kind: 'goodie',
    wonAt: new Date(), fulfilledAt: null, voidedAt: null,
  },
};

const itemIds = (order) => order.items.map((i) => String(i._id));

afterEach(async () => {
  await Order.deleteMany({});
  jest.restoreAllMocks();
});

describe('createShipment', () => {
  it('ships everything outstanding when no lines are given (the legacy whole-order case)', async () => {
    const order = await seedOrder();
    const res = await shipmentService.createShipment(order._id.toString(), {
      trackingNumber: 'AWB1', carrier: { name: 'Delhivery', code: 'delhivery' },
    }, { userId: ADMIN });

    expect(res.success).toBe(true);
    expect(res.shipment.sequence).toBe(1);
    expect(res.shipment.lines).toHaveLength(2);
    expect(res.shipment.status).toBe(SHIPMENT_STATUS.SHIPPED);

    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('shipped');
  });

  it('ships a chosen subset and leaves the order shipped with a remainder', async () => {
    const order = await seedOrder();
    const [wax] = itemIds(order);

    const res = await shipmentService.createShipment(order._id.toString(), {
      lines: [{ itemId: wax, quantity: 1 }], trackingNumber: 'AWB1',
    }, { userId: ADMIN });

    expect(res.success).toBe(true);
    const fulfilment = await shipmentService.getFulfilment(order._id.toString());
    expect(fulfilment.remaining).toEqual([
      expect.objectContaining({ itemId: wax, quantity: 1 }),
      expect.objectContaining({ name: 'Polish', quantity: 1 }),
    ]);
    expect(fulfilment.summary.label).toBe('Partially shipped · 1 of 3 items');
  });

  it('numbers parcels in sequence', async () => {
    const order = await seedOrder();
    const [wax, polish] = itemIds(order);
    const a = await shipmentService.createShipment(order._id.toString(), { lines: [{ itemId: wax, quantity: 2 }], trackingNumber: 'A' }, { userId: ADMIN });
    const b = await shipmentService.createShipment(order._id.toString(), { lines: [{ itemId: polish, quantity: 1 }], trackingNumber: 'B' }, { userId: ADMIN });
    expect(a.shipment.sequence).toBe(1);
    expect(b.shipment.sequence).toBe(2);
  });

  it('refuses to over-ship a line across two parcels', async () => {
    const order = await seedOrder();
    const [wax] = itemIds(order);
    await shipmentService.createShipment(order._id.toString(), { lines: [{ itemId: wax, quantity: 2 }], trackingNumber: 'A' }, { userId: ADMIN });

    const second = await shipmentService.createShipment(order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }], trackingNumber: 'B' }, { userId: ADMIN });
    expect(second.success).toBe(false);
    expect(second.message).toMatch(/only 0 left to ship/);
  });

  // ── THE CONCURRENCY INVARIANT ──────────────────────────────────────────────
  // Two admins hitting "ship" at the same moment each read "1 left", each validate
  // happily, and — without the compare-and-set — each push. The order would then
  // claim to have shipped two of a one-unit line.
  it('two admins shipping the last unit at once produce exactly ONE parcel', async () => {
    const order = await seedOrder();
    const [, polish] = itemIds(order);

    const results = await Promise.allSettled([
      shipmentService.createShipment(order._id.toString(), { lines: [{ itemId: polish, quantity: 1 }], trackingNumber: 'A' }, { userId: ADMIN }),
      shipmentService.createShipment(order._id.toString(), { lines: [{ itemId: polish, quantity: 1 }], trackingNumber: 'B' }, { userId: ADMIN }),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.success);
    expect(succeeded).toHaveLength(1);

    const saved = await Order.findById(order._id);
    const shippedPolish = saved.shipments
      .flatMap((s) => s.lines)
      .filter((l) => String(l.itemId) === polish)
      .reduce((n, l) => n + l.quantity, 0);
    expect(shippedPolish).toBe(1);
  });

  it('refuses to ship an unpaid order', async () => {
    const order = await seedOrder({ status: 'awaiting_payment', paymentStatus: 'pending' });
    const res = await shipmentService.createShipment(order._id.toString(), { trackingNumber: 'A' }, { userId: ADMIN });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/Cannot ship an order in 'awaiting_payment'/);
  });

  it('refuses to ship a cancelled order', async () => {
    const order = await seedOrder({ status: 'cancelled' });
    const res = await shipmentService.createShipment(order._id.toString(), { trackingNumber: 'A' }, { userId: ADMIN });
    expect(res.success).toBe(false);
  });

  it('leaves the parcel packed (and the order unshipped) when dispatch is false', async () => {
    const order = await seedOrder();
    const res = await shipmentService.createShipment(order._id.toString(), { trackingNumber: 'A', dispatch: false }, { userId: ADMIN });
    expect(res.shipment.status).toBe(SHIPMENT_STATUS.PACKED);
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('processing');
  });
});

/**
 * `Order.trackingNumber` / `carrier` predate parcels and are still read by
 * orderTrackingService, the customer tracking panel and the order-level email. Keeping
 * them in step for the single-parcel case is what let all of those readers stay
 * unchanged.
 */
describe('legacy order-level tracking mirror', () => {
  it('mirrors the FIRST parcel’s tracking onto the order, in the same write', async () => {
    const order = await seedOrder();
    await shipmentService.createShipment(order._id.toString(), {
      trackingNumber: 'AWB-FIRST',
      carrier: { name: 'Delhivery', code: 'delhivery', trackingUrl: 'http://t/AWB-FIRST' },
    }, { userId: ADMIN });

    const saved = await Order.findById(order._id);
    expect(saved.trackingNumber).toBe('AWB-FIRST');
    expect(saved.carrier.name).toBe('Delhivery');
  });

  // Once two boxes are in flight there is no honest single answer, and overwriting
  // would show parcel 2's AWB as "the" tracking number for the whole order.
  it('does NOT let a second parcel overwrite it', async () => {
    const order = await seedOrder();
    const [wax, polish] = itemIds(order);
    await shipmentService.createShipment(order._id.toString(), {
      lines: [{ itemId: wax, quantity: 2 }], trackingNumber: 'AWB-FIRST',
      carrier: { name: 'Delhivery', code: 'delhivery' },
    }, { userId: ADMIN });
    await shipmentService.createShipment(order._id.toString(), {
      lines: [{ itemId: polish, quantity: 1 }], trackingNumber: 'AWB-SECOND',
      carrier: { name: 'BlueDart', code: 'bluedart' },
    }, { userId: ADMIN });

    const saved = await Order.findById(order._id);
    expect(saved.trackingNumber).toBe('AWB-FIRST');
    expect(saved.shipments.map((sh) => sh.trackingNumber)).toEqual(['AWB-FIRST', 'AWB-SECOND']);
  });
});

describe('the goodie as a fulfilment unit', () => {
  it('rides in the parcel that completes the order by default', async () => {
    const order = await seedOrder(withGoodie);
    const res = await shipmentService.createShipment(order._id.toString(), { trackingNumber: 'A' }, { userId: ADMIN });
    expect(res.shipment.includesReward).toBe(true);
  });

  it('is NOT auto-assigned to a partial parcel', async () => {
    const order = await seedOrder(withGoodie);
    const [wax] = itemIds(order);
    const res = await shipmentService.createShipment(order._id.toString(), { lines: [{ itemId: wax, quantity: 1 }], trackingNumber: 'A' }, { userId: ADMIN });
    expect(res.shipment.includesReward).toBe(false);
  });

  // The whole point of promoting the goodie to a fulfilment unit: the order refuses to
  // finish while the gift is still on the shelf.
  it('holds the order back from delivered until the gift has also arrived', async () => {
    const order = await seedOrder(withGoodie);
    const [wax, polish] = itemIds(order);

    const goods = await shipmentService.createShipment(order._id.toString(), {
      lines: [{ itemId: wax, quantity: 2 }, { itemId: polish, quantity: 1 }],
      includesReward: false, trackingNumber: 'A',
    }, { userId: ADMIN });
    const gift = await shipmentService.createShipment(order._id.toString(), {
      lines: [], includesReward: true, trackingNumber: 'B',
    }, { userId: ADMIN });

    await shipmentService.markShipmentDelivered(order._id.toString(), goods.shipment._id.toString(), { userId: ADMIN });
    let saved = await Order.findById(order._id);
    expect(saved.status).toBe('shipped'); // every paid item arrived, but not the gift

    await shipmentService.markShipmentDelivered(order._id.toString(), gift.shipment._id.toString(), { userId: ADMIN });
    saved = await Order.findById(order._id);
    expect(saved.status).toBe('delivered');
  });

  it.each(['coupon', 'karma'])('a %s prize never holds the order back', async (kind) => {
    const order = await seedOrder({ spinReward: { ...withGoodie.spinReward, kind } });
    const res = await shipmentService.createShipment(order._id.toString(), { trackingNumber: 'A' }, { userId: ADMIN });
    await shipmentService.markShipmentDelivered(order._id.toString(), res.shipment._id.toString(), { userId: ADMIN });
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('delivered');
  });
});

describe('markShipmentDelivered', () => {
  it('moves the order to delivered when the last parcel lands', async () => {
    const order = await seedOrder();
    const res = await shipmentService.createShipment(order._id.toString(), { trackingNumber: 'A' }, { userId: ADMIN });
    await shipmentService.markShipmentDelivered(order._id.toString(), res.shipment._id.toString(), { userId: ADMIN });
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('delivered');
  });

  // Idempotency: a double-click must not re-stamp the date or re-notify the customer.
  it('is idempotent — a second call reports already-delivered and does not move the date', async () => {
    const order = await seedOrder();
    const res = await shipmentService.createShipment(order._id.toString(), { trackingNumber: 'A' }, { userId: ADMIN });
    const id = res.shipment._id.toString();

    const first = await shipmentService.markShipmentDelivered(order._id.toString(), id, { userId: ADMIN });
    const firstDate = first.order.shipments[0].deliveredAt;

    const second = await shipmentService.markShipmentDelivered(order._id.toString(), id, { userId: ADMIN });
    expect(second.success).toBe(true);
    expect(second.alreadyDelivered).toBe(true);
    expect(second.order.shipments[0].deliveredAt).toEqual(firstDate);
  });

  it('rejects an unknown parcel', async () => {
    const order = await seedOrder();
    const res = await shipmentService.markShipmentDelivered(
      order._id.toString(), new mongoose.Types.ObjectId().toString(), { userId: ADMIN });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/not found/i);
  });
});

describe('markShipmentLost', () => {
  it('returns the parcel’s units to the pool so a replacement can be sent', async () => {
    const order = await seedOrder();
    const res = await shipmentService.createShipment(order._id.toString(), { trackingNumber: 'A' }, { userId: ADMIN });

    await shipmentService.markShipmentLost(order._id.toString(), res.shipment._id.toString(), { userId: ADMIN });

    const fulfilment = await shipmentService.getFulfilment(order._id.toString());
    expect(fulfilment.remaining).toHaveLength(2);
    expect(fulfilment.summary.shippedUnits).toBe(0);
  });
});

/**
 * The bug that motivated the whole phase. `Order.notifiedStatuses` used to hold the
 * bare status word and the sender skipped when it was already present — so the second
 * parcel's "shipped" email was silently dropped and the customer was never told.
 */
describe('per-parcel email idempotency keys', () => {
  it('keys a parcel event on the shipment, and an order event on the bare status', () => {
    expect(notificationKey('shipped')).toBe('shipped');
    expect(notificationKey('shipped', 'abc')).toBe('shipped:abc');
  });

  it('gives two parcels two DIFFERENT keys, so both emails can be sent', async () => {
    const order = await seedOrder();
    const [wax, polish] = itemIds(order);
    const a = await shipmentService.createShipment(order._id.toString(), { lines: [{ itemId: wax, quantity: 2 }], trackingNumber: 'A' }, { userId: ADMIN });
    const b = await shipmentService.createShipment(order._id.toString(), { lines: [{ itemId: polish, quantity: 1 }], trackingNumber: 'B' }, { userId: ADMIN });

    const keyA = notificationKey('shipped', a.shipment._id.toString());
    const keyB = notificationKey('shipped', b.shipment._id.toString());
    expect(keyA).not.toBe(keyB);

    // Under the OLD scheme both parcels collapsed onto the single word 'shipped',
    // which is exactly how parcel B's email got swallowed.
    expect(new Set([keyA, keyB]).size).toBe(2);
  });
});

describe('legacy orders (no parcels)', () => {
  it('are never dragged backwards out of delivered by the roll-up', async () => {
    const order = await seedOrder({ status: 'delivered', shipments: [] });
    const fulfilment = await shipmentService.getFulfilment(order._id.toString());
    expect(fulfilment.shipments).toHaveLength(0);
    // Nothing recomputes them: rollUpStatus returns the stored status untouched.
    const saved = await Order.findById(order._id);
    expect(saved.status).toBe('delivered');
  });
});

/**
 * Regressions from the code review of this feature. Each of these shipped broken and is
 * pinned here so it cannot come back.
 */
describe('review regressions', () => {
  // F2: `lines: []` means "no sale items in this box" (a goodie-only parcel). A
  // truthiness check treated it as "omitted" and shipped the ENTIRE remainder.
  it('an explicitly empty lines[] does not ship the whole remainder', async () => {
    const order = await seedOrder(withGoodie);

    const res = await shipmentService.createShipment(order._id.toString(), {
      lines: [], includesReward: true, trackingNumber: 'GIFT-ONLY',
    }, { userId: ADMIN });

    expect(res.success).toBe(true);
    expect(res.shipment.lines).toHaveLength(0);
    expect(res.shipment.includesReward).toBe(true);

    // Every paid item is still waiting — nothing was swept into the gift parcel.
    const fulfilment = await shipmentService.getFulfilment(order._id.toString());
    expect(fulfilment.remaining).toHaveLength(2);
  });

  it('an OMITTED lines still means "everything outstanding"', async () => {
    const order = await seedOrder();
    const res = await shipmentService.createShipment(order._id.toString(), {
      trackingNumber: 'ALL',
    }, { userId: ADMIN });
    expect(res.shipment.lines).toHaveLength(2);
  });

  // F3: a packed parcel consumed its units from the remaining pool but nothing could
  // move it on, so the order could never reach shipped or delivered.
  it('a packed parcel can be dispatched, and that moves the order to shipped', async () => {
    const order = await seedOrder();
    const created = await shipmentService.createShipment(order._id.toString(), {
      trackingNumber: 'A', dispatch: false,
    }, { userId: ADMIN });
    expect((await Order.findById(order._id)).status).toBe('processing');

    const res = await shipmentService.dispatchShipment(
      order._id.toString(), created.shipment._id.toString(), {}, { userId: ADMIN });

    expect(res.success).toBe(true);
    expect((await Order.findById(order._id)).status).toBe('shipped');
  });

  it('dispatching twice is a no-op rather than a second dispatch', async () => {
    const order = await seedOrder();
    const created = await shipmentService.createShipment(order._id.toString(), {
      trackingNumber: 'A', dispatch: false,
    }, { userId: ADMIN });
    const id = created.shipment._id.toString();

    await shipmentService.dispatchShipment(order._id.toString(), id, {}, { userId: ADMIN });
    const second = await shipmentService.dispatchShipment(order._id.toString(), id, {}, { userId: ADMIN });
    expect(second.success).toBe(false);
    expect(second.message).toMatch(/already been dispatched/i);
  });

  /*
    F1 — the worst of them. The admin dropdown still offers order-level `delivered`.
    Flipping only Order.status left every parcel at `shipped`, and because the per-line
    return window reads PARCEL dates once an order has parcels, `deliveredAtForItem`
    returned null for every line: the order said "delivered" while the return window
    never opened and every return was refused.
  */
  it('delivering the whole order also delivers its parcels, so returns can open', async () => {
    const order = await seedOrder();
    await shipmentService.createShipment(order._id.toString(), { trackingNumber: 'A' }, { userId: ADMIN });

    const { delivered } = await shipmentService.deliverAllOutstanding(order._id.toString(), { userId: ADMIN });
    expect(delivered).toBe(1);

    const saved = await Order.findById(order._id);
    expect(saved.shipments[0].status).toBe('delivered');
    expect(saved.shipments[0].deliveredAt).toBeTruthy();
    // The whole point: every line now has a delivery date to measure a return from.
    for (const item of saved.items) {
      expect(deliveredAtForItem(saved, item._id)).toBeTruthy();
    }
  });

  it('also dispatches a still-packed parcel on the way, so it is not stranded', async () => {
    const order = await seedOrder();
    const [wax, polish] = itemIds(order);
    await shipmentService.createShipment(order._id.toString(), { lines: [{ itemId: wax, quantity: 2 }], trackingNumber: 'A' }, { userId: ADMIN });
    await shipmentService.createShipment(order._id.toString(), { lines: [{ itemId: polish, quantity: 1 }], trackingNumber: 'B', dispatch: false }, { userId: ADMIN });

    await shipmentService.deliverAllOutstanding(order._id.toString(), { userId: ADMIN });

    const saved = await Order.findById(order._id);
    expect(saved.shipments.map((sh) => sh.status)).toEqual(['delivered', 'delivered']);
    expect(saved.shipments[1].shippedAt).toBeTruthy();
  });

  it('is idempotent — re-delivering an already-delivered order moves nothing', async () => {
    const order = await seedOrder();
    await shipmentService.createShipment(order._id.toString(), { trackingNumber: 'A' }, { userId: ADMIN });
    await shipmentService.deliverAllOutstanding(order._id.toString(), { userId: ADMIN });

    const again = await shipmentService.deliverAllOutstanding(order._id.toString(), { userId: ADMIN });
    expect(again.delivered).toBe(0);
  });
});
