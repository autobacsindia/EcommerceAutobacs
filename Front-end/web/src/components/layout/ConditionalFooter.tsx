'use client';

import { usePathname } from 'next/navigation';
import StoreFooter from '@/components/home/store/StoreFooter';

/**
 * Global storefront footer — the light store footer with the green band, the same
 * one the home page renders. Suppressed on `/` (the home page ships its own), the
 * auth pages, careers, `/admin/*` and the team panel.
 */
export default function ConditionalFooter() {
  const pathname = usePathname();
  // Trailing-slash-safe match: `skipTrailingSlashRedirect` (next.config.ts)
  // serves `/careers/` verbatim, so an exact `=== '/careers'` check would miss
  // it and render a second global footer under the page's own. Keep this in
  // sync with ConditionalHeader.
  const path = pathname?.replace(/\/+$/, '') || '/';
  const hide =
    path === '/' ||
    path === '/careers' ||
    path === '/login' ||
    path === '/register' ||
    path.startsWith('/admin') ||
    path === '/team' || path.startsWith('/team/');

  if (hide) return null;

  return <StoreFooter />;
}
