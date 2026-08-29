/**
 * Refund math — the single source of truth for "how much of this order is
 * refundable, and how much of it belongs to these lines".
 *
 * WHY THIS EXISTS
 * ---------------
 * An order line stores the CHARGED LIST price (`Order.items[].price`). Order-level
 * discounts — coupon and redeemed karma — are NOT reflected there; they live in
 * `Order.discount` / `couponDiscount` / `karmaDiscount` (see the note on
 * Order.items[].listPrice). So `Σ(line.price × qty)` is what the customer's basket
 * was worth BEFORE discounts, never what they actually paid.
 *
 * Refunding that gross figure is wrong in both directions:
 *   - small discount → the gateway accepts it and we silently refund our own money;
 *   - large discount → the refund exceeds the captured amount and Razorpay rejects
 *     it outright ("The refund amount provided is greater than amount captured").
 *
 * Both were live until 2026-08-03. Every refund amount must come from here.
 *
 * CONVENTIONS
 * -----------
 *  - All arithmetic is integer paise (utils/money.js); rupees only at the edges.
 *  - Shipping is NEVER refunded (signed policy: "the original delivery charge is
 *    never refunded"), so proration covers the GOODS amount only:
 *        goodsNet = subtotal − discount        [== totalAmount − shippingCost]
 *  - Tax is embedded in prices and display-only — it is not a separate limb here.
 *  - A line's share of the discount is proportional to its gross value. Partial-
 *    quantity returns take a per-unit share of their own line.
 *  - Rounding is always DOWN (floor) at the per-line boundary. Refunding one paise
 *    less than theoretically owed is a rounding artefact; refunding one paise more
 *    than was captured is a gateway rejection. Never round up here.
 */

import { toPaise, fromPaise } from '../utils/money.js';

/** Refund states that have already committed money (or are about to). */
const COMMITTED_REFUND_STATUSES = ['processing', 'completed'];

/**
 * The goods amount actually paid for an order, in paise.
 *
 * Derived as `subtotal − discount` rather than `totalAmount − shippingCost` so it
 * stays correct for legacy/imported orders that never stored a shipping breakdown.
 * Falls back to the gross line sum when `subtotal` is missing (very old imports).
 *
 * @param {Object} order - a plain or hydrated Order
 * @returns {number} paise
 */
export function orderGoodsNetPaise(order) {
  const grossPaise = grossLinesPaise(order?.items || []);
  const subtotalPaise = order?.subtotal != null ? toPaise(order.subtotal) : grossPaise;
  // Clamp the discount to [0, subtotal]. `Order.discount` has no schema `min: 0` and is
  // operator-editable on offline orders; a NEGATIVE value would otherwise inflate the
  // goods pot above what was ever charged and produce a refund larger than the sale.
  const discountPaise = Math.min(Math.max(0, toPaise(order?.discount || 0)), subtotalPaise);
  return Math.max(0, subtotalPaise - discountPaise);
}

/**
 * Σ of the per-line coupon attribution written at order time, in paise.
 *
 * Non-zero only for an order priced by a campaign's PER-PRODUCT tier ladder. Used as the
 * switch below, and `> 0` is the right test rather than "the field exists": every order
 * created since the field was added carries `discountPaise: 0` on ordinary-coupon lines,
 * and treating that as an attribution would refund those lines at GROSS — the exact
 * over-refund this module exists to prevent.
 */
function perLineDiscountPaise(lines) {
  return (lines || []).reduce((sum, l) => sum + Math.max(0, Math.floor(Number(l?.discountPaise) || 0)), 0);
}

/** Σ(price × qty) over order lines, in paise. */
function grossLinesPaise(lines) {
  return (lines || []).reduce(
    (sum, l) => sum + toPaise(l?.price ?? l?.unitPrice ?? 0) * (Number(l?.quantity) || 0),
    0
  );
}

/**
 * The refundable (discount-adjusted) value of a set of returned lines.
 *
 * Each returned line is matched to its order line by product id — and by variantId
 * too when the return carries one, so a multi-variant order refunds the right line.
 *
 * @param {Object} order            - the Order the lines belong to
 * @param {Array}  returnedLines    - [{ product, variantId?, quantity, unitPrice }]
 * @returns {{ grossRupees: number, netRupees: number, discountShareRupees: number }}
 *   grossRupees          list value of the returned lines (what the UI struck through)
 *   netRupees            what the customer actually paid for them — the refundable base
 *   discountShareRupees  the difference, i.e. their share of the order-level discount
 */
