/**
 * Blog posts live at /blog/<slug> on the storefront (moved from the site root in
 * 2026-11). Some names under /blog are real pages, and Next's static routes win
 * over the post route, so a post given one of these slugs would be unreachable.
 *
 * Keep in step with RESERVED_BLOG_SLUGS in Front-end/web/src/lib/articleRoutes.ts.
 */
export const RESERVED_BLOG_SLUGS = Object.freeze(['gallery', 'videos']);

export const isReservedBlogSlug = (slug) =>
  RESERVED_BLOG_SLUGS.includes(String(slug ?? '').toLowerCase());

/** A reserved slug gets "-2" appended; anything else is returned unchanged. */
export const unreservedBlogSlug = (slug) => (isReservedBlogSlug(slug) ? `${slug}-2` : slug);
