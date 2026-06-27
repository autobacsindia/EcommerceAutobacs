import type { Metadata } from 'next';
import { getServerApiBase } from '@/lib/server-api';
import { resolveSeo, type SeoOverrides } from '@/lib/seo';
import { SITE_URL } from '@/lib/siteUrl';

/**
 * Metadata builder for static, entity-less routes (careers, contact, legal…).
 *
 * Each such page wires a one-liner:
 *
 *   export const generateMetadata = () =>
 *     buildPageMetadata('/careers', { title: 'Careers', description: '…' });
 *
 * It fetches any admin overrides stored for that path (PageSeo) and layers them
 * over the page's own fallback copy via the shared `resolveSeo` precedence
 * (override → page fallback → site default). If the backend is unreachable the
 * fallback still produces correct metadata — the page never ends up bare.
 */

const DEFAULT_OG = `${SITE_URL}/og-image.jpg`;

async function fetchPageSeo(path: string): Promise<SeoOverrides | null> {
  try {
    const res = await fetch(`${getServerApiBase()}/page-seo?path=${encodeURIComponent(path)}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.seo ?? null;
  } catch {
    return null;
  }
}

export interface PageMetaFallback {
  /** Title WITHOUT the site suffix — the root layout template appends it. */
  title: string;
  description: string;
  image?: string;
}

export async function buildPageMetadata(path: string, fallback: PageMetaFallback): Promise<Metadata> {
  const overrides = await fetchPageSeo(path);
  const url = `${SITE_URL}${path === '/' ? '' : path}`;

  const seo = resolveSeo(overrides, {
    title: fallback.title,
    description: fallback.description,
    url,
    image: fallback.image || DEFAULT_OG,
  });

  const ogTitle = typeof seo.title === 'string' ? seo.title : seo.title.absolute;

  return {
    title: seo.title,
    description: seo.description,
    ...(seo.robots && { robots: seo.robots }),
    alternates: { canonical: seo.canonical },
    openGraph: {
      title: ogTitle,
      description: seo.description,
      url: seo.canonical,
      siteName: 'Autobacs India',
      type: 'website',
      ...(seo.ogImage && {
        images: [{ url: seo.ogImage, width: 1200, height: 630, alt: ogTitle }],
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: seo.description,
      ...(seo.ogImage && { images: [seo.ogImage] }),
    },
  };
}
