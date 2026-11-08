import { serverFetch } from '@/lib/server-api';
import { API_ENDPOINTS } from '@/lib/constants';

/**
 * The festival switch as the storefront receives it (GET /festival-theme/active).
 * Null = off (or already ended). A theme switched on but not yet started still
 * arrives, so a cached page can turn itself on at `startsAt`.
 */
export interface PublicFestivalTheme {
  themeKey: string;
  startsAt: string | null;
  endsAt: string | null;
  live: boolean;
}

const REVALIDATE_SECONDS = 300;

/**
 * Live at `now`? Start inclusive, end exclusive — the same rule as the backend.
 * Evaluated again on the visitor's clock, so a cached "on" can never outlive the
 * end date the admin set.
 */
export function isFestivalLive(theme: PublicFestivalTheme | null, now: number = Date.now()): boolean {
  if (!theme) return false;
  const start = theme.startsAt ? Date.parse(theme.startsAt) : NaN;
  const end = theme.endsAt ? Date.parse(theme.endsAt) : NaN;
  if (!Number.isNaN(start) && start > now) return false;
  if (!Number.isNaN(end) && end <= now) return false;
  return true;
}

/** Milliseconds until the theme next flips (start or end), or null if never. */
export function msUntilNextBoundary(theme: PublicFestivalTheme | null, now: number = Date.now()): number | null {
  if (!theme) return null;
  const times = [theme.startsAt, theme.endsAt]
    .map((t) => (t ? Date.parse(t) : NaN))
    .filter((t) => !Number.isNaN(t) && t > now);
  return times.length ? Math.min(...times) - now : null;
}

/**
 * Routes where festive decoration and effects never appear: the staff/admin
 * panels, sign-in, and the whole money path (nothing may sit in front of checkout
 * or payment).
 */
export function isFestiveRoute(pathname: string | null | undefined): boolean {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  return !(
    path === '/login' ||
    path === '/register' ||
    path.startsWith('/checkout') ||
    path.startsWith('/payment') ||
    path === '/admin' || path.startsWith('/admin/') ||
    path === '/team' || path.startsWith('/team/')
  );
}

/** The staff panels: no decoration and the normal mouse, but a gentle sparkle trail. */
export function isStaffPanelRoute(pathname: string | null | undefined): boolean {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  return path === '/admin' || path.startsWith('/admin/') || path === '/team' || path.startsWith('/team/');
}

/**
 * Server-side read for the root layout. Never throws — decoration must degrade
 * to "no festival", never take the layout down.
 */
export async function getFestivalTheme(): Promise<PublicFestivalTheme | null> {
  try {
    const res = await serverFetch<{ success: boolean; theme: PublicFestivalTheme | null }>(
      API_ENDPOINTS.FESTIVAL_THEME_ACTIVE,
      { next: { tags: ['promo:festival-theme'], revalidate: REVALIDATE_SECONDS } },
    );
    return res?.theme ?? null;
  } catch {
    return null;
  }
}
