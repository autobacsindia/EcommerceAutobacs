import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';

// /offers is a client component, so its SEO metadata is provided here in a
// server layout. Managed via /admin/seo (override -> this fallback -> site
// default); the fallback copy mirrors config/staticPages.js.
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/offers', {
    title: 'Offers & Deals',
    description: 'Current deals and discounted prices on automotive accessories, body kits and performance parts at Autobacs India.',
  });

export default function OffersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
