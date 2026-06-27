import type { Metadata } from 'next';
import { getServerApiBase } from '@/lib/server-api';
import { resolveSeo } from '@/lib/seo';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://autobacsindia.com';

// The brand page is a client component, so its SEO metadata is generated here in
// a server layout. Admin overrides (Brand.seo) are layered over computed
// defaults via the shared resolver.
async function getBrand(slug: string) {
  try {
    const res = await fetch(
      `${getServerApiBase()}/products/brands/${encodeURIComponent(slug)}/details`,
      { next: { revalidate: 300 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.brand ?? null;
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
  const brand = await getBrand(slug);
  if (!brand) return { title: 'Brand Not Found | Autobacs India' };

  const computedDescription = brand.description
    ? String(brand.description).substring(0, 160).replace(/\n/g, ' ')
    : `Shop ${brand.name} products at Autobacs India — premium automotive accessories and performance parts.`;

  // The details endpoint flattens logo to a URL string.
  const image = typeof brand.logo === 'string' ? brand.logo : brand.logo?.url;

  const seo = resolveSeo(brand.seo, {
    title: brand.name,
    description: computedDescription,
    url: `${SITE_URL}/brands/${slug}`,
    image,
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
      siteName: 'Autobacs India',
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: seo.description,
      images,
    },
  };
}

export default function BrandSlugLayout({ children }: { children: React.ReactNode }) {
  return children;
}
