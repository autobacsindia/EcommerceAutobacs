/**
 * Delivery-fee maths (utils/deliveryFees.js) — pure, so every figure is pinned.
 * The owner's real courier bills and category ranges are the oracle here.
 */
import {
  computeDeliveryFees, resolveBox, unitChargedKg, DEFAULT_RATE_CARD, FEE_CODES, isValidPin, bandFor, haversineKm, normalizePackingFee,
} from '../../../utils/deliveryFees.js';
import { DEFAULT_CLASS_BOXES } from '../../../utils/shippingClass.js';

const card = (over = {}) => ({ ...DEFAULT_RATE_CARD, chargeAtCheckout: true, ...over });
const box = (weightKg, lengthCm, breadthCm, heightCm) => ({ weightKg, lengthCm, breadthCm, heightCm });
const line = (product, quantity = 1) => ({ product, quantity });
const amount = (r, code) => r.lines.find((l) => l.code === code)?.amountPaise ?? 0;
const rupees = (p) => p / 100;
const sumLines = (r) => r.lines.reduce((a, l) => a + l.amountPaise, 0);

describe('charged weight', () => {
  it('reproduces the Air Line Express Hyderabad bill: 208×70×85 → 276 kg → ₹4,416 freight', () => {
    const r = computeDeliveryFees({
      lines: [line({ shippingSize: box(60, 208, 70, 85), shippingClass: 'xl' })],
      goodsPaise: 0, card: card({ gstOnFees: { enabled: false, percent: 18 }, paymentFeePercent: 0 }),
    });
    expect(r.mode).toBe('freight');
    expect(r.chargedKg).toBe(276);
    expect(amount(r, 'shipping')).toBe(441600);
  });

  it('dead weight wins when heavier than volumetric', () => {
    expect(unitChargedKg(box(40, 50, 40, 30), 4500)).toBe(40);
  });

  it('freight has a ₹500 minimum', () => {
    const r = computeDeliveryFees({ lines: [line({ shippingSize: box(11, 30, 30, 30) })], goodsPaise: 0, card: card() });
    expect(r.chargedKg).toBe(11);
    expect(amount(r, 'shipping')).toBe(50000); // 11 × ₹16 = ₹176 → ₹500 minimum
  });

  it('freight carries docket ₹100 + other ₹50, fuel ₹30 and hamali ₹0.45/kg once per shipment', () => {
    const r = computeDeliveryFees({
      lines: [line({ shippingSize: box(20, 100, 50, 40) }, 2)], goodsPaise: 0, card: card(),
    });
    // 100×50×40/4500 = 44.44 kg per unit × 2 = 88.89 → 89 kg
    expect(r.chargedKg).toBe(89);
    expect(amount(r, 'docket')).toBe(15000);
    expect(amount(r, 'fuel')).toBe(3000);
    expect(amount(r, 'handling')).toBe(Math.round(89 * 0.45 * 100));
  });

  it('courier parcels bill per started 0.5 kg slab and carry no docket/fuel/hamali', () => {
    const r = computeDeliveryFees({ lines: [line({ shippingSize: box(1.2, 20, 15, 10) })], goodsPaise: 0, card: card() });
    expect(r.mode).toBe('courier');
    expect(r.chargedKg).toBe(1.5);
    expect(amount(r, 'shipping')).toBe(3 * 8000);
    expect(amount(r, 'docket') + amount(r, 'fuel') + amount(r, 'handling')).toBe(0);
  });

  it('exactly 10 kg is still a courier parcel (no float drift past the boundary)', () => {
    const r = computeDeliveryFees({ lines: [line({ shippingSize: box(0.1, 5, 5, 5) }, 100)], goodsPaise: 0, card: card() });
    expect(r.mode).toBe('courier');
    expect(r.chargedKg).toBe(10);
  });
});

