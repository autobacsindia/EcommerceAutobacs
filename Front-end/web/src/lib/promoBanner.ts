import { serverFetch } from '@/lib/server-api';

/**
 * Server-side read of the site-wide promo banner.
 *
 * Fetched on the server, not in the browser, for two reasons: the strip sits at
 * the very top of the page, so a client fetch would pop it in after paint and
 * shove the whole page down (CLS on every route); and a per-visitor request for
 * a value identical for everyone is wasted traffic.
 *
 * Tagged `promo:banner` so an admin toggling a campaign purges it within seconds
 * via the backend's revalidateFrontendTags — the `revalidate` window below is
 * only the fallback for when that call cannot be delivered.
 */

/**
 * Pixel dimensions accompany every url because the strip sizes itself from the
 * artwork's own aspect ratio rather than cropping to a fixed height. They are
 * nullable: a row created before the upload flow captured them, or a url typed
 * in by hand, has none, and the component falls back to the slot's spec ratio.
 */
export interface PromoBanner {
  id: string;
  /** Desktop artwork (≥1024px) — also the server-side fallback for the two below. */
  imageUrl: string;
  imageWidth: number | null;
  imageHeight: number | null;
  /** Tablet artwork (640–1023px). Already defaulted to `imageUrl` by the API. */
  tabletImageUrl: string;
  tabletImageWidth: number | null;
  tabletImageHeight: number | null;
  /** Mobile artwork (<640px). Already defaulted to `imageUrl` by the API. */
  mobileImageUrl: string;
  mobileImageWidth: number | null;
  mobileImageHeight: number | null;
  alt: string;
  linkPath: string;
}

interface PromoBannerResponse {
  success: boolean;
  banner: PromoBanner | null;
}

/** Fallback refresh when on-demand revalidation can't reach us. */
const REVALIDATE_SECONDS = 300;

/**
 * The banner to render, or null when no campaign is scheduled.
 *
 * Never throws. This is decoration mounted in the root layout — a backend blip
 * must degrade to "no banner", not take down every page on the site. The
 * distinction matters here more than in a normal data fetch: a throw in a layout
 * is not recoverable by the page below it.
 */
export async function getActivePromoBanner(): Promise<PromoBanner | null> {
  try {
    const res = await serverFetch<PromoBannerResponse>('/promo-banners/active', {
      next: { tags: ['promo:banner'], revalidate: REVALIDATE_SECONDS },
    });
    return res?.banner ?? null;
  } catch {
    return null;
  }
}
