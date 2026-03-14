'use client';

import { usePathname } from 'next/navigation';
import Footer from './Footer';

/** Renders Footer only on non-auth, non-admin pages. */
export default function ConditionalFooter() {
  const pathname = usePathname();
  const hide = pathname === '/login' || pathname === '/register' || pathname?.startsWith('/admin');
  return hide ? null : <Footer />;
}
