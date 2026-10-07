/**
 * The "Refund" badge on the admin orders list.
 *
 * An order's refund money lives in ONE of two places, and the badge must read the right one:
 *   - `refundDetails`       — a whole-order refund (order cancelled in one go)
 *   - `cancellations[].refund` — per-item refunds (order cancelled item by item)
 *
 * The list used to read only `refundDetails`. An order cancelled item by item has none,
 * so it read "Refund due" for ever — even after every item refund had completed.
 *
 * Display only: nothing here prices or sends money. Statuses come from the server.
 */

export interface RefundBadge {
  label: string;
  className: string;
}

export interface RefundBadgeOrder {
  status: string;
  paymentStatus?: string;
  refundDetails?: { status?: string; requestedAt?: string } | null;
  items?: Array<{ _id?: string; quantity?: number }>;
  cancellations?: Array<{
    lines?: Array<{ itemId: string; quantity: number }>;
    refund?: { status?: string } | null;
  }>;
}

const BADGE: Record<'refunded' | 'processing' | 'failed' | 'due', RefundBadge> = {
  refunded: { label: 'Refunded ✓', className: 'bg-green-100 text-green-800' },
  processing: { label: 'Refunding…', className: 'bg-blue-100 text-blue-800' },
  failed: { label: 'Refund failed', className: 'bg-red-100 text-red-800' },
  due: { label: 'Refund due', className: 'bg-yellow-100 text-yellow-800' },
};

/**
 * Units still live: ordered minus cancelled. A cancelled, paid order with live units and
 * no whole-order refund is one the old admin cancel left without refund records — money
 * is still owed for those units (the order page's Refund button repairs it).
 */
const hasUnrecordedUnits = (order: RefundBadgeOrder): boolean => {
  const cancelled = new Map<string, number>();
  for (const c of order.cancellations || []) {
    for (const l of c.lines || []) {
      cancelled.set(String(l.itemId), (cancelled.get(String(l.itemId)) || 0) + (l.quantity || 0));
    }
  }
  return (order.items || []).some(
    (i) => (i.quantity || 0) - (cancelled.get(String(i._id)) || 0) > 0,
  );
};

export function getRefundBadge(order: RefundBadgeOrder): RefundBadge | null {
  const refundStatus = order.refundDetails?.status;
  const lines = order.cancellations || [];

  // Order cancelled ITEM BY ITEM (and no whole-order refund on top): read the items.
  if (lines.length && !refundStatus) {
    const statuses = lines
      .map((c) => c.refund?.status)
      .filter((s): s is string => !!s && s !== 'not_applicable');
    const owesUnrecorded = order.status === 'cancelled'
      && order.paymentStatus === 'paid'
      && hasUnrecordedUnits(order);

    if (statuses.includes('failed')) return BADGE.failed;
    if (statuses.includes('pending') || owesUnrecorded) return BADGE.due;
    if (statuses.includes('processing')) return BADGE.processing;
    if (statuses.length && statuses.every((s) => s === 'completed')) return BADGE.refunded;
    return null; // unpaid order: the items simply died, nothing was owed
  }

  // Whole-order refund — unchanged behaviour.
  const isPaidCancellation = order.status === 'cancelled'
    && (order.paymentStatus === 'paid' || order.paymentStatus === 'refunded');
  if (order.paymentStatus === 'refunded' || refundStatus === 'completed') return BADGE.refunded;
  if (refundStatus === 'processing') return BADGE.processing;
  if (refundStatus === 'failed') return BADGE.failed;
  if (isPaidCancellation) return BADGE.due;
  return null;
}
