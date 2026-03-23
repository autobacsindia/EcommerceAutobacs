import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ArticleDetailClient from '@/app/media/[type]/[slug]/ArticleDetailClient';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

async function fetchArticle(slug: string) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/media/articles/${slug}`, {
      next: { revalidate: 60 }, // ISR: revalidate every 60s
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.success ? data : null;
  } catch {
    return null;
  }
}

// ── Dynamic SEO metadata ──────────────────────────────────────────────────────
export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchArticle(slug);
  if (!data) return { title: 'Article Not Found | Autobacs India' };

  const article = data.data;
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://autobacsindia.com';
  const articleUrl = `${siteUrl}/media/${article.type}/${article.slug}`;
  const description = article.excerpt || `Read ${article.title} on Autobacs India.`;
  const image = article.coverImage || `${siteUrl}/og-default.jpg`;
  const typeLabel = article.type === 'news' ? 'News' : 'Blog';

  return {
    title: `${article.title} | Autobacs India`,
    description,
    keywords: article.tags?.join(', '),
    authors: [{ name: article.author || 'Autobacs Team' }],
    openGraph: {
      title: article.title,
      description,
      url: articleUrl,
      siteName: 'Autobacs India',
      images: [{ url: image, width: 1200, height: 630, alt: article.title }],
      type: 'article',
      publishedTime: article.publishedAt,
      authors: [article.author],
      tags: article.tags,
      section: typeLabel,
    },
    twitter: {
      card: 'summary_large_image',
      title: article.title,
      description,
      images: [image],
      site: '@autobacsindia',
    },
    alternates: {
      canonical: articleUrl,
    },
  };
}

// ── Page component (Server) ───────────────────────────────────────────────────
export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ type: string; slug: string }>;
}) {
  const { type, slug } = await params;
  const data = await fetchArticle(slug);
  if (!data) return notFound();

  return (
    <ArticleDetailClient
      article={data.data}
      related={data.related || []}
      type={type}
    />
  );
}
