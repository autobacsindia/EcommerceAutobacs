import { Metadata } from 'next';
import ClientPage from './ClientPage';
import { getServerApiBase } from '@/lib/server-api';

async function getProductForMetadata(slug: string) {
  try {
    // Try slug-based lookup first (SEO canonical URL)
    const slugRes = await fetch(`${getServerApiBase()}/products/slug/${encodeURIComponent(slug)}`, { next: { revalidate: 3600 } });
    if (slugRes.ok) {
      const data = await slugRes.json();
      return data.product;
    }
    // Fallback: legacy ObjectId URL (e.g. old bookmarks / internal admin links)
    const idRes = await fetch(`${getServerApiBase()}/products/${slug}`, { next: { revalidate: 3600 } });
    if (!idRes.ok) return null;
    const data = await idRes.json();
    return data.product;
  } catch (error) {
    console.error('Metadata fetch error:', error);
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductForMetadata(slug);

  if (!product) {
    return {
      title: 'Product Not Found | Autobacs India',
    }
  }

  const title = `${product.name} | Autobacs India`;
  const description = product.description 
    ? product.description.substring(0, 160).replace(/\n/g, ' ') 
    : 'Shop premium automotive accessories, body kits, and performance parts at Autobacs India.';

  const images = [];
  if (product.images && product.images.length > 0) {
    if (typeof product.images[0] === 'string') {
        images.push(product.images[0]);
    } else if (product.images[0].url) {
        images.push(product.images[0].url);
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
