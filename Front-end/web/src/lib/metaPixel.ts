/**
 * Meta (Facebook/Instagram) Pixel config + client-side event helpers.
 *
 * The Pixel id is PUBLIC (it appears in page source) — not a secret — but is
 * env-driven so non-prod deploys (Vercel Preview / local) can leave it unset and
 * therefore NOT fire events into the live dataset. The base loader lives in
 * app/layout.tsx; this module only decides whether it's enabled and provides
 * typed `track` helpers whose `content_ids` MATCH the catalogue feed (the backend
 * hands each product a ready-made `metaContentId`, so we never re-derive the id).
 *
 * Purchase is deduped with the server-side Conversions API (metaCapiService.js)
 * by passing eventID = order id on BOTH sides — Meta counts the pair once.
 *
 * Set per environment (build-time baked, redeploy after change):
 *   NEXT_PUBLIC_META_PIXEL_ID   e.g. "1234567890"
 */

export const META_PIXEL_ID = (process.env.NEXT_PUBLIC_META_PIXEL_ID || '').trim();

/** True only when a real numeric pixel id is configured. Gates the base loader. */
export const isMetaPixelEnabled = /^\d{5,}$/.test(META_PIXEL_ID);

type Fbq = (
  action: string,
  event: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string }
) => void;

declare global {
  interface Window {
    fbq?: Fbq;
  }
}

/** Safe wrapper — no-op when the Pixel isn't loaded (unset id / blocked). */
export function trackMeta(
  event: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string }
): void {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
  window.fbq('track', event, params, options);
}

/** All money is RUPEES (Order/Product store rupees) — never divide by 100. */
const CURRENCY = 'INR';

export function trackViewContent(contentId: string, value?: number): void {
  if (!contentId) return;
  trackMeta('ViewContent', {
    content_type: 'product',
    content_ids: [contentId],
    currency: CURRENCY,
    ...(value != null ? { value } : {}),
  });
}

export function trackAddToCart(contentId: string, value?: number, quantity = 1): void {
  if (!contentId) return;
  trackMeta('AddToCart', {
    content_type: 'product',
    content_ids: [contentId],
    contents: [{ id: contentId, quantity }],
    currency: CURRENCY,
    ...(value != null ? { value } : {}),
  });
}

export interface MetaPurchaseItem {
  id: string;
  quantity: number;
  item_price?: number;
}

export function trackPurchase(
  orderId: string,
  items: MetaPurchaseItem[],
  value: number
): void {
  const contentIds = items.map((i) => i.id).filter(Boolean);
  trackMeta(
    'Purchase',
    {
      content_type: 'product',
      content_ids: contentIds,
      contents: items.filter((i) => i.id),
      currency: CURRENCY,
      value,
    },
    { eventID: orderId } // dedup key shared with server CAPI
  );
}
