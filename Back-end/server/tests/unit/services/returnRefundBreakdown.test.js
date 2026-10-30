import mongoose from 'mongoose';
import ReturnRequest from '../../../models/ReturnRequest.js';
import {
  returnRefundBreakdown,
  serviceLineOptions,
  refundableForLines,
  RefundBreakdownError,
} from '../../../services/refundMathService.js';

/**
 * returnRefundBreakdown — owner-approved rule 1 (2026-10-30): whoever caused the problem
 * pays. Everything is integer paise, floored line by line, recomputed from the order.
 *
 *   our fault        goods net + shipping share + picked installation line(s)
 *   customer reason  goods net − real pickup cost − optional restocking
 */

// Dash cam ₹9,000 + floor mats 2 × ₹1,000 + installation ₹1,000 (CUSTOM line) + ₹300 shipping.
function order(overrides = {}) {
  return {
    subtotal: 12000,
    discount: 0,
    shippingCost: 300,
    totalAmount: 12300,
    items: [
      { _id: 'cam', product: 'p-cam', quantity: 1, price: 9000 },
      { _id: 'mat', product: 'p-mat', quantity: 2, price: 1000 },
      { _id: 'fit', product: null, custom: true, name: 'Installation', quantity: 1, price: 1000 },
    ],
    ...overrides,
  };
}
const line = (orderItemId, product, quantity, reason, fault) => ({
  orderItemId, product, quantity, reason, ...(fault ? { fault } : {}),
});
const ret = (...items) => ({ items });

describe('returnRefundBreakdown — our fault', () => {
  it('refunds the item, its shipping share and the picked installation', () => {
    const b = returnRefundBreakdown(order(), ret(line('cam', 'p-cam', 1, 'wrong_item')), {
      serviceLines: [{ orderItemId: 'fit' }],
    });
    // Shipping share over CATALOGUE goods only (₹11,000): 300 × 9000/11000 = ₹245.45 (floored).
    expect(b.goodsNetPaise).toBe(900000);
    expect(b.shippingSharePaise).toBe(24545);
    expect(b.servicePaise).toBe(100000);
    expect(b.totalPaise).toBe(900000 + 24545 + 100000);
    expect(b.hasOurFault).toBe(true);
    expect(b.hasCustomerFault).toBe(false);
  });

  it('returning every catalogue unit refunds the whole shipping charge, never more', () => {
    const b = returnRefundBreakdown(order(), ret(
      line('cam', 'p-cam', 1, 'transit_damage'),
      line('mat', 'p-mat', 2, 'missing_part'),
    ), { serviceLines: [{ orderItemId: 'fit' }] });
    expect(b.shippingSharePaise).toBeLessThanOrEqual(30000);
    expect(b.shippingSharePaise).toBeGreaterThanOrEqual(29999); // floor per line
    expect(b.totalPaise).toBeLessThanOrEqual(1230000);
  });

  it('a partial quantity takes a per-unit share of shipping', () => {
    const one = returnRefundBreakdown(order(), ret(line('mat', 'p-mat', 1, 'manufacturing_defect')));
    // ₹1,000 of ₹11,000 catalogue goods → 300 × 1000/11000 = ₹27.27.
    expect(one.goodsNetPaise).toBe(100000);
    expect(one.shippingSharePaise).toBe(2727);
  });

  it('applies the coupon to goods and installation alike', () => {
    // 10% off the whole ₹12,000 → ₹10,800 goods net.
    const b = returnRefundBreakdown(order({ discount: 1200, couponDiscount: 1200, totalAmount: 11100 }),
      ret(line('cam', 'p-cam', 1, 'wrong_fitment_info')),
      { serviceLines: [{ orderItemId: 'fit' }] });
    expect(b.goodsGrossPaise).toBe(900000);
    expect(b.goodsNetPaise).toBe(810000);
    expect(b.serviceLines[0]).toMatchObject({ netPaidPaise: 90000, amountPaise: 90000 });
    // Shipping is never discounted by a goods coupon.
    expect(b.shippingSharePaise).toBe(24545);
  });

  it('uses the per-line campaign attribution when the order carries one', () => {
    const o = order({
      discount: 500,
      items: [
        { _id: 'cam', product: 'p-cam', quantity: 1, price: 9000, discountPaise: 45000 }, // ₹450 off
        { _id: 'mat', product: 'p-mat', quantity: 2, price: 1000, discountPaise: 5000 },  // ₹50 off
        { _id: 'fit', product: null, custom: true, name: 'Installation', quantity: 1, price: 1000 },
      ],
    });
    const b = returnRefundBreakdown(o, ret(line('mat', 'p-mat', 1, 'wrong_item')));
    // Half the mat line's own ₹50 → ₹25 off one ₹1,000 mat.
    expect(b.goodsNetPaise).toBe(97500);
  });

  it('refuses any deduction — we pay for the pickup', () => {
    expect(() => returnRefundBreakdown(order(), ret(line('cam', 'p-cam', 1, 'wrong_item')), {
      pickupDeductionPaise: 30000, pickupDeductionReason: 'Courier',
    })).toThrow(/customer’s own reason/);
    expect(() => returnRefundBreakdown(order(), ret(line('cam', 'p-cam', 1, 'wrong_item')), {
      restockingPaise: 1000,
    })).toThrow(RefundBreakdownError);
  });

  it('treats installer damage as our fault', () => {
    const b = returnRefundBreakdown(order(), ret(line('cam', 'p-cam', 1, 'installer_damage')), {
      serviceLines: [{ orderItemId: 'fit' }],
    });
    expect(b.servicePaise).toBe(100000);
  });
});

