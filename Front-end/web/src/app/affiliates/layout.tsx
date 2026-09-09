import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/pageSeo';

// /affiliates is a client component (it holds a form), so its SEO metadata is provided
// here in a server layout. Managed via /admin/seo (override -> this fallback -> site
// default); the fallback copy mirrors Back-end/server/config/staticPages.js.
//
// Deliberately INDEXED, unlike /festive and /onam: recruiting affiliates is a public
// goal, so this page belongs in the sitemap. The affiliate's own dashboard at
// /account/affiliate is the private half and is disallowed in robots.ts.
export const generateMetadata = (): Promise<Metadata> =>
  buildPageMetadata('/affiliates', {
    title: 'Affiliate Program',
    description:
      'Earn commission promoting Autobacs India. Share your link or code, your audience saves on car accessories and performance parts, and you get paid on every delivered order.',
  });

export default function AffiliatesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
