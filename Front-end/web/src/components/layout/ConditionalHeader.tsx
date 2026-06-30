'use client';

import { usePathname } from 'next/navigation';
import Header from './Header';
import type { NavCategory } from '@/lib/navCategories';

/**
 * Renders Header only on non-auth, non-admin pages.
 * The redesigned home page (`/`) ships its own nav, so the global Header is
 * suppressed there too.
 */
export default function ConditionalHeader({ navCategories }: { navCategories: NavCategory[] }) {
  const pathname = usePathname();
  const hide =
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/register' ||
    pathname?.startsWith('/admin');
  return hide ? null : <Header navCategories={navCategories} />;
}
