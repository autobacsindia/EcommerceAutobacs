/**
 * Partial-return coverage maths (utils/orderReturns.js).
 *
 * The predicate these tests pin down is the one that decides whether an approved return
 * closes the WHOLE order. Getting it wrong in either direction is expensive:
 *
 *   too eager  → returning 1 of 3 items flips Order.status to `returned`, which is
 *                terminal, so the other 2 can never be returned and the order is stuck.
 *                (This was the live bug.)
 *   too shy    → a genuine full return never closes the order, so the admin queue keeps
 *                showing it as `delivered` forever.
 *
 * Pure functions, no DB — the returned-quantity map is supplied by the caller.
 */

import {
  deliveredQuantityByProduct,
  coversEveryDeliveredLine,
  remainingReturnable,
  returnSummary,
} from '../../../utils/orderReturns.js';

/** Order with parcels: caller states exactly what each shipment carried. */
const withParcels = (items, shipments, cancellations = []) => ({
  _id: 'o1', items, shipments, cancellations,
});

/** Pre-parcel order — every historical order looks like this. */
const legacy = (items, cancellations = []) => ({
  _id: 'o1', items, shipments: [], cancellations,
});

const delivered = (lines, id = 's1') => ({
  _id: id, status: 'delivered', deliveredAt: new Date(), lines,
});

describe('deliveredQuantityByProduct', () => {
  it('counts only units a parcel actually delivered', () => {
    const order = withParcels(
      [
        { _id: 'i1', product: 'p1', quantity: 3 },
        { _id: 'i2', product: 'p2', quantity: 1 },
      ],
      [
        delivered([{ itemId: 'i1', quantity: 2 }]),
        { _id: 's2', status: 'shipped', lines: [{ itemId: 'i2', quantity: 1 }] },
      ],
    );

    const got = deliveredQuantityByProduct(order);
    expect(got.get('p1')).toBe(2);   // 1 of the 3 is still in transit
    expect(got.has('p2')).toBe(false); // its parcel has not landed
  });

  /*
    The fallback that keeps every pre-split-shipment order working. Without it these
    orders look 0%-delivered, so no return could ever close one.
  */
  it('treats every live unit as delivered on an order that predates parcels', () => {
    const got = deliveredQuantityByProduct(legacy([
      { _id: 'i1', product: 'p1', quantity: 2 },
      { _id: 'i2', product: 'p2', quantity: 1 },
    ]));
    expect(got.get('p1')).toBe(2);
    expect(got.get('p2')).toBe(1);
  });

  it('subtracts cancelled units — they were never delivered and can never come back', () => {
    const order = legacy(
      [{ _id: 'i1', product: 'p1', quantity: 3 }],
      [{ lines: [{ itemId: 'i1', quantity: 1 }] }],
    );
    expect(deliveredQuantityByProduct(order).get('p1')).toBe(2);
  });

  it('sums two order lines of the same product into one product total', () => {
    // Two variants of one product are separate order lines but a single return key.
    const order = legacy([
      { _id: 'i1', product: 'p1', variantId: 'v1', quantity: 1 },
      { _id: 'i2', product: 'p1', variantId: 'v2', quantity: 2 },
    ]);
    expect(deliveredQuantityByProduct(order).get('p1')).toBe(3);
  });

  it('skips a legacy WooCommerce line carrying no product reference', () => {
    const order = legacy([
      { _id: 'i1', product: null, quantity: 1 },
      { _id: 'i2', product: 'p2', quantity: 1 },
    ]);
    const got = deliveredQuantityByProduct(order);
    expect(got.size).toBe(1);
    expect(got.get('p2')).toBe(1);
  });

  it('never counts more than was delivered when a parcel over-states its quantity', () => {
    const order = withParcels(
      [{ _id: 'i1', product: 'p1', quantity: 2 }],
      [delivered([{ itemId: 'i1', quantity: 5 }])],
    );
    expect(deliveredQuantityByProduct(order).get('p1')).toBe(2);
  });
});

