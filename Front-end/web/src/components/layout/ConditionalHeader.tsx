'use client';

import { usePathname } from 'next/navigation';
import Header from './Header';
import type { NavCategory } from '@/lib/navCategories';

/** Renders Header only on non-auth, non-admin pages. */
export default function ConditionalHeader({ navCategories }: { navCategories: NavCategory[] }) {
  const pathname = usePathname();
  const hide = pathname === '/login' || pathname === '/register' || pathname?.startsWith('/admin');
  return hide ? null : <Header navCategories={navCategories} />;
}
