import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';

// /media is a client component, so its SEO metadata is provided here in a
// server layout. Managed via /admin/seo (override -> this fallback -> site
// default); the fallback copy mirrors config/staticPages.js.
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/media', {
    title: 'Press & Media',
    description: 'Autobacs India in the press — coverage of our $1M revenue milestone, structured import model and the premium automotive aftermarket.',
  });

export default function MediaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
