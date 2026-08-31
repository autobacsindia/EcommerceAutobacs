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
  /** Lines cancelled before delivery — those units are never coming. */
  cancellations?: Array<{ lines?: Array<{ itemId: string; quantity: number }> }>;
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

/* ─────────────────────────────────────────────────────────────────────────────────
   Per-item fulfilment state, and the list-screen roll-up.

   Both are DERIVED from `shipments[]` — nothing here is stored, and neither is a
   second source of truth. The parcel a line went in is the only fact; "this item is
   on its way" is a reading of that fact, exactly as `deliveredAtForItem` above is.

   These live on the client because the two LIST endpoints (findByUser /
   findAllAdmin) already return `shipments[]` on the wire, and neither calls the
   server's `fulfilmentSummary`. Asking the fulfilment endpoint once per row would be
   an N+1 across a page of orders to render a badge.
   ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Where a single order line has got to.
 *
 * `pending` covers both "not in a box yet" and "the box it was in was lost" — in both
 * cases the customer is still waiting and the units are back in the to-ship pool, so
 * showing anything else would be a lie about goods they do not have.
 */
export type ItemFulfilmentState = 'delivered' | 'shipped' | 'packed' | 'pending';

/** Parcel statuses whose contents are still committed to the customer (mirrors COMMITTED). */
const COMMITTED: ReadonlyArray<ShipmentSummary['status']> = ['packed', 'shipped', 'delivered'];

const linesFor = (order: FulfilmentOrder, itemId: string) =>
  (order?.shipments || []).filter((s) =>
    COMMITTED.includes(s.status) &&
    (s.lines || []).some((l) => String(l.itemId) === String(itemId)));

/**
 * The furthest-along state this line has reached, or `pending`.
 *
 * ⚠️ Returns `null` for an order with no parcels. Every order placed before split
 * shipments existed carries none, and inventing a state for them would put a
 * fulfilment chip on thousands of historical orders that never had one. Callers
 * render nothing on null and fall through to the order-level status, exactly as today.
 *
 * When a line spans parcels at different stages the LEAST advanced wins: a customer
 * holding 1 of 2 units has not received that item, and calling it "Delivered" is the
 * error that actually costs — it hides a missing unit behind a green tick.
 */
export const fulfilmentStateForItem = (
  order: FulfilmentOrder,
  itemId: string,
  quantity?: number,
): ItemFulfilmentState | null => {
  if (!(order?.shipments || []).length) return null;

  const carrying = linesFor(order, itemId);
  if (!carrying.length) return 'pending';

  /*
    Short of the LIVE quantity: some units are still owed, whatever the parcels say.

    Live, not ordered — cancelled units are never coming, so counting them here would
    hold the line at `pending` for ever. A line of 3 with 1 cancelled and 2 delivered is
    delivered, and gating anything (the Review button, for one) on the ordered figure
    would keep it permanently unavailable.
  */
  if (typeof quantity === 'number' && quantity > 0) {
    const live = Math.max(0, quantity - cancelledQuantityForItem(order, itemId));
    if (live === 0) return 'pending'; // wholly cancelled — nothing to fulfil
    const committed = carrying.reduce(
      (n, s) => n + (s.lines || [])
        .filter((l) => String(l.itemId) === String(itemId))
        .reduce((m, l) => m + (l.quantity || 0), 0),
      0);
    if (committed < live) return 'pending';
  }

  // Least-advanced parcel wins.
  if (carrying.some((s) => s.status === 'packed')) return 'packed';
  if (carrying.some((s) => s.status === 'shipped')) return 'shipped';
  return 'delivered';
};

export interface ParcelProgress {
  /** Parcels written off as lost are excluded — they are not a box anyone is waiting on. */
  total: number;
  shipped: number;
  delivered: number;
  /** True only when there is genuinely more than one box to talk about. */
  isSplit: boolean;
  /** Short badge copy, or null when a badge would be noise. */
  label: string | null;
}

