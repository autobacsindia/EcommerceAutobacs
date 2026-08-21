import type { Metadata } from 'next';

/**
 * The festive landing page is reached by the QR code printed on a card. The offer
 * behind it is now PUBLIC — the campaign's audience is 'everyone', so anyone holding
 * the card, or a photo of it, can redeem — but public to cardholders is not the same as
 * wanting it in Google. Indexing it would hand the discount to everyone who searches
 * "autobacs offer", including people who never received a card, and would keep drawing
 * traffic to a dead page long after the campaign is switched off.
 *
 * Abuse is bounded by the campaign's redemption cap, its verified-email requirement,
 * and the managed coupon's per-customer limit — not by how hard the page is to find.
 *
 * Deliberately NOT wired into the config-driven PageSeo system: that system exists to
 * manage the metadata of pages we WANT found. This one is paired with a matching
 * disallow in robots.ts and is absent from sitemap.ts.
 *
 * A sibling layout carries the metadata because page.tsx is a client component.
 */
export const metadata: Metadata = {
  title: 'Your Festive Reward | Autobacs India',
  description: 'A festive thank-you offer for Autobacs India customers.',
  robots: { index: false, follow: false, nocache: true },
};

export default function FestiveLayout({ children }: { children: React.ReactNode }) {
  return children;
}