describe("returnRefundBreakdown — customer's reason", () => {
  it('refunds goods net only, minus the pickup cost', () => {
    const b = returnRefundBreakdown(order(), ret(line('cam', 'p-cam', 1, 'ordered_wrong')), {
      pickupDeductionPaise: 30000, pickupDeductionReason: 'Delhivery AWB 123',
    });
    expect(b.shippingSharePaise).toBe(0);
    expect(b.servicePaise).toBe(0);
    expect(b.totalPaise).toBe(900000 - 30000);
  });

  it('refuses installation', () => {
    expect(() => returnRefundBreakdown(order(), ret(line('cam', 'p-cam', 1, 'changed_mind')), {
      serviceLines: [{ orderItemId: 'fit' }],
    })).toThrow(/only when the fault is ours/);
  });

  it('requires a reason for the pickup cost', () => {
    expect(() => returnRefundBreakdown(order(), ret(line('cam', 'p-cam', 1, 'changed_mind')), {
      pickupDeductionPaise: 30000,
    })).toThrow(/what the pickup cost is for/);
  });

  it('applies optional restocking', () => {
    const b = returnRefundBreakdown(order(), ret(line('cam', 'p-cam', 1, 'changed_mind')), { restockingPaise: 90000 });
    expect(b.totalPaise).toBe(810000);
  });

  it('caps deductions at the customer-reason lines, never touching our-fault money', () => {
    const mixed = ret(line('cam', 'p-cam', 1, 'wrong_item'), line('mat', 'p-mat', 1, 'changed_mind'));
    // The mat (customer reason) is worth ₹1,000: a ₹1,001 deduction would eat the dash cam's refund.
    expect(() => returnRefundBreakdown(order(), mixed, {
      pickupDeductionPaise: 100100, pickupDeductionReason: 'Courier',
    })).toThrow(/at most ₹1000/);
    const b = returnRefundBreakdown(order(), mixed, { pickupDeductionPaise: 100000, pickupDeductionReason: 'Courier' });
    // Dash cam ₹9,000 + its shipping share; the mat nets to zero.
    expect(b.totalPaise).toBe(900000 + 24545);
  });
});

describe('returnRefundBreakdown — fault resolution', () => {
  it("operations' confirmed fault wins over the reason's claim", () => {
    const b = returnRefundBreakdown(order(), ret(
      line('cam', 'p-cam', 1, 'changed_mind', { claimed: 'customer', confirmed: 'ours' }),
    ));
    expect(b.lines[0].fault).toBe('ours');
    expect(b.shippingSharePaise).toBe(24545);
  });

  it('a confirmed customer fault removes the shipping share a defect claim asked for', () => {
    const b = returnRefundBreakdown(order(), ret(
      line('cam', 'p-cam', 1, 'manufacturing_defect', { claimed: 'ours', confirmed: 'customer' }),
    ));
    expect(b.shippingSharePaise).toBe(0);
  });

  it('a legacy row (no fault, no orderItemId) resolves through its reason and its product', () => {
    const b = returnRefundBreakdown(order(), { items: [{ product: 'p-mat', quantity: 2, reason: 'wrong_item', unitPrice: 1000 }] });
    expect(b.lines[0]).toMatchObject({ fault: 'ours', orderItemId: 'mat' });
    expect(b.goodsNetPaise).toBe(200000);
  });

  it('a row with no reason at all is treated as our fault (the July default)', () => {
    const b = returnRefundBreakdown(order(), { items: [{ product: 'p-mat', quantity: 1 }] });
    expect(b.lines[0].fault).toBe('ours');
  });
});

