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
 *  - `/login`, `/register` → minimal auth chrome
 *  - `/admin/*`         → admin has its own light-theme shell
 *
 * `navCategories` is accepted for API compatibility with the previous Header
 * (the redesign nav sources its vehicle menu independently).
 */
export default function ConditionalHeader({ navCategories: _navCategories }: { navCategories: NavCategory[] }) {
  const pathname = usePathname();
  const hide =
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/register' ||
    pathname?.startsWith('/admin');

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
