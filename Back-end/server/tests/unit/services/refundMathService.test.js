/**
 * refundMathService — the money rules behind every refund amount.
 *
 * Pure functions, no mocks. These encode the 2026-08-03 production bug: refunds were
 * computed from Σ(line.price × qty), which is the LIST value, while coupon/karma
 * discounts live at order level. Razorpay rejected one ("refund amount provided is
 * greater than amount captured"); the smaller cases would have been silently overpaid.
 */

import { refundableForLines, remainingRefundable, orderGoodsNetPaise } from '../../../services/refundMathService.js';

const order = (overrides = {}) => ({
  _id: 'order-1',
  subtotal: 1000,
  discount: 0,
  shippingCost: 100,
  totalAmount: 1100,
  items: [{ product: 'p1', quantity: 2, price: 500, variantId: null }],
  ...overrides,
});

const line = (overrides = {}) => ({ product: 'p1', quantity: 2, unitPrice: 500, ...overrides });

describe('refundableForLines', () => {
  it('returns the gross value unchanged when the order carried no discount', () => {
    const r = refundableForLines(order(), [line()]);
    expect(r).toEqual({ grossRupees: 1000, netRupees: 1000, discountShareRupees: 0 });
  });

  it('subtracts the order-level discount from a single-line order', () => {
    const r = refundableForLines(order({ subtotal: 1000, discount: 400, totalAmount: 700 }), [line()]);
    expect(r.grossRupees).toBe(1000);
    expect(r.netRupees).toBe(600);
    expect(r.discountShareRupees).toBe(400);
  });

  it('prorates the discount by line value when only one line is returned', () => {
    // ₹4000 goods, ₹400 discount. The returned line is ₹1000 = 25% → owes ₹100 of it.
    const o = order({
      subtotal: 4000, discount: 400, shippingCost: 0, totalAmount: 3600,
      items: [
        { product: 'p1', quantity: 2, price: 500 },
        { product: 'p2', quantity: 1, price: 3000 },
      ],
    });
    expect(refundableForLines(o, [line()])).toEqual({
      grossRupees: 1000, netRupees: 900, discountShareRupees: 100,
    });
  });

  it('prorates within a line for a partial-quantity return', () => {
    // 1 of the 2 units, on a 40%-discounted order → ₹500 gross, ₹300 net.
    const r = refundableForLines(
      order({ subtotal: 1000, discount: 400, totalAmount: 700 }),
      [line({ quantity: 1 })]
    );
    expect(r).toEqual({ grossRupees: 500, netRupees: 300, discountShareRupees: 200 });
  });

  it('never lets the sum of prorated lines exceed the goods pot (rounds down)', () => {
    // ₹1000 split 3 ways against a ₹1 discount forces a repeating fraction.
    const o = order({
      subtotal: 1000, discount: 1, shippingCost: 0, totalAmount: 999,
      items: [
        { product: 'p1', quantity: 1, price: 333.33 },
        { product: 'p2', quantity: 1, price: 333.33 },
        { product: 'p3', quantity: 1, price: 333.34 },
      ],
    });
    const all = refundableForLines(o, [
      { product: 'p1', quantity: 1, unitPrice: 333.33 },
      { product: 'p2', quantity: 1, unitPrice: 333.33 },
      { product: 'p3', quantity: 1, unitPrice: 333.34 },
    ]);
    // May round a paise short — must never round over, which the gateway would reject.
    expect(all.netRupees).toBeLessThanOrEqual(999);
    expect(all.netRupees).toBeGreaterThan(998.9);
  });

  it('prefers the order line price over a stale snapshot on the return', () => {
    // The return snapshot claims ₹9999/unit; the order is the record of what was charged.
    const r = refundableForLines(order(), [line({ unitPrice: 9999 })]);
    expect(r.netRupees).toBe(1000);
  });

  it('matches the right line when one product appears twice under different variants', () => {
    const o = order({
      subtotal: 1500, discount: 0, shippingCost: 0, totalAmount: 1500,
      items: [
        { product: 'p1', quantity: 1, price: 500, variantId: 'v1' },
        { product: 'p1', quantity: 1, price: 1000, variantId: 'v2' },
      ],
    });
    const r = refundableForLines(o, [{ product: 'p1', variantId: 'v2', quantity: 1, unitPrice: 1000 }]);
    expect(r.netRupees).toBe(1000);
  });

  it('caps a nonsensical order-level discount rather than producing a negative refund', () => {
    // `discount` is operator-editable on offline orders; a bad value must not invert.
    const r = refundableForLines(order({ subtotal: 1000, discount: 5000 }), [line()]);
    expect(r.netRupees).toBe(0);
  });

  it('never returns more than the lines are worth when `discount` is NEGATIVE', () => {
    // No schema `min: 0` on Order.discount. A negative value would otherwise inflate the
    // goods pot above what was charged — and `discountShare` floors at 0, so the
    // inflated refund would read as a perfectly ordinary full-price one.
    const r = refundableForLines(order({ subtotal: 1000, discount: -500, totalAmount: 1600 }), [line()]);
    expect(r.netRupees).toBe(1000);
    expect(r.netRupees).toBeLessThanOrEqual(r.grossRupees);
    expect(r.discountShareRupees).toBe(0);
  });

  it('falls back to the gross line sum when a legacy order has no subtotal', () => {
    const r = refundableForLines(order({ subtotal: undefined, discount: 0 }), [line()]);
    expect(r.netRupees).toBe(1000);
  });
});

