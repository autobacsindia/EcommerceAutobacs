/**
 * Split-shipment maths.
 *
 * These are the invariants that decide whether a customer gets their goods: an order
 * that says "delivered" while a box is still on a shelf, or one that can never say
 * delivered at all, are both worse than no feature. Pure functions, no DB.
 */

import {
  SHIPMENT_STATUS,
  remainingToShip,
  shippedQuantityByItem,
  deliveredQuantityByItem,
  rewardShipped,
  rewardDelivered,
  isFullyShipped,
  isFullyDelivered,
  rollUpStatus,
  fulfilmentSummary,
  validateProposedShipment,
  deliveredAtForItem,
  deliveredAtForReward,
  isItemDelivered,
} from '../../../utils/orderFulfilment.js';

const goodie = (over = {}) => ({ name: 'Cloth', sku: 'MF1', kind: 'goodie', voidedAt: null, fulfilledAt: null, ...over });

const order = (over = {}) => ({
  status: 'processing',
  items: [
    { _id: 'a', name: 'Wax', quantity: 2 },
    { _id: 'b', name: 'Polish', quantity: 1 },
  ],
  spinReward: null,
  shipments: [],
  ...over,
});

const parcel = (over = {}) => ({
  _id: 's1', sequence: 1, status: SHIPMENT_STATUS.SHIPPED,
  lines: [], includesReward: false, ...over,
});

describe('remainingToShip', () => {
  it('is the whole order when nothing has shipped', () => {
    expect(remainingToShip(order())).toEqual([
      { itemId: 'a', name: 'Wax', quantity: 2 },
      { itemId: 'b', name: 'Polish', quantity: 1 },
    ]);
  });

  it('subtracts partial quantities and drops fully-shipped lines', () => {
    const o = order({ shipments: [parcel({ lines: [{ itemId: 'a', quantity: 1 }] })] });
    expect(remainingToShip(o)).toEqual([
      { itemId: 'a', name: 'Wax', quantity: 1 },
      { itemId: 'b', name: 'Polish', quantity: 1 },
    ]);
  });

  it('counts packed parcels as committed — they are already spoken for', () => {
    const o = order({ shipments: [parcel({ status: SHIPMENT_STATUS.PACKED, lines: [{ itemId: 'a', quantity: 2 }] })] });
    expect(remainingToShip(o).map((l) => l.itemId)).toEqual(['b']);
  });

  // A written-off parcel must free its units, or the customer can never be sent a
  // replacement and the order is stuck short for ever.
  it('returns a LOST parcel’s units to the pool', () => {
    const o = order({ shipments: [parcel({ status: SHIPMENT_STATUS.LOST, lines: [{ itemId: 'a', quantity: 2 }] })] });
    expect(remainingToShip(o)).toEqual([
      { itemId: 'a', name: 'Wax', quantity: 2 },
      { itemId: 'b', name: 'Polish', quantity: 1 },
    ]);
  });

  it('tallies quantities across several parcels', () => {
    const o = order({ shipments: [
      parcel({ _id: 's1', lines: [{ itemId: 'a', quantity: 1 }] }),
      parcel({ _id: 's2', lines: [{ itemId: 'a', quantity: 1 }] }),
    ] });
    expect(shippedQuantityByItem(o).get('a')).toBe(2);
    expect(remainingToShip(o).map((l) => l.itemId)).toEqual(['b']);
  });
});

describe('the goodie as a fulfilment unit', () => {
  it('an order owing a goodie is NOT fully shipped until the gift is in a box', () => {
    const o = order({
      spinReward: goodie(),
      shipments: [parcel({ lines: [{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }] })],
    });
    expect(remainingToShip(o)).toEqual([]);   // every paid item is out...
    expect(rewardShipped(o)).toBe(false);     // ...but the gift is not
    expect(isFullyShipped(o)).toBe(false);
  });

  it('is fully shipped once a parcel carries the gift', () => {
    const o = order({
      spinReward: goodie(),
      shipments: [parcel({ lines: [{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }], includesReward: true })],
    });
    expect(isFullyShipped(o)).toBe(true);
  });

  // ── THE DEADLOCK GUARDS ────────────────────────────────────────────────────
  // If either of these regresses, the affected orders can NEVER reach `delivered`.
  it.each(['coupon', 'karma'])('a %s prize never blocks completion — nothing to pack', (kind) => {
    const o = order({
      spinReward: goodie({ kind }),
      shipments: [parcel({ lines: [{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }] })],
    });
    expect(rewardShipped(o)).toBe(true);
    expect(isFullyShipped(o)).toBe(true);
  });

  it('a VOIDED goodie never blocks completion — the gift was withdrawn', () => {
    const o = order({
      spinReward: goodie({ voidedAt: new Date() }),
      shipments: [parcel({ lines: [{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }] })],
    });
    expect(rewardShipped(o)).toBe(true);
    expect(isFullyShipped(o)).toBe(true);
  });

  it('delivery of the gift is tracked separately from its dispatch', () => {
    const shipped = order({
      spinReward: goodie(),
      shipments: [parcel({ lines: [{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }], includesReward: true })],
    });
    expect(rewardShipped(shipped)).toBe(true);
    expect(rewardDelivered(shipped)).toBe(false);
    expect(isFullyDelivered(shipped)).toBe(false);
  });
});

