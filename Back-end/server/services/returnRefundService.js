/**
 * Return refunds — the ONE path that pays a customer back for a return.
 *
 * Moved out of controllers/returnController.js (2026-10-30) so the admin route and the
 * team panel (/team/return-refunds) run exactly the same money code. Nothing in here
 * trusts a client figure: every amount is recomputed from the order
 * (refundMathService.returnRefundBreakdown), capped by what is left on the order across
 * returns AND cancellations (remainingRefundable), and claimed atomically
 * (returnRequestRepository.claimForRefund) so a retry, a double-click or two people
 * pressing "Refund" at once pay exactly once.
 */

import * as Sentry from '@sentry/node';
import AppError from '../utils/AppError.js';
import returnRequestRepository from '../repositories/returnRequestRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import paymentRepository from '../repositories/paymentRepository.js';
import razorpayService from './razorpayService.js';
import { reverseReturnLtvOnce } from './returnRefundLtvService.js';
import auditLogger from './auditLogger.js';
import {
  refundableForLines,
  remainingRefundable,
  returnRefundBreakdown,
  serviceLineOptions,
  RefundBreakdownError,
} from './refundMathService.js';
import { supportsPartialRefund, describeEmiPlan } from '../utils/paymentMethodDetails.js';
import { toPaise, fromPaise } from '../utils/money.js';
import { enqueueNotification } from '../queue/queues.js';
import { RETURN_CHAT_JOB } from './chatBusinessUpdates.js';
import { OFFLINE_METHODS, offlineMethodLabel } from '../config/offlineRefund.js';
import { suggestedRestockingRupees, effectiveFault } from '../config/returnPolicy.js';
import { isSplitPaid, SPLIT_REFUND_MESSAGE } from '../utils/splitPayment.js';

/** Round rupees to 2dp so refund math never carries float dust. */
export const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Push a timeline entry + set status on a loaded return. */
export const transition = (rr, status, note, userId) => {
  rr.status = status;
  rr.timeline.push({ status, note, updatedBy: userId, timestamp: new Date() });
};

/**
 * Resolve everything the money decision depends on, from the ORDER rather than the
 * return's own snapshot. Shared by the preview and the refund so the number the
 * operator sees is the number that gets claimed and sent — they can never diverge.
 *
 * Reading the order live also silently repairs returns created before discount
 * proration existed (their stored productValue is a gross figure), so no backfill
 * migration is needed for the ones already sitting in the queue.
 *
 * @returns {{ order, payment, refundable, headroom }}
 */
export const resolveRefundBasis = async (rr) => {
  const order = await orderRepository.findById(rr.order);
  if (!order) {
    throw new AppError('The order for this return no longer exists.', 404);
  }
  const refundable = refundableForLines(order, rr.items);
  // Both reads depend only on `order` and not on each other, so they go out together
  // — one round trip instead of two on every preview AND every refund. The Payment row
  // is loaded here (not just at refund time) so the headroom the operator PREVIEWS
  // already accounts for money the payment knows about; otherwise the preview and the
  // refund could disagree about what is left.
  const [siblings, payment] = await Promise.all([
    returnRequestRepository.find({ order: order._id }).select('refund').lean(),
    order.payment ? paymentRepository.findById(order.payment) : Promise.resolve(null),
  ]);
  const headroom = remainingRefundable(order, siblings, rr._id, payment);
  return { order, payment, refundable, headroom };
};

/**
 * The staff's choices for a refund, read from a request body and converted to paise.
 * Only ids, deductions and a LOWER installation amount are taken from the client; every
 * figure they are checked against is recomputed from the order by returnRefundBreakdown.
 * `shippingDeduction` is the older name for the pickup cost and is still accepted.
 */
