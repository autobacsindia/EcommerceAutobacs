import type { Metadata } from 'next';

/**
 * Internal search results are never indexed: every typed term is a new, thin,
 * duplicate URL. `follow` stays on so the products they link to are still found.
 * robots.ts also keeps crawlers off /products/search.
 */
export const metadata: Metadata = {
  title: 'Search results',
  robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
};

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
