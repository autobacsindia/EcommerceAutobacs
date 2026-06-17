import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ArticleDetailClient from '@/app/media/[type]/[slug]/ArticleDetailClient';

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
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://autobacsindia.com';
  const articleUrl = `${siteUrl}/${article.slug}`;
  const description = article.excerpt || `Read ${article.title} on Autobacs India.`;
  const image = article.coverImage || `${siteUrl}/og-default.jpg`;

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
      section: 'Blog',
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

export default async function RootBlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await fetchBlogArticle(slug);
  if (!data) return notFound();

  return (
    <ArticleDetailClient
      article={data.data}
      related={data.related || []}
      type="blogs"
    />
  );
}
