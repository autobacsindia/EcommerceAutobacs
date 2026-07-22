'use client';

import { usePathname } from 'next/navigation';
import RedesignFooter from '@/components/home/redesign/RedesignFooter';
import '@/components/home/redesign/home-redesign.css';

/**
 * Global storefront footer — the redesigned obsidian+gold footer (wrapped in the
 * `.hr` scope its styles need). Suppressed on `/` (HomeRedesign ships its own),
 * the auth pages, and `/admin/*`.
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
    path.startsWith('/admin');

  if (hide) return null;

  return (
    <div className="hr">
      <RedesignFooter />
    </div>
  );
}