describe('box resolution (missing size → category → safe fallback)', () => {
  it('measured box first, then online size + margin, then stored class, then category class, then Small', () => {
    expect(resolveBox({ shippingSize: box(2, 30, 20, 10) }).source).toBe('measured');
    expect(resolveBox({ listedSize: box(2, 30, 20, 10) }).source).toBe('listed');
    expect(resolveBox({ shippingClass: 'medium' })).toEqual({ box: DEFAULT_CLASS_BOXES.medium, source: 'class', cls: 'medium' });
    // XL has no admin standard box → the rate card's XL crate (owner's Hyderabad bill).
    expect(resolveBox({ shippingClass: 'xl' })).toEqual({ box: DEFAULT_RATE_CARD.xlBox, source: 'class', cls: 'xl' });
    expect(resolveBox({ categoryClass: 'xl' })).toEqual({ box: DEFAULT_RATE_CARD.xlBox, source: 'category', cls: 'xl' });
    expect(resolveBox({ categoryClass: 'large' })).toEqual({ box: DEFAULT_CLASS_BOXES.large, source: 'category', cls: 'large' });
    // A stored class beats the category guess; a real size beats both.
    expect(resolveBox({ shippingClass: 'small', categoryClass: 'xl' }).cls).toBe('small');
    expect(resolveBox({ shippingSize: box(2, 30, 20, 10), categoryClass: 'xl' }).source).toBe('measured');
    expect(resolveBox({})).toEqual({ box: DEFAULT_CLASS_BOXES.small, source: 'fallback', cls: null });
    expect(resolveBox(null).source).toBe('fallback');
  });

  it('the XL crate is admin-editable through the rate card', () => {
    const r = computeDeliveryFees({
      lines: [line({ categoryClass: 'xl' })], goodsPaise: 0,
      card: card({ xlBox: { weightKg: 300, lengthCm: 100, breadthCm: 50, heightCm: 50 }, gstOnFees: { enabled: false, percent: 18 }, paymentFeePercent: 0 }),
    });
    expect(r.chargedKg).toBe(300); // actual weight beats 250 kg volumetric
    expect(amount(r, 'packing')).toBe(150000); // XL crate packing
  });

  it('an incomplete measured size is ignored, not half-used', () => {
    expect(resolveBox({ shippingSize: { weightKg: 2, lengthCm: null, breadthCm: 10, heightCm: 10 } }).source).toBe('fallback');
  });

  it('a product with no size at all gets the cheapest (Small) fees and is flagged estimated', () => {
    const none = computeDeliveryFees({ lines: [line({})], goodsPaise: 50000, card: card() });
    const small = computeDeliveryFees({ lines: [line({ shippingSize: DEFAULT_CLASS_BOXES.small })], goodsPaise: 50000, card: card() });
    expect(none.estimated).toBe(true);
    expect(small.estimated).toBe(false);
    expect(none.totalPaise).toBe(small.totalPaise);
  });
});