export function refundableForLines(order, returnedLines) {
  const orderLines = order?.items || [];
  const orderGrossPaise = grossLinesPaise(orderLines);
  const goodsNetPaise = orderGoodsNetPaise(order);

  // Per-line attribution when the order carries it; proration otherwise. Legacy orders,
  // ordinary coupons and cart-value campaigns all take the proration path unchanged.
  const usePerLine = perLineDiscountPaise(orderLines) > 0;
  const orderKarmaPaise = toPaise(order?.karmaDiscount || 0);

  let grossPaise = 0;
  let netPaise = 0;

  for (const rl of returnedLines || []) {
    const orderLine = matchOrderLine(orderLines, rl);
    // Prefer the order's own price over the return's snapshot: the order is the
    // record of what was charged, and a snapshot can only ever be staler.
    const unitPaise = toPaise(orderLine?.price ?? rl.unitPrice ?? 0);
    const orderQty = Number(orderLine?.quantity) || 0;
    const qty = Math.min(Number(rl.quantity) || 0, orderQty || Number(rl.quantity) || 0);

    const lineGrossPaise = unitPaise * qty;
    grossPaise += lineGrossPaise;

    let linePaise;
    if (usePerLine) {
      /*
        The order recorded what THIS line was actually discounted by, so use it.

        Proration by gross value — the branch below — is exact only while every line
        shares one percentage. Once a cart can hold 3%, 5%, 8% and 2% lines together it
        answers with the cart AVERAGE: return the already-on-offer item discounted 2%
        and it is refunded as though it had carried the cart's blended rate, refunding
        money that was never taken off it. Same class of defect as the list-price
        over-refund fixed on 2026-08-03, which is why the attribution is snapshotted.

        Partial-quantity returns take a per-unit share of their OWN line, floored — the
        same never-round-a-refund-up rule as everywhere else here.

        Karma stays prorated: it is a whole-cart discount with no per-line meaning, so
        the only defensible split is by value.
      */
      const lineDiscountPaise = Math.max(0, Math.floor(Number(orderLine?.discountPaise) || 0));
      const couponSharePaise = orderQty > 0
        ? Math.floor((lineDiscountPaise * qty) / orderQty)
        : lineDiscountPaise;
      const karmaSharePaise = orderGrossPaise > 0
        ? Math.floor((lineGrossPaise * orderKarmaPaise) / orderGrossPaise)
        : 0;
      linePaise = Math.max(0, lineGrossPaise - couponSharePaise - karmaSharePaise);
    } else {
      // Proportional share of the goods-net pot. When the order carries no discount
      // this collapses to the gross value exactly (ratio == 1), so a full-price order
      // is unaffected by the proration path.
      linePaise = orderGrossPaise > 0
        ? Math.floor((lineGrossPaise * goodsNetPaise) / orderGrossPaise)
        : 0;
    }
    netPaise += linePaise;
  }

  // Two independent ceilings, both belt-and-braces:
  //   - the order's goods pot (a prorated sum should never exceed it);
  //   - the returned lines' OWN gross value. Proration can only ever reduce a line, so
  //     net > gross means an upstream figure is corrupt (e.g. a negative `order.discount`
  //     on a hand-edited offline order). Without this the inflated number would be
  //     invisible, because `discountShareRupees` floors at 0 and would still read ₹0.
  netPaise = Math.min(netPaise, goodsNetPaise, grossPaise);

  return {
    grossRupees: fromPaise(grossPaise),
    netRupees: fromPaise(netPaise),
    discountShareRupees: fromPaise(Math.max(0, grossPaise - netPaise)),
  };
}

/**
 * Match a returned (or cancelled) line to its order line.
 *
 * `itemId` wins outright when the caller has one. Cancellations reference
 * `Order.items[]._id` directly, which is exact — where product+variant is only nearly
 * exact: the same product under the same variant can legitimately appear as two order
 * lines (re-added to the cart, or an offline order built by hand), and the fallback
 * below silently picks the first of them. Returns have no item id and keep that
 * behaviour unchanged.
 */
function matchOrderLine(orderLines, returnedLine) {
  if (returnedLine?.itemId) {
    const wanted = String(returnedLine.itemId);
    const exact = orderLines.find((ol) => String(ol?._id || '') === wanted);
    if (exact) return exact;
  }
  const productId = String(returnedLine.product?._id || returnedLine.product || '');
  const variantId = returnedLine.variantId ? String(returnedLine.variantId) : null;

  const candidates = orderLines.filter(
    (ol) => String(ol.product?._id || ol.product || '') === productId
  );
  if (candidates.length <= 1 || !variantId) return candidates[0];
  return candidates.find((ol) => String(ol.variantId || '') === variantId) || candidates[0];
}

