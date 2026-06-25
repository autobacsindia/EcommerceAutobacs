// Single source of truth for article public URLs.
//
// Blog posts are canonical at the SITE ROOT (`/<slug>`) — ADR-005 keeps the old
// WordPress permalink to preserve SEO, so blog links must point straight there
// (no `/media/...` redirect hop). News lives under the Media/Press section.
//
// Blog posts render at `app/[slug]` (passing type "blogs"), so both "blog" and
// "blogs" must be treated as blog. The "news" branch is legacy (News was replaced
// by the Press Coverage page at /media) and kept only for defensive fallback.

export type ArticleType = 'news' | 'blog' | 'blogs' | string;

function isBlog(type: ArticleType): boolean {
  return type === 'blog' || type === 'blogs';
}

/** Public URL for a single article. */
export function articleHref(type: ArticleType, slug: string): string {
  return isBlog(type) ? `/${slug}` : `/media/news/${slug}`;
}

/** Public URL for the article's listing/section. */
export function articleListHref(type: ArticleType): string {
  return isBlog(type) ? '/blog' : '/media/news';
}

/** Public URL for a tag-filtered listing. */
export function tagHref(type: ArticleType, tag: string): string {
  return `${articleListHref(type)}?search=${encodeURIComponent(tag)}`;
}