export const refundChoicesFromBody = (body = {}, rr = null) => ({
  serviceLines: (Array.isArray(body.serviceLines) ? body.serviceLines : []).map((l) => ({
    orderItemId: l?.orderItemId,
    amountPaise: l?.amountRupees == null || l?.amountRupees === '' ? null : toPaise(Math.max(0, Number(l.amountRupees) || 0)),
    reductionReason: l?.reductionReason,
  })),
  ...pickupChoice(body, rr),
  restockingPaise: toPaise(Math.max(0, Number(body.restockingDeduction) || 0)),
});

/**
 * The pickup cost to deduct. Operations records it at inspection (rule 1: "operations
 * enters it with a reason"), so when the caller sends none, the recorded one is used —
 * the team refund screen never asks accounts for it. An explicit figure (the admin
 * screen) still wins, so an admin can correct it.
 */
function pickupChoice(body, rr) {
  const sent = body.pickupDeduction ?? body.shippingDeduction;
  if (sent != null && sent !== '') {
    return {
      pickupDeductionPaise: toPaise(Math.max(0, Number(sent) || 0)),
      pickupDeductionReason: typeof body.pickupDeductionReason === 'string' ? body.pickupDeductionReason.trim() : null,
    };
  }
  return {
    pickupDeductionPaise: toPaise(Math.max(0, Number(rr?.refund?.pickupDeduction) || 0)),
    pickupDeductionReason: rr?.refund?.pickupDeductionReason || null,
  };
}

/**
 * The fault-based breakdown for a return, with the installation lines another return
 * already refunded ruled out. Maps the pure function's refusal to an AppError.
 */
export const breakdownFor = async (order, rr, choices) => {
  const serviceItemIdsTaken = await returnRequestRepository.refundedServiceLineIds(order._id, rr._id);
  try {
    return returnRefundBreakdown(order, rr, { ...choices, serviceItemIdsTaken });
  } catch (err) {
    if (err instanceof RefundBreakdownError) throw new AppError(err.message, err.status);
    throw err;
  }
};

/** Rupee view of a breakdown, for the preview, the response and the stored record. */
export const breakdownRupees = (b) => ({
  goodsGross: fromPaise(b.goodsGrossPaise),
  goodsNet: fromPaise(b.goodsNetPaise),
  discountShare: fromPaise(Math.max(0, b.goodsGrossPaise - b.goodsNetPaise)),
  shippingShare: fromPaise(b.shippingSharePaise),
  service: fromPaise(b.servicePaise),
  pickupDeduction: fromPaise(b.pickupDeductionPaise),
  restocking: fromPaise(b.restockingPaise),
  total: fromPaise(b.totalPaise),
});

/**
 * Debit-card EMI is FULL-REFUND-ONLY at the issuer.
 *
 * The bank is never told which line of a multi-item order came back — it only holds a
 * loan against the whole capture — so it can unwind the loan or nothing. Razorpay
 * rejects a partial refund on a DC EMI payment outright.
 *
 * Our return flow is partial by construction (per-line proration, minus shipping and
 * restocking deductions), so on a DC EMI order almost every refund is one Razorpay
 * refuses. Without this check the operator only finds out AFTER claimForRefund has
 * moved the return into `processing`, and gets a 502 for what is really a policy
 * conflict we can see in advance.
 *
 * Returns null when the refund may proceed, or an operator-facing reason string.
 *
 * @param {Object} payment - our Payment document (needs methodDetails)
 * @param {number} finalAmount - rupees this refund will send
 * @param {number} capturedRupees - what the gateway captured on the order
 * @returns {string|null}
 */
const partialRefundBlockReason = (payment, finalAmount, capturedRupees) => {
  if (supportsPartialRefund(payment)) return null;
  // A refund that happens to cover the whole capture IS a full refund and is allowed.
  if (toPaise(finalAmount) >= toPaise(capturedRupees)) return null;

  return (
    `This order was paid by Debit Card EMI, which the bank can only refund in full — ` +
    `a partial refund of ₹${finalAmount} against the ₹${capturedRupees} captured will be ` +
    `rejected by Razorpay. Either refund the full ₹${capturedRupees}, or settle this ` +
    `return outside the gateway and record it manually.`
  );
};