/**
 * How much of this order's captured payment is still refundable, in rupees.
 *
 * Reconstructed from the durable per-refund records rather than read from one field:
 *
 *   - every OTHER ReturnRequest on this order whose refund is processing/completed;
 *   - every PARTIAL-CANCELLATION refund on the order (`Order.cancellations[].refund`)
 *     that is processing/completed. Without this an order could be partly cancelled and
 *     refunded, then have the SAME money drawn again by a return or a whole-order
 *     cancel — the gateway would reject the second draw with an opaque "refund amount
 *     provided is greater than amount captured", after our own records had already said
 *     yes. Excluded by id when the caller is refunding one of them right now;
 *   - the order-level cancellation refund, if one exists and did not come from a
 *     return (return refunds also mirror themselves onto `order.refundDetails`,
 *     which would otherwise be double-counted — they stamp `notes: "Return <id>"`,
 *     and orderRepository.markRefundProcessing clears that note when it claims a
 *     genuine cancellation so a stale one cannot hide a real refund);
 *   - `Payment.refundAmount`, taken as a FLOOR via max() rather than added.
 *
 * The max() against the payment row is deliberate. Neither source is complete alone:
 * `Payment.refundAmount` was historically overwritten rather than accumulated (and a
 * partial return refund never wrote it at all), so it can under-report; but our own
 * records cannot see a refund issued by hand in the Razorpay dashboard, whose webhook
 * resolves to no order. Adding them would double-count the normal case, so we take
 * whichever is larger and accept that both can still under-report together.
 *
 * LIMIT — this is a guard, not a guarantee: a dashboard refund that never reached
 * either record stays invisible here, and the gateway remains the final arbiter. The
 * caller must therefore still handle a gateway rejection gracefully.
 *
 * @param {Object} order              - the Order
 * @param {Array}  siblingReturns     - ReturnRequests on this order (may include self)
 * @param {string} [excludeReturnId]  - the return being refunded right now
 * @param {Object} [payment]          - the Payment row, when the caller has loaded it
 * @param {string} [excludeCancellationId] - the cancellation being refunded right now
 * @returns {{ capturedRupees: number, alreadyRefundedRupees: number, remainingRupees: number }}
 */
export function remainingRefundable(
  order, siblingReturns = [], excludeReturnId = null, payment = null, excludeCancellationId = null,
) {
  const capturedPaise = toPaise(order?.totalAmount || 0);

  let refundedPaise = 0;
  for (const rr of siblingReturns) {
    if (excludeReturnId && String(rr._id) === String(excludeReturnId)) continue;
    if (!COMMITTED_REFUND_STATUSES.includes(rr?.refund?.status)) continue;
    refundedPaise += toPaise(rr.refund.finalAmount || 0);
  }

  /*
    Partial cancellations draw from the same capture as returns do.

    Stored in PAISE already (unlike ReturnRequest.refund.finalAmount, which is rupees),
    so no conversion — running it through toPaise() would multiply it by 100 and wipe
    out the entire headroom on the first partial cancel.
  */
  for (const c of order?.cancellations || []) {
    if (excludeCancellationId && String(c._id) === String(excludeCancellationId)) continue;
    if (!COMMITTED_REFUND_STATUSES.includes(c?.refund?.status)) continue;
    refundedPaise += Math.max(0, Math.floor(Number(c.refund.amountPaise) || 0));
  }

  const rd = order?.refundDetails;
  const fromReturn = typeof rd?.notes === 'string' && rd.notes.startsWith('Return ');
  if (rd && COMMITTED_REFUND_STATUSES.includes(rd.status) && !fromReturn) {
    refundedPaise += toPaise(rd.amount || 0);
  }

  // Floor, not a summand — see the note above.
  refundedPaise = Math.max(refundedPaise, toPaise(payment?.refundAmount || 0));

  return {
    capturedRupees: fromPaise(capturedPaise),
    alreadyRefundedRupees: fromPaise(refundedPaise),
    remainingRupees: fromPaise(Math.max(0, capturedPaise - refundedPaise)),
  };
}

export default { orderGoodsNetPaise, refundableForLines, remainingRefundable };
