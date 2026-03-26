import { Metadata } from 'next';
import ClientPage from './ClientPage';
import { getServerApiBase } from '@/lib/server-api';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://autobacsIndia.com';

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
  const description = product.shortDescription
    ? product.shortDescription.substring(0, 160).replace(/\n/g, ' ')
    : product.description
      ? product.description.substring(0, 160).replace(/\n/g, ' ')
      : 'Shop premium automotive accessories, body kits, and performance parts at Autobacs India.';

  // Build canonical URL
  const canonicalSlug = product.slug || slug;
  const url = `${SITE_URL}/products/${canonicalSlug}`;

  // Build OG image list with width/height for richer previews
  const ogImages: { url: string; width: number; height: number; alt: string }[] = [];
  if (product.images && product.images.length > 0) {
    const img = product.images[0];
    const imgUrl = typeof img === 'string' ? img : img?.url;
    if (imgUrl) {
      ogImages.push({ url: imgUrl, width: 1200, height: 630, alt: product.name });
    }
  }

  // Price for open-graph product metadata
  const price: string | undefined = product.price != null
    ? String(Number(product.price).toFixed(2))
    : undefined;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: 'website',          // 'product' is not an official OG type; 'website' + og:price works for WhatsApp/Facebook
      images: ogImages,
      siteName: 'Autobacs India',
      ...(price && {
        // Facebook / WhatsApp pick up og:price:amount and og:price:currency
        // Next.js Metadata doesn't have typed fields for these, so we add via 'other'
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ogImages.map(i => i.url),
      site: '@AutobacsIndia',
    },
    // og:price:amount / og:price:currency — passed via the 'other' field
    ...(price && {
      other: {
        'og:price:amount': price,
        'og:price:currency': 'INR',
        'product:price:amount': price,
        'product:price:currency': 'INR',
      },
    }),
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ClientPage slug={slug} />;
}
