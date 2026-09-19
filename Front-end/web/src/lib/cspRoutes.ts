/**
 * Which routes get the strict, nonce-bearing CSP.
 *
 * Lives outside middleware.ts for the same reason lib/csp.ts does: importing
 * the middleware pulls in next/server, which needs Edge runtime globals and
 * cannot be loaded by Jest. This predicate is the one piece of that file worth
 * testing on its own — getting it wrong blacks out a page silently — so it has
 * to be importable. See src/app/cspRoutePairing.test.ts.
 */

/**
 * Routes that receive the STRICT, nonce-bearing CSP. Everything else gets the
 * public policy.
 *
 * ⚠ THE DEFAULT DIRECTION HERE IS A SAFETY PROPERTY, NOT A STYLE CHOICE.
 * A nonce cannot exist in prerendered HTML. Serving the strict policy over a
 * static page therefore names a nonce that no script carries, 'strict-dynamic'
 * discards the 'self' fallback, and the browser blocks EVERY script on the
 * page — while the build, the tests and curl all look perfectly healthy.
 * Measured on the ISR spike.
 *
 * The inverse mistake is mild: a dynamic route served the public policy simply
 * has a weaker CSP. So the list is opt-IN, and a route may only be added here
 * once it is certain to be dynamically rendered. src/app/cspRoutePairing.test.ts
 * enforces exactly that against the build's prerender manifest.
 *
 * Every entry below is a cookie-reading or client-only route that Next cannot
 * statically render. `/login` and `/register` are deliberately ABSENT: they
 * prerender, so they must take the public policy despite being auth screens.
 */
const STRICT_CSP_PREFIXES = [
  '/checkout',
  '/account',
  '/orders',
  '/profile',
  '/wishlist',
  '/cart',
  '/admin',
];

/** True when this path is dynamically rendered and may carry a per-request nonce. */
export const isStrictCspPath = (pathname: string): boolean =>
  STRICT_CSP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
