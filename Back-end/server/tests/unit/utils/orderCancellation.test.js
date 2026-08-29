/**
 * Partial-cancellation maths.
 *
 * The rule under test throughout: cancelled units and units committed to a parcel draw
 * from the SAME finite pool. Break it in one direction and we refund goods that are on
 * a courier's van; break it in the other and we ship goods we have already paid back.
 */

import mongoose from 'mongoose';
import {
  cancelledQuantityByItem,
  goneQuantityByItem,
  liveQuantityByItem,
  remainingCancellable,
  isFullyCancelled,
  hasCancellations,
  validateProposedCancellation,
  cancellationSummary,
} from '../../../utils/orderCancellation.js';

const id = () => new mongoose.Types.ObjectId();
const A = id();
const B = id();

/** Wax ×3, Polish ×1. */
const order = (over = {}) => ({
  items: [
    { _id: A, name: 'Wax', price: 500, quantity: 3 },
    { _id: B, name: 'Polish', price: 250, quantity: 1 },
  ],
  shipments: [],
  cancellations: [],
  ...over,
});

const cancellation = (lines) => ({ _id: id(), sequence: 1, lines });
const parcel = (status, lines) => ({ _id: id(), sequence: 1, status, lines });

describe('cancelledQuantityByItem / liveQuantityByItem', () => {
  it('subtracts cancelled units from what is still owed', () => {
    const o = order({ cancellations: [cancellation([{ itemId: A, quantity: 2 }])] });
    expect(cancelledQuantityByItem(o).get(String(A))).toBe(2);
    expect(liveQuantityByItem(o).get(String(A))).toBe(1);
    expect(liveQuantityByItem(o).get(String(B))).toBe(1);
  });

  it('adds up across several cancellations on the same line', () => {
    const o = order({
      cancellations: [
        cancellation([{ itemId: A, quantity: 1 }]),
        cancellation([{ itemId: A, quantity: 1 }]),
      ],
    });
    expect(liveQuantityByItem(o).get(String(A))).toBe(1);
  });

  it('never reports a negative live quantity', () => {
    const o = order({ cancellations: [cancellation([{ itemId: A, quantity: 99 }])] });
    expect(liveQuantityByItem(o).get(String(A))).toBe(0);
  });
});

describe('goneQuantityByItem', () => {
  // The whole packed-vs-shipped distinction lives here.
  it('counts shipped and delivered parcels, but NOT packed or lost ones', () => {
    const o = order({
      shipments: [
        parcel('packed', [{ itemId: A, quantity: 1 }]),
        parcel('shipped', [{ itemId: A, quantity: 1 }]),
        parcel('delivered', [{ itemId: B, quantity: 1 }]),
        parcel('lost', [{ itemId: A, quantity: 1 }]),
      ],
    });
    expect(goneQuantityByItem(o).get(String(A))).toBe(1);
    expect(goneQuantityByItem(o).get(String(B))).toBe(1);
  });
});

describe('remainingCancellable', () => {
  it('is everything on an untouched order', () => {
    expect(remainingCancellable(order())).toEqual([
      { itemId: String(A), name: 'Wax', quantity: 3, packed: 0 },
      { itemId: String(B), name: 'Polish', quantity: 1, packed: 0 },
    ]);
  });

  // A packed box has not left, so its units stay cancellable — the service pulls them
  // back out. Reporting `packed` lets the UI warn that a parcel will be edited.
  it('keeps units in a PACKED parcel cancellable, and flags them', () => {
    const o = order({ shipments: [parcel('packed', [{ itemId: A, quantity: 2 }])] });
    const wax = remainingCancellable(o).find((l) => l.itemId === String(A));
    expect(wax).toEqual({ itemId: String(A), name: 'Wax', quantity: 3, packed: 2 });
  });

  it('removes units that have already shipped — those are a return, not a cancellation', () => {
    const o = order({ shipments: [parcel('shipped', [{ itemId: A, quantity: 2 }])] });
    const wax = remainingCancellable(o).find((l) => l.itemId === String(A));
    expect(wax.quantity).toBe(1);
  });

  it('drops a line that is fully cancelled already', () => {
    const o = order({ cancellations: [cancellation([{ itemId: B, quantity: 1 }])] });
    expect(remainingCancellable(o).map((l) => l.itemId)).toEqual([String(A)]);
  });

  it('subtracts cancelled AND shipped together', () => {
    const o = order({
      shipments: [parcel('shipped', [{ itemId: A, quantity: 1 }])],
      cancellations: [cancellation([{ itemId: A, quantity: 1 }])],
    });
    expect(remainingCancellable(o).find((l) => l.itemId === String(A)).quantity).toBe(1);
  });
});

