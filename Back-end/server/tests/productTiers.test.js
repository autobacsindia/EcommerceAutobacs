/**
 * Product-tier resolution — the pure money maths.
 *
 * These are the invariant tests for the per-line discount ladder. The cases are drawn
 * from the real prod catalogue measurements taken while designing the scheme, so a
 * regression here is a regression against the actual tier configuration:
 *
 *   Bronkz 3%  — 143 products (proman, nano, ironman, profender thar/jimny/gypsy,
 *                70mai, comeup, bmc)
 *   Sora   5%  —  50 products (auxbeam, mark sports, hypersonic)
 *   Thanos 8%  —  85 products (profender, bodykit) after losing 6 to Bronkz
 *   Ismpor 4%  — ~650 products, the DEFAULT
 *   on sale    —  capped at 2% (27 of the 278 explicitly assigned products)
 */

import {
  ON_SALE_MAX_PERCENT,
  resolveAssignedTierCode,
  resolveLinePercent,
  lineDiscountPaise,
  apportionCap,
  validateProductTiers,
  defaultTier,
  explicitTiers,
} from '../utils/productTiers.js';

/** The live scheme, in declared order. */
const TIERS = [
  { code: 'bronkz', label: 'Bronkz', percent: 3 },
  { code: 'sora',   label: 'Sora',   percent: 5 },
  { code: 'thanos', label: 'Thanos', percent: 8 },
  { code: 'ismpor', label: 'Ismpor', percent: 4, isDefault: true },
];

describe('resolveAssignedTierCode — overlap resolution at assignment time', () => {
  test('lowest percentage wins when a product matches several tiers', () => {
    // The 6 real overlap products: Profender Thar/Jimny/Gypsy kits match both the
    // `profender` (Thanos 8%) and `profender thar` (Bronkz 3%) queries.
    expect(resolveAssignedTierCode(TIERS, ['thanos', 'bronkz'])).toBe('bronkz');
    expect(resolveAssignedTierCode(TIERS, ['bronkz', 'thanos'])).toBe('bronkz');
  });

  test('a single match resolves to itself', () => {
    expect(resolveAssignedTierCode(TIERS, ['thanos'])).toBe('thanos');
    expect(resolveAssignedTierCode(TIERS, ['sora'])).toBe('sora');
  });

  test('no explicit match resolves to null, meaning "use the default at pricing time"', () => {
    // Deliberately NOT 'ismpor': the default code is never written onto a product, so
    // changing which tier is default cannot require rewriting ~650 catalogue rows.
    expect(resolveAssignedTierCode(TIERS, [])).toBeNull();
    expect(resolveAssignedTierCode(TIERS, ['nonexistent'])).toBeNull();
  });

  test('THE TRAP: the default tier never competes, so premium tiers still fire', () => {
    // If 'ismpor' (4%) took part in the lowest-wins comparison it would beat Sora (5%)
    // and Thanos (8%) every single time — both tiers would silently never pay out.
    // A product matching an explicit tier AND the default keeps the explicit tier.
    expect(resolveAssignedTierCode(TIERS, ['thanos', 'ismpor'])).toBe('thanos');
    expect(resolveAssignedTierCode(TIERS, ['sora', 'ismpor'])).toBe('sora');
    // And the default alone still means "nothing explicit matched".
    expect(resolveAssignedTierCode(TIERS, ['ismpor'])).toBeNull();
  });

  test('ties keep the earliest-declared tier so the operator-visible label is stable', () => {
    const tied = [
      { code: 'first',  percent: 3 },
      { code: 'second', percent: 3 },
      { code: 'def',    percent: 4, isDefault: true },
    ];
    expect(resolveAssignedTierCode(tied, ['second', 'first'])).toBe('first');
  });

  test('a tier with an ABSENT percent is skipped, not treated as 0%', () => {
    // `Number(null)` is 0 and passes Number.isFinite, so a null percent would resolve
    // to 0%, win lowest-wins, and hand the buyer a silent zero discount. Caught by
    // this test on first run.
    for (const absent of [null, undefined, '']) {
      const broken = [
        { code: 'broken', percent: absent },
        { code: 'thanos', percent: 8 },
        { code: 'def', percent: 4, isDefault: true },
      ];
      expect(resolveAssignedTierCode(broken, ['broken', 'thanos'])).toBe('thanos');
    }
  });

  test('an explicit 0% tier is real and DOES win lowest-wins', () => {
    // The distinction that makes the test above safe: absent means "skip me",
    // zero means "these products get nothing", which is a valid thing to configure.
    const withZero = [
      { code: 'excluded', percent: 0 },
      { code: 'thanos', percent: 8 },
      { code: 'def', percent: 4, isDefault: true },
    ];
    expect(resolveAssignedTierCode(withZero, ['excluded', 'thanos'])).toBe('excluded');
    expect(resolveLinePercent(withZero, 'excluded').percent).toBe(0);
  });
});

