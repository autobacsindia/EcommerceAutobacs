import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';
import ArticleListPage, { type Article, type Pagination } from '../media/ArticleListPage';
import { API_ENDPOINTS } from '@/lib/constants';
import { getServerApiBase } from '@/lib/server-api';

// Wired into the config-driven SEO system (admin override -> this fallback -> site
// default). The old hand-written metadata set no canonical, so /blog and every
// /blog?search=… variant inherited the root layout's homepage canonical, and its
// title repeated the suffix the root template already appends.
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/blog', {
    title: 'Blog',
    description: 'Expert automotive tips, guides and insights from Autobacs India.',
  });

/**
 * Page one comes from the server. Fetched in the browser it could not even start
 * until the JavaScript had run: 3 seconds in, on a mid-range phone on 4G. A failure
 * here is not an error: the list falls back to fetching for itself.
 */
async function firstPage() {
  try {
    const res = await fetch(`${getServerApiBase()}${API_ENDPOINTS.MEDIA_ARTICLES}?type=blog&page=1&limit=12`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { success?: boolean; data?: Article[]; pagination?: Pagination };
    return body.success && body.data ? { articles: body.data, pagination: body.pagination ?? null } : undefined;
  } catch (error) {
    console.error('[blog/page] server fetch failed:', error);
    return undefined;
  }
}

export default async function BlogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { page, category, search } = await searchParams;
  // Any filter or later page is the browser's to fetch: this seed is the plain list.
  const initial = !page && !category && !search ? await firstPage() : undefined;
  return <ArticleListPage type="blog" initial={initial} />;
}