describe('returnRefundBreakdown — installation lines', () => {
  const ours = ret(line('cam', 'p-cam', 1, 'wrong_item'));

  it('may be lowered with a reason, never raised', () => {
    const lowered = returnRefundBreakdown(order(), ours, {
      serviceLines: [{ orderItemId: 'fit', amountPaise: 40000, reductionReason: 'Partial refit only' }],
    });
    expect(lowered.serviceLines[0]).toMatchObject({ amountPaise: 40000, netPaidPaise: 100000, reductionReason: 'Partial refit only' });
    expect(() => returnRefundBreakdown(order(), ours, {
      serviceLines: [{ orderItemId: 'fit', amountPaise: 40000 }],
    })).toThrow(/Say why/);
    expect(() => returnRefundBreakdown(order(), ours, {
      serviceLines: [{ orderItemId: 'fit', amountPaise: 100001 }],
    })).toThrow(/up to ₹1000/);
  });

  it('only a CUSTOM line can be picked as installation', () => {
    expect(() => returnRefundBreakdown(order(), ours, { serviceLines: [{ orderItemId: 'mat' }] }))
      .toThrow(/installation line/);
    expect(() => returnRefundBreakdown(order(), ours, { serviceLines: [{ orderItemId: 'nope' }] }))
      .toThrow(/installation line/);
  });

  it('refuses the same line twice in one return', () => {
    expect(() => returnRefundBreakdown(order(), ours, {
      serviceLines: [{ orderItemId: 'fit' }, { orderItemId: 'fit' }],
    })).toThrow(/listed twice/);
  });

  it('refuses a line another return already refunded (409)', () => {
    let err;
    try {
      returnRefundBreakdown(order(), ours, { serviceLines: [{ orderItemId: 'fit' }], serviceItemIdsTaken: ['fit'] });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(RefundBreakdownError);
    expect(err.status).toBe(409);
  });

  it('refunds only the units a cancellation has not already refunded', () => {
    const o = order({
      items: [
        { _id: 'cam', product: 'p-cam', quantity: 1, price: 9000 },
        { _id: 'fit', product: null, custom: true, name: 'Installation', quantity: 2, price: 500 },
      ],
      subtotal: 10000,
      cancellations: [{ lines: [{ itemId: 'fit', quantity: 1 }] }],
    });
    const b = returnRefundBreakdown(o, ours, { serviceLines: [{ orderItemId: 'fit' }] });
    expect(b.serviceLines[0].netPaidPaise).toBe(50000);

    const all = order({ cancellations: [{ lines: [{ itemId: 'fit', quantity: 1 }] }] });
    expect(() => returnRefundBreakdown(all, ours, { serviceLines: [{ orderItemId: 'fit' }] }))
      .toThrow(/cancelled and refunded already/);
  });

  it('serviceLineOptions lists custom lines at their net paid, without cancelled ones', () => {
    const opts = serviceLineOptions(order({ discount: 1200 }));
    expect(opts).toEqual([{ orderItemId: 'fit', name: 'Installation', quantity: 1, netPaidPaise: 90000 }]);
    expect(serviceLineOptions(order({ cancellations: [{ lines: [{ itemId: 'fit', quantity: 1 }] }] }))).toEqual([]);
  });
});

describe('returnRefundBreakdown — guards', () => {
  it('prices a return loaded from the DATABASE (Mongoose subdocuments), not just plain objects', () => {
    // Regression: spreading a subdocument copies none of its fields, so every line of a
    // real return priced at ₹0 and the refund was refused. Plain test fixtures hid it.
    const camLine = new mongoose.Types.ObjectId();
    const o = order({ items: [
      { _id: camLine, product: 'p-cam', quantity: 1, price: 9000 },
      { _id: 'mat', product: 'p-mat', quantity: 2, price: 1000 },
      { _id: 'fit', product: null, custom: true, name: 'Installation', quantity: 1, price: 1000 },
    ] });
    const hydrated = new ReturnRequest({
      order: new mongoose.Types.ObjectId(),
      user: new mongoose.Types.ObjectId(),
      problemDescription: 'x',
      items: [{ product: new mongoose.Types.ObjectId(), orderItemId: camLine, quantity: 1, reason: 'wrong_item', unitPrice: 9000 }],
    });
    const b = returnRefundBreakdown(o, hydrated, { serviceLines: [{ orderItemId: 'fit' }] });
    expect(b.goodsNetPaise).toBe(900000);
    expect(b.totalPaise).toBe(900000 + 24545 + 100000);
  });

  it('goods net agrees with refundableForLines (one maths, two callers)', () => {
    const o = order({ discount: 777, karmaDiscount: 77 });
    const items = [line('cam', 'p-cam', 1, 'wrong_item'), line('mat', 'p-mat', 1, 'changed_mind')];
    const b = returnRefundBreakdown(o, ret(...items));
    const r = refundableForLines(o, items.map((i) => ({ ...i, itemId: i.orderItemId })));
    expect(b.goodsNetPaise / 100).toBe(r.netRupees);
  });

  it('a negative order discount cannot inflate the goods above their gross', () => {
    const b = returnRefundBreakdown(order({ discount: -5000 }), ret(line('cam', 'p-cam', 1, 'wrong_item')));
    expect(b.goodsNetPaise).toBeLessThanOrEqual(b.goodsGrossPaise);
  });

  it('an order with no shipping charge adds no shipping share', () => {
    const b = returnRefundBreakdown(order({ shippingCost: 0, totalAmount: 12000 }), ret(line('cam', 'p-cam', 1, 'wrong_item')));
    expect(b.shippingSharePaise).toBe(0);
  });

  it('never returns a negative total', () => {
    const b = returnRefundBreakdown(order(), ret(line('mat', 'p-mat', 1, 'changed_mind')), {
      pickupDeductionPaise: 100000, pickupDeductionReason: 'Courier',
    });
    expect(b.totalPaise).toBe(0);
  });
});