describe('rollUpStatus', () => {
  it('leaves an order with no parcels exactly as it is — historical orders are never recomputed', () => {
    expect(rollUpStatus(order({ status: 'delivered', shipments: [] }))).toBe('delivered');
    expect(rollUpStatus(order({ status: 'processing', shipments: [] }))).toBe('processing');
  });

  it.each(['cancelled', 'returned', 'awaiting_payment'])(
    'never overwrites the terminal/pre-payment status %s',
    (status) => {
      const o = order({ status, shipments: [parcel({ lines: [{ itemId: 'a', quantity: 2 }] })] });
      expect(rollUpStatus(o)).toBe(status);
    },
  );

  it('is `shipped` as soon as ANY parcel is in transit, even with items outstanding', () => {
    const o = order({ shipments: [parcel({ lines: [{ itemId: 'a', quantity: 1 }] })] });
    expect(rollUpStatus(o)).toBe('shipped');
  });

  it('is `delivered` only when every unit has arrived', () => {
    const partial = order({ shipments: [
      parcel({ _id: 's1', status: SHIPMENT_STATUS.DELIVERED, lines: [{ itemId: 'a', quantity: 2 }] }),
      parcel({ _id: 's2', status: SHIPMENT_STATUS.SHIPPED, lines: [{ itemId: 'b', quantity: 1 }] }),
    ] });
    expect(rollUpStatus(partial)).toBe('shipped');

    const all = order({ shipments: [
      parcel({ _id: 's1', status: SHIPMENT_STATUS.DELIVERED, lines: [{ itemId: 'a', quantity: 2 }] }),
      parcel({ _id: 's2', status: SHIPMENT_STATUS.DELIVERED, lines: [{ itemId: 'b', quantity: 1 }] }),
    ] });
    expect(rollUpStatus(all)).toBe('delivered');
  });

  it('withholds `delivered` while the goodie is still undelivered', () => {
    const o = order({
      spinReward: goodie(),
      shipments: [
        parcel({ _id: 's1', status: SHIPMENT_STATUS.DELIVERED, lines: [{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }] }),
        parcel({ _id: 's2', status: SHIPMENT_STATUS.SHIPPED, lines: [], includesReward: true }),
      ],
    });
    expect(rollUpStatus(o)).toBe('shipped');
  });

  // A lost parcel with nothing else in transit must walk the order BACK: telling the
  // customer it is "shipped" when the courier lost it is a lie, and `shipped` also
  // blocks the cancellation they may well want.
  it('falls back to `processing` when the only parcel is written off as lost', () => {
    const o = order({
      status: 'shipped',
      shipments: [parcel({ status: SHIPMENT_STATUS.LOST, lines: [{ itemId: 'a', quantity: 2 }] })],
    });
    expect(rollUpStatus(o)).toBe('processing');
  });

  it('stays `shipped` when one parcel is lost but another is still in transit', () => {
    const o = order({
      status: 'shipped',
      shipments: [
        parcel({ _id: 's1', status: SHIPMENT_STATUS.LOST, lines: [{ itemId: 'a', quantity: 2 }] }),
        parcel({ _id: 's2', status: SHIPMENT_STATUS.SHIPPED, lines: [{ itemId: 'b', quantity: 1 }] }),
      ],
    });
    expect(rollUpStatus(o)).toBe('shipped');
  });

  it('stays `processing` while parcels are only packed', () => {
    const o = order({ shipments: [parcel({ status: SHIPMENT_STATUS.PACKED, lines: [{ itemId: 'a', quantity: 2 }] })] });
    expect(rollUpStatus(o)).toBe('processing');
  });
});

