/**
 * Dead WooCommerce/WordPress paths, answered at the edge with 410 Gone.
 *
 * Post-cutover these are pure crawler noise — measured 2026-08-08 over 12h of
 * production Observability: 2,453 `/_not-found` hits, of which `/page/2/` (691)
 * and `/page/1/` (545) alone were half. Every one of them booted a Vercel
 * Function to render a 404 document, billing Function Invocations, Fluid Active
 * CPU and an Observability Event. Short-circuiting in middleware keeps them on
 * the (included-tier) Edge Request meter instead of the (paid) Function meters.
 *
 * 410 rather than 404 on purpose: these pages are permanently gone, and 410 gets
 * them dropped from Google's index materially faster than a 404. They are
 * paginated archive URLs with no unique content, so there is no link equity
 * worth preserving via a 301.
 *
 * Vercel WAF rules cover the same ground one layer earlier (before middleware
 * runs at all) and are strictly cheaper — this is the in-code backstop so the
 * behaviour is versioned, reviewable and survives a dashboard change.
 *
 * Lives in its own module rather than inside `middleware.ts` so it is unit
 * testable: importing the middleware pulls in `next/server` and the ESM-only
 * `jose`, neither of which Jest can load without transform surgery.
 *
 * ⚠️ The danger with these patterns is a FALSE POSITIVE — one character too
 * greedy and a live storefront route starts returning 410, a silent revenue
 * outage. Any edit here must keep `legacyPaths.test.ts` green.
 */
export const GONE_PATHS: RegExp[] = [
  /^\/wp-(admin|content|includes|json|login)(\/|$|\.)/,
  /^\/(shop\/)?page\/\d+\/?$/,
  /\.php$/,
  /^\/xmlrpc/,
  /^\/feed\/?$/,
];

/** True when `pathname` is a permanently-removed legacy WordPress URL. */
export function isGonePath(pathname: string): boolean {
  return GONE_PATHS.some(re => re.test(pathname));
}
