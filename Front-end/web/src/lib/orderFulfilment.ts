/**
 * Split-shipment helpers for the customer UI (frontend mirror of the parts of
 * Back-end/server/utils/orderFulfilment.js that the browser needs).
 *
 * Only the delivery-date rules live here — the roll-up, the over-ship guard and the
 * fulfilment summary are server concerns and the server sends their results down.
 * Keep this file and its backend twin in step; the return window depends on both
 * agreeing about when an item arrived.
 */

export interface ShipmentSummary {
  _id?: string;
  status: 'packed' | 'shipped' | 'delivered' | 'lost';
  lines?: Array<{ itemId: string; quantity: number }>;
  includesReward?: boolean;
  deliveredAt?: string | null;
}

export interface FulfilmentOrder {
  shipments?: ShipmentSummary[];
  deliveredAt?: string | null;
  fulfillmentMetrics?: { deliveredAt?: string | null };
}

/**
 * When did THIS line arrive?
 *
 * The return window runs from delivery, and with several parcels a single order-level
 * date is wrong for at least one line: item A arrives Monday, item B the next Friday.
 * Using the order's date would either run A's window long or expire B's before the
 * customer ever held it.
 *
 * Legacy orders (no parcels) fall back to the order-level date, so nothing about a
 * historical order changes. Where a line was split across parcels that landed on
 * different days the LATEST wins — the customer did not hold the full quantity until
 * then, and an ambiguous date should favour the buyer.
 */
export const deliveredAtForItem = (
  order: FulfilmentOrder,
  itemId: string,
): Date | null => {
  const shipments = order?.shipments || [];
  const times = shipments
    .filter((s) =>
      s.status === 'delivered' &&
      s.deliveredAt &&
      (s.lines || []).some((l) => String(l.itemId) === String(itemId)))
    .map((s) => new Date(s.deliveredAt as string).getTime());

  if (times.length) return new Date(Math.max(...times));
  if (shipments.length) return null; // a live split order: this line has not arrived

  const fallback = order?.deliveredAt || order?.fulfillmentMetrics?.deliveredAt;
  return fallback ? new Date(fallback) : null;
};

/** Fractional days since a date — the window is a continuous cutoff, never floored. */
export const daysSince = (date: Date): number =>
  (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);

/**
 * Is this specific line inside its return window?
 *
 * @param windowDays RETURN_WINDOW_DAYS from lib/constants (mirrors the signed policy)
 */
export const canReturnItem = (
  order: FulfilmentOrder,
  itemId: string,
  windowDays: number,
): boolean => {
  const deliveredAt = deliveredAtForItem(order, itemId);
  return Boolean(deliveredAt) && daysSince(deliveredAt as Date) <= windowDays;
};
