/**
 * Unit tests for the lead priority scorer (utils/leadScore.js). Pure function —
 * no DB, no mocks. Locks in the ranking that keeps strong leads above the
 * low-intent flood, plus the edge cases (terminal, empty, malformed).
 */

import { computeLeadScore, scoreTier, SCORE_HOT, SCORE_WARM } from '../utils/leadScore.js';

const now = () => new Date();

function lead(overrides = {}) {
  return {
    status: 'new',
    sources: [],
    reopenCount: 0,
    hasPurchased: false,
    ...overrides,
  };
}

describe('computeLeadScore', () => {
  test('empty / missing input scores 0', () => {
    expect(computeLeadScore(null)).toBe(0);
    expect(computeLeadScore(undefined)).toBe(0);
    expect(computeLeadScore(lead({ sources: [] }))).toBe(0);
    expect(computeLeadScore({})).toBe(0);
  });

  test('terminal (won/lost) leads score 0 regardless of signals', () => {
    const hot = lead({
      status: 'won',
      primarySource: 'order_cancelled',
      sources: [{ type: 'order_cancelled', snapshot: { total: 60_00_000 }, capturedAt: now() }],
      hasPurchased: true,
    });
    expect(computeLeadScore(hot)).toBe(0);
    expect(computeLeadScore({ ...hot, status: 'lost' })).toBe(0);
  });

  test('a stalled payment outranks an abandoned cart outranks a dormant signup', () => {
    const capturedAt = now();
    const payment = computeLeadScore(lead({ primarySource: 'payment_failed', sources: [{ type: 'payment_failed', snapshot: {}, capturedAt }] }));
    const cart = computeLeadScore(lead({ primarySource: 'cart_abandoned', sources: [{ type: 'cart_abandoned', snapshot: {}, capturedAt }] }));
    const dormant = computeLeadScore(lead({ primarySource: 'dormant_user', sources: [{ type: 'dormant_user', snapshot: {}, capturedAt }] }));
    expect(payment).toBeGreaterThan(cart);
    expect(cart).toBeGreaterThan(dormant);
  });

  test('a dormant-only signup lands in the cold tier', () => {
    const score = computeLeadScore(lead({
      primarySource: 'dormant_user',
      sources: [{ type: 'dormant_user', snapshot: {}, capturedAt: now() }],
    }));
    expect(scoreTier(score)).toBe('cold');
    expect(score).toBeLessThan(SCORE_WARM);
  });

  test('monetary value lifts the score', () => {
    const base = { primarySource: 'payment_pending', capturedAt: now() };
    const cheap = computeLeadScore(lead({ ...base, sources: [{ type: 'payment_pending', snapshot: { total: 50_000 }, capturedAt: base.capturedAt }] }));
    const rich = computeLeadScore(lead({ ...base, sources: [{ type: 'payment_pending', snapshot: { total: 60_00_000 }, capturedAt: base.capturedAt }] }));
    expect(rich).toBeGreaterThan(cheap);
  });

  test('recency decays: an old signal scores lower than a fresh one', () => {
    const src = (age) => ({ type: 'consultation', snapshot: {}, capturedAt: new Date(Date.now() - age) });
    const fresh = computeLeadScore(lead({ primarySource: 'consultation', sources: [src(0)] }));
    const old = computeLeadScore(lead({ primarySource: 'consultation', sources: [src(60 * 24 * 60 * 60 * 1000)] }));
    expect(fresh).toBeGreaterThan(old);
  });

  test('engagement: reopened + returning customer + multi-signal all add', () => {
    const capturedAt = now();
    const plain = computeLeadScore(lead({ primarySource: 'consultation', sources: [{ type: 'consultation', snapshot: {}, capturedAt }] }));
    const engaged = computeLeadScore(lead({
      primarySource: 'consultation',
      reopenCount: 1,
      hasPurchased: true,
      sources: [
        { type: 'consultation', snapshot: {}, capturedAt },
        { type: 'cart_abandoned', snapshot: {}, capturedAt },
      ],
    }));
    expect(engaged).toBeGreaterThan(plain);
  });

  test('a hot lead (recent high-value cancelled order, returning customer) crosses SCORE_HOT', () => {
    const score = computeLeadScore(lead({
      primarySource: 'order_cancelled',
      hasPurchased: true,
      sources: [{ type: 'order_cancelled', snapshot: { total: 60_00_000 }, capturedAt: now() }],
    }));
    expect(score).toBeGreaterThanOrEqual(SCORE_HOT);
    expect(scoreTier(score)).toBe('hot');
  });

  test('output is always an integer clamped to 0–100', () => {
    const score = computeLeadScore(lead({
      primarySource: 'order_cancelled',
      reopenCount: 5,
      hasPurchased: true,
      sources: [
        { type: 'order_cancelled', snapshot: { total: 99_00_000 }, capturedAt: now() },
        { type: 'payment_failed', snapshot: { total: 99_00_000 }, capturedAt: now() },
      ],
    }));
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('malformed sources do not throw', () => {
    expect(() => computeLeadScore(lead({ sources: [{ type: 'x', snapshot: null, capturedAt: 'nonsense' }] }))).not.toThrow();
  });
});
