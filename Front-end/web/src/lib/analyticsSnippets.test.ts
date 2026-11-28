/**
 * Staff panels (/admin, /team) must not download or fire ad/tracking scripts,
 * while every shopper page still does. The snippets are run for real here, the
 * way the browser runs them from the served HTML.
 */
jest.mock('./gtm', () => ({ GTM_ID: 'GTM-TEST1', GTM_DATA_LAYER: 'gtmDataLayer' }));
jest.mock('./googleAds', () => ({ GOOGLE_ADS_ID: 'AW-123' }));
jest.mock('./metaPixel', () => ({ META_PIXEL_ID: '456' }));

import { gtmQueueSnippet, gtmLoaderSnippet, googleAdsSnippet, metaPixelSnippet } from './analyticsSnippets';

type W = typeof window & { gtmDataLayer?: unknown[]; dataLayer?: unknown[]; gtag?: unknown; fbq?: { queue: unknown[] }; _fbq?: unknown };

function runAt(path: string) {
  window.history.replaceState(null, '', path);
  document.head.innerHTML = '<script></script>'; // the snippets insert before the first script
  const w = window as W;
  delete w.gtmDataLayer; delete w.dataLayer; delete w.gtag; delete w.fbq; delete w._fbq;
  for (const s of [gtmQueueSnippet, gtmLoaderSnippet, googleAdsSnippet, metaPixelSnippet]) {
    // eslint-disable-next-line no-new-func
    new Function(s)();
  }
  const injected = [...document.querySelectorAll('script[src]')].map((s) => (s as HTMLScriptElement).src);
  return { w, injected };
}

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
