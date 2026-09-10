import type { Metadata } from 'next';

/**
 * The affiliate's private dashboard.
 *
 * `noindex`, and `/account` is in robots.ts DISALLOW: this page shows one person's
 * earnings. The PUBLIC half of the programme — recruiting — lives at /affiliates, which
 * IS indexed and in the sitemap.
 *
 * Deliberately NOT wired into the config-driven PageSeo system. That system exists to
 * manage the metadata of pages we want found; there is nothing here for an admin to
 * tune, and adding it would put a private route into the SEO admin's page list.
 */
export const metadata: Metadata = {
  title: 'Affiliate Dashboard',
  description: 'Your affiliate link, referred orders and earnings.',
  robots: { index: false, follow: false },
};

export default function AccountAffiliateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
