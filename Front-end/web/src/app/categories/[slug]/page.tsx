import { Metadata } from 'next';
import ClientPage from './ClientPage';
import { getServerApiBase } from '@/lib/server-api';
import { resolveSeo } from '@/lib/seo';
import { SITE_URL } from '@/lib/siteUrl';

async function getCategoryForMetadata(slug: string) {
  try {
    const res = await fetch(`${getServerApiBase()}/categories/slug/${slug}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.success && data.category) {
        return data.category;
    }
    return null;
  } catch (error) {
    console.error('Metadata fetch error:', error);
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryForMetadata(slug);

  if (!category) {
    return {
      title: 'Category Not Found | Autobacs India',
    }
  }

  const computedDescription = category.description
    ? category.description.substring(0, 160).replace(/\n/g, ' ')
    : `Shop ${category.name} at Autobacs India - Premium automotive accessories, body kits, and performance parts for Indian vehicles. Free shipping across India.`;

  const defaultImage = category.image
    ? (typeof category.image === 'string' ? category.image : category.image.url)
    : undefined;

  // Layer admin SEO overrides over computed defaults. Plain-string default title
  // lets the root layout template append " | Autobacs India" exactly once.
  const seo = resolveSeo(category.seo, {
    title: category.name,
    description: computedDescription,
    url: `${SITE_URL}/categories/${slug}`,
    image: defaultImage,
  });

  const ogTitle = typeof seo.title === 'string' ? seo.title : seo.title.absolute;
  const images = seo.ogImage ? [seo.ogImage] : [];

  return {
    title: seo.title,
    description: seo.description,
    ...(seo.robots && { robots: seo.robots }),
    alternates: { canonical: seo.canonical },
    openGraph: {
       title: ogTitle,
       description: seo.description,
       url: seo.canonical,
       images,
       type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: ogTitle,
        description: seo.description,
        images,
    }
  }
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ClientPage slug={slug} />;
}
