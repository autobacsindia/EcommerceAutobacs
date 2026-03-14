'use client';

import { usePathname } from 'next/navigation';
import Header from './Header';

/** Renders Header only on non-auth, non-admin pages. */
export default function ConditionalHeader() {
  const pathname = usePathname();
  const hide = pathname === '/login' || pathname === '/register' || pathname?.startsWith('/admin');
  return hide ? null : <Header />;
}
