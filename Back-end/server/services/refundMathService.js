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
 *  - Proration covers the GOODS amount only:
 *        goodsNet = subtotal − discount        [== totalAmount − shippingCost]
 *    Shipping is refunded only by returnRefundBreakdown, and only for an OUR-FAULT
 *    return line (owner-approved rules, 2026-10-30). Cancellations and every other
 *    caller still never refund it.
 *  - Tax is embedded in prices and display-only — it is not a separate limb here.
 *  - A line's share of the discount is proportional to its gross value. Partial-
 *    quantity returns take a per-unit share of their own line.
 *  - Rounding is always DOWN (floor) at the per-line boundary. Refunding one paise
 *    less than theoretically owed is a rounding artefact; refunding one paise more
 *    than was captured is a gateway rejection. Never round up here.
 */

import { toPaise, fromPaise } from '../utils/money.js';
import { effectiveFault } from '../config/returnPolicy.js';
import { cancelledQuantityByItem } from '../utils/orderCancellation.js';

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
  const ctx = proration(order);

  let grossPaise = 0;
  let netPaise = 0;
  for (const rl of returnedLines || []) {
    const line = lineNet(ctx, rl);
    grossPaise += line.grossPaise;
    netPaise += line.netPaise;
  }

  // Two independent ceilings, both belt-and-braces:
  //   - the order's goods pot (a prorated sum should never exceed it);
  //   - the returned lines' OWN gross value. Proration can only ever reduce a line, so
  //     net > gross means an upstream figure is corrupt (e.g. a negative `order.discount`
  //     on a hand-edited offline order). Without this the inflated number would be
  //     invisible, because `discountShareRupees` floors at 0 and would still read ₹0.
  netPaise = Math.min(netPaise, ctx.goodsNetPaise, grossPaise);

  return {
    grossRupees: fromPaise(grossPaise),
    netRupees: fromPaise(netPaise),
    discountShareRupees: fromPaise(Math.max(0, grossPaise - netPaise)),
  };
}

/** The order-wide figures every per-line share is taken against. */
function proration(order) {
  const orderLines = order?.items || [];
  return {
    orderLines,
    orderGrossPaise: grossLinesPaise(orderLines),
    goodsNetPaise: orderGoodsNetPaise(order),
    // Per-line attribution when the order carries it; proration otherwise. Legacy orders,
    // ordinary coupons and cart-value campaigns all take the proration path unchanged.
    usePerLine: perLineDiscountPaise(orderLines) > 0,
    orderKarmaPaise: toPaise(order?.karmaDiscount || 0),
  };
}

/**
 * What the customer paid for ONE returned (or refunded) line — its gross value less its
 * share of the order-level discount, floored. The body of refundableForLines, split out
 * so the return breakdown can price each line on its own (each carries its own fault).
 */
function lineNet(ctx, rl) {
  const { orderLines, orderGrossPaise, goodsNetPaise, usePerLine, orderKarmaPaise } = ctx;
  const orderLine = matchOrderLine(orderLines, rl);
  // Prefer the order's own price over the return's snapshot: the order is the
  // record of what was charged, and a snapshot can only ever be staler.
  const unitPaise = toPaise(orderLine?.price ?? rl.unitPrice ?? 0);
  const orderQty = Number(orderLine?.quantity) || 0;
  const qty = Math.min(Number(rl.quantity) || 0, orderQty || Number(rl.quantity) || 0);

  const lineGrossPaise = unitPaise * qty;

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
  return { orderLine, qty, grossPaise: lineGrossPaise, netPaise: linePaise };
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
export function matchOrderLine(orderLines, returnedLine) {
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
  // What the gateway actually holds: the total, less any Razorpay offer applied at
  // checkout (order.gatewayOffer). Refunding the full total would be rejected.
  const capturedPaise = Math.max(0, toPaise(order?.totalAmount || 0) - toPaise(order?.gatewayOffer?.discount || 0));

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

/** A refund input the breakdown refuses. `status` is the HTTP status to answer with. */
export class RefundBreakdownError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'RefundBreakdownError';
    this.status = status;
  }
}

const idStr = (v) => (v == null ? '' : String(v._id ?? v));
/** A sales-panel CUSTOM line (installation, fitting…): no catalogue product behind it. */
const isCustomLine = (line) => line?.custom === true;
const wholePaise = (n) => Math.max(0, Math.floor(Number(n) || 0));