describe('resolveLinePercent — the rate a cart line earns at pricing time', () => {
  test('an assigned tier yields its own percentage', () => {
    expect(resolveLinePercent(TIERS, 'thanos').percent).toBe(8);
    expect(resolveLinePercent(TIERS, 'sora').percent).toBe(5);
    expect(resolveLinePercent(TIERS, 'bronkz').percent).toBe(3);
  });

  test('an unassigned product falls back to the default, and Bronkz is BELOW it', () => {
    const fallback = resolveLinePercent(TIERS, null);
    expect(fallback.percent).toBe(4);
    expect(fallback.tierCode).toBe('ismpor');
    // Deliberate commercial call, confirmed 2026-08-19: the 143 named-brand Bronkz
    // products get LESS than the ~650 unlisted ones. Asserted so it reads as intent.
    expect(resolveLinePercent(TIERS, 'bronkz').percent).toBeLessThan(fallback.percent);
  });

  test('a stale tier code that no longer exists falls back to the default, never to zero', () => {
    // A tier deleted from the campaign while assignments still reference it must not
    // silently zero the discount — the buyer keeps the "everything else" rate.
    expect(resolveLinePercent(TIERS, 'deleted-tier').percent).toBe(4);
  });

  test('an already-discounted product is capped at 2%, whatever its tier', () => {
    expect(resolveLinePercent(TIERS, 'thanos', true).percent).toBe(ON_SALE_MAX_PERCENT);
    expect(resolveLinePercent(TIERS, 'sora', true).percent).toBe(ON_SALE_MAX_PERCENT);
    expect(resolveLinePercent(TIERS, null, true).percent).toBe(ON_SALE_MAX_PERCENT);
  });

  test('the cap REPLACES the tier rate — it is never added to it', () => {
    // Confirmed 2026-08-19: an on-sale Thanos product pays 2%, not 8% and not 10%.
    const capped = resolveLinePercent(TIERS, 'thanos', true);
    expect(capped.percent).toBe(2);
    expect(capped.percent).not.toBe(10);
  });

  test('a tier already at or below the cap is not reported as capped', () => {
    // Bronkz is 3%, so an on-sale Bronkz line drops to 2% and IS capped…
    expect(resolveLinePercent(TIERS, 'bronkz', true).onSaleCapped).toBe(true);
    // …but a tier at 2% loses nothing, and telling the buyer otherwise would be a lie.
    const low = [{ code: 'low', percent: 2 }, { code: 'd', percent: 4, isDefault: true }];
    expect(resolveLinePercent(low, 'low', true).onSaleCapped).toBe(false);
    expect(resolveLinePercent(low, 'low', true).percent).toBe(2);
  });

  test('not on sale is never capped', () => {
    expect(resolveLinePercent(TIERS, 'thanos', false).onSaleCapped).toBe(false);
  });

  test('no tiers configured at all yields zero, not a crash', () => {
    expect(resolveLinePercent([], null).percent).toBe(0);
    expect(resolveLinePercent(undefined, 'thanos').percent).toBe(0);
  });
});

describe('lineDiscountPaise — integer paise, always floored', () => {
  test('computes a straightforward percentage', () => {
    expect(lineDiscountPaise(100_000, 8)).toBe(8_000);   // ₹1,000 @ 8% = ₹80
    expect(lineDiscountPaise(100_000, 3)).toBe(3_000);
  });

  test('floors, so a discount is never rounded UP against the business', () => {
    // ₹99.99 @ 3% = 299.97 paise → 299
    expect(lineDiscountPaise(9_999, 3)).toBe(299);
    expect(lineDiscountPaise(3_333, 8)).toBe(266);       // 266.64 → 266
  });

  test('never exceeds the line value', () => {
    expect(lineDiscountPaise(5_000, 100)).toBe(5_000);
    expect(lineDiscountPaise(5_000, 150)).toBe(5_000);
  });

  test('zero and garbage inputs yield zero', () => {
    expect(lineDiscountPaise(0, 8)).toBe(0);
    expect(lineDiscountPaise(100_000, 0)).toBe(0);
    expect(lineDiscountPaise(100_000, -5)).toBe(0);
    expect(lineDiscountPaise(null, null)).toBe(0);
  });
});

