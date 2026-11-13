// Single source of truth for article public URLs.
//
// Blog posts live at `/blog/<slug>` (moved from the site root in 2026-11; the old
// root URLs 301 here in one hop — see lib/legacyBlogSlugs.ts and middleware).
// News lives under the Media/Press section.
//
// Blog posts render at `app/blog/[slug]` (passing type "blogs"), so both "blog"
// and "blogs" must be treated as blog. The "news" branch is legacy (News was
// replaced by the Press Coverage page at /media) and kept only for defensive
// fallback.

import { SITE_URL } from '@/lib/siteUrl';

export type ArticleType = 'news' | 'blog' | 'blogs' | string;

/**
 * Real pages under /blog that a post's slug must never shadow. Static routes win
 * over `blog/[slug]` in Next, so a post with one of these slugs would be
 * unreachable. The backend refuses to create them (Back-end/server/utils/blogSlug.js
 * keeps the same list) — keep the two in step.
 */
export const RESERVED_BLOG_SLUGS: ReadonlySet<string> = new Set(['gallery', 'videos']);

function isBlog(type: ArticleType): boolean {
  return type === 'blog' || type === 'blogs';
}

/** Site-relative path of a blog post. */
export function blogPostPath(slug: string): string {
  return `/blog/${slug}`;
}

/** Absolute URL of a blog post: canonical, og:url, JSON-LD, sitemap. */
export function blogPostUrl(slug: string, siteUrl: string = SITE_URL): string {
  return `${siteUrl}${blogPostPath(slug)}`;
}

/** Public URL for a single article. */
export function articleHref(type: ArticleType, slug: string): string {
  return isBlog(type) ? blogPostPath(slug) : `/media/news/${slug}`;
}

/** Public URL for the article's listing/section. */
export function articleListHref(type: ArticleType): string {
  return isBlog(type) ? '/blog' : '/media/news';
}

/** Public URL for a tag-filtered listing. */
export function tagHref(type: ArticleType, tag: string): string {
  return `${articleListHref(type)}?search=${encodeURIComponent(tag)}`;
}

const OWN_HOSTS = new Set(['autobacsindia.com', 'www.autobacsindia.com']);

/**
 * An admin canonical override that still points at the post's OLD root URL
 * (`https://autobacsindia.com/<slug>`, www or apex, with or without a trailing
 * slash) would tell Google the real page is the one that now 301s here. Such an
 * override is read as "this post's own URL" and replaced with the new /blog URL.
 * Any other override is returned unchanged.
 */
export function fixLegacyBlogCanonical(
  override: string | null | undefined,
  slug: string,
  siteUrl: string = SITE_URL,
): string | null | undefined {
  if (!override || !override.trim()) return override;
  let url: URL;
  try {
    url = new URL(override.trim(), 'https://www.autobacsindia.com');
  } catch {
    return override;
  }
  const hosts = new Set(OWN_HOSTS);
  try {
    hosts.add(new URL(siteUrl).hostname.toLowerCase());
  } catch {
    /* malformed site URL adds nothing */
  }
  if (!hosts.has(url.hostname.toLowerCase())) return override;
  const path = url.pathname.replace(/\/+$/, '').toLowerCase();
  return path === `/${slug.toLowerCase()}` ? blogPostUrl(slug, siteUrl) : override;
}
