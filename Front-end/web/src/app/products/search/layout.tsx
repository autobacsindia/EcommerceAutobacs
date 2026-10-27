import type { Metadata } from 'next';

/**
 * Internal search results are never indexed: every typed term is a new, thin,
 * duplicate URL. `follow` stays on so the products they link to are still found.
 * robots.ts deliberately ALLOWS the crawl: a Disallow would hide this noindex from
 * Google and keep the URLs indexed. The middleware also sends it as X-Robots-Tag.
 */
export const metadata: Metadata = {
  title: 'Search results',
  robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
};

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
