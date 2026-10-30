'use client';

/**
 * Every return raised on one order, each with its own progress — an order can have
 * several (one item now, another next week), so this replaces the old single
 * "Return Request" card that only ever mirrored the LATEST one.
 *
 * Reads GET /returns/my-returns?orderId= (the customer's own view: no staff notes,
 * no supplier claims). Amounts shown are the server's; nothing is computed here.
 */
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { API_ENDPOINTS, returnReasonLabel } from '@/lib/constants';
import { customerReturnKeys } from '@/hooks/queries/keys';
import { formatDateIST } from '@/lib/datetime';

export type CustomerReturnStatus =
  | 'pending' | 'approved' | 'courier_booked' | 'received' | 'refunded' | 'rejected' | 'cancelled';

export interface CustomerReturn {
  _id: string;
  status: CustomerReturnStatus;
  createdAt: string;
  rejectionReason: string | null;
  items: {
    orderItemId: string | null;
    product: { _id: string; name?: string } | string | null;
    quantity: number;
    reason: string;
    fault: 'ours' | 'customer';
  }[];
  courier: { provider?: string; trackingNumber: string } | null;
  pickupMode: string | null;
  inspection: { passed: boolean } | null;
  refund: { status: string; finalAmount: number | null; method?: string };
}

/** Statuses whose items are spoken for — mirrors config/returnPolicy.js RETURN_QUANTITY_CONSUMING_STATUSES. */
const CONSUMING: CustomerReturnStatus[] = ['pending', 'approved', 'courier_booked', 'received', 'refunded'];

const STEPS = ['Raised', 'Approved', 'Picked up', 'Checked', 'Refunded'] as const;

function stepReached(r: CustomerReturn): number {
  if (r.status === 'refunded' || r.refund.status === 'completed') return 5;
  if (r.inspection?.passed) return 4;
  if (r.status === 'received') return 3;
  if (r.status === 'approved' || r.status === 'courier_booked') return 2;
  return 1;
}

const STATUS_TEXT: Record<CustomerReturnStatus, string> = {
  pending: 'We are checking your photos',
  approved: 'Approved — we are arranging the pickup',
  courier_booked: 'Pickup booked',
  received: 'Reached us — being checked',
  refunded: 'Refunded',
  rejected: 'Not approved',
  cancelled: 'Cancelled',
};

export function useOrderReturns(orderId: string | undefined) {
  return useQuery({
    queryKey: customerReturnKeys.forOrder(orderId || ''),
    queryFn: () => apiClient.get<{ success: boolean; requests: CustomerReturn[] }>(
      `${API_ENDPOINTS.MY_RETURNS}?orderId=${encodeURIComponent(orderId || '')}`,
    ),
    enabled: Boolean(orderId),
  });
}

/**
 * Units of each order line already in a return that has not been rejected or
 * cancelled, keyed by order-line id (product id for older returns without one). The
 * server is the authority — this only keeps the form from offering what it would refuse.
 */
export function returnedUnits(requests: CustomerReturn[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of requests || []) {
    if (!CONSUMING.includes(r.status)) continue;
    for (const i of r.items) {
      const productId = typeof i.product === 'string' ? i.product : i.product?._id;
      const key = i.orderItemId || (productId ? `product:${productId}` : null);
      if (key) out.set(key, (out.get(key) || 0) + (Number(i.quantity) || 0));
    }
  }
  return out;
}

/** The tracker card. The page owns the query (useOrderReturns) and passes the list down. */
export default function OrderReturns({ requests, itemName }: {
  requests: CustomerReturn[] | undefined;
  itemName: (orderItemId: string | null, productId: string | null) => string;
}) {
  if (!requests?.length) return null;

  return (
    <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-6 mb-6" data-testid="order-returns">
      <h2 className="font-display font-bold text-orange-700 uppercase tracking-wide mb-4">
        {requests.length > 1 ? `Returns (${requests.length})` : 'Return'}
      </h2>
      <ul className="space-y-4">
        {requests.map((r) => {
          const reached = stepReached(r);
          const closed = r.status === 'rejected' || r.status === 'cancelled';
          return (
            <li key={r._id} className="rounded-lg border border-orange-500/20 bg-obsidian p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-display font-bold text-ink text-sm">
                  Return #{r._id.slice(-8).toUpperCase()} <span className="font-normal text-ink-muted">· raised {formatDateIST(r.createdAt)}</span>
                </p>
                <p className={`text-sm font-display font-bold ${closed ? 'text-red-600' : 'text-orange-700'}`}>{STATUS_TEXT[r.status] || r.status}</p>
              </div>
              <ul className="mt-2 space-y-0.5 text-sm text-ink/80">
                {r.items.map((i, k) => {
                  const productId = typeof i.product === 'string' ? i.product : i.product?._id || null;
                  const name = (typeof i.product === 'object' && i.product?.name) || itemName(i.orderItemId, productId);
                  return <li key={k}>{name} × {i.quantity} — {returnReasonLabel(i.reason)}</li>;
                })}
              </ul>
              {!closed && (
                <ol className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Return progress">
                  {STEPS.map((label, idx) => (
                    <li key={label} className={idx < reached ? 'font-semibold text-orange-700' : 'text-ink-muted'}>
                      {idx < reached ? '●' : '○'} {label}
                    </li>
                  ))}
                </ol>
              )}
              {r.status === 'rejected' && r.rejectionReason && (
                <p className="mt-2 text-sm text-ink/80">Why: {r.rejectionReason}</p>
              )}
              {r.inspection && !r.inspection.passed && (
                <p className="mt-2 text-sm text-ink/80">The item did not pass our check. We have emailed you the details.</p>
              )}
              {r.courier?.trackingNumber && r.status === 'courier_booked' && (
                <p className="mt-2 text-sm text-ink/80">
                  Pickup: {r.courier.provider ? `${r.courier.provider} · ` : ''}AWB {r.courier.trackingNumber}
                </p>
              )}
              {r.refund.finalAmount != null && (
                <p className="mt-2 text-sm text-ink">
                  Refund: <strong>₹{r.refund.finalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong>
                  {r.refund.status === 'processing' && r.refund.method !== 'offline'
                    ? ' — on its way to your original payment method (usually 5–9 business days)' : ''}
                  {r.refund.method === 'offline' ? ' — paid by bank transfer' : ''}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