/**
 * The full money breakdown of ONE return, in integer paise, floored line by line.
 * Owner-approved rule 1 (2026-10-30): whoever caused the problem pays.
 *
 *   goods net         every line: what the customer paid for it (coupon-aware, as above)
 * + shipping share    OUR-FAULT lines: shippingCost × the line's share of the goods
 * + service lines     only when some line is our fault: the installation line(s) staff
 *                     picked, at their net paid — lowered with a reason, never raised
 * − pickup deduction  CUSTOMER-REASON lines only: the real pickup cost, with a reason
 * − restocking        CUSTOMER-REASON lines only, optional
 *
 * Both deductions are bounded by the customer-reason lines' own goods net, so a
 * deduction can never eat into money owed for an our-fault line.
 *
 * "The line's share of the goods" is taken over the CATALOGUE lines only. Custom lines
 * (installation) were never shipped, and a custom line can never be a return line
 * (ReturnRequest.items.product is required) — so returning every catalogue unit
 * refunds exactly the whole shipping charge and never more.
 *
 * Pure: no I/O. The caller recomputes it from the order at refund time, caps the total
 * with remainingRefundable, and never stores a client figure.
 *
 * @param {Object} order
 * @param {{ items: Array }} request - the return (items carry reason, fault, quantity)
 * @param {Object} [choices]
 * @param {Array}  [choices.serviceLines] - [{ orderItemId, amountPaise?, reductionReason? }]
 * @param {number} [choices.pickupDeductionPaise]
 * @param {string} [choices.pickupDeductionReason]
 * @param {number} [choices.restockingPaise]
 * @param {Array}  [choices.serviceItemIdsTaken] - custom line ids another return already refunded
 * @returns {{ lines, goodsGrossPaise, goodsNetPaise, shippingSharePaise, serviceLines,
 *   servicePaise, pickupDeductionPaise, restockingPaise, totalPaise, hasOurFault, hasCustomerFault }}
 * @throws {RefundBreakdownError}
 */
