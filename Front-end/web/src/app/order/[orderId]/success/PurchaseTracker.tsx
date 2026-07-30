'use client';

import { useEffect } from 'react';
import { trackPurchase, type MetaPurchaseItem } from '@/lib/metaPixel';

/**
 * Google Ads `purchase` conversion payload — GA4/Ads item schema.
 * Built server-side (see purchase.ts) so all currency math lives in one place;
 * this component only decides whether/when to fire it.
 */
export interface PurchasePayload {
  /** Google Ads conversion action target ("AW-XXXX/LABEL"). Absent in non-prod. */
  send_to?: string;
  transaction_id: string;
  value: number;
  currency: string;
  items: Array<{
    item_id: string;
    item_name: string;
    price: number;
    quantity: number;
  }>;
}

// Order/payment states that mean NO money was captured — never a conversion.
const NON_CAPTURED_ORDER_STATUS = ['cancelled', 'failed', 'returned'];
const NON_CAPTURED_PAYMENT_STATUS = ['failed', 'cancelled'];

function hasJustPaidMarker(orderId: string): boolean {
  // Set by useRazorpay right after a verified payment — means "this session just
  // paid for this order" (the webhook confirmation may still be in flight).
  try {
    return !!sessionStorage.getItem(`awaitingPaymentConfirmation:${orderId}`);
  } catch {
    return false;
  }
}

/**
 * Whether this order is a captured sale we should count as a conversion.
 *
 * Fires ONLY for genuinely-paid orders — never for awaiting_payment, cancelled,
 * or failed. This stops a direct visit to `/order/<id>/success` for an unpaid
 * order (bookmark, refresh, shared link) from logging a phantom conversion.
 */
function isCapturedPurchase(orderId: string, paymentStatus?: string, orderStatus?: string): boolean {
  const status = (orderStatus || '').toLowerCase();
  const payment = (paymentStatus || '').toLowerCase();
  if (NON_CAPTURED_ORDER_STATUS.includes(status)) return false;
  if (NON_CAPTURED_PAYMENT_STATUS.includes(payment)) return false;
  // 'paid' = server-confirmed capture; the marker = client just completed
  // Razorpay verify-payment (the normal redirect, before the webhook lands).
  return payment === 'paid' || hasJustPaidMarker(orderId);
}

/**
 * Fires the Google Ads `purchase` conversion exactly once per paid order.
 *
 * Idempotency: a `gtag_fired_${orderId}` sessionStorage flag survives page
 * refreshes within the tab, so a reload never double-counts. (Tab-scoped;
 * true cross-device de-dup would need a server-side "conversion sent" flag on
 * the order — noted as a follow-up.)
 */
export default function PurchaseTracker({
  orderId,
  purchase,
  metaItems,
  metaValue,
  paymentStatus,
  orderStatus,
}: {
  orderId: string;
  purchase: PurchasePayload;
  /** Meta Pixel Purchase line items (content_ids matching the catalogue feed). */
  metaItems?: MetaPurchaseItem[];
  /** Order total in RUPEES for the Meta Purchase value. */
  metaValue?: number;
  paymentStatus?: string;
  orderStatus?: string;
}) {
  useEffect(() => {
    // Gate: only count captured payments. Shared by both trackers.
    if (!isCapturedPurchase(orderId, paymentStatus, orderStatus)) return;

    const fireOnce = (flagKey: string, fire: () => void, isLoaded: () => boolean) => {
      let already = false;
      try { already = sessionStorage.getItem(flagKey) === '1'; } catch { /* no storage */ }
      if (already) return;
      // Not loaded (id unset / blocked): do NOT set the flag, so it can still
      // fire on a later visit once the tag is available. Both platforms also
      // de-dup server-side (gtag on transaction_id; Meta on eventID).
      if (!isLoaded()) return;
      fire();
      try { sessionStorage.setItem(flagKey, '1'); } catch { /* best-effort */ }
    };

    // Google Ads purchase conversion.
    fireOnce(
      `gtag_fired_${orderId}`,
      () => window.gtag!('event', 'purchase', purchase),
      () => typeof window !== 'undefined' && typeof window.gtag === 'function'
    );

    // Meta Pixel Purchase — eventID = orderId dedupes it with the server CAPI event.
    if (metaItems && metaItems.length > 0) {
      fireOnce(
        `metapixel_fired_${orderId}`,
        () => trackPurchase(orderId, metaItems, Number(metaValue) || 0),
        () => typeof window !== 'undefined' && typeof window.fbq === 'function'
      );
    }
    // Re-run when the order (route param) changes on a client-side navigation
    // between two success pages, which reuses this component without remounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  return null;
}
