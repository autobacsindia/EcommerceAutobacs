'use client';

import { useEffect } from 'react';

/**
 * Google Ads `purchase` conversion payload — GA4/Ads item schema.
 * Built server-side (in page.tsx) so all currency math (paise→rupee) lives in
 * one place; this component only fires it.
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

/**
 * Fires the Google Ads `purchase` conversion exactly once per order.
 *
 * Idempotency: a `gtag_fired_${orderId}` sessionStorage flag survives page
 * refreshes within the tab, so a reload of the confirmation page never
 * double-counts the conversion. (The tab-scoped flag is the pragmatic guard the
 * spec asked for; true cross-device de-duplication would need a server-side
 * "conversion sent" flag on the order — noted as a follow-up.)
 */
export default function PurchaseTracker({
  orderId,
  purchase,
}: {
  orderId: string;
  purchase: PurchasePayload;
}) {
  useEffect(() => {
    const flagKey = `gtag_fired_${orderId}`;

    let alreadyFired = false;
    try {
      alreadyFired = sessionStorage.getItem(flagKey) === '1';
    } catch {
      // sessionStorage unavailable (private mode / SSR mismatch) — fall through
      // and fire; the tag layer itself de-dupes on transaction_id server-side.
    }
    if (alreadyFired) return;

    if (typeof window === 'undefined' || typeof window.gtag !== 'function') {
      // gtag.js not loaded (e.g. NEXT_PUBLIC_GOOGLE_ADS_ID unset / blocked).
      // Do NOT set the flag, so the conversion can still fire on a later visit
      // once the tag is available.
      return;
    }

    window.gtag('event', 'purchase', purchase);

    try {
      sessionStorage.setItem(flagKey, '1');
    } catch {
      /* ignore — best-effort de-dupe */
    }
    // Fire once on mount. `purchase`/`orderId` are stable for a given page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
