import { readFileSync } from 'fs';
import path from 'path';
import {
  applyFestivalOffer,
  isOfferLive,
  msUntilOfferBoundary,
  tierPercentForPaise,
  type FestivalOfferTier,
  type PublicFestivalOffer,
} from './festivalOffer';

/*
  The SAME case table the backend runs against the function that charges
  (Back-end/server/tests/festivalOffer.test.js). If this mirror ever drifts from the
  server's maths, one of the two suites goes red.
*/
const fixturePath = path.resolve(__dirname, '../../../../../Back-end/server/tests/fixtures/festivalOfferCases.json');
const { cases } = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  cases: { name: string; unitPrice: number; listPrice: number | null; expected: Record<string, number> | null }[];
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
    const out = applyFestivalOffer({ unitPrice: c.unitPrice }, TIERS);
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