describe('percentage fees, remote area and GST', () => {
  const base = { lines: [line({ shippingSize: box(1, 20, 15, 10), shippingClass: 'small' })], goodsPaise: 1000000 };

  it('no insurance line (removed 2026-11-20), even with an old card that still holds a rate', () => {
    expect(amount(computeDeliveryFees({ ...base, card: card({ insurancePercent: 0.1 }) }), 'insurance')).toBe(0);
  });

  it('GST on fees OFF: payment fee = Razorpay 2% + its 18% GST on (goods + other fees)', () => {
    const r = computeDeliveryFees({ ...base, card: card({ gstOnFees: { enabled: false, percent: 18 } }) });
    const others = sumLines(r) - amount(r, 'payment');
    expect(amount(r, 'payment')).toBe(Math.round((1000000 + others) * 2.36 / 100));
  });

  it('GST on fees ON: payment fee is the 2% alone — GST is charged once, by the GST line', () => {
    const r = computeDeliveryFees({ ...base, card: card() });
    const beforePayment = sumLines(r) - amount(r, 'payment') - amount(r, 'gst');
    expect(amount(r, 'payment')).toBe(Math.round((1000000 + beforePayment) * 2 / 100));
    expect(amount(r, 'gst')).toBe(Math.round((beforePayment + amount(r, 'payment')) * 18 / 100));
  });

  it('payment fee is capped at paymentFeeMax (default ₹999); 0 = no cap', () => {
    const big = { lines: base.lines, goodsPaise: 50500000 }; // ₹5,05,000
    expect(amount(computeDeliveryFees({ ...big, card: card() }), 'payment')).toBe(99900);
    expect(amount(computeDeliveryFees({ ...big, card: card({ paymentFeeMax: 500 }) }), 'payment')).toBe(50000);
    expect(amount(computeDeliveryFees({ ...big, card: card({ paymentFeeMax: 0 }) }), 'payment')).toBeGreaterThan(1000000);
    // Under the cap the percentage applies unchanged.
    expect(amount(computeDeliveryFees({ ...base, card: card() }), 'payment')).toBeLessThan(99900);
  });

  it('remote area fee only for a remote PIN; unknown PIN (cart page) adds nothing', () => {
    expect(amount(computeDeliveryFees({ ...base, isRemote: true, card: card() }), 'remote')).toBe(75000);
    expect(amount(computeDeliveryFees({ ...base, isRemote: false, card: card() }), 'remote')).toBe(0);
    expect(amount(computeDeliveryFees({ ...base, isRemote: null, card: card() }), 'remote')).toBe(0);
  });

  it('GST on fees toggles: on adds one 18% line on every other fee, off adds no GST line', () => {
    const on = computeDeliveryFees({ ...base, card: card() });
    const off = computeDeliveryFees({ ...base, card: card({ gstOnFees: { enabled: false, percent: 18 } }) });
    expect(amount(off, 'gst')).toBe(0);
    expect(off.lines.some((l) => l.code === 'gst')).toBe(false);
    expect(amount(on, 'gst')).toBe(Math.round((sumLines(on) - amount(on, 'gst')) * 18 / 100));
    // Every non-payment line is identical; only the payment fee drops Razorpay's GST.
    for (const code of ['shipping', 'packing']) expect(amount(on, code)).toBe(amount(off, code));
    expect(amount(on, 'payment')).toBeLessThan(amount(off, 'payment'));
  });

  it('total always equals the sum of the lines, lines follow the fixed order, zero lines are hidden', () => {
    const r = computeDeliveryFees({ ...base, isRemote: true, card: card() });
    expect(r.totalPaise).toBe(sumLines(r));
    const order = r.lines.map((l) => FEE_CODES.indexOf(l.code));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(r.lines.every((l) => l.amountPaise > 0 && Number.isInteger(l.amountPaise))).toBe(true);
  });

  it('rejects bad input instead of guessing', () => {
    expect(() => computeDeliveryFees({ lines: [], goodsPaise: 0, card: card() })).toThrow();
    expect(() => computeDeliveryFees({ ...base, goodsPaise: 10.5, card: card() })).toThrow();
  });
});

describe("owner's category ranges (typical packed boxes, default rate card)", () => {
  const total = (shippingSize, shippingClass, pricePaise) => rupees(computeDeliveryFees({
    lines: [line({ shippingSize, shippingClass })], goodsPaise: pricePaise, card: card({ gstOnFees: { enabled: false, percent: 18 } }),
  }).totalPaise);

  it.each([
    ['keychain', box(0.1, 10, 8, 4), 'small', 40000, 100, 300],
    ['BMC air filter', box(0.5, 30, 20, 8), 'small', 300000, 300, 1500],
    ['BMC air filter (big)', box(1.5, 45, 30, 15), 'small', 800000, 300, 1500],
    ['head/tail lights (wooden)', box(6, 70, 40, 35), 'large', 1200000, 1000, 3000],
    ['head/tail lights (big)', box(10, 90, 55, 45), 'large', 3000000, 1000, 3000],
    ['electric side steps', box(25, 200, 40, 35), 'large', 4500000, 2000, 5000],
    ['full body kit', box(35, 180, 80, 60), 'xl', 3500000, 5000, 10000],
    ['full body kit (Hyderabad crate)', box(50, 208, 70, 85), 'xl', 8000000, 5000, 10000],
  ])('%s falls in ₹%#', (_name, size, cls, price, lo, hi) => {
    const r = total(size, cls, price);
    expect(r).toBeGreaterThanOrEqual(lo);
    expect(r).toBeLessThanOrEqual(hi);
  });
});

