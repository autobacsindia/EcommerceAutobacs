import type { Metadata } from 'next';

/**
 * /hilux-owners is reached by the QR printed on the Roavion thank-you card. It must
 * never be indexed: a search result would hand ₹5,000 off to everyone who searches for
 * a Hilux discount, not just the people we gave a card to.
 *
 * Same treatment as /festive and the retired /onam: kept OUT of the config-driven
 * PageSeo system on purpose (that system manages pages we WANT found, and an admin
 * override there could flip it to indexable). Paired with a disallow in robots.ts,
 * absent from sitemap.ts. A sibling layout carries the metadata because page.tsx is a
 * client component.
 */
export const metadata: Metadata = {
  title: 'Your Hilux Owner Offer',
  description: 'A thank-you offer for Toyota Hilux Revo and Travo owners.',
  robots: { index: false, follow: false, nocache: true },
};

export default function HiluxOwnersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
