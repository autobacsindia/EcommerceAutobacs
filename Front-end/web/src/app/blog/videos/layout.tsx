import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';

// /blog/videos is a client component, so its SEO metadata is provided here in a
// server layout. Managed via /admin/seo (override -> this fallback -> site
// default); the fallback copy mirrors config/staticPages.js.
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/blog/videos', {
    title: 'Videos',
    description: 'Video walkthroughs of builds, product fitment and premium automotive accessories from Autobacs India.',
  });

export default function BlogVideosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
