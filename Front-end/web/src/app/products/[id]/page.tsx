import { Metadata } from 'next';
import ClientPage from './ClientPage';
import { getServerApiBase } from '@/lib/server-api';

async function getProductForMetadata(id: string) {
  try {
    const res = await fetch(`${getServerApiBase()}/products/${id}`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.product;
  } catch (error) {
    console.error('Metadata fetch error:', error);
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const product = await getProductForMetadata(id);

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

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientPage id={id} />;
}