describe('orderGoodsNetPaise', () => {
  it('excludes shipping — the delivery charge is never refunded', () => {
    expect(orderGoodsNetPaise(order({ subtotal: 1000, discount: 0, shippingCost: 100 }))).toBe(100000);
  });
});

describe('remainingRefundable', () => {
  it('reports the whole capture when nothing has been refunded', () => {
    expect(remainingRefundable(order({ totalAmount: 1500 }), [])).toEqual({
      capturedRupees: 1500, alreadyRefundedRupees: 0, remainingRupees: 1500,
    });
  });

  it('subtracts sibling returns that are completed or in flight', () => {
    const r = remainingRefundable(order({ totalAmount: 1500 }), [
      { _id: 'a', refund: { status: 'completed', finalAmount: 500 } },
      { _id: 'b', refund: { status: 'processing', finalAmount: 300 } },
    ]);
    expect(r.remainingRupees).toBe(700);
  });

  it('ignores returns whose refund never committed money', () => {
    const r = remainingRefundable(order({ totalAmount: 1500 }), [
      { _id: 'a', refund: { status: 'pending', finalAmount: 500 } },
      { _id: 'b', refund: { status: 'failed', finalAmount: 300 } },
    ]);
    expect(r.remainingRupees).toBe(1500);
  });

  it('excludes the return currently being refunded so it does not block itself', () => {
    const r = remainingRefundable(
      order({ totalAmount: 1500 }),
      [{ _id: 'self', refund: { status: 'processing', finalAmount: 1000 } }],
      'self'
    );
    expect(r.remainingRupees).toBe(1500);
  });

  it('counts a cancellation refund recorded on the order', () => {
    const o = order({ totalAmount: 1500, refundDetails: { status: 'completed', amount: 600 } });
    expect(remainingRefundable(o, []).remainingRupees).toBe(900);
  });

  it('does NOT double-count a return refund mirrored onto order.refundDetails', () => {
    // returnController stamps `notes: "Return <id>"` on the order summary it mirrors;
    // counting both that and the ReturnRequest itself would halve the headroom.
    const o = order({
      totalAmount: 1500,
      refundDetails: { status: 'completed', amount: 600, notes: 'Return ret-9' },
    });
    const r = remainingRefundable(o, [{ _id: 'ret-9', refund: { status: 'completed', finalAmount: 600 } }]);
    expect(r.alreadyRefundedRupees).toBe(600);
    expect(r.remainingRupees).toBe(900);
  });

  it('never reports negative headroom on an over-refunded order', () => {
    const r = remainingRefundable(order({ totalAmount: 1000 }), [
      { _id: 'a', refund: { status: 'completed', finalAmount: 1500 } },
    ]);
    expect(r.remainingRupees).toBe(0);
  });

  describe('Payment.refundAmount is a floor, never a summand', () => {
    it('uses the payment row when it knows about MORE than our own records do', () => {
      // e.g. a refund recorded against the payment that left no ReturnRequest behind.
      const r = remainingRefundable(order({ totalAmount: 1500 }), [], null, { refundAmount: 900 });
      expect(r.alreadyRefundedRupees).toBe(900);
      expect(r.remainingRupees).toBe(600);
    });

    it('does NOT add it on top of a refund already counted from the ReturnRequest', () => {
      // Both describe the SAME ₹1000. Summing would report ₹2000 refunded and wrongly
      // block a legitimate second refund.
      const r = remainingRefundable(
        order({ totalAmount: 1500 }),
        [{ _id: 'a', refund: { status: 'completed', finalAmount: 1000 } }],
        null,
        { refundAmount: 1000 }
      );
      expect(r.alreadyRefundedRupees).toBe(1000);
      expect(r.remainingRupees).toBe(500);
    });

    it('prefers our records when the payment row under-reports (the legacy case)', () => {
      // refundAmount was historically overwritten, and partial return refunds never
      // wrote it at all — so a stale ₹0 must not widen the headroom.
      const r = remainingRefundable(
        order({ totalAmount: 1500 }),
        [{ _id: 'a', refund: { status: 'completed', finalAmount: 1200 } }],
        null,
        { refundAmount: 0 }
      );
      expect(r.remainingRupees).toBe(300);
    });

    it('tolerates a missing payment argument', () => {
      expect(remainingRefundable(order({ totalAmount: 1500 }), []).remainingRupees).toBe(1500);
    });
  });
});
