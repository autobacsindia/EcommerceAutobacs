import { parcelProgress } from '@/lib/orderFulfilment';
import type { FulfilmentOrder } from '@/lib/orderFulfilment';

/**
 * "1 of 2 parcels delivered" — the split-order badge for LIST screens.
 *
 * ── WHY LIST SCREENS NEED THEIR OWN BADGE ────────────────────────────────────────
 * `Order.status` is a roll-up: it sits at `shipped` until the LAST parcel lands. On a
 * list that is all you get, so an order with one of two boxes already in the
 * customer's hands rendered identically to one where nothing had moved. The detail
 * screens have the Parcels panel to say it properly; the lists had nothing.
 *
 * Shared between the admin and customer lists because it is the same fact in both
 * places, and a badge that says "2 of 3" to ops and "1 of 3" to the customer is worse
 * than no badge. Only the styling differs, hence `className`.
 *
 * Renders nothing for a single-parcel or parcel-less order — one box adds nothing the
 * status has not already said, and every order placed before split shipments existed
 * carries no parcels at all.
 */
export default function ParcelProgressBadge({
  order,
  className,
}: {
  order: FulfilmentOrder;
  className: string;
}) {
  const { label } = parcelProgress(order);
  if (!label) return null;
  return <span className={className}>{label}</span>;
}
