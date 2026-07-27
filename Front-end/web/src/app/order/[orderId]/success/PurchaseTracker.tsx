'use client';

import { useEffect } from 'react';

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
  paymentStatus,
  orderStatus,
}: {
  orderId: string;
  purchase: PurchasePayload;
  paymentStatus?: string;
  orderStatus?: string;
}) {
  useEffect(() => {
    // Gate: only count captured payments.
    if (!isCapturedPurchase(orderId, paymentStatus, orderStatus)) return;

    const flagKey = `gtag_fired_${orderId}`;
    let alreadyFired = false;
    try {
      alreadyFired = sessionStorage.getItem(flagKey) === '1';
    } catch {
      // sessionStorage unavailable — fall through; the tag de-dups on
      // transaction_id server-side.
    }
    if (alreadyFired) return;

    if (typeof window === 'undefined' || typeof window.gtag !== 'function') {
      // gtag.js not loaded (id unset / blocked). Do NOT set the flag, so the
      // conversion can still fire on a later visit once the tag is available.
      return;
    }

    window.gtag('event', 'purchase', purchase);

    try {
      sessionStorage.setItem(flagKey, '1');
    } catch {
      /* ignore — best-effort de-dupe */
    }
    // Re-run when the order (route param) changes on a client-side navigation
    // between two success pages, which reuses this component without remounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  return null;
}
