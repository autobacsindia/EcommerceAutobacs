import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';

// The shipping page itself is a client component, so its SEO metadata is provided
// here in a server layout (admin-managed via /admin/seo). Without this the page
// inherits the root layout's title and ships as "ROAVION - Powered by AutoBacs
// India" — which is what it did in production, sharing one title with every
// other unwired page while /admin/seo happily stored overrides nothing read.
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/shipping', {
    title: 'Shipping & Delivery',
    description: 'Shipping options, timelines, and nationwide delivery information for Autobacs India orders.',
  });

export default function ShippingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
