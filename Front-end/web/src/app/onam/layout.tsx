import type { Metadata } from 'next';

/**
 * The Onam landing page is reached by scanning the QR printed on the counter card.
 * It must never be indexed: it advertises an in-store price on goods that are not in
 * the catalogue, so a search result for it would promise the whole internet something
 * only a customer standing in the shop can actually be given.
 *
 * Deliberately NOT wired into the config-driven PageSeo system, for the same reason
 * /festive is not: that system manages the metadata of pages we WANT found. This one
 * is paired with a matching disallow in robots.ts and is absent from sitemap.ts.
 *
 * A sibling layout carries the metadata because page.tsx is a client component.
 */
export const metadata: Metadata = {
  title: 'Your Onam Offer | Autobacs India',
  description: 'An in-store Onam offer for Autobacs India customers.',
  robots: { index: false, follow: false, nocache: true },
};

export default function OnamLayout({ children }: { children: React.ReactNode }) {
  return children;
}