describe('distance bands', () => {
  const bands = [
    { upToKm: 500, ratePerKg: 10 }, { upToKm: 1000, ratePerKg: 12 }, { upToKm: null, ratePerKg: 20 },
  ];
  const heavy = [line({ shippingSize: box(100, 50, 50, 50) })]; // 100 kg freight

  it('picks the first band whose limit covers the distance; limits are inclusive', () => {
    expect(bandFor(0, bands).ratePerKg).toBe(10);
    expect(bandFor(500, bands).ratePerKg).toBe(10);
    expect(bandFor(500.4, bands).ratePerKg).toBe(12);
    expect(bandFor(1000, bands).ratePerKg).toBe(12);
    expect(bandFor(3500, bands).ratePerKg).toBe(20);
  });

  it('unknown distance (PIN not located) → the highest band, never a cheaper guess', () => {
    expect(bandFor(null, bands).ratePerKg).toBe(20);
    expect(bandFor(NaN, bands).ratePerKg).toBe(20);
  });

  it('freight is charged at the band rate', () => {
    const near = computeDeliveryFees({ lines: heavy, goodsPaise: 0, distanceKm: 300, card: card({ distanceBands: bands }) });
    const far = computeDeliveryFees({ lines: heavy, goodsPaise: 0, distanceKm: null, card: card({ distanceBands: bands }) });
    expect(amount(near, 'shipping')).toBe(100 * 1000);
    expect(amount(far, 'shipping')).toBe(100 * 2000);
    expect(near.band).toEqual({ upToKm: 500, ratePerKg: 10, slabRate: 80 });
    expect(far.band).toEqual({ upToKm: null, ratePerKg: 20, slabRate: 80 });
  });

  describe('small parcels (courier) by distance', () => {
    const small = [line({ shippingSize: box(1.2, 20, 15, 10) })]; // 1.2 kg → 3 slabs of 0.5 kg
    const slabBands = [
      { upToKm: 500, ratePerKg: 16, slabRate: 60 },
      { upToKm: 1500, ratePerKg: 16, slabRate: null }, // blank → all-India rate
      { upToKm: null, ratePerKg: 16, slabRate: 100 },
    ];
    const at = (km) => computeDeliveryFees({ lines: small, goodsPaise: 0, distanceKm: km, card: card({ distanceBands: slabBands }) });

    it('uses the band\'s own slab rate: near is cheaper than far', () => {
      expect(at(25).mode).toBe('courier');
      expect(amount(at(25), 'shipping')).toBe(3 * 6000);   // Gurugram: 3 × ₹60
      expect(amount(at(2076), 'shipping')).toBe(3 * 10000); // Kochi: 3 × ₹100
      expect(at(25).band.slabRate).toBe(60);
    });
    it('a band left blank uses the all-India courier rate', () => {
      expect(amount(at(1241), 'shipping')).toBe(3 * 8000); // Hyderabad: 3 × ₹80
      expect(at(1241).band.slabRate).toBe(80);
    });
    it('unknown PIN → the highest band\'s slab rate', () => {
      expect(amount(at(null), 'shipping')).toBe(3 * 10000);
    });
    it('bands without slab rates (old saved cards) price exactly as before', () => {
      const r = computeDeliveryFees({ lines: small, goodsPaise: 0, distanceKm: 25, card: card() });
      expect(amount(r, 'shipping')).toBe(3 * 8000);
    });
    it('freight ignores the slab rate', () => {
      const r = computeDeliveryFees({ lines: heavy, goodsPaise: 0, distanceKm: 25, card: card({ distanceBands: slabBands }) });
      expect(r.mode).toBe('freight');
      expect(amount(r, 'shipping')).toBe(100 * 1600);
    });
  });

  it('default bands are all ₹16/kg — the same as today\'s bills at any distance', () => {
    const a = computeDeliveryFees({ lines: heavy, goodsPaise: 0, distanceKm: 100, card: card() });
    const b = computeDeliveryFees({ lines: heavy, goodsPaise: 0, distanceKm: 2500, card: card() });
    expect(amount(a, 'shipping')).toBe(amount(b, 'shipping'));
    expect(amount(a, 'shipping')).toBe(100 * 1600);
  });

  it('haversine: Delhi → Hyderabad ≈ 1,250 km, Delhi → itself 0', () => {
    const delhi = DEFAULT_RATE_CARD.origin;
    const km = haversineKm(delhi, { lat: 17.385, lng: 78.4867 });
    expect(km).toBeGreaterThan(1230);
    expect(km).toBeLessThan(1280);
    expect(haversineKm(delhi, delhi)).toBe(0);
  });
});

