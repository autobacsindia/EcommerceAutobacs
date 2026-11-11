import { readFileSync } from 'fs';
import path from 'path';
import {
  applyFestivalOffer,
  festivalPriceRange,
  resolveFestivalSetting,
  isOfferLive,
  msUntilOfferBoundary,
  tierPercentForPaise,
  type FestivalOfferTier,
  type PublicFestivalOffer,
} from './festivalOffer';
import type { FestivalOfferSetting } from './festivalOffer';

/*
  The SAME case table the backend runs against the function that charges
  (Back-end/server/tests/festivalOffer.test.js). If this mirror ever drifts from the
  server's maths, one of the two suites goes red.
*/
const fixturePath = path.resolve(__dirname, '../../../../../Back-end/server/tests/fixtures/festivalOfferCases.json');
const { cases } = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  cases: { name: string; unitPrice: number; listPrice: number | null; setting?: FestivalOfferSetting; expected: Record<string, number> | null }[];
};

// The server's ladder, as GET /festival-offer/active publishes it.
const TIERS: FestivalOfferTier[] = [
  { minPaise: 0, percent: 10 },
  { minPaise: 50_000_00, percent: 5 },
  { minPaise: 1_00_000_00 + 1, percent: 3 },
  { minPaise: 2_00_000_00 + 1, percent: 2 },
];

describe('applyFestivalOffer — shared case table with the server', () => {
  it('has cases to run (the fixture path resolves)', () => {
    expect(cases.length).toBeGreaterThan(10);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const out = applyFestivalOffer({ unitPrice: c.unitPrice, setting: c.setting }, TIERS);
    if (c.expected === null) expect(out).toBeNull();
    else expect(out).toEqual({ code: 'diwali', ...c.expected });
  });

  it('does not depend on the order the server lists tiers in', () => {
    expect(tierPercentForPaise(50_000_00, [...TIERS].reverse())).toBe(5);
    expect(tierPercentForPaise(2_00_000_01, [...TIERS].reverse())).toBe(2);
  });

  it('applies no offer when the ladder is empty', () => {
    expect(applyFestivalOffer({ unitPrice: 40000 }, [])).toBeNull();
  });
});

describe('offer window on the visitor clock', () => {
  const NOW = Date.parse('2026-11-06T12:00:00Z');
  const offer = (over: Partial<PublicFestivalOffer> = {}): PublicFestivalOffer => ({
    code: 'diwali', startsAt: null, endsAt: null, live: true, tiers: TIERS, ...over,
  });

  it('is off when null, before the start, and at/after the end', () => {
    expect(isOfferLive(null, NOW)).toBe(false);
    expect(isOfferLive(offer({ startsAt: new Date(NOW + 1).toISOString() }), NOW)).toBe(false);
    expect(isOfferLive(offer({ endsAt: new Date(NOW).toISOString() }), NOW)).toBe(false);
    expect(isOfferLive(offer({ endsAt: new Date(NOW + 1).toISOString() }), NOW)).toBe(true);
  });

  it('schedules the next flip at the nearest future boundary', () => {
    const o = offer({ startsAt: new Date(NOW - 1000).toISOString(), endsAt: new Date(NOW + 5000).toISOString() });
    expect(msUntilOfferBoundary(o, NOW)).toBe(5000);
    expect(msUntilOfferBoundary(offer(), NOW)).toBeNull();
  });
});

/*
  Per-model Diwali choices — the SAME case table the server runs against the resolver
  that charges (Back-end/server/tests/festivalOfferVariants.test.js).
*/
const variantFixture = path.resolve(__dirname, '../../../../../Back-end/server/tests/fixtures/festivalVariantSettingCases.json');
const variantCases = (JSON.parse(readFileSync(variantFixture, 'utf8')) as {
  cases: { name: string; product: Parameters<typeof resolveFestivalSetting>[0]; variantId: string | null; expected: FestivalOfferSetting | null }[];
}).cases;

describe('resolveFestivalSetting — shared case table with the server', () => {
  it('has cases to run', () => { expect(variantCases.length).toBeGreaterThan(5); });
  it.each(variantCases.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    expect(resolveFestivalSetting(c.product, c.variantId)).toEqual(c.expected);
  });
});

describe('festivalPriceRange — per-model "From" and range', () => {
  const jerry = {
    priceMin: 3060,
    priceMax: 6390,
    variants: [
      { _id: 'red', price: 3060 },
      { _id: 'black', price: 4200 },
      { _id: 'kit', price: 6390 },
    ],
  };

  it('no model choices: every model on Automatic (same numbers as before)', () => {
    expect(festivalPriceRange(jerry, TIERS)).toMatchObject({ min: 2754, max: 5751, anyOffer: true });
  });

  it('mixed choices: the cheapest model is not always the cheapest price', () => {
    // Red on No offer (₹3,060), Black at 30% (₹2,940) → Black is the real "From".
    const r = festivalPriceRange({
      ...jerry,
      festivalOfferVariantSettings: [
        { variantId: 'red', mode: 'none' },
        { variantId: 'black', mode: 'custom', percent: 30 },
        { variantId: 'kit', mode: 'none' },
      ],
    }, TIERS);
    expect(r.min).toBe(2940);
    expect(r.max).toBe(6390);
    expect(r.minOffer).toMatchObject({ percent: 30, finalPrice: 2940, basePrice: 4200 });
  });

  it('every model excluded → the normal range, no offer label', () => {
    const r = festivalPriceRange({ ...jerry, festivalOfferSetting: { mode: 'none' } }, TIERS);
    expect(r).toEqual({ min: 3060, max: 6390, minOffer: null, anyOffer: false });
  });

  it('a model on "same as product" follows the product default', () => {
    const r = festivalPriceRange({
      ...jerry,
      festivalOfferSetting: { mode: 'custom', percent: 5 },
      festivalOfferVariantSettings: [{ variantId: 'kit', mode: 'none' }],
    }, TIERS);
    expect(r.min).toBe(2907);          // red 5%
    expect(r.max).toBe(6390);          // kit no offer
  });

  it('without the model list: old ladder on min/max, but never guesses when models have their own choices', () => {
    const noList = { priceMin: 3060, priceMax: 6390 };
    expect(festivalPriceRange(noList, TIERS)).toMatchObject({ min: 2754, max: 5751, anyOffer: true });
    expect(festivalPriceRange({ ...noList, festivalOfferVariantSettings: [{ variantId: 'x', mode: 'auto' }] }, TIERS))
      .toEqual({ min: 3060, max: 6390, minOffer: null, anyOffer: false });
  });
});