describe('fulfilmentSummary', () => {
  it('counts the gift as one more unit still owed', () => {
    const o = order({
      spinReward: goodie(),
      shipments: [parcel({ lines: [{ itemId: 'a', quantity: 2 }] })],
    });
    const s = fulfilmentSummary(o);
    expect(s.totalUnits).toBe(4);      // 2 wax + 1 polish + 1 gift
    expect(s.shippedUnits).toBe(2);
    expect(s.label).toBe('Partially shipped · 2 of 4 items');
    expect(s.partial).toBe(true);
  });

  it('reads Preparing / Shipped / Delivered for the whole-order cases', () => {
    expect(fulfilmentSummary(order()).label).toBe('Preparing');

    const shipped = order({ shipments: [parcel({ lines: [{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }] })] });
    expect(fulfilmentSummary(shipped).label).toBe('Shipped');

    const delivered = order({ shipments: [parcel({ status: SHIPMENT_STATUS.DELIVERED, lines: [{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }] })] });
    expect(fulfilmentSummary(delivered).label).toBe('Delivered');
  });

  it('excludes a lost parcel from the count', () => {
    const o = order({ shipments: [parcel({ status: SHIPMENT_STATUS.LOST, lines: [{ itemId: 'a', quantity: 2 }] })] });
    expect(fulfilmentSummary(o).parcelCount).toBe(0);
    expect(fulfilmentSummary(o).shippedUnits).toBe(0);
  });
});

describe('validateProposedShipment (the over-ship guard)', () => {
  it('accepts a subset of what is owed', () => {
    expect(validateProposedShipment(order(), { lines: [{ itemId: 'a', quantity: 1 }] }))
      .toEqual({ valid: true });
  });

  it('rejects more than was ordered', () => {
    const res = validateProposedShipment(order(), { lines: [{ itemId: 'a', quantity: 3 }] });
    expect(res.valid).toBe(false);
    expect(res.message).toMatch(/only 2 left to ship/);
  });

  it('rejects more than is LEFT once part has already shipped', () => {
    const o = order({ shipments: [parcel({ lines: [{ itemId: 'a', quantity: 1 }] })] });
    const res = validateProposedShipment(o, { lines: [{ itemId: 'a', quantity: 2 }] });
    expect(res.valid).toBe(false);
    expect(res.message).toMatch(/only 1 left to ship/);
  });

  it('rejects an empty parcel', () => {
    expect(validateProposedShipment(order(), { lines: [] }).valid).toBe(false);
  });

  it('rejects an item that is not on the order', () => {
    const res = validateProposedShipment(order(), { lines: [{ itemId: 'zzz', quantity: 1 }] });
    expect(res.valid).toBe(false);
    expect(res.message).toMatch(/not part of this order/);
  });

  it('rejects a duplicated line — it would silently double the quantity', () => {
    const res = validateProposedShipment(order(), {
      lines: [{ itemId: 'a', quantity: 1 }, { itemId: 'a', quantity: 1 }],
    });
    expect(res.valid).toBe(false);
    expect(res.message).toMatch(/twice/);
  });

  it.each([0, -1, 1.5, NaN])('rejects a non-positive-integer quantity (%s)', (quantity) => {
    expect(validateProposedShipment(order(), { lines: [{ itemId: 'a', quantity }] }).valid).toBe(false);
  });

  it('rejects a second parcel claiming the goodie', () => {
    const o = order({
      spinReward: goodie(),
      shipments: [parcel({ lines: [{ itemId: 'a', quantity: 1 }], includesReward: true })],
    });
    const res = validateProposedShipment(o, { lines: [{ itemId: 'b', quantity: 1 }], includesReward: true });
    expect(res.valid).toBe(false);
    expect(res.message).toMatch(/already in another parcel/);
  });

  it('rejects a goodie on an order that never won one', () => {
    const res = validateProposedShipment(order(), { lines: [{ itemId: 'a', quantity: 1 }], includesReward: true });
    expect(res.valid).toBe(false);
    expect(res.message).toMatch(/no goodie/);
  });

  it('allows a gift-only parcel — the goodie may follow separately', () => {
    const o = order({
      spinReward: goodie(),
      shipments: [parcel({ lines: [{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }] })],
    });
    expect(validateProposedShipment(o, { lines: [], includesReward: true })).toEqual({ valid: true });
  });
});