it('isValidPin', () => {
  expect(isValidPin('735101')).toBe(true);
  expect(isValidPin('035101')).toBe(false);
  expect(isValidPin('73510')).toBe(false);
  expect(isValidPin(735101)).toBe(false);
});

describe("owner's real bills (freight)", () => {
  const noExtras = (over = {}) => card({ gstOnFees: { enabled: false, percent: 18 }, paymentFeePercent: 0, insurancePercent: 0, ...over });
  it('Hyderabad (Air Line Express): 208×70×85 → 276 kg → ₹4,416 freight + ₹150 docket + ₹30 fuel = ₹4,596', () => {
    const r = computeDeliveryFees({ lines: [line({ shippingSize: box(60, 208, 70, 85) })], goodsPaise: 0, card: noExtras() });
    expect(r.chargedKg).toBe(276);
    expect(amount(r, 'shipping') + amount(r, 'docket') + amount(r, 'fuel')).toBe(459600);
  });
  it('Kerala (VRL): 360 kg at ₹15/kg → ₹5,400 freight', () => {
    const r = computeDeliveryFees({
      lines: [line({ shippingSize: box(360, 100, 100, 100) })], goodsPaise: 0, distanceKm: 2076,
      card: noExtras({ distanceBands: [{ upToKm: null, ratePerKg: 15 }] }),
    });
    expect(r.chargedKg).toBe(360);
    expect(amount(r, 'shipping')).toBe(540000);
  });
});

describe('the ₹5,05,000 Maybach conversion kit to Kochi (PIN 682019), no size data (2026-11-17)', () => {
  // The live product had no box, listed size or class, only categories → XL by category.
  const kit = () => computeDeliveryFees({
    lines: [line({ categoryClass: 'xl' })], goodsPaise: 50500000, isRemote: false, distanceKm: 2076, card: card(),
  });

  it('is freight with docket, handling and fuel — not a ½ kg parcel', () => {
    const r = kit();
    expect(r.mode).toBe('freight');
    expect(r.chargedKg).toBe(276);
    expect(r.estimated).toBe(true);
    expect(r.lines.map((l) => l.code)).toEqual(['shipping', 'packing', 'handling', 'docket', 'fuel', 'payment', 'gst']);
    expect(rupees(amount(r, 'shipping'))).toBe(4416);
    expect(rupees(amount(r, 'packing'))).toBe(1500);
  });
  it('payment fee is capped at ₹999 (was ₹11,937.94)', () => {
    expect(rupees(amount(kit(), 'payment'))).toBe(999);
  });
  it('GST is charged once: 18% of every other line, and no Razorpay GST inside the payment fee', () => {
    const r = kit();
    expect(amount(r, 'gst')).toBe(Math.round((sumLines(r) - amount(r, 'gst')) * 18 / 100));
    // ₹1,390.36 with insurance (₹505); ₹1,299.46 since it was removed.
    expect(rupees(amount(r, 'gst'))).toBe(1299.46);
  });
  it('total is in the owner\'s body-kit range (₹5,000–10,000)', () => {
    // ₹9,114.56 before insurance was removed (₹505 + ₹90.90 GST on it).
    expect(rupees(kit().totalPaise)).toBe(8518.66);
  });
});
describe('normalizePackingFee (admin product form)', () => {
  it.each([
    ['', null], [null, null], [undefined, null], ['2500', 2500], [0, 0], ['99.999', 100],
  ])('%j → %j', (input, out) => expect(normalizePackingFee(input)).toBe(out));
  it.each([['-1'], ['abc'], [100001]])('%j is invalid', (input) => expect(normalizePackingFee(input)).toBeUndefined());
});

describe('per-product packing fee', () => {
  const lineFor = (product, quantity = 1) => computeDeliveryFees({ lines: [{ quantity, product }], goodsPaise: 100000 });
  it('replaces the class rate, per unit', () => {
    expect(amount(lineFor({ shippingClass: 'large' }), 'packing')).toBe(50000); // paise
    expect(amount(lineFor({ shippingClass: 'large', packingFee: 2500 }, 3), 'packing')).toBe(750000);
  });
  it('null / non-number falls back to the class rate', () => {
    expect(amount(lineFor({ shippingClass: 'large', packingFee: null }), 'packing')).toBe(50000);
  });
});