/**
 * List-screen roll-up: "1 of 2 parcels delivered".
 *
 * Counts PARCELS, not units, because that is what the badge can say honestly without
 * the order's `items[]` — which the admin list has but the derivation should not need.
 * The detail screens show the unit-level `summary.label` computed server-side.
 *
 * Returns `label: null` for a legacy order (no parcels) and for a single-parcel order,
 * matching OrderParcels' own `< 2` rule: one box adds nothing the status does not say.
 */
export const parcelProgress = (order: FulfilmentOrder): ParcelProgress => {
  const live = (order?.shipments || []).filter((s) => s.status !== 'lost');
  const delivered = live.filter((s) => s.status === 'delivered').length;
  const shipped = live.filter((s) => s.status === 'shipped').length;
  const total = live.length;
  const isSplit = total > 1;

  let label: string | null = null;
  if (isSplit) {
    if (delivered === total) label = `All ${total} parcels delivered`;
    else if (delivered > 0) label = `${delivered} of ${total} parcels delivered`;
    else if (shipped > 0) label = `${shipped} of ${total} parcels shipped`;
    else label = `${total} parcels · preparing`;
  }

  return { total, shipped, delivered, isSplit, label };
};

/**
 * Parcels a whole-order "delivered" would land at once.
 *
 * Mirrors the server's `deliverAllOutstanding` (Back-end/server/services/
 * shipmentService.js), which moves every `shipped` OR `packed` parcel — a packed one is
 * dispatched first so its `shippedAt` stamp is not skipped. Already-delivered parcels
 * are no-ops there, so counting them here would overstate what the click does; a `lost`
 * parcel is not delivered at all.
 *
 * Defined once because the number is shown to an admin as a warning before an
 * irreversible, customer-emailing action — the count and what the server actually does
 * must not be able to drift apart.
 */
export const outstandingParcels = (order: FulfilmentOrder): number =>
  (order?.shipments || []).filter((s) => s.status === 'shipped' || s.status === 'packed').length;

/* ─────────────────────────────────────────────────────────────────────────────────
   Partial cancellation — the client mirror of Back-end/server/utils/orderCancellation.js.

   DISPLAY ONLY. Nothing here decides money or eligibility: the server prices every
   refund through refundMathService and decides what may be cancelled. These helpers
   exist so a line can be struck through and labelled without a second request, using
   `cancellations[]` that the order endpoints already return.
   ───────────────────────────────────────────────────────────────────────────────── */

export interface CancellationSummaryLine {
  _id?: string;
  lines?: Array<{ itemId: string; quantity: number }>;
  refund?: { status?: string; amountPaise?: number; productValuePaise?: number };
}

/**
 * How many units of one order line were cancelled.
 *
 * Summed across every cancellation record, because a line can die in stages — two units
 * when stock ran short, the third a week later when the customer changed their mind.
 */
export const cancelledQuantityForItem = (
  order: { cancellations?: CancellationSummaryLine[] } | null | undefined,
  itemId: string,
): number =>
  (order?.cancellations || []).reduce(
    (n, c) => n + (c.lines || [])
      .filter((l) => String(l.itemId) === String(itemId))
      .reduce((m, l) => m + (l.quantity || 0), 0),
    0);

/**
 * How many units of a line are still live.
 *
 * ⚠️ Floored at 0 rather than trusted. A negative would only arise from inconsistent
 * data, and rendering "-1 remaining" is worse than rendering nothing.
 */
export const liveQuantityForItem = (
  order: { cancellations?: CancellationSummaryLine[] },
  itemId: string,
  orderedQuantity: number,
): number => Math.max(0, orderedQuantity - cancelledQuantityForItem(order, itemId));

/** Has anything on this order been cancelled? Gates all the cancellation UI. */
export const hasCancellations = (order: { cancellations?: CancellationSummaryLine[] }): boolean =>
  (order?.cancellations || []).length > 0;

