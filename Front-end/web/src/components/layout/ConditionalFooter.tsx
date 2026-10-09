'use client';

import { usePathname } from 'next/navigation';
import StoreFooter from '@/components/home/store/StoreFooter';

/**
 * Global storefront footer — the light store footer with the green band, on every
 * storefront page including the home page (which no longer ships its own copy).
 * Suppressed on the auth pages, `/admin/*` and the team panel.
 */
export default function ConditionalFooter() {
  const pathname = usePathname();
  // Trailing-slash-safe match: `skipTrailingSlashRedirect` (next.config.ts)
  // serves `/careers/` verbatim, so an exact `=== '/careers'` check would miss
  // it and render a second global footer under the page's own. Keep this in
  // sync with ConditionalHeader.
  const path = pathname?.replace(/\/+$/, '') || '/';
  const hide =
    path === '/login' ||
    path === '/register' ||
    path.startsWith('/admin') ||
    path === '/team' || path.startsWith('/team/');

  if (hide) return null;

  return <StoreFooter />;
}
