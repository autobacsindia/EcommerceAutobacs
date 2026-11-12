/**
 * Roav Points — every rule in the pure maths (no database).
 * services/incentives/pointsMath.js, paymentProof.js, months.js, ruleService.validateRules.
 */
import {
  bracketPoints, discountKeep, computeOrderPoints, slabFor, nextSlab, monthFactors, monthResult, allocate,
} from '../services/incentives/pointsMath.js';
import { verifyPaid } from '../services/incentives/paymentProof.js';
import { monthOf, monthStart, addMonths } from '../services/incentives/months.js';
import { validateRules } from '../services/incentives/ruleService.js';
import { INCENTIVE_DEFAULT_RULES as R } from '../config/incentiveDefaults.js';

const order = (over = {}) => ({
  lines: [{ id: 'l1', productId: 'p1', quantity: 1, price: 118000, listPrice: null }],
  orderDiscount: 0, orderTax: 18000, isB2B: false, specialSourcing: false, ...over,
});
const core = (res) => res.components.filter((c) => c.component === 'core').reduce((a, c) => a + c.centi, 0);
const month = (over) => monthResult({ centi: 0, flatCenti: 0, orders: 10, returnedOrders: 0, ratingCount: 0, ratingAvg: null, ...over }, R);

describe('base points and invoice multipliers', () => {
  test('1,960 points per ₹1,00,000 ex-GST', () => {
    expect(bracketPoints(100000, R).points).toBeCloseTo(1960, 6);
  });
  test('₹1.7L is all at 1.0×', () => {
    expect(bracketPoints(170000, R).points).toBeCloseTo(3332, 6);
  });
  test('₹5L by formula = 10,544.8 (the PDF shows 10,549)', () => {
    // 1.7L×1.0 + 2.8L×1.1 + 0.5L×1.2 = 5,38,000 × 0.0196
    expect(bracketPoints(500000, R).points).toBeCloseTo(10544.8, 6);
  });
  test('each portion gets its own multiplier up to ₹14L, then 1.0× above', () => {
    const at14 = 170000 + 280000 * 1.1 + 420000 * 1.2 + 530000 * 1.3;
    expect(bracketPoints(1400000, R).points).toBeCloseTo(at14 * 0.0196, 6);
    expect(bracketPoints(1500000, R).points).toBeCloseTo((at14 + 100000) * 0.0196, 6);
  });
  test('zero / negative value earns nothing', () => {
    expect(bracketPoints(0, R).points).toBe(0);
    expect(bracketPoints(-5, R).points).toBe(0);
  });
  test('order value is goods after discount, minus the GST on it', () => {
    const r = computeOrderPoints(order(), R);
    expect(r.snapshot.valueExGst).toBe(100000);
    expect(core(r)).toBe(196000); // 1,960.00 points in centi
  });
  test('falls back to the GST rate when the order has no tax figure', () => {
    const r = computeOrderPoints(order({ orderTax: null }), R);
    expect(r.snapshot.valueExGst).toBeCloseTo(100000, 2);
  });
});

describe('discount keep', () => {
  test.each([
    [0, 1], [0.005, 1], [0.5, 0.85], [5, 0.85], [5.0001, 0.6], [10, 0.6], [10.01, 0.4], [40, 0.4],
  ])('%s%% discount keeps %s', (pct, keep) => {
    expect(discountKeep(pct, R)).toBe(keep);
  });
  test('seller markdown against list price is measured on the order', () => {
    // list ₹1,18,000, sold at ₹1,06,200 → 10% off → keeps 60%
    const r = computeOrderPoints(order({ lines: [{ id: 'l1', quantity: 1, price: 106200, listPrice: 118000 }], orderTax: 16200 }), R);
    expect(r.snapshot.discountPercent).toBeCloseTo(10, 4);
    expect(r.snapshot.discountKeep).toBe(0.6);
  });
  test('an order-level discount counts too', () => {
    const r = computeOrderPoints(order({ orderDiscount: 5900, orderTax: 17100 }), R); // 5%
    expect(r.snapshot.discountKeep).toBe(0.85);
  });
  test('B2B is measured against the dealer price', () => {
    const rules = { ...R, b2bDealerDiscountPercent: 10 };
    // website ₹1,18,000, dealer ₹1,06,200, sold at dealer price → no discount
    const r = computeOrderPoints(order({ isB2B: true, lines: [{ id: 'l1', quantity: 1, price: 106200, listPrice: 118000 }], orderTax: 16200 }), rules);
    expect(r.snapshot.discountPercent).toBeCloseTo(0, 6);
    expect(r.snapshot.discountKeep).toBe(1);
  });
});

