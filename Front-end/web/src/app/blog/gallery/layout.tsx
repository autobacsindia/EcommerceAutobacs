import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';

// /blog/gallery is a client component, so its SEO metadata is provided here in a
// server layout. Managed via /admin/seo (override -> this fallback -> site
// default); the fallback copy mirrors config/staticPages.js.
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/blog/gallery', {
    title: 'Photo Gallery',
    description: 'Photographs of completed builds, fitment work and premium automotive accessories from Autobacs India.',
  });

export default function BlogGalleryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
