/**
 * Campaign tier ladder — pure money maths.
 *
 * These lock the exact rupee figures the festival campaign pays out, and assert the
 * property that actually protects the customer experience: in "best" resolution the
 * discount can never DECREASE as the cart grows. The literal brief ("0–1L → 20%,
 * above 1L → 10%") violates that — a ₹1,00,001 cart saved ₹10,000 less than a
 * ₹99,999 one — so the cliff is pinned here as the behaviour of "window" mode only,
 * and the property test is what stops it leaking back into "best".
 */

import { resolveTier, validateTiers, assertMonotonic, TIER_RESOLUTION } from '../utils/campaignTiers.js';
import { toPaise, fromPaise } from '../utils/money.js';

/** The live festival ladder: 20% capped at ₹20,000, or 10% uncapped above ₹1 lakh. */
const FESTIVE = {
  resolution: TIER_RESOLUTION.BEST,
  maxDiscountPerOrder: 50000,
  tiers: [
    { id: 'festive20', label: 'Festive 20', minCartValue: 0,      percent: 20, maxDiscount: 20000 },
    { id: 'grand10',   label: 'Grand 10',   minCartValue: 100000, percent: 10, maxDiscount: null  },
  ],
};

/** Discount in rupees for a rupee cart value — the figure a buyer would see. */
const discountFor = (campaign, rupees) =>
  fromPaise(resolveTier(campaign, toPaise(rupees))?.discountPaise || 0);

