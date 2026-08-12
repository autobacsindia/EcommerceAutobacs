/**
 * The cache-tag prefix allowlist, shared by the /api/revalidate routes and the
 * drift-guard test.
 *
 * It lives in its own module (rather than in the route) so it can be imported
 * without dragging `next/cache` into a non-Next runtime.
 *
 * MUST stay in sync with ALLOWED_PREFIXES in the backend's
 * services/frontendRevalidator.js. Both sides filter and silently drop anything
 * outside the list, so a tag missing from either end doesn't error — it just
 * makes the page permanently unrevalidatable. Backend tag names are built in
 * Back-end/server/utils/nextTags.js.
 */
export const ALLOWED_PREFIXES = [
  'home:',
  'product:',
  'category:',
  'nav:',
  'seo:',
  'blog:',
  'careers:',
] as const;

export function isAllowedTag(tag: string): boolean {
  return ALLOWED_PREFIXES.some((p) => tag.startsWith(p));
}