export async function previewRefund(id, body = null) {
  const rr = await returnRequestRepository.findById(id).populate('items.product', 'name');
  if (!rr) {
    throw new AppError('Return request not found', 404);
  }
  const { order, payment, refundable, headroom } = await resolveRefundBasis(rr);
  // GET previews the defaults; POST previews the staff's choices (installation lines,
  // deductions) so the screen shows the server's figure for exactly what will be sent.
  const breakdown = await breakdownFor(order, rr, refundChoicesFromBody(body || {}, rr));
  const taken = new Set(await returnRequestRepository.refundedServiceLineIds(order._id, rr._id));

  // Suggested restocking = the price-threshold limb, over CUSTOMER-REASON lines only:
  // an our-fault return is never charged for restocking.
  const suggestedRestocking = money(
    rr.items
      .filter((it) => effectiveFault(it) === 'customer')
      .reduce((sum, it) => sum + suggestedRestockingRupees(it.unitPrice, it.quantity), 0)
  );
  return {
    success: true,
    preview: {
      // Payment-instrument constraints the operator has to know BEFORE choosing an
      // amount — chiefly debit-card EMI, which the bank can only refund in full.
      paidBy: describeEmiPlan(payment) || null,
      fullRefundOnly: !supportsPartialRefund(payment),
      // What the customer actually paid for these lines — the goods part of the refund.
      productValue: refundable.netRupees,
      // Context for the operator: the list value we used to (wrongly) refund, and the
      // slice of the order-level coupon/karma discount attributable to these lines.
      listValue: refundable.grossRupees,
      discountShare: refundable.discountShareRupees,
      couponCode: order.couponCode || null,
      // The fault-based breakdown (rule 1): what each part adds or takes away.
      breakdown: breakdownRupees(breakdown),
      lines: breakdown.lines.map((l) => ({
        orderItemId: l.orderItemId,
        product: l.product,
        quantity: l.quantity,
        reason: l.reason,
        fault: l.fault,
        net: fromPaise(l.netPaise),
        shippingShare: fromPaise(l.shippingSharePaise),
      })),
      hasOurFault: breakdown.hasOurFault,
      hasCustomerFault: breakdown.hasCustomerFault,
      // The order's installation lines staff may pick, each at what the customer paid.
      serviceLineOptions: serviceLineOptions(order).map((o) => ({
        orderItemId: o.orderItemId,
        name: o.name,
        quantity: o.quantity,
        netPaid: fromPaise(o.netPaidPaise),
        alreadyRefunded: taken.has(o.orderItemId),
      })),
      serviceLines: breakdown.serviceLines.map((l) => ({
        orderItemId: l.orderItemId, name: l.name, netPaid: fromPaise(l.netPaidPaise), amount: fromPaise(l.amountPaise),
      })),
      // What will actually be sent: the breakdown, capped at what is left on the order.
      refundNow: money(Math.min(fromPaise(breakdown.totalPaise), headroom.remainingRupees)),
      // Gateway headroom. Razorpay rejects anything above this outright.
      orderTotal: headroom.capturedRupees,
      alreadyRefunded: headroom.alreadyRefundedRupees,
      maxRefundable: headroom.remainingRupees,
      suggestedRestocking, // operator may accept, change, or zero this
      shippingDeductionDefault: 0,
      note: 'Our fault: the customer gets what they paid for the item, a share of the original delivery charge, and any installation you pick. '
        + 'Customer\'s reason: what they paid for the item, minus the real pickup cost (and restocking, for items over ₹1,00,000).',
    },
  };
}

