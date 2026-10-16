'use client';

import { usePathname } from 'next/navigation';

/** Where the marketing team's copies of the admin marketing screens live. */
export const MARKETING_BASE = '/team/marketing';

/**
 * Which panel a shared admin screen is rendering in.
 *
 * The marketing screens (blog, SEO, coupons, campaigns, spin, banners, leads,
 * consultations) are the admin pages themselves, re-exported under
 * /team/marketing. They build their internal links from `base`, and hide
 * admin-only controls (deletes, links into orders/users/sales reps) when
 * `isAdmin` is false.
 *
 * Reading the path is enough: the /team layout redirects admins to /admin and
 * the /admin layout rejects non-admins, and the API enforces the same split on
 * every call — this only hides what would 403.
 */
export function usePanel(): { base: string; isAdmin: boolean } {
  const pathname = usePathname() ?? '';
  const isTeam = pathname === '/team' || pathname.startsWith('/team/');
  return { base: isTeam ? MARKETING_BASE : '/admin', isAdmin: !isTeam };
}
