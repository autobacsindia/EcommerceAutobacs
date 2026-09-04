import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';

// /consultation is a client component, so its SEO metadata is provided here in a
// server layout. Managed via /admin/seo (override -> this fallback -> site
// default); the fallback copy mirrors config/staticPages.js.
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/consultation', {
    title: 'Book a Consultation',
    description: 'Build your upgrade profile and get a personalised consultation from the Autobacs India team on parts, fitment and custom builds.',
  });

export default function ConsultationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