/** Human label for an offline payout method, for timeline + email copy. */
/**
 * Settle a refund that was ALREADY paid outside the gateway.
 *
 * Called only after claimForRefund has won the atomic claim, so this owns a return that
 * no other request can be paying out concurrently.
 *
 * ORDERING IS THE WHOLE DESIGN HERE, and it is the opposite of the gateway path's.
 * There, the money moves last, so a failure before it means nothing was paid. Here the
 * money moved BEFORE the request arrived — a customer is already holding cash. So:
 *
 *   Phase 1 (must succeed)  Write the completed refund to the ReturnRequest. That doc is
 *                           the system of record and the ONLY thing remainingRefundable
 *                           counts, so until it lands the payout is invisible and a
 *                           gateway refund could pay the same money a second time.
 *   Phase 2 (best-effort)   The order mirror, the Payment row, net LTV, emails. Each is
 *                           individually guarded: a failure here is logged and reported
 *                           in `warnings`, and must NEVER walk phase 1 back to `failed`.
 *                           That rollback is precisely how recorded cash would vanish
 *                           from the headroom while the pre-check (`status === 'received'`)
 *                           blocked the retry the operator was told to make.
 *
 * Only a phase-1 failure marks the refund `failed`, and it also rewinds `status` to
 * `received` so claimForRefund can re-claim on a retry.
 */
const recordOfflineRefund = async (req, { rr, order, payment, finalAmount, offlineMethod, reference, paidAt }) => {
  const label = offlineMethodLabel(offlineMethod);
  const settledAt = paidAt || new Date();
  const warnings = [];

  /** Run a phase-2 step without letting it fail the recorded payout. */
  const bestEffort = async (what, fn) => {
    try {
      await fn();
    } catch (err) {
      warnings.push(what);
      console.error(`[ReturnRefund] offline refund ${rr._id}: ${what} failed — ${err.message}`);
      if (process.env.SENTRY_DSN) {
        Sentry.withScope((scope) => {
          scope.setContext('return_refund', { returnId: rr._id.toString(), orderId: String(rr.order), step: what });
          scope.setTag('payment_action', 'return_refund_offline');
          scope.setTag('severity', 'high');
          Sentry.captureException(err);
        });
      }
    }
  };

  // ── Phase 1 ────────────────────────────────────────────────────────────────
  try {
    rr.refund.status = 'completed';
    rr.refund.completedAt = settledAt;
    transition(rr, 'refunded', `Refund of ₹${finalAmount} recorded as paid by ${label} (ref ${reference})`, req.user._id);
    await returnRequestRepository.save(rr);
  } catch (err) {
    // Nothing durable was written, so make the return claimable again rather than
    // stranding it: `received` + a non-terminal refund is what claimForRefund needs.
    rr.status = 'received';
    rr.timeline = (rr.timeline || []).filter((t) => t.status !== 'refunded');
    rr.refund.status = 'failed';
    rr.refund.failureReason = err.message;
    try { await returnRequestRepository.save(rr); } catch { /* already failing; nothing more to do */ }

    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        scope.setContext('return_refund', { returnId: rr._id.toString(), orderId: String(rr.order), finalAmount, offlineMethod });
        scope.setTag('payment_action', 'return_refund_offline');
        scope.setTag('severity', 'high');
        Sentry.captureException(err);
      });
    }
    throw new AppError(`Could not record the offline refund: ${err.message}. Nothing was recorded — try again.`, 500);
  }

  // ── Phase 2 ────────────────────────────────────────────────────────────────
  await bestEffort('order mirror', async () => {
    order.refundDetails = {
      requestedAt: rr.refund.initiatedAt,
      amount: finalAmount,
      refundType: finalAmount >= order.totalAmount ? 'full' : 'partial',
      refundMethod: 'offline',
      itemsRefunded: rr.items.map((it) => ({ product: it.product, quantity: it.quantity, amount: money(it.unitPrice * it.quantity) })),
      status: 'completed',
      processedBy: req.user._id,
      processedAt: settledAt,
      // The operator's reference IS the transaction id for a payout with no gateway.
      transactionId: reference,
      // `remainingRefundable` keys off this prefix to tell a return-sourced summary
      // apart from a cancellation refund — do not reword without updating it.
      notes: `Return ${rr._id}`,
    };
    // Payment axis, matching applyReturnRefundWebhook exactly: only a refund covering
    // the whole order value flips it: a partial per-line return leaves the order `paid`.
    // Without this an offline full refund left the order reading `paid` forever — there
    // is no webhook coming to do it — so revenue/LTV reporting kept counting it as a sale.
    if (finalAmount >= order.totalAmount) {
      order.paymentStatus = 'refunded';
    }
    await order.save();
    await orderRepository.setReturnRequestStatus(rr.order, 'refund_processed');
  });

  // Only when a Payment row exists — a legacy order may have none, and there is then
  // nothing to accumulate against.
  if (payment) {
    await bestEffort('payment record', async () => {
      if (await returnRequestRepository.claimPaymentRecord(rr._id)) {
        await paymentRepository.recordRefund(payment._id, finalAmount, 'return_refund_offline');
      }
    });
  }
  // reverseReturnLtvOnce swallows its own errors, but wrap it anyway so a future
  // change there cannot reach back into this path.
  await bestEffort('LTV reversal', () => reverseReturnLtvOnce(rr._id.toString()));

  // Finance always hears about money leaving. The customer is told only on request —
  // they were handed the money in person, so an unsolicited "your refund is on its
  // way, allow 5-9 working days" would be actively wrong.
  await bestEffort('notifications', async () => {
    enqueueNotification('send-admin-return-refunded-alert', { returnId: rr._id.toString() });
    enqueueNotification(RETURN_CHAT_JOB, { event: 'refunded', returnId: rr._id.toString() });
    if (req.body.notifyCustomer && rr.user) {
      enqueueNotification('send-return-status-email', { returnId: rr._id.toString(), event: 'refunded' });
    }
  });

  await bestEffort('audit log', () => auditLogger.logAction(req, 'RETURN_OFFLINE_REFUND', 'ReturnRequest', rr._id, {
    orderId: String(rr.order),
    amount: finalAmount,
    offlineMethod,
    reference,
  }));

  return {
    success: true,
    message: warnings.length
      ? `Recorded ₹${finalAmount} refunded by ${label}. Some follow-up steps need checking: ${warnings.join(', ')}.`
      : `Recorded ₹${finalAmount} refunded by ${label}.`,
    refund: { id: reference, status: 'completed', amount: finalAmount, method: 'offline' },
    ...(warnings.length ? { warnings } : {}),
    request: rr,
  };
};

