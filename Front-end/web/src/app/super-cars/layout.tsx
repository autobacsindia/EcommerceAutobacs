import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';

// /super-cars is a client component, so its SEO metadata is provided here in a
// server layout. Managed via /admin/seo (override -> this fallback -> site
// default); the fallback copy mirrors config/staticPages.js.
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/super-cars', {
    title: 'Supercar Upgrades',
    description: 'Essential upgrades for supercar owners — performance exhausts, suspension, brakes, aerodynamics and interior work from Autobacs India.',
  });

export default function SuperCarsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
