import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';

// /brands is a client component, so its SEO metadata is provided here in a server
// layout. Scoped to the (list) group so it never reaches /brands/[slug], which
// builds its own. Managed via /admin/seo (override -> this fallback -> site default).
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/brands', {
    title: 'Brands',
    description: 'Shop premium automotive accessory brands at Autobacs India — off-road, lighting, body kits, suspension and performance parts.',
  });

export default function BrandsListLayout({ children }: { children: React.ReactNode }) {
  return children;
}
