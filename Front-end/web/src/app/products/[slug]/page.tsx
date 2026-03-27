import { Metadata } from 'next';
import ClientPage from './ClientPage';
import { getServerApiBase } from '@/lib/server-api';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://autobacsIndia.com';

async function getProductForMetadata(slug: string) {
  try {
    // Slug-only lookup — ObjectId URLs are permanently redirected by the backend
    const res = await fetch(`${getServerApiBase()}/products/slug/${encodeURIComponent(slug)}`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.product ?? null;
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

  // Build canonical URL — slug is the only identifier; no _id fallback
  const url = product.slug ? `${SITE_URL}/products/${product.slug}` : null;
  if (!url) {
    // Product predates slug generation — treat as unavailable for metadata
    return { title: 'Product | Autobacs India' };
  }

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
  const product = await getProductForMetadata(slug);

  // Build JSON-LD structured data for Google rich results
  const jsonLd = product?.slug ? {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.shortDescription || product.description || '',
    url: `${SITE_URL}/products/${product.slug}`,
    ...(product.images?.[0] && {
      image: typeof product.images[0] === 'string' ? product.images[0] : product.images[0]?.url,
    }),
    brand: product.brand
      ? { '@type': 'Brand', name: typeof product.brand === 'string' ? product.brand : product.brand.name }
      : undefined,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'INR',
      price: product.price,
      availability: product.stock > 0
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      url: `${SITE_URL}/products/${product.slug}`,
      seller: { '@type': 'Organization', name: 'Autobacs India' },
    },
  } : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <ClientPage slug={slug} />
    </>
  );
}
