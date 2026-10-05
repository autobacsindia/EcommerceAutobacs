import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';

// /vehicles is a client component, so its SEO metadata is provided here in a
// server layout. It lives in the (index) route group — the URL is still /vehicles —
// so this metadata does NOT cascade into /vehicles/[make] and /vehicles/[make]/[model].
// Managed via /admin/seo (override -> this fallback -> site default).
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/vehicles', {
    title: 'Shop by Vehicle',
    description: 'Find accessories and performance parts for your car — browse Autobacs India by vehicle make and model.',
  });

export default function VehiclesIndexLayout({ children }: { children: React.ReactNode }) {
  return children;
}