describe('coversEveryDeliveredLine', () => {
  const threeUnits = legacy([
    { _id: 'i1', product: 'p1', quantity: 1 },
    { _id: 'i2', product: 'p2', quantity: 2 },
  ]);

  it('is false while any delivered unit is still with the customer', () => {
    expect(coversEveryDeliveredLine(threeUnits, new Map([['p1', 1]]))).toBe(false);
  });

  it('is false when a product is only partly returned', () => {
    expect(coversEveryDeliveredLine(threeUnits, new Map([['p1', 1], ['p2', 1]]))).toBe(false);
  });

  it('is true once every delivered unit is accounted for', () => {
    expect(coversEveryDeliveredLine(threeUnits, new Map([['p1', 1], ['p2', 2]]))).toBe(true);
  });

  /*
    An order still in transit has nothing to "cover". Treating that as vacuously complete
    would let a return close an order the customer never received.
  */
  it('is false when nothing has been delivered at all', () => {
    const inTransit = withParcels(
      [{ _id: 'i1', product: 'p1', quantity: 1 }],
      [{ _id: 's1', status: 'shipped', lines: [{ itemId: 'i1', quantity: 1 }] }],
    );
    expect(coversEveryDeliveredLine(inTransit, new Map([['p1', 1]]))).toBe(false);
  });

  it('ignores cancelled units, so returning the delivered remainder still closes it', () => {
    const partlyCancelled = legacy(
      [
        { _id: 'i1', product: 'p1', quantity: 1 },
        { _id: 'i2', product: 'p2', quantity: 2 },
      ],
      [{ lines: [{ itemId: 'i2', quantity: 2 }] }], // p2 cancelled outright
    );
    expect(coversEveryDeliveredLine(partlyCancelled, new Map([['p1', 1]]))).toBe(true);
  });

  it('only counts what was DELIVERED, not what was ordered', () => {
    // p2's parcel is still in transit, so returning p1 covers everything delivered…
    const order = withParcels(
      [
        { _id: 'i1', product: 'p1', quantity: 1 },
        { _id: 'i2', product: 'p2', quantity: 1 },
      ],
      [
        delivered([{ itemId: 'i1', quantity: 1 }]),
        { _id: 's2', status: 'shipped', lines: [{ itemId: 'i2', quantity: 1 }] },
      ],
    );
    expect(coversEveryDeliveredLine(order, new Map([['p1', 1]]))).toBe(true);
  });

  it('tolerates a missing map rather than throwing', () => {
    expect(coversEveryDeliveredLine(threeUnits, undefined)).toBe(false);
  });
});

describe('remainingReturnable', () => {
  it('lists the units still with the customer, with their names', () => {
    const order = legacy([
      { _id: 'i1', product: 'p1', name: 'Wiper', quantity: 1 },
      { _id: 'i2', product: 'p2', name: 'Mat', quantity: 3 },
    ]);
    expect(remainingReturnable(order, new Map([['p1', 1], ['p2', 1]])))
      .toEqual([{ productId: 'p2', name: 'Mat', quantity: 2 }]);
  });

  it('is empty once everything has been sent back', () => {
    const order = legacy([{ _id: 'i1', product: 'p1', name: 'Wiper', quantity: 1 }]);
    expect(remainingReturnable(order, new Map([['p1', 1]]))).toEqual([]);
  });
});

describe('returnSummary', () => {
  const order = legacy([
    { _id: 'i1', product: 'p1', quantity: 1 },
    { _id: 'i2', product: 'p2', quantity: 2 },
  ]);

  it('says nothing when nothing was returned', () => {
    const s = returnSummary(order, new Map());
    expect(s).toMatchObject({ returnedUnits: 0, partial: false, fullyReturned: false, label: null });
  });

  it('describes a partial return in units, not statuses', () => {
    const s = returnSummary(order, new Map([['p1', 1]]));
    expect(s.partial).toBe(true);
    expect(s.fullyReturned).toBe(false);
    expect(s.label).toBe('Partially returned · 1 of 3 items');
  });

  it('reads simply "Returned" once it is complete', () => {
    const s = returnSummary(order, new Map([['p1', 1], ['p2', 2]]));
    expect(s.fullyReturned).toBe(true);
    expect(s.partial).toBe(false);
    expect(s.label).toBe('Returned');
  });

  /*
    Bad data (a return recorded against the wrong order) must not read "4 of 3 items".
    The count is clamped per product to what this order actually delivered.
  */
  it('clamps an over-claim instead of reporting more returned than delivered', () => {
    const s = returnSummary(order, new Map([['p1', 9], ['p2', 9]]));
    expect(s.returnedUnits).toBe(3);
    expect(s.label).toBe('Returned');
  });
});
