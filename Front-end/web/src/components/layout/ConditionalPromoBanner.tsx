'use client';

import { usePathname } from 'next/navigation';
import PromoBanner from './PromoBanner';
import { useRewardRibbonClaimsSlot } from '@/hooks/useRewardRibbon';
import type { PromoBanner as PromoBannerData } from '@/lib/promoBanner';

/**
 * Route gate for the site-wide promo strip.
 *
 * Mirrors ConditionalHeader: the banner belongs on storefront pages and nowhere
 * else. It is a client component only because Next gives a layout no way to read
 * the current path on the server — the banner DATA is still fetched server-side
 * and passed in, so nothing here costs a request or delays first paint.
 *
 * Suppressed on:
 *  - `/`                   → the home page mounts the banner itself, below the
 *                            hero. Its nav is `position: fixed` and lives inside
 *                            HomeRedesign, so a strip rendered from the layout
 *                            would sit underneath that bar.
 *  - `/admin/*`            → internal tooling; marketing chrome is noise there
 *  - `/login`, `/register` → minimal auth chrome, and a promo mid-signin is a
 *                            distraction on a conversion-critical screen
 *  - `/checkout`, `/cart`  → never advertise a way OUT of an in-progress
 *                            purchase. This is the one placement rule here with
 *                            revenue attached.
 */
export default function ConditionalPromoBanner({ banner }: { banner: PromoBannerData | null }) {
  const pathname = usePathname();

  /**
   * Stand down for the campaign reward ribbon.
   *
   * Both bars want the strip under the nav, and stacking them pushes the page
   * down while asking the shopper to weigh two different offers at once. The
   * ribbon wins because it is the only on-screen proof of a discount a customer
   * was personally emailed about; this one is marketing that can wait. The rule
   * itself lives in the hook so neither component can drift from the other.
   */
  const rewardRibbonShowing = useRewardRibbonClaimsSlot();

  // Normalise a trailing slash before matching: next.config.ts sets
  // `skipTrailingSlashRedirect`, so '/cart/' is served verbatim and an exact
  // === '/cart' test would miss it (the same trap ConditionalHeader documents).
  const path = pathname?.replace(/\/+$/, '') || '/';

  const hide =
    path === '/' ||
    path === '/login' ||
    path === '/register' ||
    path === '/cart' ||
    path.startsWith('/checkout') ||
    path.startsWith('/admin');

  if (hide || rewardRibbonShowing) return null;

  return <PromoBanner banner={banner} />;
}
