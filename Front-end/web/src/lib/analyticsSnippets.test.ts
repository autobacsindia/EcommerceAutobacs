/**
 * Staff panels (/admin, /team) must not download or fire ad/tracking scripts,
 * while every shopper page still does. The snippets are run for real here, the
 * way the browser runs them from the served HTML.
 */
jest.mock('./gtm', () => ({ GTM_ID: 'GTM-TEST1', GTM_DATA_LAYER: 'gtmDataLayer' }));
jest.mock('./googleAds', () => ({ GOOGLE_ADS_ID: 'AW-123' }));
jest.mock('./metaPixel', () => ({ META_PIXEL_ID: '456' }));

import {
  gtmQueueSnippet, gtmLoaderSnippet, googleAdsSnippet, metaPixelSnippet, THIRD_PARTY_START_MAX_WAIT_MS,
} from './analyticsSnippets';

type W = typeof window & { gtmDataLayer?: unknown[]; dataLayer?: unknown[]; gtag?: unknown; fbq?: { queue: unknown[] }; _fbq?: unknown };

/** The snippets run while the HTML is still being parsed. */
const setPageState = (state: DocumentReadyState) =>
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => state });

const injectedSrcs = () => [...document.querySelectorAll('script[src]')].map((s) => (s as HTMLScriptElement).src);

/** Run the snippets as the HTML parser would, then let the page finish loading. */
function runAt(path: string) {
  const out = parseAt(path);
  finishLoading();
  return { ...out, injected: injectedSrcs() };
}

function finishLoading() {
  setPageState('complete');
  window.dispatchEvent(new Event('load'));
  jest.advanceTimersByTime(THIRD_PARTY_START_MAX_WAIT_MS);
}

function parseAt(path: string) {
  setPageState('loading');
  window.history.replaceState(null, '', path);
  document.head.innerHTML = '<script></script>'; // the snippets insert before the first script
  const w = window as W;
  const g = window as unknown as Record<string, unknown>;
  for (const k of ['gtmDataLayer', 'dataLayer', 'gtag', 'fbq', '_fbq']) delete g[k];
  for (const s of [gtmQueueSnippet, gtmLoaderSnippet, googleAdsSnippet, metaPixelSnippet]) {
    new Function(s)();
  }
  return { w, injected: injectedSrcs() };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  // Drain this test's pending load listeners/timers so they cannot fire into the next one.
  window.dispatchEvent(new Event('load'));
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  Reflect.deleteProperty(document, 'readyState');
});

describe('analytics snippets on staff panels vs shop pages', () => {
  it.each(['/', '/products/some-kit', '/checkout', '/teams-and-clubs', '/administrator'])(
    'shop page %s loads GTM, Google Ads and the Meta Pixel',
    (path) => {
      const { injected } = runAt(path);
      expect(injected.some((u) => u.includes('googletagmanager.com/gtm.js?id=GTM-TEST1'))).toBe(true);
      expect(injected.some((u) => u.includes('googletagmanager.com/gtag/js?id=AW-123'))).toBe(true);
      expect(injected.some((u) => u.includes('connect.facebook.net/en_US/fbevents.js'))).toBe(true);
    },
  );

  it.each(['/admin', '/admin/orders', '/team', '/team/sales/orders'])(
    'staff page %s loads none of them',
    (path) => {
      const { injected } = runAt(path);
      expect(injected).toEqual([]);
    },
  );

  it('on a staff page the queues still exist, so code that tracks an event cannot throw', () => {
    const { w } = runAt('/admin/orders');
    expect(Array.isArray(w.gtmDataLayer)).toBe(true);
    expect(typeof w.gtag).toBe('function');
    expect(typeof w.fbq).toBe('function');
    expect(() => (w.gtag as (...a: unknown[]) => void)('event', 'x')).not.toThrow();
    expect(() => (w.fbq as unknown as (...a: unknown[]) => void)('track', 'ViewContent')).not.toThrow();
  });
});

describe('ad and tracking scripts wait for the page to load (shop pages)', () => {
  const ALL = ['gtm.js?id=GTM-TEST1', 'gtag/js?id=AW-123', 'fbevents.js'];
  const has = (injected: string[], part: string) => injected.some((u) => u.includes(part));

  it('downloads none of them while the page is still loading', () => {
    const { injected } = parseAt('/products/some-kit');
    expect(injected).toEqual([]);
    jest.advanceTimersByTime(THIRD_PARTY_START_MAX_WAIT_MS - 1);
    expect(injectedSrcs()).toEqual([]);
  });

  it('starts them right after the page has loaded', () => {
    parseAt('/');
    setPageState('complete');
    window.dispatchEvent(new Event('load'));
    jest.advanceTimersByTime(2); // no requestIdleCallback in jsdom → next tick
    for (const part of ALL) expect(has(injectedSrcs(), part)).toBe(true);
  });

  it('starts them after 4 seconds even if the page never finishes loading', () => {
    parseAt('/');
    jest.advanceTimersByTime(THIRD_PARTY_START_MAX_WAIT_MS);
    for (const part of ALL) expect(has(injectedSrcs(), part)).toBe(true);
  });

  it('adds each script once, even when both the load and the 4 second limit happen', () => {
    parseAt('/');
    finishLoading();
    jest.advanceTimersByTime(10_000);
    window.dispatchEvent(new Event('load'));
    expect(injectedSrcs()).toHaveLength(3);
  });

  it.each(['/checkout', '/checkout/payment', '/order/abc123/success'])(
    'checkout and order page %s start them at once, so a purchase never waits on a timer',
    (path) => {
      const { injected } = parseAt(path);
      for (const part of ALL) expect(has(injected, part)).toBe(true);
    },
  );

  it('events pushed before the scripts arrive wait in the queues', () => {
    const { w } = parseAt('/products/some-kit');
    (w.gtag as (...a: unknown[]) => void)('event', 'view_item');
    (w.fbq as unknown as (...a: unknown[]) => void)('track', 'ViewContent');
    w.gtmDataLayer!.push({ event: 'x' });
    expect(injectedSrcs()).toEqual([]);
    expect(w.dataLayer!.length).toBeGreaterThan(0);
    expect(w.fbq!.queue.length).toBeGreaterThan(0);
  });

  it('a page that is already loaded starts them at once', () => {
    setPageState('complete');
    window.history.replaceState(null, '', '/');
    document.head.innerHTML = '<script></script>';
    new Function(googleAdsSnippet)();
    expect(has(injectedSrcs(), 'gtag/js?id=AW-123')).toBe(true);
  });

  it('still adds them if the script they were to sit beside has been removed meanwhile', () => {
    parseAt('/');
    document.head.innerHTML = ''; // e.g. replaced during hydration
    jest.advanceTimersByTime(THIRD_PARTY_START_MAX_WAIT_MS);
    for (const part of ALL) expect(has(injectedSrcs(), part)).toBe(true);
  });

  it('the script URLs stay in the snippet text, so tag checkers reading the HTML still find them', () => {
    expect(gtmLoaderSnippet).toContain('https://www.googletagmanager.com/gtm.js?id=');
    expect(googleAdsSnippet).toContain('https://www.googletagmanager.com/gtag/js?id=AW-123');
    expect(metaPixelSnippet).toContain('https://connect.facebook.net/en_US/fbevents.js');
  });
});
