import { Metadata } from 'next';
import ClientPage from './ClientPage';
import { getServerApiBase } from '@/lib/server-api';

async function getCategoryForMetadata(slug: string) {
  try {
    const res = await fetch(`${getServerApiBase()}/categories/slug/${slug}`, { next: { revalidate: 3600 } });
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

  const title = `${category.name} | Autobacs India`;
  const description = category.description 
    ? category.description.substring(0, 160).replace(/\n/g, ' ') 
    : `Shop ${category.name} at Autobacs India. Best prices on premium automotive accessories.`;

  const images = [];
  if (category.image) {
      if (typeof category.image === 'string') {
          images.push(category.image);
      } else if (category.image.url) {
          images.push(category.image.url);
      }
  }

  return {
    title,
    description,
    openGraph: {
       title,
       description,
       images,
       type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title,
        description,
        images,
    }
  }
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ClientPage slug={slug} />;
}
