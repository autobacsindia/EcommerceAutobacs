'use client';

import { usePathname } from 'next/navigation';
import RedesignNav from '@/components/home/redesign/RedesignNav';
import '@/components/home/redesign/home-redesign.css';
import type { NavCategory } from '@/lib/navCategories';

/**
 * Global storefront nav. Renders the redesigned obsidian+gold nav (wrapped in the
 * `.hr` scope its styles need) on every storefront page, plus a spacer that
 * offsets content below the fixed 76px bar (64px on mobile).
 *
 * Suppressed on:
 *  - `/`                → the home page ships its own nav inside HomeRedesign
 *  - `/careers`         → standalone recruiting landing ships its own header
 *  - `/login`, `/register` → minimal auth chrome
 *  - `/admin/*`         → admin has its own light-theme shell
 *
 * `navCategories` is accepted for API compatibility with the previous Header
 * (the redesign nav sources its vehicle menu independently).
 */
export default function ConditionalHeader({ navCategories: _navCategories }: { navCategories: NavCategory[] }) {
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
    path.startsWith('/admin');

  if (hide) return null;

  return (
    <>
      <div className="hr">
        <RedesignNav />
      </div>
      {/* Spacer: the nav is position:fixed, so reserve its height in flow. */}
      <div className="h-16 md:h-[76px] shrink-0" aria-hidden />
    </>
  );
}
