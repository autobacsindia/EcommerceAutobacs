import { Metadata } from 'next';

// SEO: Prevent indexing but allow following links (preserves link equity)
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: true,
  },
};

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
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