describe('apportionCap — an order ceiling pushed back onto the lines', () => {
  test('leaves lines untouched when the total is under the cap', () => {
    expect(apportionCap([1_000, 2_000], 50_000)).toEqual([1_000, 2_000]);
  });

  test('the apportioned parts sum EXACTLY to the cap — no paise lost or invented', () => {
    const lines = [3_333, 5_555, 8_888, 1_111];
    const capped = apportionCap(lines, 10_000);
    expect(capped.reduce((s, d) => s + d, 0)).toBe(10_000);
  });

  test('holds exactly across a spread of awkward caps and line shapes', () => {
    const shapes = [
      [1, 1, 1],
      [7, 11, 13, 17],
      [100_000, 3, 999_999],
      [50_000, 50_000],
      [12_345, 67_890, 1],
    ];
    for (const lines of shapes) {
      const total = lines.reduce((s, d) => s + d, 0);
      for (const cap of [0, 1, 2, 3, 7, Math.floor(total / 3), total - 1, total]) {
        const out = apportionCap(lines, cap);
        expect(out.reduce((s, d) => s + d, 0)).toBe(Math.min(total, cap));
        // No line may be handed more than it earned.
        out.forEach((d, i) => expect(d).toBeLessThanOrEqual(lines[i]));
        expect(out.every(d => Number.isInteger(d) && d >= 0)).toBe(true);
      }
    }
  });

  test('shares proportionally to what each line earned, not to line count', () => {
    // 8% line earned 4x the 2% line, so it should absorb ~4x the surviving discount.
    const [big, small] = apportionCap([8_000, 2_000], 5_000);
    expect(big + small).toBe(5_000);
    expect(big).toBe(4_000);
    expect(small).toBe(1_000);
  });

  test('a zero cap zeroes every line', () => {
    expect(apportionCap([1_000, 2_000], 0)).toEqual([0, 0]);
  });

  test('is deterministic — the same cart always produces the same breakdown', () => {
    const lines = [3_333, 3_333, 3_334];
    const first = apportionCap(lines, 5_000);
    for (let i = 0; i < 5; i++) expect(apportionCap(lines, 5_000)).toEqual(first);
  });

  test('does not mutate the caller’s array', () => {
    const lines = [8_000, 2_000];
    apportionCap(lines, 5_000);
    expect(lines).toEqual([8_000, 2_000]);
  });

  test('an empty cart apportions to nothing', () => {
    expect(apportionCap([], 5_000)).toEqual([]);
  });
});

describe('validateProductTiers — refuse a bad ladder before it reaches a cart', () => {
  test('accepts the live scheme', () => {
    expect(validateProductTiers(TIERS)).toEqual([]);
  });

  test('an empty ladder is valid — a campaign need not use product tiers at all', () => {
    expect(validateProductTiers([])).toEqual([]);
    expect(validateProductTiers(undefined)).toEqual([]);
  });

  test('requires exactly one default, or unlisted products silently get nothing', () => {
    const none = TIERS.filter(t => !t.isDefault);
    expect(validateProductTiers(none).join(' ')).toMatch(/must be marked as the default/i);

    const two = [...none, { code: 'a', percent: 4, isDefault: true }, { code: 'b', percent: 6, isDefault: true }];
    expect(validateProductTiers(two).join(' ')).toMatch(/Only one tier can be the default/i);
  });

  test('rejects duplicate codes, missing codes and out-of-range percentages', () => {
    const bad = [
      { code: 'dup', percent: 3 },
      { code: 'dup', percent: 5 },
      { code: '', percent: 5 },
      { code: 'high', percent: 150 },
      { code: 'neg', percent: -1 },
      { code: 'def', percent: 4, isDefault: true },
    ];
    const errors = validateProductTiers(bad).join(' ');
    expect(errors).toMatch(/duplicate tier code "dup"/i);
    expect(errors).toMatch(/a code is required/i);
    expect(errors).toMatch(/percent must be between 0 and 100/i);
  });
});

describe('tier helpers', () => {
  test('defaultTier and explicitTiers split the ladder', () => {
    expect(defaultTier(TIERS).code).toBe('ismpor');
    expect(explicitTiers(TIERS).map(t => t.code)).toEqual(['bronkz', 'sora', 'thanos']);
    expect(defaultTier([])).toBeNull();
  });
});
