import type { Metadata } from 'next';

/**
 * The festive landing page is a PRIVATE offer for invited customers, reached only by
 * the QR code printed on a thank-you card. It must never be indexed: a search result
 * for "autobacs festive offer" would hand the doorway to everyone, and while the email
 * allowlist still blocks redemption, a public page advertising a private reward is a
 * support and goodwill problem.
 *
 * Deliberately NOT wired into the config-driven PageSeo system: that system exists to
 * manage the metadata of pages we WANT found. This one is paired with a matching
 * disallow in robots.ts and is absent from sitemap.ts.
 *
 * A sibling layout carries the metadata because page.tsx is a client component.
 */
export const metadata: Metadata = {
  title: 'Your Festive Reward | Autobacs India',
  description: 'A private thank-you offer for invited Autobacs India customers.',
  robots: { index: false, follow: false, nocache: true },
};

export default function FestiveLayout({ children }: { children: React.ReactNode }) {
  return children;
}
