import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';

// about-us is a client component, so its SEO metadata is provided here in a
// server layout (admin-managed via /admin/seo).
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/about-us', {
    title: 'About Us',
    description: 'Learn about Autobacs India — our story, mission, and the team behind India’s trusted auto accessories retailer.',
  });

export default function AboutUsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
