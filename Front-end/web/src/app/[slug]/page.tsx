import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ArticleDetailClient from '@/components/blog/ArticleDetailClient';
import { resolveSeo } from '@/lib/seo';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://autobacsindia.com';

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

async function fetchBlogArticle(slug: string) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/media/articles/${slug}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success || data.data?.type !== 'blog') return null;
    return data;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchBlogArticle(slug);
  if (!data) return { title: 'Not Found | Autobacs India' };

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
