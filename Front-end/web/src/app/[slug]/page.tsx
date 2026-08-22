import { cache } from 'react';
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ArticleDetailClient from '@/components/blog/ArticleDetailClient';
import { resolveSeo } from '@/lib/seo';
import { SITE_URL } from '@/lib/siteUrl';
import { internalApiHeaders } from '@/lib/server-api';

// JSON.stringify does not escape < > & — unicode-escape them so an article
// field containing </script> can't break out of the JSON-LD script tag.
function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

// Root-level blog post route (ADR-005). WordPress served blog posts at the domain root
// (autobacsindia.com/<slug>), so we keep that exact path to preserve SEO with zero
// redirects. Only published BLOG articles resolve here; everything else 404s, and Next's
// named routes (/products, /cart, …) always take precedence over this catch-all.

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Wrapped in React cache() per the frontend conventions: generateMetadata and
// the page body both resolve the same slug, and this guarantees one upstream
// call per request regardless of Next's fetch-memoization behaviour.
const fetchBlogArticle = cache(async function fetchBlogArticle(slug: string) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/media/articles/${slug}`, {
      headers: internalApiHeaders(),
      // Tagged so an admin publish/edit/delete refreshes this page immediately
      // via the backend revalidator, instead of waiting out the 60s window.
      next: { revalidate: 60, tags: [`blog:${slug}`] },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success || data.data?.type !== 'blog') return null;
    return data;
  } catch {
    return null;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchBlogArticle(slug);

  // notFound() here rather than a "Not Found" title, so the not-found decision
  // is made as early as possible.
  //
  // This route is the root catch-all: every unmatched single-segment URL a
  // crawler invents lands on it. For years those went out as 200 + not-found
  // HTML (a soft 404 — Google indexes it, and it never shows up in 404 metrics,
  // which is why Observability reported zero 404s for this route).
  //
  // Cause, isolated by rebuilding with the file removed (2026-08-08): the root
  // `src/app/loading.tsx` wrapped the tree in a Suspense boundary, so Next
  // committed the status and started streaming before either this function or
  // the page body could throw. Measured, same build, only that file differing:
  //     with root loading.tsx      /zzz-nope → 200
  //     without root loading.tsx   /zzz-nope → 404
  //
  // That file is now GONE, along with `/products/loading.tsx`,
  // `/products/[slug]/loading.tsx` and `/categories/[slug]/loading.tsx`, which
  // soft-404'd their own segments for the same reason. ⚠️ Re-adding a
  // `loading.tsx` at the app root, or above any route that can 404, silently
  // restores the soft 404 — nothing else in the app will complain.
  // src/app/soft404.test.ts fails if one reappears.
  //
  // The edge-level 410 blocklist in lib/legacyPaths.ts still runs first and is
  // still worth keeping: it answers the high-volume dead WordPress paths without
  // ever invoking a Function.
  if (!data) notFound();

  const article = data.data;
  const articleUrl = `${SITE_URL}/${article.slug}`;

  // Layer admin SEO overrides on top of computed defaults (override → default →
  // site default). Returning a plain string title lets the root layout template
  // append " | Autobacs India" exactly once.
  const seo = resolveSeo(article.seo, {
    title: article.title,
    description: article.excerpt || `Read ${article.title} on Autobacs India.`,
    url: articleUrl,
    image: article.coverImage || `${SITE_URL}/og-default.jpg`,
  });

  const ogTitle = typeof seo.title === 'string' ? seo.title : seo.title.absolute;
  const ogImage = seo.ogImage || `${SITE_URL}/og-default.jpg`;

  return {
    title: seo.title,
    description: seo.description,
    authors: [{ name: article.author || 'Autobacs Team' }],
    ...(seo.robots && { robots: seo.robots }),
    openGraph: {
      title: ogTitle,
      description: seo.description,
      url: seo.canonical,
      siteName: 'Autobacs India',
      images: [{ url: ogImage, width: 1200, height: 630, alt: article.title }],
      type: 'article',
      publishedTime: article.publishedAt,
      authors: [article.author],
      tags: article.tags,
      section: 'Blog',
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: seo.description,
      images: [ogImage],
      site: '@autobacsindia',
    },
    alternates: {
      canonical: seo.canonical,
    },
  };
}

export default async function RootBlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await fetchBlogArticle(slug);
  if (!data) return notFound();

  const article = data.data;
  const articleUrl = `${SITE_URL}/${article.slug}`;
  const image = article.seo?.ogImage || article.coverImage || `${SITE_URL}/og-default.jpg`;

  // Article structured data → eligible for Google article rich results.
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': `${articleUrl}#article`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrl },
    headline: article.title,
    description: article.seo?.metaDescription || article.excerpt || '',
    image: [image],
    url: articleUrl,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt || article.publishedAt,
    author: { '@type': 'Organization', name: article.author || 'Autobacs Team' },
    publisher: {
      '@type': 'Organization',
      name: 'Autobacs India',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/og-image.jpg` },
    },
    ...(Array.isArray(article.tags) && article.tags.length > 0 && { keywords: article.tags.join(', ') }),
  };

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    '@id': `${articleUrl}#breadcrumb`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/blog` },
      { '@type': 'ListItem', position: 3, name: article.title },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(articleSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbSchema) }}
      />
      <ArticleDetailClient
        article={data.data}
        related={data.related || []}
        type="blogs"
      />
    </>
  );
}