/**
 * Per-line delivery dates — what the 4-day return window is measured from.
 *
 * With one parcel per order a single `deliveredAt` was right for everything. Split it
 * and that date is wrong for at least one line: either an item's window silently runs
 * long, or it expires before the customer ever held the thing.
 */
describe('deliveredAtForItem', () => {
  const MON = '2026-08-17T10:00:00.000Z';
  const FRI = '2026-08-21T10:00:00.000Z';

  it('returns the delivery date of the parcel that line arrived in', () => {
    const o = order({ shipments: [
      parcel({ _id: 's1', status: SHIPMENT_STATUS.DELIVERED, deliveredAt: MON, lines: [{ itemId: 'a', quantity: 2 }] }),
      parcel({ _id: 's2', status: SHIPMENT_STATUS.DELIVERED, deliveredAt: FRI, lines: [{ itemId: 'b', quantity: 1 }] }),
    ] });
    expect(deliveredAtForItem(o, 'a')).toEqual(new Date(MON));
    expect(deliveredAtForItem(o, 'b')).toEqual(new Date(FRI));
  });

  it('is null for a line that has not arrived, even when another parcel has', () => {
    const o = order({ shipments: [
      parcel({ _id: 's1', status: SHIPMENT_STATUS.DELIVERED, deliveredAt: MON, lines: [{ itemId: 'a', quantity: 2 }] }),
      parcel({ _id: 's2', status: SHIPMENT_STATUS.SHIPPED, lines: [{ itemId: 'b', quantity: 1 }] }),
    ] });
    expect(deliveredAtForItem(o, 'b')).toBeNull();
    expect(isItemDelivered(o, 'a')).toBe(true);
    expect(isItemDelivered(o, 'b')).toBe(false);
  });

  // An ambiguous date should favour the buyer: they did not hold the full quantity
  // until the last box landed.
  it('takes the LATEST date when a line was split across parcels', () => {
    const o = order({ shipments: [
      parcel({ _id: 's1', status: SHIPMENT_STATUS.DELIVERED, deliveredAt: MON, lines: [{ itemId: 'a', quantity: 1 }] }),
      parcel({ _id: 's2', status: SHIPMENT_STATUS.DELIVERED, deliveredAt: FRI, lines: [{ itemId: 'a', quantity: 1 }] }),
    ] });
    expect(deliveredAtForItem(o, 'a')).toEqual(new Date(FRI));
  });

  it('ignores a lost parcel', () => {
    const o = order({ shipments: [
      parcel({ _id: 's1', status: SHIPMENT_STATUS.LOST, deliveredAt: MON, lines: [{ itemId: 'a', quantity: 2 }] }),
    ] });
    expect(deliveredAtForItem(o, 'a')).toBeNull();
  });

  // ── THE LEGACY GUARANTEE ───────────────────────────────────────────────────
  // Every order placed before parcels existed must behave exactly as it did.
  it('falls back to the order-level date when there are no parcels', () => {
    const legacy = order({ shipments: [], deliveredAt: MON });
    expect(deliveredAtForItem(legacy, 'a')).toEqual(new Date(MON));

    const viaMetrics = order({ shipments: [], fulfillmentMetrics: { deliveredAt: FRI } });
    expect(deliveredAtForItem(viaMetrics, 'a')).toEqual(new Date(FRI));
  });

  it('is null for an undelivered legacy order', () => {
    expect(deliveredAtForItem(order({ shipments: [] }), 'a')).toBeNull();
  });

  it('tracks the goodie’s own delivery date', () => {
    const o = order({
      spinReward: goodie(),
      shipments: [
        parcel({ _id: 's1', status: SHIPMENT_STATUS.DELIVERED, deliveredAt: MON, lines: [{ itemId: 'a', quantity: 2 }] }),
        parcel({ _id: 's2', status: SHIPMENT_STATUS.DELIVERED, deliveredAt: FRI, lines: [], includesReward: true }),
      ],
    });
    expect(deliveredAtForReward(o)).toEqual(new Date(FRI));
  });
});

/**
 * Cancelled units must vanish from every fulfilment question.
 *
 * A cancelled line has been refunded and is not owed. Leaving it in these sums does two
 * kinds of damage: an admin is offered goods to ship that were already paid back, and
 * the order can never be fully shipped — so it never reaches `delivered`, so karma, the
 * review-request email and the per-line return window never fire.
 */
