import { notFound, permanentRedirect } from 'next/navigation';
import { fetchBlogArticle } from '@/lib/blogArticle';
import { blogPostPath } from '@/lib/articleRoutes';

/**
 * Root catch-all, `/<slug>` — the SAFETY NET for the 2026-11 move of blog posts
 * to /blog/<slug>.
 *
 * The real 301s happen earlier, in middleware: every one of the 64 posts that was
 * ever at the root is in lib/legacyBlogSlugs.ts, and a renamed post is in the
 * slug-history map. This page only catches what those miss — a published post
 * that was noindex (so not in the sitemap the list was built from), or a request
 * the middleware let through because the rename map could not load — and sends
 * it to /blog/<stored slug>.
 *
 * Note: Next's permanentRedirect() answers 308, not 301. Google treats the two
 * identically for ranking; middleware (the path almost every old URL takes)
 * sends a true 301.
 *
 * Anything that is not a published blog post 404s exactly as before. Next's named
 * routes (/products, /about-us, …) always take precedence over this segment.
 * No loading.tsx may sit above this file — see src/app/soft404.test.ts.
 */
async function resolve(params: Promise<{ slug: string }>): Promise<never> {
  const { slug } = await params;
  const data = await fetchBlogArticle(slug);
  if (!data) notFound();
  permanentRedirect(blogPostPath(data.data.slug));
}

// Decided in generateMetadata too, so the 404/redirect is settled before any
// streaming starts (same reason the post page does it).
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return resolve(params);
}

export default async function RootSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  return resolve(params);
}