describe('isFullyCancelled / hasCancellations', () => {
  it('is false while any unit is still live', () => {
    const o = order({ cancellations: [cancellation([{ itemId: A, quantity: 3 }])] });
    expect(isFullyCancelled(o)).toBe(false);
  });

  it('is true once every line is gone', () => {
    const o = order({
      cancellations: [cancellation([{ itemId: A, quantity: 3 }, { itemId: B, quantity: 1 }])],
    });
    expect(isFullyCancelled(o)).toBe(true);
  });

  // An order that never cancelled anything is intact, not "fully cancelled" — otherwise
  // an empty order would roll every untouched order straight to `cancelled`.
  it('is false for an order with no cancellations at all', () => {
    expect(isFullyCancelled(order())).toBe(false);
    expect(hasCancellations(order())).toBe(false);
    expect(isFullyCancelled({ items: [], cancellations: [] })).toBe(false);
  });
});

describe('validateProposedCancellation', () => {
  it('accepts a legal partial cancellation', () => {
    expect(validateProposedCancellation(order(), { lines: [{ itemId: A, quantity: 2 }] }))
      .toEqual({ valid: true });
  });

  it('refuses an empty selection', () => {
    expect(validateProposedCancellation(order(), { lines: [] }).valid).toBe(false);
  });

  it('refuses more than the line holds', () => {
    const res = validateProposedCancellation(order(), { lines: [{ itemId: A, quantity: 4 }] });
    expect(res.valid).toBe(false);
    expect(res.message).toMatch(/only 3 left to cancel/i);
  });

  /*
    THE OVER-CANCEL HOLE. Two entries for the same line each pass a per-entry check
    while together exceeding the remainder. Without folding duplicates first, this
    cancels and refunds four units of a three-unit line.
  */
  it('folds duplicate entries for the same line before checking', () => {
    const res = validateProposedCancellation(order(), {
      lines: [{ itemId: A, quantity: 2 }, { itemId: A, quantity: 2 }],
    });
    expect(res.valid).toBe(false);
  });

  it('refuses a line that has already shipped, and says why', () => {
    const o = order({ shipments: [parcel('shipped', [{ itemId: A, quantity: 3 }])] });
    const res = validateProposedCancellation(o, { lines: [{ itemId: A, quantity: 1 }] });
    expect(res.valid).toBe(false);
    expect(res.message).toMatch(/already shipped/i);
    expect(res.message).toMatch(/return/i);
  });

  it('refuses a line that is not on the order', () => {
    const res = validateProposedCancellation(order(), { lines: [{ itemId: id(), quantity: 1 }] });
    expect(res.valid).toBe(false);
    expect(res.message).toMatch(/not on this order/i);
  });

  it('refuses a fractional or zero quantity', () => {
    expect(validateProposedCancellation(order(), { lines: [{ itemId: A, quantity: 0 }] }).valid).toBe(false);
    expect(validateProposedCancellation(order(), { lines: [{ itemId: A, quantity: 1.5 }] }).valid).toBe(false);
    expect(validateProposedCancellation(order(), { lines: [{ itemId: A, quantity: -1 }] }).valid).toBe(false);
  });
});

describe('cancellationSummary', () => {
  it('describes a partial cancellation in units', () => {
    const o = order({ cancellations: [cancellation([{ itemId: A, quantity: 2 }])] });
    expect(cancellationSummary(o)).toMatchObject({
      orderedUnits: 4, cancelledUnits: 2, liveUnits: 2,
      partial: true, fullyCancelled: false,
      label: '2 of 4 items cancelled',
    });
  });

  it('says simply "Cancelled" once nothing is left', () => {
    const o = order({
      cancellations: [cancellation([{ itemId: A, quantity: 3 }, { itemId: B, quantity: 1 }])],
    });
    expect(cancellationSummary(o)).toMatchObject({ fullyCancelled: true, label: 'Cancelled' });
  });

  // An untouched order must produce no label, so nothing renders on the vast majority
  // of orders and every historical one.
  it('produces no label for an intact order', () => {
    expect(cancellationSummary(order()).label).toBeNull();
  });
});
