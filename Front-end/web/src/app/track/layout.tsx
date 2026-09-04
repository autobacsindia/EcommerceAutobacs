import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';

// The track page itself is a client component, so its SEO metadata is provided
// here in a server layout (admin-managed via /admin/seo). Without this the page
// inherits the root layout's title and ships as "ROAVION - Powered by AutoBacs
// India" — which is what it did in production, sharing one title with every
// other unwired page while /admin/seo happily stored overrides nothing read.
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/track', {
    title: 'Track Your Order',
    description: 'Track the status of your Autobacs India order in real time.',
  });

export default function TrackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
