/**
 * Regression guard for the edge-level 410 blocklist consumed by `middleware.ts`.
 *
 * These patterns short-circuit dead WordPress/WooCommerce crawl traffic before
 * a Vercel Function is invoked (see the GONE_PATHS comment for the cost
 * rationale). The risk they carry is a FALSE POSITIVE: a pattern that is one
 * character too greedy would start returning 410 Gone for a live storefront
 * route, which is a silent revenue outage that no test elsewhere would catch.
 *
 * The `MUST_PASS` list therefore matters more than `SHOULD_BLOCK` — it pins the
 * near-miss cases (`/pages`, `/homepage`, `/page-not-a-number`) that a naive
 * `/^\/page/` would wrongly swallow.
 */
import { isGonePath as isGone } from './legacyPaths';

describe('legacyPaths / GONE_PATHS', () => {
  describe('blocks dead WordPress paths', () => {
    it.each([
      ['/wp-admin/setup-config.php'],
      ['/wp-content/uploads/2021/09/Fire4X4.jpg'],
      ['/wp-includes/wlwmanifest.xml'],
      ['/wp-json/oembed/1.0/embed'],
      ['/wp-login.php'],
      ['/xmlrpc.php'],
      ['/index.php'],
      ['/feed'],
      ['/feed/'],
    ])('410s %s', p => expect(isGone(p)).toBe(true));

    // The two highest-volume offenders in production Observability (2026-08-08):
    // /page/2/ at 691 req/12h and /page/1/ at 545 req/12h.
    it.each([
      ['/page/1/'],
      ['/page/2/'],
      ['/page/10/'],
      ['/page/13'],
      ['/shop/page/2/'],
      ['/shop/page/3/'],
    ])('410s legacy pagination %s', p => expect(isGone(p)).toBe(true));
  });

  describe('never blocks live routes', () => {
    it.each([
      ['/'],
      ['/products'],
      ['/products/some-brake-pad'],
      ['/cart'],
      ['/checkout'],
      ['/consultation'],
      ['/categories/interior'],
      ['/categories/exterior'],
      ['/blog'],
      ['/blog/gallery'],
      ['/media'],
      ['/careers'],
      ['/account'],
      ['/orders'],
      ['/login'],
      ['/admin/seo'],
      ['/model/toyota'],
      ['/sitemap.xml'],
      ['/robots.txt'],
      ['/api/v1/cart'],
      ['/_next/static/chunks/main.js'],
      ['/ingest/static/surveys.js'],
      // A published blog post served by the root catch-all route.
      ['/best-car-accessories-2026'],
    ])('allows %s', p => expect(isGone(p)).toBe(false));

    // Near-misses for the pagination pattern — these must NOT be swallowed.
    // `/shop` and `/model/[slug]/page/[page]` are REAL routes in the build
    // manifest; the latter is the dangerous one, since it contains a literal
    // `page/<n>` segment and differs from the blocked pattern only by not being
    // anchored at the start of the path.
    it.each([
      ['/pages'],
      ['/page-not-a-number'],
      ['/homepage'],
      ['/page/abc'],
      ['/shop'],
      ['/model/toyota-hilux/page/2'],
      ['/model/toyota-hilux/page/2/'],
    ])('allows near-miss %s', p => expect(isGone(p)).toBe(false));
  });
});