export function returnRefundBreakdown(order, request, choices = {}) {
  const ctx = proration(order);
  const shippingPaise = wholePaise(toPaise(order?.shippingCost || 0));
  const catalogueGrossPaise = grossLinesPaise(ctx.orderLines.filter((l) => !isCustomLine(l)));

  const lines = [];
  let goodsGrossPaise = 0;
  let goodsNetPaise = 0;
  let customerNetPaise = 0;
  let shippingSharePaise = 0;
  for (const raw of request?.items || []) {
    // A return loaded from the database carries Mongoose subdocuments, whose fields are
    // getters: spreading one copies none of them (quantity, product… all undefined) and
    // the line silently prices at ₹0. Always work on a plain copy.
    const item = typeof raw?.toObject === 'function' ? raw.toObject() : raw;
    const fault = effectiveFault(item);
    const priced = lineNet(ctx, { ...item, itemId: item.orderItemId });
    const sharePaise = fault === 'ours' && catalogueGrossPaise > 0
      ? Math.floor((priced.grossPaise * shippingPaise) / catalogueGrossPaise)
      : 0;
    goodsGrossPaise += priced.grossPaise;
    goodsNetPaise += priced.netPaise;
    if (fault === 'customer') customerNetPaise += priced.netPaise;
    shippingSharePaise += sharePaise;
    lines.push({
      orderItemId: idStr(priced.orderLine?._id) || null,
      product: idStr(item.product) || null,
      quantity: priced.qty,
      reason: item.reason,
      fault,
      grossPaise: priced.grossPaise,
      netPaise: priced.netPaise,
      shippingSharePaise: sharePaise,
    });
  }
  // The same two ceilings refundableForLines applies — see the note there.
  goodsNetPaise = Math.min(goodsNetPaise, ctx.goodsNetPaise, goodsGrossPaise);
  customerNetPaise = Math.min(customerNetPaise, goodsNetPaise);
  shippingSharePaise = Math.min(shippingSharePaise, shippingPaise);

  const hasOurFault = lines.some((l) => l.fault === 'ours');
  const hasCustomerFault = lines.some((l) => l.fault === 'customer');

  // ── Service (installation) lines ──────────────────────────────────────────────
  const picked = Array.isArray(choices.serviceLines) ? choices.serviceLines : [];
  if (picked.length && !hasOurFault) {
    throw new RefundBreakdownError('Installation is refunded only when the fault is ours.');
  }
  const taken = new Set((choices.serviceItemIdsTaken || []).map(idStr));
  const cancelled = cancelledQuantityByItem(order);
  const seen = new Set();
  const serviceLines = [];
  for (const choice of picked) {
    const wanted = idStr(choice?.orderItemId);
    const orderLine = ctx.orderLines.find((l) => idStr(l._id) === wanted);
    if (!orderLine || !isCustomLine(orderLine)) {
      throw new RefundBreakdownError('Pick an installation line from this order’s bill.');
    }
    const name = orderLine.name || 'Installation';
    if (seen.has(wanted)) throw new RefundBreakdownError(`"${name}" is listed twice.`);
    seen.add(wanted);
    if (taken.has(wanted)) {
      throw new RefundBreakdownError(`"${name}" was already refunded with another return.`, 409);
    }
    // Units of the line already cancelled were refunded by the cancellation; only the
    // rest is still owed.
    const qty = Number(orderLine.quantity) || 0;
    const liveQty = Math.max(0, qty - (cancelled.get(wanted) || 0));
    if (liveQty === 0) {
      throw new RefundBreakdownError(`"${name}" was cancelled and refunded already.`, 409);
    }
    const netPaidPaise = lineNet(ctx, { itemId: wanted, quantity: liveQty }).netPaise;

    let amountPaise = netPaidPaise;
    let reductionReason = null;
    if (choice.amountPaise != null && choice.amountPaise !== '') {
      const requested = Number(choice.amountPaise);
      if (!Number.isFinite(requested) || requested < 0) {
        throw new RefundBreakdownError(`Enter a valid amount for "${name}".`);
      }
      if (Math.floor(requested) > netPaidPaise) {
        throw new RefundBreakdownError(
          `"${name}" can be refunded up to ₹${fromPaise(netPaidPaise)} — the amount the customer paid for it.`,
        );
      }
      amountPaise = Math.floor(requested);
      if (amountPaise < netPaidPaise) {
        reductionReason = String(choice.reductionReason || '').trim();
        if (!reductionReason) {
          throw new RefundBreakdownError(`Say why "${name}" is refunded for less than was paid.`);
        }
      }
    }
    serviceLines.push({ orderItemId: wanted, name, netPaidPaise, amountPaise, reductionReason });
  }
  const servicePaise = serviceLines.reduce((sum, l) => sum + l.amountPaise, 0);

  // ── Deductions (customer-reason lines only) ───────────────────────────────────
  const pickupDeductionPaise = wholePaise(choices.pickupDeductionPaise);
  const restockingPaise = wholePaise(choices.restockingPaise);
  if ((pickupDeductionPaise || restockingPaise) && !hasCustomerFault) {
    throw new RefundBreakdownError('Pickup and restocking are deducted only when the return is for the customer’s own reason.');
  }
  if (pickupDeductionPaise && !String(choices.pickupDeductionReason || '').trim()) {
    throw new RefundBreakdownError('Say what the pickup cost is for (courier and AWB, or the receipt).');
  }
  if (pickupDeductionPaise + restockingPaise > customerNetPaise) {
    throw new RefundBreakdownError(
      `Deductions can be at most ₹${fromPaise(customerNetPaise)} — what the customer paid for the items returned for their own reason.`,
    );
  }

  const totalPaise = goodsNetPaise + shippingSharePaise + servicePaise - pickupDeductionPaise - restockingPaise;

  return {
    lines,
    goodsGrossPaise,
    goodsNetPaise,
    shippingSharePaise,
    serviceLines,
    servicePaise,
    pickupDeductionPaise,
    restockingPaise,
    totalPaise: Math.max(0, totalPaise),
    hasOurFault,
    hasCustomerFault,
  };
}

/**
 * The installation lines a return MAY refund: the order's custom lines, each with what
 * the customer paid for its still-live units. For the staff picker and the estimate.
 */
export function serviceLineOptions(order) {
  const ctx = proration(order);
  const cancelled = cancelledQuantityByItem(order);
  return ctx.orderLines
    .filter(isCustomLine)
    .map((l) => {
      const liveQty = Math.max(0, (Number(l.quantity) || 0) - (cancelled.get(idStr(l._id)) || 0));
      return {
        orderItemId: idStr(l._id),
        name: l.name || 'Installation',
        quantity: liveQty,
        netPaidPaise: liveQty > 0 ? lineNet(ctx, { itemId: idStr(l._id), quantity: liveQty }).netPaise : 0,
      };
    })
    .filter((l) => l.quantity > 0);
}

export default {
  orderGoodsNetPaise, refundableForLines, remainingRefundable, matchOrderLine,
  returnRefundBreakdown, serviceLineOptions,
};