describe('resolveTier — festival ladder, best resolution', () => {
  it.each([
    // cart,      expected discount,  winning tier
    [1000,        200,                'festive20'],
    [50000,       10000,              'festive20'],
    [99999,       19999.8,            'festive20'],
    [100000,      20000,              'festive20'],  // 20% reaches its cap exactly here
    [100001,      20000,              'festive20'],  // the old cliff — holds instead of dropping
    [150000,      20000,              'festive20'],  // flat through the 1L–2L stretch
    [200000,      20000,              'festive20'],  // crossover: both tiers give ₹20,000
    [250000,      25000,              'grand10'],    // 10% overtakes the cap
    [300000,      30000,              'grand10'],
    [500000,      50000,              'grand10'],    // exactly on the absolute ceiling
  ])('a ₹%s cart earns ₹%s (tier %s)', (cart, expected, tierId) => {
    const resolved = resolveTier(FESTIVE, toPaise(cart));
    expect(fromPaise(resolved.discountPaise)).toBe(expected);
    expect(resolved.tierId).toBe(tierId);
  });

  it('never exceeds the campaign-wide per-order ceiling', () => {
    // 10% of ₹8 lakh would be ₹80,000; the ₹50,000 ceiling must bite.
    expect(discountFor(FESTIVE, 800000)).toBe(50000);
    expect(discountFor(FESTIVE, 2000000)).toBe(50000);
  });

  it('does not drop ₹10,000 when a cart crosses ₹1 lakh', () => {
    // The specific regression the "best" mode exists to prevent: adding a ₹2 item
    // to a ₹99,999 cart must not make the customer worse off.
    const before = discountFor(FESTIVE, 99999);
    const after = discountFor(FESTIVE, 100001);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('breaks ties toward the earliest-declared tier for a stable label', () => {
    // At ₹2 lakh both tiers yield ₹20,000; the buyer must not see the label flicker.
    expect(resolveTier(FESTIVE, toPaise(200000)).tierId).toBe('festive20');
  });
});

describe('resolveTier — monotonicity property (best resolution)', () => {
  it('never decreases across the full cart range on the festival ladder', () => {
    expect(assertMonotonic(FESTIVE, 1_000_000)).toEqual({ ok: true });
  });

  it('never decreases for randomly generated ladders', () => {
    // Fuzz: an admin can edit tiers long after launch. Any ladder they can express
    // in "best" mode must stay cliff-free, so the guarantee is structural rather
    // than a property of the one configuration we happened to ship.
    let seed = 20260810;
    const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);

    for (let round = 0; round < 200; round++) {
      const tiers = Array.from({ length: 1 + rnd(4) }, (_, i) => ({
        id: `t${i}`,
        minCartValue: rnd(300000),
        percent: 1 + rnd(60),
        maxDiscount: rnd(3) === 0 ? null : 1000 + rnd(60000),
      }));
      const campaign = {
        resolution: TIER_RESOLUTION.BEST,
        maxDiscountPerOrder: rnd(2) === 0 ? null : 10000 + rnd(90000),
        tiers,
      };
      const result = assertMonotonic(campaign, 600000);
      if (!result.ok) {
        throw new Error(
          `Discount fell at ₹${fromPaise(result.at)}: ₹${fromPaise(result.from)} → ` +
          `₹${fromPaise(result.to)}\nLadder: ${JSON.stringify(campaign)}`
        );
      }
    }
  });

  it('a cart one paise larger is never worth less', () => {
    for (let rupees = 0; rupees <= 400000; rupees += 997) {
      const a = resolveTier(FESTIVE, toPaise(rupees))?.discountPaise || 0;
      const b = resolveTier(FESTIVE, toPaise(rupees) + 1)?.discountPaise || 0;
      expect(b).toBeGreaterThanOrEqual(a);
    }
  });
});

describe('resolveTier — window resolution', () => {
  // Faithful to the literal brief. Kept working, and kept documented as non-monotonic.
  const WINDOW = {
    resolution: TIER_RESOLUTION.WINDOW,
    tiers: [
      { id: 'upto1L', minCartValue: 0,      maxCartValue: 100000, percent: 20 },
      { id: 'above1L', minCartValue: 100000, maxCartValue: null,  percent: 10 },
    ],
  };

  it('picks the bracket containing the cart value', () => {
    expect(resolveTier(WINDOW, toPaise(50000)).tierId).toBe('upto1L');
    expect(resolveTier(WINDOW, toPaise(150000)).tierId).toBe('above1L');
  });

  it('exhibits the cliff the brief implies (and best mode removes)', () => {
    expect(discountFor(WINDOW, 99999)).toBe(19999.8);
    expect(discountFor(WINDOW, 100001)).toBe(10000.1);
    // Proof the cliff is real: bigger cart, smaller saving.
    expect(discountFor(WINDOW, 100001)).toBeLessThan(discountFor(WINDOW, 99999));
  });

  it('is reported as non-monotonic by assertMonotonic', () => {
    expect(assertMonotonic(WINDOW, 300000).ok).toBe(false);
  });

  it('yields nothing when no bracket covers the cart', () => {
    const gapped = {
      resolution: TIER_RESOLUTION.WINDOW,
      tiers: [{ id: 'high', minCartValue: 500000, maxCartValue: null, percent: 10 }],
    };
    expect(resolveTier(gapped, toPaise(1000))).toBeNull();
  });
});

describe('resolveTier — caps and edges', () => {
  it('never discounts more than the cart is worth', () => {
    const absurd = { tiers: [{ id: 'x', minCartValue: 0, percent: 100, maxDiscount: null }] };
    expect(resolveTier(absurd, toPaise(1000)).discountPaise).toBe(toPaise(1000));
  });

  it('returns null for an empty cart, empty ladder, or zero percent', () => {
    expect(resolveTier(FESTIVE, 0)).toBeNull();
    expect(resolveTier(FESTIVE, -500)).toBeNull();
    expect(resolveTier({ tiers: [] }, toPaise(5000))).toBeNull();
    expect(resolveTier({}, toPaise(5000))).toBeNull();
    expect(resolveTier(null, toPaise(5000))).toBeNull();
    expect(resolveTier({ tiers: [{ id: 'z', minCartValue: 0, percent: 0 }] }, toPaise(5000))).toBeNull();
  });

  it('returns null when no tier minimum is met', () => {
    const highOnly = { tiers: [{ id: 'vip', minCartValue: 100000, percent: 10 }] };
    expect(resolveTier(highOnly, toPaise(5000))).toBeNull();
  });

  it('uses floor so a discount can never round up against us', () => {
    // 20% of ₹99.99 = ₹19.998 → 1999 paise, not 2000.
    const r = resolveTier({ tiers: [{ id: 'f', minCartValue: 0, percent: 20 }] }, 9999);
    expect(r.discountPaise).toBe(1999);
  });
});

describe('validateTiers', () => {
  it('accepts the live festival ladder', () => {
    expect(validateTiers(FESTIVE)).toEqual([]);
  });

  it('requires at least one tier', () => {
    expect(validateTiers({ tiers: [] })).toContain('At least one tier is required.');
  });

  it('rejects a percent outside 0–100', () => {
    expect(validateTiers({ tiers: [{ id: 'a', percent: 0 }] }).join()).toMatch(/between 0 and 100/);
    expect(validateTiers({ tiers: [{ id: 'a', percent: 120 }] }).join()).toMatch(/between 0 and 100/);
  });

  it('rejects maxCartValue in best resolution, naming the reason', () => {
    const errors = validateTiers({
      resolution: TIER_RESOLUTION.BEST,
      tiers: [{ id: 'a', percent: 20, minCartValue: 0, maxCartValue: 100000 }],
    });
    expect(errors.join()).toMatch(/ignored in "best" resolution/);
  });

  it('allows maxCartValue in window resolution', () => {
    expect(validateTiers({
      resolution: TIER_RESOLUTION.WINDOW,
      tiers: [{ id: 'a', percent: 20, minCartValue: 0, maxCartValue: 100000 }],
    })).toEqual([]);
  });

  it('flags duplicate tier ids and inverted windows', () => {
    const errors = validateTiers({
      resolution: TIER_RESOLUTION.WINDOW,
      tiers: [
        { id: 'dup', percent: 10, minCartValue: 0 },
        { id: 'dup', percent: 10, minCartValue: 5000, maxCartValue: 1000 },
      ],
    });
    expect(errors.join()).toMatch(/duplicate tier id/);
    expect(errors.join()).toMatch(/maximum cart value is below its minimum/);
  });

  it('flags a window ladder that leaves small carts uncovered', () => {
    const errors = validateTiers({
      resolution: TIER_RESOLUTION.WINDOW,
      tiers: [{ id: 'a', percent: 20, minCartValue: 5000 }],
    });
    expect(errors.join()).toMatch(/No tier covers carts below/);
  });
});
