import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';

// The returns page itself is a client component, so its SEO metadata is provided
// here in a server layout (admin-managed via /admin/seo). Without this the page
// inherits the root layout's title and ships as "ROAVION - Powered by AutoBacs
// India" — which is what it did in production, sharing one title with every
// other unwired page while /admin/seo happily stored overrides nothing read.
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/returns', {
    title: 'Returns & Refunds',
    description: 'Our return and refund policy for automotive accessories purchased from Autobacs India.',
  });

export default function ReturnsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
