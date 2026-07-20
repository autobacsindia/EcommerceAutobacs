import { Metadata } from 'next';
import { cache } from 'react';
import ClientPage from './ClientPage';
import { getServerApiBase } from '@/lib/server-api';
import { isOutOfStock, getStockStatus } from '@/lib/stock';
import { resolveSeo } from '@/lib/seo';
import { SITE_URL } from '@/lib/siteUrl';

// JSON.stringify does not escape < > & so a product field containing </script>
// would break out of the script tag. Unicode-escape these three characters so
// the HTML parser never sees them — JSON parsers decode \uXXXX correctly.
function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

// Wrapped in React cache() so generateMetadata and the page component (which
// both need the product) share ONE fetch per request instead of two.
const getProductForMetadata = cache(async (slug: string) => {
  try {
    // Slug-only lookup — ObjectId URLs are permanently redirected by the backend
    // revalidate 60s: keeps the page cached but shrinks the window between an
    // admin SEO/content edit and it appearing publicly (was 3600 = up to 1h).
    const res = await fetch(`${getServerApiBase()}/products/slug/${encodeURIComponent(slug)}`, { next: { revalidate: 60, tags: [`product:${slug}`] } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.product ?? null;
  } catch (error) {
    console.error('Metadata fetch error:', error);
    return null;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductForMetadata(slug);

  if (!product) {
    return {
      title: 'Product Not Found | Autobacs India',
    }
  }

  // Build canonical URL — slug is the only identifier; no _id fallback
  const url = product.slug ? `${SITE_URL}/products/${product.slug}` : null;
  if (!url) {
    // Product predates slug generation — treat as unavailable for metadata
    return { title: 'Product | Autobacs India' };
  }

  // Computed defaults derived from the product. These apply whenever the admin
  // has not set a corresponding `seo.*` override — so a brand-new product is
  // fully SEO-complete with zero extra steps.
  const computedDescription = product.shortDescription
    ? product.shortDescription.substring(0, 160).replace(/\n/g, ' ')
    : product.description
      ? product.description.substring(0, 160).replace(/\n/g, ' ')
      : 'Shop premium automotive accessories, body kits, and performance parts.';

  // Layer admin SEO overrides on top of the computed defaults (override →
  // default → site default) via the shared resolver.
  const seo = resolveSeo(product.seo, {
    title: product.name,
    description: computedDescription,
    url,
    image: product.images?.[0] ? (typeof product.images[0] === 'string' ? product.images[0] : product.images[0]?.url) : undefined,
  });

  const title = seo.title;
  const description = seo.description;

  // Build OG image list with width/height for richer previews. seo.ogImage is
  // already the resolved choice (override if set, else the primary image).
  const ogImages: { url: string; width: number; height: number; alt: string }[] = [];
  if (seo.ogImage) {
    ogImages.push({ url: seo.ogImage, width: 1200, height: 630, alt: product.name });
  }

  // Price for open-graph product metadata
  const price: string | undefined = product.price != null
    ? String(Number(product.price).toFixed(2))
    : undefined;

  // OG/Twitter need a plain string; seo.title may be an { absolute } object
  // when the admin set a full meta title.
  const ogTitle = typeof title === 'string' ? title : title.absolute;

  return {
    title,
    description,
    alternates: { canonical: seo.canonical },
    ...(seo.robots && { robots: seo.robots }),
    openGraph: {
      title: ogTitle,
      description,
      url: seo.canonical,
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
      title: ogTitle,
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
    '@id': `${SITE_URL}/products/${product.slug}#product`,  // Entity ID for deduplication
    mainEntityOfPage: {  // Links product to this page
      '@type': 'WebPage',
      '@id': `${SITE_URL}/products/${product.slug}`,
    },
    name: product.name,
    description: product.seo?.metaDescription || product.shortDescription || product.description || '',
    url: `${SITE_URL}/products/${product.slug}`,  // Canonical URL (matches @id base)
    
    // Multiple images preferred by Google (≥ 1200px width)
    ...(product.images && product.images.length > 0 && {
      image: product.images
        .map((img: any) => typeof img === 'string' ? img : img?.url)
        .filter(Boolean)
        .slice(0, 8),  // Google recommends up to 8 images
    }),
    
    ...(product.sku && { sku: product.sku }),
    brand: product.brand
      ? { '@type': 'Brand', name: typeof product.brand === 'string' ? product.brand : product.brand.name }
      : undefined,
    
    // Aggregate ratings (ONLY if real reviews exist and are displayed on page).
    // Field names match the Product schema: averageRating / totalReviews.
    ...(product.averageRating > 0 && product.totalReviews > 0 && {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: product.averageRating,
        reviewCount: product.totalReviews,
        bestRating: 5,
        worstRating: 1,
      },
    }),
    
    offers: {
      '@type': 'Offer',
      priceCurrency: 'INR',
      price: product.price,
      availability: isOutOfStock(product)
        ? 'https://schema.org/OutOfStock'
        : getStockStatus(product) === 'backorder'
          ? 'https://schema.org/BackOrder'
          : 'https://schema.org/InStock',
      url: `${SITE_URL}/products/${product.slug}`,
      seller: { '@type': 'Organization', name: 'Autobacs India' },
      
      // Item condition (new/used/refurbished)
      itemCondition: 'https://schema.org/NewCondition',  // Default for new products
      
      // Only include priceValidUntil for ACTUAL sales/discounts with end date
      ...(product.originalPrice && product.originalPrice > product.price && product.offerEndDate && {
        priceValidUntil: new Date(product.offerEndDate).toISOString().split('T')[0],
      }),
    },
  } : null;

  // Build breadcrumb schema for enhanced search navigation
  const breadcrumbSchema = product?.slug ? {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    '@id': `${SITE_URL}/products/${product.slug}#breadcrumb`,  // Entity ID
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: SITE_URL,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Products',
        item: `${SITE_URL}/products`,
      },
      ...(product.category ? [{
        '@type': 'ListItem',
        position: 3,
        name: typeof product.category === 'string' ? product.category : product.category.name,
        item: `${SITE_URL}/categories/${typeof product.category === 'string' ? product.category : product.category.slug}`,
      }] : []),
      {
        '@type': 'ListItem',
        position: product.category ? 4 : 3,
        name: product.name,
      },
    ],
  } : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      )}
      {breadcrumbSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbSchema) }}
        />
      )}
      <ClientPage slug={slug} initialProduct={product} />
    </>
  );
}