/**
 * Send (or record) the refund for one return. The single refund path for BOTH the admin
 * route and the team panel: the amount is recomputed here from the order, the atomic
 * claim makes it once-only, and `authorize` lets the caller add its own rule (the team
 * panel's accounts limit) once the server's figure is known — before anything moves.
 *
 * @param {import('express').Request} req - req.user is the actor, req.body the choices
 * @param {{ authorize?: (finalAmount: number, method: string) => void }} [opts]
 * @returns {Promise<object>} the response body
 */
export async function initiateRefund(req, { authorize = null } = {}) {
  const method = req.body.method === 'offline' ? 'offline' : 'original_payment';
  const isOffline = method === 'offline';
  const offlineMethod = isOffline ? String(req.body.offlineMethod || '').trim() : null;
  const reference = isOffline ? String(req.body.reference || '').trim() : null;
  if (isOffline) {
    if (!OFFLINE_METHODS.includes(offlineMethod)) {
      throw new AppError(`How the money was paid back is required (${OFFLINE_METHODS.join(', ')}).`, 400);
    }
    if (!reference) {
      throw new AppError('A reference (UTR, cheque number, or receipt number) is required — it is the only proof the money moved.', 400);
    }
  }
  const paidAt = isOffline && req.body.paidAt ? new Date(req.body.paidAt) : null;
  if (paidAt && Number.isNaN(paidAt.getTime())) {
    throw new AppError('The payout date is not a valid date.', 400);
  }

  const existing = await returnRequestRepository.findById(req.params.id);
  if (!existing) {
    throw new AppError('Return request not found', 404);
  }
  // Friendly pre-checks for a fast, readable 4xx. These are NOT the real guard —
  // the atomic claimForRefund() below is what actually serializes concurrent
  // requests; these just avoid doing work / returning an opaque 409 in the common case.
  if (existing.status !== 'received' || existing.inspection?.passed !== true) {
    throw new AppError('Refund can only be initiated after the item is received and passes inspection.', 400);
  }
  if (['processing', 'completed'].includes(existing.refund?.status)) {
    throw new AppError(`A refund for this return is already ${existing.refund.status}.`, 409);
  }

  // Recompute everything from the ORDER — never from existing.refund.productValue, which
  // is a create-time hint and, for returns raised before 2026-08-03, a GROSS figure.
  const { order, payment, refundable, headroom } = await resolveRefundBasis(existing);

  // The fault-based breakdown (rule 1): goods net + our-fault shipping share + picked
  // installation lines − customer-reason pickup cost − restocking. Only ids and
  // deductions come from the client; every amount is recomputed here.
  const choices = refundChoicesFromBody(req.body, existing);
  const breakdown = await breakdownFor(order, existing, choices);
  const rupees = breakdownRupees(breakdown);
  const shippingDeduction = rupees.pickupDeduction;
  const restockingDeduction = rupees.restocking;
  const productValue = refundable.netRupees;
  /*
    The cap: what the customer actually paid (a Razorpay offer at the gateway is money
    they never handed over) less everything already refunded on the order — returns AND
    cancellations (remainingRefundable). An our-fault return of the whole order adds up
    to the order total, so on an offer order the breakdown is ABOVE what was captured by
    exactly the offer; refusing would leave the operator no amount to lower. So the
    figure is capped here and the cap is shown on the preview and the timeline.
  */
  const finalAmount = money(Math.min(rupees.total, headroom.remainingRupees));
  const cappedBy = money(rupees.total - finalAmount);
  const creditNoteNo = typeof req.body.creditNoteNo === 'string' && req.body.creditNoteNo.trim()
    ? req.body.creditNoteNo.trim()
    : null;

  // Deductions are bounded inside the breakdown by the customer-reason lines' own net,
  // so the only bound left to assert is that something is left to refund.
  if (finalAmount <= 0) {
    throw new AppError(
      rupees.total > 0
        ? `Nothing is left to refund on this order (₹${headroom.alreadyRefundedRupees} of ₹${headroom.capturedRupees} already refunded).`
        : 'The refund amount after deductions must be greater than ₹0.',
      rupees.total > 0 ? 422 : 400,
    );
  }

  // Gateway headroom guard. The cap above makes this unreachable today; it stays as the
  // backstop so a future edit to the cap can never send Razorpay more than it holds
  // (an opaque rejection AFTER the return was claimed into `processing`).
  if (finalAmount > headroom.remainingRupees) {
    throw new AppError(
      `Refund of ₹${finalAmount} exceeds what is left on this order (₹${headroom.remainingRupees} of ₹${headroom.capturedRupees} captured` +
      `${headroom.alreadyRefundedRupees > 0 ? `, ₹${headroom.alreadyRefundedRupees} already refunded` : ''}). ` +
      'Refund the balance manually in the Razorpay dashboard.',
      422
    );
  }

  // Money can only be given back if it was taken in the first place. This gate applies
  // to BOTH paths: the headroom above is derived from `order.totalAmount`, which is what
  // the order is WORTH, not what was collected — so without this an unpaid order (an
  // offline deal whose Razorpay payment link was never paid, sitting at
  // `awaiting_payment`) would happily accept a full "refund" of money nobody ever sent.
  if (order.paymentStatus !== 'paid') {
    throw new AppError(
      `This order is not paid (payment status "${order.paymentStatus || 'pending'}"), so there is nothing to refund. ` +
      'If money was collected outside the system, record the payment on the order first.',
      422,
    );
  }

  // The two remaining preconditions are GATEWAY-specific and are skipped for money
  // already handed back by hand: a paid legacy/imported order can have no Razorpay
  // payment id to refund against, and the debit-card-EMI constraint belongs to the
  // ISSUER, which a cash payout never touches. Between them these are what the old code
  // meant by "settle outside the gateway and record manually" while offering no way to
  // record it.
  if (!isOffline) {
    // Resolve the captured Razorpay payment on the order BEFORE claiming, so an order
    // that can't be refunded online never leaves a return stranded in `processing`.
    if (!payment || !payment.gatewayPaymentId) {
      throw new AppError('No Razorpay payment id on file — refund in the dashboard and record it here as an offline refund.', 422);
    }
    if (isSplitPaid(order)) throw new AppError(SPLIT_REFUND_MESSAGE, 422);

    // Instrument constraint (debit-card EMI = full refund only). Checked HERE, after the
    // amount is final but before claimForRefund, so a refund the gateway would reject
    // never leaves the return stranded in `processing`.
    const blockReason = partialRefundBlockReason(payment, finalAmount, headroom.capturedRupees);
    if (blockReason) {
      throw new AppError(blockReason, 422);
    }
  }

  // The caller's own rule on who may send this much, by which route — checked on the
  // SERVER's figure and before the claim, so a refused request moves nothing.
  if (authorize) authorize(finalAmount, method);

  const amountPaise = Math.round(finalAmount * 100);

  // Atomically claim the refund into `processing` (the serialization point) BEFORE
  // touching the gateway. A double-click / two-admin race resolves to a single
  // winner here; the loser matches zero docs, gets null, and 409s — never firing a
  // second Razorpay refund. `rr` is the freshly-claimed document we mutate below.
  let rr;
  try {
    rr = await returnRequestRepository.claimForRefund(req.params.id, {
      productValue,
      listValue: refundable.grossRupees,
      discountShare: refundable.discountShareRupees,
      shippingDeduction, restockingDeduction, finalAmount, initiatedBy: req.user._id,
      method, offlineMethod, reference, paidAt,
      shippingShare: rupees.shippingShare,
      serviceLines: breakdown.serviceLines,
      pickupDeductionReason: shippingDeduction > 0 ? choices.pickupDeductionReason : null,
      creditNoteNo,
    });
  } catch (err) {
    // unique_refunded_service_line: another return claimed the same installation line
    // between our pre-check and this claim. Nothing was written; nothing was paid.
    if (err?.code === 11000) {
      throw new AppError('That installation was just refunded with another return. Refresh and check the amount.', 409);
    }
    throw err;
  }
  if (!rr) {
    throw new AppError('This refund is already being processed.', 409);
  }

  if (isOffline) {
    return recordOfflineRefund(req, {
      rr, order, payment, finalAmount, offlineMethod, reference, paidAt,
    });
  }

  try {
    const result = await razorpayService.refundPayment(payment.gatewayPaymentId, amountPaise, {
      orderId: order._id.toString(),
      returnId: rr._id.toString(), // authoritative reconciliation target for the webhook
      reason: `return_refund:${rr._id}`,
    });
    const completed = result.status === 'processed';
    rr.refund.razorpayRefundId = result.refundId;
    rr.refund.status = completed ? 'completed' : 'processing';
    if (completed) rr.refund.completedAt = new Date();
    transition(
      rr, 'refunded',
      `Refund ${completed ? 'completed' : 'initiated'} — ₹${finalAmount} to original payment`
        + (cappedBy > 0 ? ` (₹${cappedBy} less than the breakdown: capped at what is left on the order)` : ''),
      req.user._id,
    );
    await returnRequestRepository.save(rr);

    // Mirror THIS refund onto the order as a best-effort LATEST-refund summary. It is
    // deliberately NOT authoritative: an order can have several returns and this single
    // subdoc can only hold one, so a later return overwrites it. The durable per-return
    // record lives on ReturnRequest.refund (keyed by razorpayRefundId), which is what the
    // refund.* webhook reconciles via notes.returnId. Same applies to order.returnRequest.
    order.refundDetails = {
      requestedAt: rr.refund.initiatedAt,
      amount: finalAmount,
      refundType: finalAmount >= order.totalAmount ? 'full' : 'partial',
      refundMethod: 'original_payment',
      itemsRefunded: rr.items.map((it) => ({ product: it.product, quantity: it.quantity, amount: money(it.unitPrice * it.quantity) })),
      status: completed ? 'completed' : 'processing',
      processedBy: req.user._id,
      processedAt: completed ? new Date() : undefined,
      transactionId: result.refundId,
      // `remainingRefundable` keys off this prefix to tell a return-sourced summary
      // apart from a cancellation refund — do not reword without updating it.
      notes: `Return ${rr._id}`,
    };
    await order.save();
    await orderRepository.setReturnRequestStatus(rr.order, 'refund_processed');

    // Payment axis: a partial return refund never touched the Payment row, so the
    // finance view read ₹0 refunded on an order that had money sent back. ACCUMULATE
    // (never assign) — an order can have several partial refunds and each must add.
    // Only the full-value case marks the row `refunded`; a partial leaves it `completed`.
    //
    // Behind a once-only claim: the $inc is not idempotent, and for an instant refund
    // the refund.processed webhook can arrive before the save above lands, at which
    // point both paths believe they are the one to record it.
    if (completed && await returnRequestRepository.claimPaymentRecord(rr._id)) {
      await paymentRepository.recordRefund(payment._id, finalAmount, 'return_refund');
    }

    // Net-LTV reversal only when the money has actually left (instant/optimum refunds
    // come back `processed`). For a normal-speed refund it stays `processing` here and
    // the refund.processed webhook does the reversal instead — the once-only claim
    // inside reverseReturnLtvOnce makes the two paths mutually exclusive.
    if (completed) await reverseReturnLtvOnce(rr._id.toString());

    enqueueNotification('send-return-status-email', { returnId: rr._id.toString(), event: 'refunded' });
    enqueueNotification('send-admin-return-refunded-alert', { returnId: rr._id.toString() });
    // The seller hears about it in #sales (and on their phone) so they can call the customer.
    enqueueNotification(RETURN_CHAT_JOB, { event: 'refunded', returnId: rr._id.toString() });

    return {
      success: true,
      message: completed ? 'Refund completed.' : 'Refund initiated — funds typically settle in 5–9 business days.',
      refund: { id: result.refundId, status: rr.refund.status, amount: finalAmount },
      request: rr,
    };
  } catch (err) {
    rr.refund.status = 'failed';
    rr.refund.failureReason = err.message;
    await returnRequestRepository.save(rr);

    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        scope.setContext('return_refund', { returnId: rr._id.toString(), orderId: String(rr.order), amountPaise });
        scope.setTag('payment_action', 'return_refund');
        scope.setTag('severity', 'high');
        Sentry.captureException(err);
      });
    }
    // 502, and OPERATIONAL: a gateway rejection is the gateway's answer, not a fault in
    // this service. Thrown as a bare Error it became a 500 that paged on-call and showed
    // the operator "Something went wrong" while the real reason sat in the logs.
    throw new AppError(`Refund failed at the gateway: ${err.message}`, 502);
  }
}

export default { previewRefund, initiateRefund, resolveRefundBasis, refundChoicesFromBody };
