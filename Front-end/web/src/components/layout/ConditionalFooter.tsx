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
  const hide =
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/register' ||
    pathname?.startsWith('/admin');

  if (hide) return null;

  return (
    <div className="hr">
      <RedesignFooter />
    </div>
  );
}
