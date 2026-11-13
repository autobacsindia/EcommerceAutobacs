import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ArticleDetailClient from '@/components/blog/ArticleDetailClient';
import { resolveSeo } from '@/lib/seo';
import { SITE_URL } from '@/lib/siteUrl';
import { fetchBlogArticle } from '@/lib/blogArticle';
import { blogPostUrl, fixLegacyBlogCanonical } from '@/lib/articleRoutes';

// JSON.stringify does not escape < > & — unicode-escape them so an article
// field containing </script> can't break out of the JSON-LD script tag.
function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

// Blog post page, /blog/<slug>. Moved here from the site root (/<slug>, the old
// WordPress permalink kept by ADR-005) in 2026-11. The old root URLs 301 here in
// ONE hop from middleware (lib/legacyBlogSlugs.ts + the rename map), with
// app/[slug] as a safety net. Only published BLOG articles resolve; everything
// else 404s. /blog/gallery and /blog/videos are static routes and win over this
// segment; the backend never gives a post one of those slugs.

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
  // This page used to be the root catch-all (it is now app/[slug], which keeps
  // the same guard): every unmatched single-segment URL a crawler invents lands
  // on it, and /blog/<anything> lands here. For years those went out as 200 + not-found
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
  const articleUrl = blogPostUrl(article.slug);

  // Layer admin SEO overrides on top of computed defaults (override → default →
  // site default). Returning a plain string title lets the root layout template
  // append " | Autobacs India" exactly once.
  // An override still naming the post's OLD root URL would point Google at a page
  // that now 301s here; it is read as the post's own URL (see the helper).
  const seo = resolveSeo({ ...article.seo, canonical: fixLegacyBlogCanonical(article.seo?.canonical, article.slug) }, {
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

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await fetchBlogArticle(slug);
  if (!data) return notFound();

  const article = data.data;
  const articleUrl = blogPostUrl(article.slug);
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
      { '@type': 'ListItem', position: 3, name: article.title, item: articleUrl },
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