describe('cancellations', () => {
  const A = 'itemA';
  const B = 'itemB';

  const order = (over = {}) => ({
    items: [
      { _id: A, name: 'Wax', quantity: 3 },
      { _id: B, name: 'Polish', quantity: 1 },
    ],
    status: 'processing',
    shipments: [],
    cancellations: [],
    ...over,
  });

  it('takes cancelled units out of remainingToShip', () => {
    const o = order({ cancellations: [{ lines: [{ itemId: A, quantity: 2 }] }] });
    expect(remainingToShip(o).find((l) => l.itemId === A).quantity).toBe(1);
  });

  it('drops a fully cancelled line from remainingToShip entirely', () => {
    const o = order({ cancellations: [{ lines: [{ itemId: B, quantity: 1 }] }] });
    expect(remainingToShip(o).map((l) => l.itemId)).toEqual([A]);
  });

  it('subtracts cancelled and shipped together', () => {
    const o = order({
      shipments: [{ _id: 's1', status: 'shipped', lines: [{ itemId: A, quantity: 1 }] }],
      cancellations: [{ lines: [{ itemId: A, quantity: 1 }] }],
    });
    expect(remainingToShip(o).find((l) => l.itemId === A).quantity).toBe(1);
  });

  // The case that would otherwise strand the order short of `delivered` forever.
  it('lets a partly cancelled order be fully shipped and fully delivered', () => {
    const o = order({
      cancellations: [{ lines: [{ itemId: A, quantity: 3 }] }],
      shipments: [{
        _id: 's1', status: 'delivered', deliveredAt: new Date(),
        lines: [{ itemId: B, quantity: 1 }],
      }],
    });
    expect(isFullyShipped(o)).toBe(true);
    expect(isFullyDelivered(o)).toBe(true);
    expect(rollUpStatus(o)).toBe('delivered');
  });

  // Nothing arrived, so "fully delivered" would be a lie — even though no unit is owed.
  it('does not call an order with every line cancelled "fully delivered"', () => {
    const o = order({
      cancellations: [{ lines: [{ itemId: A, quantity: 3 }, { itemId: B, quantity: 1 }] }],
    });
    expect(isFullyDelivered(o)).toBe(false);
  });

  it('counts the summary in LIVE units, so the label can reach complete', () => {
    const o = order({
      cancellations: [{ lines: [{ itemId: A, quantity: 3 }] }],
      shipments: [{ _id: 's1', status: 'shipped', lines: [{ itemId: B, quantity: 1 }] }],
    });
    const summary = fulfilmentSummary(o);
    expect(summary.totalUnits).toBe(1);
    expect(summary.shippedUnits).toBe(1);
    expect(summary.label).toBe('Shipped');
  });

  // Every order that predates partial cancellation carries no `cancellations` at all.
  it('leaves an order with no cancellations completely unchanged', () => {
    const o = order();
    delete o.cancellations;
    expect(remainingToShip(o)).toEqual([
      { itemId: A, name: 'Wax', quantity: 3 },
      { itemId: B, name: 'Polish', quantity: 1 },
    ]);
    expect(fulfilmentSummary(o).totalUnits).toBe(4);
  });
});

/**
 * Drift guard.
 *
 * orderFulfilment re-derives `cancelledQuantityByItem` locally rather than importing it
 * from utils/orderCancellation.js, because that module imports SHIPMENT_STATUS from
 * here and the import would be circular. Two copies of a fold is a cheap price for
 * breaking the cycle — but only while they agree, so this pins them together.
 */
describe('cancelled-quantity fold matches utils/orderCancellation', () => {
  it('produces the same totals as the shared helper', async () => {
    const { cancelledQuantityByItem } = await import('../../../utils/orderCancellation.js');
    const o = {
      items: [{ _id: 'x', quantity: 5 }],
      cancellations: [
        { lines: [{ itemId: 'x', quantity: 2 }] },
        { lines: [{ itemId: 'x', quantity: 1 }] },
      ],
    };
    // remainingToShip is the local fold's only observable output: 5 − 3 = 2.
    expect(remainingToShip(o)[0].quantity).toBe(2);
    expect(cancelledQuantityByItem(o).get('x')).toBe(3);
  });
});