/**
 * Units on this order that could still be cancelled — the client mirror of the server's
 * `remainingCancellable` (Back-end/server/utils/orderCancellation.js).
 *
 * ── WHY THE CUSTOMER PAGE NEEDS THIS ──────────────────────────────────────────────
 * Split shipments made `shipped` mean "at least one parcel has left", not "the whole
 * order has left". The customer page keyed its cancel control on the status alone, so a
 * three-item order with one box in transit rendered "Already Shipped — Can't Cancel"
 * while two items sat untouched in the warehouse. The server has always allowed those
 * two to be cancelled; only the UI (and the `canCustomerCancel` gate behind it) said no.
 *
 * A unit is cancellable up to `ordered − cancelled − gone`, where `gone` counts only
 * SHIPPED and DELIVERED parcels. Units in a `packed` box stay cancellable because the
 * server pulls them out of the parcel first.
 *
 * ⚠️ DISPLAY ONLY, like everything else in this section. It decides which button to
 * render, never what may actually be cancelled or what it is worth — the server
 * re-derives both and is free to disagree.
 */
export const remainingCancellableUnits = (order: (FulfilmentOrder & {
  items?: Array<{ _id?: string; quantity?: number }>;
  cancellations?: CancellationSummaryLine[];
}) | null | undefined): number => {
  const gone = new Map<string, number>();
  for (const shipment of order?.shipments || []) {
    if (shipment.status !== 'shipped' && shipment.status !== 'delivered') continue;
    for (const line of shipment.lines || []) {
      const key = String(line.itemId);
      gone.set(key, (gone.get(key) || 0) + (line.quantity || 0));
    }
  }

  return (order?.items || []).reduce((total, item) => {
    const id = String(item._id ?? '');
    const available = (item.quantity || 0)
      - cancelledQuantityForItem(order, id)
      - (gone.get(id) || 0);
    return total + Math.max(0, available);
  }, 0);
};

/**
 * What the customer's cancel control should offer.
 *
 * `full` — nothing has left yet, so cancelling kills the whole order.
 * `partial` — a parcel is already in transit but some units are not; only those go.
 * `none` — everything has gone (or the order is in a state that cannot be cancelled);
 *          the way back is a return, not a cancellation.
 *
 * Mirrors orderStatusService.canCustomerCancel. Kept as one function so the button
 * label, the confirm copy and the disabled state cannot drift apart.
 */
export const customerCancelScope = (order: (FulfilmentOrder & {
  status?: string;
  items?: Array<{ _id?: string; quantity?: number }>;
  cancellations?: CancellationSummaryLine[];
}) | null | undefined): 'full' | 'partial' | 'none' => {
  const status = (order?.status || '').toLowerCase();
  if (status === 'awaiting_payment' || status === 'processing') return 'full';
  if (status === 'shipped' && remainingCancellableUnits(order) > 0) return 'partial';
  return 'none';
};

/**
 * Return statuses that mean a return is OPEN — the goods decision is not yet settled.
 *
 * Mirrors the in-flight set the backend uses (config/returnPolicy.js
 * IN_FLIGHT_RETURN_STATUSES) via the order's mirrored `returnRequest.status`, whose enum
 * spells `received` as `item_received`.
 */
const RETURN_IN_FLIGHT = ['pending', 'approved', 'item_received'];

/**
 * Is there a return open on this order that its STATUS does not already show?
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────
 * Approving a return used to flip `Order.status` straight to `returned`, so the admin
 * table showed "Returned" the moment ops accepted one. That flip is now gated on the
 * return covering every delivered line — because `returned` is TERMINAL, and on a
 * 1-of-3 return it stranded the other two items forever.
 *
 * Correct, but it would have left the table showing a bare "Delivered" for an order with
 * a return in flight: less than it showed before. This badge puts the signal back
 * without lying about the order's state.
 *
 * ⚠️ Deliberately says "a return is open", never how MANY items. `returnRequest` is a
 * mirror of the LATEST return only, so it cannot be summed — counting units needs the
 * ReturnRequest collection (see the server's utils/orderReturns.js). Claiming
 * "1 of 3 returned" from this field would be a guess.
 */
export const hasOpenReturn = (order: {
  status?: string;
  returnRequest?: { status?: string };
}): boolean => {
  const orderStatus = (order?.status || '').toLowerCase();
  // `returned` already says it; anything terminal has nothing in flight.
  if (orderStatus === 'returned' || orderStatus === 'cancelled') return false;
  return RETURN_IN_FLIGHT.includes(order?.returnRequest?.status || '');
};
