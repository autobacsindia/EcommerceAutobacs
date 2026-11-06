import { isFestivalLive, isFestiveRoute, msUntilNextBoundary, type PublicFestivalTheme } from './festivalTheme';
import { claimOrderCelebration } from './celebrateOnce';
import { istInputToIso, isoToIstInput } from './istInput';
import { FESTIVAL_THEMES, getThemeTokens } from './themes';

jest.mock('@/lib/server-api', () => ({ serverFetch: jest.fn() }));

const NOW = Date.parse('2026-11-06T12:00:00Z');
const theme = (p: Partial<PublicFestivalTheme> = {}): PublicFestivalTheme => ({
  themeKey: 'diwali', startsAt: null, endsAt: null, live: true, ...p,
});

describe('isFestivalLive', () => {
  it('is off with no theme (switched off)', () => {
    expect(isFestivalLive(null, NOW)).toBe(false);
  });
  it('is on with an open window', () => {
    expect(isFestivalLive(theme(), NOW)).toBe(true);
  });
  it('is off before the start, on at the start', () => {
    expect(isFestivalLive(theme({ startsAt: new Date(NOW + 1).toISOString() }), NOW)).toBe(false);
    expect(isFestivalLive(theme({ startsAt: new Date(NOW).toISOString() }), NOW)).toBe(true);
  });
  it('is off at and after the end — a cached "on" cannot outlive the end date', () => {
    expect(isFestivalLive(theme({ endsAt: new Date(NOW).toISOString(), live: true }), NOW)).toBe(false);
    expect(isFestivalLive(theme({ endsAt: new Date(NOW - 60_000).toISOString(), live: true }), NOW)).toBe(false);
    expect(isFestivalLive(theme({ endsAt: new Date(NOW + 1).toISOString() }), NOW)).toBe(true);
  });
});

describe('msUntilNextBoundary', () => {
  it('returns the nearer future boundary, or null', () => {
    expect(msUntilNextBoundary(null, NOW)).toBeNull();
    expect(msUntilNextBoundary(theme(), NOW)).toBeNull();
    expect(msUntilNextBoundary(theme({ startsAt: new Date(NOW + 5000).toISOString(), endsAt: new Date(NOW + 9000).toISOString() }), NOW)).toBe(5000);
    expect(msUntilNextBoundary(theme({ startsAt: new Date(NOW - 5000).toISOString(), endsAt: new Date(NOW + 9000).toISOString() }), NOW)).toBe(9000);
  });
});

describe('isFestiveRoute', () => {
  it.each(['/', '/products/x', '/cart', '/order/abc/success', '/categories/audio'])('decorates %s', (p) => {
    expect(isFestiveRoute(p)).toBe(true);
  });
  it.each(['/checkout', '/checkout/', '/checkout/review', '/admin', '/admin/festival-theme', '/team', '/team/marketing', '/login', '/register', '/payment/x'])(
    'never decorates %s', (p) => {
      expect(isFestiveRoute(p)).toBe(false);
    },
  );
});

describe('claimOrderCelebration', () => {
  beforeEach(() => sessionStorage.clear());
  it('returns true once per order, false on every later call (refresh)', () => {
    expect(claimOrderCelebration('o1')).toBe(true);
    expect(claimOrderCelebration('o1')).toBe(false);
    expect(claimOrderCelebration('o2')).toBe(true);
  });
  it('returns false when storage throws (skip rather than replay)', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(claimOrderCelebration('o3')).toBe(false);
    spy.mockRestore();
  });
  it('returns false for an empty id', () => {
    expect(claimOrderCelebration('')).toBe(false);
  });
});

describe('IST datetime input', () => {
  it('reads the input as IST regardless of the browser timezone', () => {
    expect(istInputToIso('2026-11-08T23:59')).toBe('2026-11-08T18:29:00.000Z');
    expect(istInputToIso('')).toBeNull();
    expect(istInputToIso('garbage')).toBeNull();
  });
  it('round-trips', () => {
    expect(isoToIstInput('2026-11-08T18:29:00.000Z')).toBe('2026-11-08T23:59');
    expect(isoToIstInput(null)).toBe('');
  });
});

describe('theme config', () => {
  it('has every token a festival needs', () => {
    for (const t of Object.values(FESTIVAL_THEMES)) {
      expect(t.particles.length).toBeGreaterThan(0);
      expect(t.icons.lamp).toBeTruthy();
      expect(t.icons.garland.length).toBeGreaterThan(0);
      expect(t.copy.dealBadge && t.copy.orderConfirmed && t.copy.countdownLabel).toBeTruthy();
    }
    expect(getThemeTokens('diwali')?.copy.orderConfirmed).toBe('Happy Diwali! Your order is confirmed 🪔');
    expect(getThemeTokens('unknown')).toBeNull();
  });
});
