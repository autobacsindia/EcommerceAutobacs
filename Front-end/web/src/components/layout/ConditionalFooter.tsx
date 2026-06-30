'use client';

import { usePathname } from 'next/navigation';
import Footer from './Footer';

/**
 * Renders Footer only on non-auth, non-admin pages.
 * The redesigned home page (`/`) ships its own footer, so the global Footer is
 * suppressed there too.
 */
export default function ConditionalFooter() {
  const pathname = usePathname();
  const hide =
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/register' ||
    pathname?.startsWith('/admin');
  return hide ? null : <Footer />;
}
