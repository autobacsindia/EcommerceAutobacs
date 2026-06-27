import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';

// The contact page itself is a client component, so its SEO metadata is
// provided here in a server layout (admin-managed via /admin/seo).
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/contact', {
    title: 'Contact Us',
    description: 'Get in touch with Autobacs India — sales, support, and store enquiries.',
  });

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