describe('special sourcing, bonuses, per-order points', () => {
  test('special sourcing keeps 75% of order points', () => {
    expect(core(computeOrderPoints(order({ specialSourcing: true }), R))).toBe(147000);
  });
  test('+200 needs an order value of at least ₹1,000 before GST', () => {
    const bonus = (value) => computeOrderPoints(order({ lines: [{ id: 'l1', quantity: 1, price: value * 1.18 }], orderTax: value * 0.18 }), R)
      .components.find((c) => c.component === 'order');
    expect(bonus(10)).toBeUndefined();       // the ₹10 test orders found by the backtest
    expect(bonus(999.99)).toBeUndefined();
    expect(bonus(1000).centi).toBe(20000);   // exactly the minimum counts
    expect(bonus(1000.01).centi).toBe(20000);
  });
  test('a rule version saved before the minimum existed pays +200 on any order', () => {
    const { perOrderBonusMinValue: _drop, ...old } = R;
    const r = computeOrderPoints(order({ lines: [{ id: 'l1', quantity: 1, price: 11.8 }], orderTax: 1.8 }), old);
    expect(r.components.find((c) => c.component === 'order').centi).toBe(20000);
  });
  test('+200 per paid order, not scaled by discount', () => {
    const r = computeOrderPoints(order({ orderDiscount: 50000, orderTax: 10000 }), R);
    expect(r.components.find((c) => c.component === 'order').centi).toBe(20000);
  });
  const rules = { ...R, priorityProducts: [
    { key: 'profender-bundle', label: 'Profender', productIds: ['p1'], b2c: 5400, b2b: 3200 },
    { key: 'f150-kit', label: 'F-150', productIds: ['p2'], b2c: 5000, b2b: 3000 },
  ] };
  test('priority bonus per unit, by buyer type', () => {
    const lines = [{ id: 'l1', productId: 'p1', quantity: 2, price: 59000 }, { id: 'l2', productId: 'p2', quantity: 1, price: 59000 }];
    const b2c = computeOrderPoints(order({ lines }), rules).components.filter((c) => c.component.startsWith('bonus:'));
    expect(b2c.map((c) => c.centi)).toEqual([1080000, 500000]);
    const b2b = computeOrderPoints(order({ lines, isB2B: true }), rules).components.filter((c) => c.component.startsWith('bonus:'));
    expect(b2b.map((c) => c.centi)).toEqual([640000, 300000]);
  });
  test('line points sum exactly to the order points', () => {
    const lines = [1, 2, 3].map((i) => ({ id: `l${i}`, quantity: i, price: 333.33 * i }));
    const r = computeOrderPoints(order({ lines, orderTax: null, orderDiscount: 17 }), R);
    const expected = Math.round(bracketPoints(r.snapshot.valueExGst, R).points * r.snapshot.discountKeep * 100);
    expect(core(r)).toBe(expected);
  });
  test('allocate never loses or invents a centi-point', () => {
    for (const total of [0, 1, 7, 100, 99999]) {
      expect(allocate(total, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(total);
      expect(allocate(total, [0, 0]).reduce((a, b) => a + b, 0)).toBe(total);
    }
    expect(allocate(1, [1, 1])).toEqual([1, 0]);
  });
});

describe('slabs', () => {
  test.each([
    [11499, null], [11500, 'Crank'], [18699, 'Crank'], [18700, 'Ignition'], [27900, 'Torque'],
    [38599, 'Torque'], [38600, 'Turbo'], [67299, 'Turbo'], [67300, 'Nitro'], [96799, 'Nitro'], [96800, 'Apex'], [5000000, 'Apex'],
  ])('%s points → %s', (points, name) => {
    expect(slabFor(points, R.slabs)?.name ?? null).toBe(name);
  });
  test('the slab rate applies to ALL points; below Crank pays ₹0', () => {
    expect(month({ centi: 1149900 }).payoutPaise).toBe(0);
    expect(month({ centi: 1150000 }).payoutPaise).toBe(11500 * 28);
    expect(month({ centi: 6729900 }).payoutPaise).toBe(67299 * 55);
    expect(month({ centi: 6730000 }).payoutPaise).toBe(67300 * 70);
  });
  test('no ceiling', () => {
    expect(month({ centi: 100000000 }).payoutPaise).toBe(1000000 * 85);
    expect(month({ centi: 100000000 }).next).toBeNull();
  });
  test('points to the next slab', () => {
    expect(nextSlab(60000, R.slabs)).toEqual({ name: 'Nitro', minPoints: 67300, pointsToGo: 7300 });
  });
  test('final points round half up, once', () => {
    expect(month({ centi: 1149950 }).finalPoints).toBe(11500);
    expect(month({ centi: 1149949 }).finalPoints).toBe(11499);
  });
  test('negative month (reversals after lock) pays nothing', () => {
    expect(month({ centi: -50000 }).finalPoints).toBe(0);
  });
});

describe('returns and feedback factors', () => {
  test('returns over 10% of orders → ×0.95; exactly 10% → no penalty', () => {
    expect(monthFactors({ orders: 10, returnedOrders: 1, ratingCount: 0 }, R).returnFactor).toBe(1);
    expect(monthFactors({ orders: 9, returnedOrders: 1, ratingCount: 0 }, R).returnFactor).toBe(0.95);
  });
  test('needs at least 3 ratings', () => {
    expect(monthFactors({ orders: 1, returnedOrders: 0, ratingCount: 2, ratingAvg: 5 }, R).ratingFactor).toBe(1);
    expect(monthFactors({ orders: 1, returnedOrders: 0, ratingCount: 3, ratingAvg: 5 }, R).ratingFactor).toBe(1.05);
  });
  test.each([[4.5, 1.05], [4.49, 1], [3.5, 1], [3.49, 0.9], [1, 0.9]])('average %s★ → ×%s', (avg, f) => {
    expect(monthFactors({ orders: 1, returnedOrders: 0, ratingCount: 5, ratingAvg: avg }, R).ratingFactor).toBe(f);
  });
  test('both factors multiply the month total before the slab', () => {
    const r = month({ centi: 7000000, orders: 9, returnedOrders: 1, ratingCount: 3, ratingAvg: 4.6 });
    expect(r.finalPoints).toBe(Math.round(70000 * 0.95 * 1.05)); // 69,825 → Nitro
    expect(r.slab).toBe('Nitro');
  });
  test('optional multiplier cap: above the cap slab, paid on flat points', () => {
    const rules = { ...R, multiplierSlabCap: 'Turbo' };
    const r = monthResult({ centi: 7000000, flatCenti: 6000000, orders: 1, returnedOrders: 0, ratingCount: 0, ratingAvg: null }, rules);
    expect(r.multipliersDropped).toBe(true);
    expect(r.finalPoints).toBe(60000);
    expect(r.slab).toBe('Turbo');
  });
});

describe('verified payment', () => {
  const base = { totalAmount: 1000, paymentStatus: 'paid', paidAt: new Date('2026-10-05T10:00:00Z') };
  const rp = (over = {}) => ({ paymentGateway: 'razorpay', gatewayPaymentId: 'pay_1', status: 'completed', amount: 1000, ...over });
  test('a Razorpay capture covering the total counts', () => {
    expect(verifyPaid(base, [rp()], []).verified).toBe(true);
  });
  test('status "paid" alone (admin forced it) does NOT count', () => {
    expect(verifyPaid(base, [], []).verified).toBe(false);
  });
  test('a payment without a gateway id does not count', () => {
    expect(verifyPaid(base, [rp({ gatewayPaymentId: null })], []).verified).toBe(false);
  });
  test('part payments must add up to the total', () => {
    expect(verifyPaid(base, [rp({ amount: 600 })], []).verified).toBe(false);
    expect(verifyPaid(base, [rp({ amount: 600 }), rp({ gatewayPaymentId: 'pay_2', amount: 400 })], []).verified).toBe(true);
  });
  test('a CONFIRMED bank transfer counts; pending or for an extra does not', () => {
    expect(verifyPaid(base, [], [{ status: 'confirmed', amount: 1000 }]).verified).toBe(true);
    expect(verifyPaid(base, [], [{ status: 'pending', amount: 1000 }]).verified).toBe(false);
    expect(verifyPaid(base, [], [{ status: 'confirmed', amount: 1000, extraCharge: 'x' }]).verified).toBe(false);
  });
  test('a Razorpay offer: the amount actually captured is what is due', () => {
    expect(verifyPaid({ ...base, gatewayOffer: { amountPaid: 900 } }, [rp({ amount: 900 })], []).verified).toBe(true);
  });
  test('an unpaid order never counts', () => {
    expect(verifyPaid({ ...base, paymentStatus: 'pending' }, [rp()], []).verified).toBe(false);
  });
});

describe('IST months', () => {
  test('23:59 IST on the 31st is still that month; 00:00 IST on the 1st is the next', () => {
    expect(monthOf(new Date('2026-10-31T18:29:59.999Z'))).toBe('2026-10');
    expect(monthOf(new Date('2026-10-31T18:30:00.000Z'))).toBe('2026-11');
    expect(monthStart('2026-11').toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
});

describe('rule validation', () => {
  test('the defaults are valid and survive a round trip unchanged', () => {
    expect(validateRules(structuredClone(R))).toEqual(structuredClone(R));
  });
  test.each([
    ['slabs out of order', (r) => { r.slabs[1].minPoints = 100; }],
    ['negative rate', (r) => { r.slabs[0].ratePerPoint = -1; }],
    ['first discount row not 0%', (r) => { r.discountKeep[0].maxPercent = 2; }],
    ['keep above 100%', (r) => { r.specialSourcingKeep = 1.5; }],
    ['bad product id', (r) => { r.priorityProducts[0].productIds = ['nope']; }],
    ['unknown cap slab', (r) => { r.multiplierSlabCap = 'Warp'; }],
    ['bracket limits not increasing', (r) => { r.brackets[1].upTo = 100; }],
  ])('rejects %s', (_, mutate) => {
    const r = structuredClone(R);
    mutate(r);
    expect(() => validateRules(r)).toThrow();
  });
});
