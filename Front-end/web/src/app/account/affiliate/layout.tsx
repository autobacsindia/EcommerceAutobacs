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

/**
 * Forces this segment to render dynamically — a SECURITY pairing, not a
 * performance choice.
 *
 * The segment is listed in lib/cspRoutes.ts STRICT_CSP_PREFIXES, so middleware
 * serves it a per-request nonce CSP. A nonce cannot exist in prerendered HTML:
 * Next would otherwise prerender these pages happily (they are client
 * components with no server-side dynamic API), producing a CSP that names a
 * nonce no script carries — which under 'strict-dynamic' blocks EVERY script on
 * the page while the build and the tests stay green.
 *
 * ⚠ It MUST live in this server layout. `export const dynamic` in a 'use client'
 * page.tsx is silently IGNORED by Next 15.5 — verified on a production build:
 * the pages stayed `○ Static` with the export present.
 *
 * Little is lost: these pages are per-user and fetch their content on the
 * client, so a cached shell saves a paint, not a round trip.
 *
 * src/app/cspRoutePairing.test.ts enforces the pairing against the build
 * manifest. Do not remove this without removing the route from that list.
 */
export const dynamic = 'force-dynamic';
