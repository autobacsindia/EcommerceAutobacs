import { cache } from 'react';
import { articleSlugForApi } from '@/lib/articleSlug';
import { internalApiHeaders } from '@/lib/server-api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

/**
 * A published BLOG article by slug, or null (missing, unpublished, not a blog
 * post, or the API failed). Shared by the post page (`app/blog/[slug]`) and the
 * root catch-all (`app/[slug]`), which only uses it to 301 a live post's old root
 * URL to /blog.
 *
 * Wrapped in React cache() per the frontend conventions: generateMetadata and
 * the page body both resolve the same slug, and this guarantees one upstream
 * call per request regardless of Next's fetch-memoization behaviour.
 */
export const fetchBlogArticle = cache(async function fetchBlogArticle(slug: string) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/media/articles/${articleSlugForApi(slug)}`, {
      headers: internalApiHeaders(),
      // Tagged so an admin publish/edit/delete refreshes this page immediately
      // via the backend revalidator, instead of waiting out the 60s window.
      // The tag is path-independent, so moving the page to /blog changed nothing
      // on the backend (utils/nextTags.js articleTags).
      next: { revalidate: 60, tags: [`blog:${slug.toLowerCase()}`] },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success || data.data?.type !== 'blog') return null;
    return data;
  } catch {
    return null;
  }
});
