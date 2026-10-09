'use client';

import { usePathname } from 'next/navigation';
import StoreHeader from '@/components/home/store/StoreHeader';
import type { NavCategory } from '@/lib/navCategories';

/**
 * Global storefront header — the light store's dark header + green department bar
 * (components/home/store/StoreHeader), the same one the home page renders.
 *
 * Suppressed on:
 *  - `/`                → the home page ships its own header
 *  - `/careers`         → standalone recruiting landing ships its own header
 *  - `/login`, `/register` → minimal auth chrome
 *  - `/admin/*`         → admin has its own light-theme shell
 *
 * `navCategories` (the live category hubs, from the root layout) feed the green
 * department bar and the "All" menu.
 */
export default function ConditionalHeader({ navCategories }: { navCategories: NavCategory[] }) {
  const pathname = usePathname();
  // Normalise a trailing slash before matching. `next.config.ts` sets
  // `skipTrailingSlashRedirect`, so `/careers/` is served verbatim and
  // usePathname() returns it with the slash — an exact `=== '/careers'` check
  // would miss it and render the global nav on top of the page's own header
  // (the double-header bug). Collapse trailing slashes, keeping root as '/'.
  const path = pathname?.replace(/\/+$/, '') || '/';
  const hide =
    path === '/' ||
    path === '/careers' ||
    path === '/login' ||
    path === '/register' ||
    path.startsWith('/admin') ||
    path === '/team' || path.startsWith('/team/');

  if (hide) return null;

  return (
    <>
      {/* The same dark header + green department bar as the home page. It sits in
          normal flow (sticky on desktop), so no spacer is needed. */}
      {/* Target of the footer's "Back to top". Not on the header itself: the header is
          sticky, so the browser treats it as already in view and would not scroll. */}
      <span id="top" aria-hidden="true" />
      <div className="sh-theme sh-chrome">
        <StoreHeader categories={navCategories.map((c) => ({ name: c.label, href: c.href }))} />
      </div>
    </>
  );
}
