/**
 * Refunds settled OUTSIDE Razorpay — recording them, and withdrawing a record that
 * turns out to be wrong.
 *
 * Two situations this exists for, and they behave identically:
 *   1. The money genuinely went back by hand — cash at the counter, NEFT, UPI, cheque.
 *   2. An admin refunded the payment in the Razorpay DASHBOARD. That writes nothing
 *      here (the resulting webhook carries no order/return/cancellation note, so it
 *      resolves to nothing), which is why the gateway button then fails with "already
 *      fully refunded" and the order sits in the refunds queue for ever. Recording it
 *      here is what closes it out.
 *
 * ── THE CENTRAL INVARIANT ───────────────────────────────────────────────────────────
 * AN OFFLINE RECORD MUST HAVE EXACTLY THE SIDE EFFECTS ITS GATEWAY TWIN HAS — no more,
 * no fewer. The two are alternative ways to settle the same debt, and a customer must
 * not get a different email, a different LTV, or a different affiliate ledger depending
 * on which one an admin happened to use. That is why the per-surface effects below look
 * uneven, and the unevenness is deliberate:
 *
 *   whole-order  Payment row + paymentStatus + customer email. NO LTV reversal and NO
 *                affiliate clawback — both already fired on the `cancelled` transition
 *                (orderStatusService → post-order-cancelled), not on the refund. Doing
 *                them here would double-count.
 *   per-line     Payment row + affiliate clawback + LTV, via the SAME
 *                applyCancellationRefundSideEffectsOnce the gateway path and the
 *                refund webhook share. No customer email, because the gateway per-line
 *                path sends none either (applyCancellationRefundWebhook).
 *
 * ── PHASE ORDER ─────────────────────────────────────────────────────────────────────
 * Copied from the return path (returnController.recordOfflineRefund), for its reason:
 * the money moved BEFORE the request arrived, so the record of it must land first.
 *   Phase 1 (must succeed)  the completed refund record — the only thing
 *                           refundMathService.remainingRefundable counts. Until it
 *                           exists the payout is invisible and a gateway refund could
 *                           pay the same money a second time.
 *   Phase 2 (best-effort)   everything else, each guarded, failures returned as
 *                           `warnings[]`. A phase-2 failure must NEVER walk phase 1
 *                           back — that is how recorded cash disappears from the
 *                           headroom while the pre-checks block the retry.
 *
 * Reverting runs the mirror image, and its ordering is justified in
 * services/refundReversalService.js.
 */

import orderRepository from '../repositories/orderRepository.js';
import paymentRepository from '../repositories/paymentRepository.js';
import returnRequestRepository from '../repositories/returnRequestRepository.js';
import auditLogger from './auditLogger.js';
import { remainingRefundable } from './refundMathService.js';
import { applyCancellationRefundSideEffectsOnce } from './cancellationRefundSideEffects.js';
import { reverseRefundSideEffects } from './refundReversalService.js';
import { enqueueNotification } from '../queue/queues.js';
import { offlineMethodLabel } from '../config/offlineRefund.js';
import { toPaise, fromPaise } from '../utils/money.js';
import AppError from '../utils/AppError.js';
import * as Sentry from '@sentry/node';

/**
 * The acting admin's id.
 *
 * The two controllers that reach this service disagree: orderController passes
 * `req.user.id` shaped requests, returnController `req.user._id`. Both are present on a
 * real hydrated user, so either works in production — but reading only one of them
 * would silently stamp `undefined` into `processedBy` the first time a route hands over
 * a lean user object, and an audit field that is quietly empty is worse than no field.
 */
const actorId = (req) => req?.user?._id ?? req?.user?.id ?? null;

/** Run a phase-2 step without letting it fail the payout that has already been recorded. */
const bestEffort = async (warnings, what, context, fn) => {
  try {
    await fn();
  } catch (err) {
    warnings.push(what);
    console.error(`[OfflineRefund] ${context.label}: ${what} failed — ${err.message}`);
    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        scope.setContext('offline_refund', { ...context, step: what });
        scope.setTag('payment_action', 'offline_refund');
        scope.setTag('severity', 'high');
        Sentry.captureException(err);
      });
    }
  }
};

/**
 * Preconditions shared by both offline-mark surfaces.
 *
 * ⚠️ `paymentStatus === 'paid'` applies to the offline path just as it does to the
 * gateway one. Headroom is derived from `order.totalAmount` — what the order is WORTH,
 * not what was collected — so without this an unpaid order (an offline deal whose
 * payment link was never paid) would happily accept a full "refund" of money nobody
 * ever sent.
 */
const assertRefundable = (order) => {
  if (order.paymentStatus !== 'paid') {
    throw new AppError(
      `This order is not paid (payment status "${order.paymentStatus || 'pending'}"), so there is `
      + 'nothing to refund. If money was collected outside the system, record the payment first.',
      422,
    );
  }
};

/**
 * Resolve and bound the amount to record.
 *
 * The client's number is a REQUEST, never the answer: it is checked against the ceiling
 * and rejected outright if it exceeds it, rather than silently trimmed — an admin who
 * typed the wrong figure needs to see that they did.
 *
 * ⚠️ THE CEILING, NOT THE ORDER'S HEADROOM. This used to validate against
 * `headroom.remainingRupees` and use `ceilingRupees` only as the default, which made the
 * ceiling advisory: a ₹400 cancellation on a ₹5,000 order happily accepted `amount: 5000`,
 * inflating the Payment row, the affiliate clawback and the LTV decrement, and eating the
 * whole order's headroom so every sibling refund was then refused. The gateway twin caps
 * at `min(productValuePaise, headroom)`; this has to agree with it.
 *
 * Callers pass a ceiling that is ALREADY the lesser of the surface's own value and the
 * order headroom, so one comparison covers both — `headroom` is taken separately only to
 * say WHICH limit was hit, since "more than this cancellation is worth" and "more than
 * the order has left" need different corrections from the admin.
 */
const resolveAmountRupees = (requested, ceilingRupees, headroom) => {
  const wanted = requested == null ? ceilingRupees : Number(requested);

  if (!Number.isFinite(wanted) || wanted <= 0) {
    throw new AppError('The refund amount must be greater than ₹0.', 400);
  }
  if (toPaise(wanted) > toPaise(ceilingRupees)) {
    // The order's remaining balance is the binding limit only when it is the tighter of
    // the two; otherwise this surface's own value is, and saying "still refundable on
    // this order" would point the admin at the wrong number.
    const headroomBinds = toPaise(ceilingRupees) >= toPaise(headroom.remainingRupees);
    throw new AppError(
      headroomBinds
        ? `₹${wanted} is more than the ₹${headroom.remainingRupees} still refundable on this order `
          + `(₹${headroom.capturedRupees} captured`
          + `${headroom.alreadyRefundedRupees > 0 ? `, ₹${headroom.alreadyRefundedRupees} already refunded` : ''}). `
          + 'Record only what actually went back.'
        : `₹${wanted} is more than the ₹${ceilingRupees} this refund covers. `
          + 'Record only what actually went back.',
      422,
    );
  }
  return fromPaise(toPaise(wanted));
};

// ── Whole-order cancellation refund ──────────────────────────────────────────────────

/**
 * Record that a cancelled, paid order's refund was settled outside the gateway.
 *
 * @param {object} req - for the acting admin + audit context
 * @param {object} args
 * @param {object} args.order   - hydrated order
 * @param {object|null} args.payment
 * @param {number|null} args.amount - rupees; defaults to the whole remaining balance
 * @param {string} args.offlineMethod
 * @param {string} args.reference
 * @param {Date|null} args.paidAt
 * @param {boolean} args.notifyCustomer
 */
export const markOrderRefundOffline = async (req, {
  order, payment, amount = null, offlineMethod, reference, paidAt = null, notifyCustomer = true,
}) => {
  if (order.status !== 'cancelled') {
    throw new AppError(
      `Refunds are only recorded against cancelled orders (order is '${order.status}').`, 400,
    );
  }

  /*
    Per-line cancellations price their money individually, net of the order's discount.
    A whole-order record would be both the wrong figure and a second claim on the same
    capture. Same guard the gateway path carries — see orderController.processRefund.
  */
  if ((order.cancellations || []).length) {
    throw new AppError(
      'This order was cancelled line by line. Record each cancellation\'s refund from the '
      + "order's Cancellations panel — those amounts are already net of the order's discount.",
      409,
    );
  }

  assertRefundable(order);

  const siblingReturns = await returnRequestRepository.find({ order: order._id })
    .select('refund').lean();
  const headroom = remainingRefundable(order, siblingReturns, null, payment);
  const ceiling = Math.min(order.totalAmount, headroom.remainingRupees);
  const amountRupees = resolveAmountRupees(amount, ceiling, headroom);

  // A record covering the whole order value moves the payment axis and tells the
  // customer; a partial one is a reconciliation entry and does neither. Same rule the
  // return path applies (`finalAmount >= order.totalAmount`).
  const isFull = toPaise(amountRupees) >= toPaise(order.totalAmount);
  const settledAt = paidAt || new Date();
  const warnings = [];
  const context = { orderId: String(order._id), amountRupees, label: `order ${order._id} refund` };

  // ── Phase 1 ───────────────────────────────────────────────────────────────────────
  const claimed = await orderRepository.markRefundOfflineCompleted(order._id, {
    amount: amountRupees,
    refundType: isFull ? 'full' : 'partial',
    offlineMethod,
    offlineReference: reference,
    paidAt: settledAt,
    userId: actorId(req),
    markRefunded: isFull,
  });
  if (!claimed) {
    throw new AppError(
      'This order\'s refund is already recorded or in progress — reload the order to see its '
      + 'current state.',
      409,
    );
  }

  // ── Phase 2 ───────────────────────────────────────────────────────────────────────
  /*
    Payment row only. NO LTV decrement and NO affiliate clawback: both already ran when
    the order was cancelled (post-order-cancelled), and the gateway refund path does not
    repeat them either. See the invariant at the top of this file.
  */
  if (payment) {
    await bestEffort(warnings, 'payment record', context, async () => {
      if (await orderRepository.claimRefundPaymentRecord(order._id)) {
        await paymentRepository.recordRefund(payment._id, amountRupees, 'order_cancelled_offline');
        /*
          Recorded ONLY after the write succeeded, and this is what a later revert
          subtracts. The `paymentRecorded` claim flag cannot be used for it: the claim is
          taken BEFORE the write, so it stays `true` when the write throws — and a revert
          trusting it would take money off `Payment.refundAmount` that was never added,
          wiping a sibling refund's contribution off the headroom floor.
        */
        await orderRepository.setRefundAppliedAmounts(order._id, {
          paymentRecordedPaise: toPaise(amountRupees),
        });
      }
    });
  }

  /*
    Customer email, reusing the idempotent status-email path the refund webhook uses, so
    an offline refund is indistinguishable from a gateway one at the customer's end.

    ⚠️ FULL REFUNDS ONLY, and not by preference. `notifiedStatuses` keys on the bare
    status word for order-level events, so ONE 'refunded' email can ever be sent per
    order. Spending that stamp on a partial reconciliation entry would permanently
    silence the notification for the real, complete refund later. The same limitation is
    documented on the webhook path in razorpayService.applyRefundWebhook.
  */
  if (notifyCustomer && isFull) {
    await bestEffort(warnings, 'customer email', context, () => {
      enqueueNotification('send-order-status-email', {
        orderId: order._id.toString(), status: 'refunded',
      });
    });
  }

  await bestEffort(warnings, 'audit log', context, () =>
    auditLogger.logAction(req, 'ORDER_REFUND_MARKED_OFFLINE', 'Order', order._id, {
      amount: amountRupees, offlineMethod, reference, paidAt: settledAt, isFull,
    }));

  const label = offlineMethodLabel(offlineMethod);
  const notified = notifyCustomer && isFull;
  return {
    amountRupees,
    isFull,
    notified,
    warnings,
    message: `Recorded ₹${amountRupees} refunded by ${label}.`
      + (notifyCustomer && !isFull
        ? ' No customer email was sent: this is a partial record, and an order gets only one refund email — it is kept for the full refund.'
        : '')
      + (warnings.length ? ` Some follow-up steps need checking: ${warnings.join(', ')}.` : ''),
  };
};

/**
 * Withdraw a whole-order offline refund record an admin says was a mistake.
 *
 * Only ever reaches the side effects if the atomic claim confirmed the record was an
 * OFFLINE one — a Razorpay refund cannot be undone by writing fields.
 */
export const revertOrderRefund = async (req, { orderId, reason }) => {
  const before = await orderRepository.claimRefundRevert(orderId, {
    userId: actorId(req), reason,
  });

  if (!before) {
    /*
      Distinguish "nothing to revert" from "that refund is real", because the second is
      the one an admin needs explaining. Re-read rather than trusting the failed match:
      the claim is deliberately narrow and its failure alone does not say why.
    */
    const order = await orderRepository.findById(orderId);
    if (!order) throw new AppError('Order not found', 404);

    const rd = order.refundDetails || {};
    if (rd.status === 'completed' && rd.refundMethod !== 'offline') {
      throw new AppError(
        'This refund went through Razorpay, so it cannot be reverted here — the money has '
        + 'genuinely left the account. Only a refund recorded as settled offline can be '
        + 'withdrawn. If the gateway refund itself was a mistake, that is a new charge, not '
        + 'a reversal.',
        409,
      );
    }
    throw new AppError(
      `There is no offline refund recorded on this order to revert (refund is ${rd.status || 'not recorded'}).`,
      409,
    );
  }

  const recorded = before.refundDetails || {};
  const amountPaise = toPaise(recorded.amount || 0);
  /*
    What the mark ACTUALLY put on the Payment row, not what it intended to. Absent or 0
    means the write never landed (or was skipped), so there is nothing to take back —
    reversing anyway would corrupt the row. Absent leaves headroom consumed, which blocks
    a payout rather than allowing a second one: the safe direction.
  */
  const paymentRecordedPaise = Math.max(0, Math.floor(Number(recorded.paymentRecordedPaise) || 0));

  const { warnings } = await reverseRefundSideEffects({
    orderId: before._id,
    // Neither is reversed on this surface, because neither was applied — the whole-order
    // refund path never touched LTV or the affiliate ledger. See the invariant above.
    userId: null,
    affiliateClawbackPaise: 0,
    paymentId: before.payment || null,
    amountPaise: paymentRecordedPaise,
    /*
      Already done, atomically, inside claimRefundRevert's pipeline. Doing it here too
      would be a best-effort second attempt at a write that has to be reliable: both
      refund entry points require `paid`, so an order left at `refunded` shows a refund
      button that every path behind it refuses.
    */
    restorePaidStatus: false,
    label: `order ${before._id} refund`,
    reason: 'refund_reverted',
  });

  await bestEffort(warnings, 'audit log', { orderId: String(orderId), label: `order ${orderId} refund` }, () =>
    auditLogger.logAction(req, 'ORDER_REFUND_REVERTED', 'Order', orderId, {
      amount: recorded.amount,
      offlineMethod: recorded.offlineMethod,
      reference: recorded.offlineReference,
      reason,
    }));

  return {
    amountRupees: fromPaise(amountPaise),
    warnings,
    message: `Withdrew the ₹${fromPaise(amountPaise)} offline refund record. The order is back to `
      + '"refund due".'
      + (warnings.length ? ` Some follow-up steps need checking: ${warnings.join(', ')}.` : ''),
  };
};

// ── Per-line cancellation refund ─────────────────────────────────────────────────────

/**
 * Record that ONE cancellation's refund was settled outside the gateway.
 *
 * @param {object} req
 * @param {object} args
 * @param {object} args.order
 * @param {object} args.record - the Order.cancellations[] entry
 * @param {object|null} args.payment
 * @param {number|null} args.amount - rupees; defaults to this cancellation's priced value
 */
export const markCancellationRefundOffline = async (req, {
  order, record, payment, amount = null, offlineMethod, reference, paidAt = null,
}) => {
  if (['processing', 'completed'].includes(record.refund?.status)) {
    throw new AppError(
      `A refund for this cancellation is already ${record.refund.status}.`, 409,
    );
  }
  if (record.refund?.status === 'not_applicable') {
    throw new AppError('This cancellation carried no refundable value.', 409);
  }

  assertRefundable(order);

  /*
    Recompute from the ORDER, never from the snapshot taken when the lines were
    cancelled. Between then and now a return may have drawn part of the same capture,
    and the cap has to be applied against what is left TODAY. `excludeCancellationId`
    keeps this record's own pending figure out of its own ceiling.
  */
  const siblingReturns = await returnRequestRepository.find({ order: order._id })
    .select('refund').lean();
  const headroom = remainingRefundable(order, siblingReturns, null, payment, record._id);
  const pricedRupees = fromPaise(Math.max(0, Math.floor(Number(record.refund?.productValuePaise) || 0)));
  const ceiling = Math.min(pricedRupees, headroom.remainingRupees);

  if (toPaise(ceiling) <= 0) {
    throw new AppError(
      `Nothing left to refund on this order — ₹${headroom.alreadyRefundedRupees} of `
      + `₹${headroom.capturedRupees} has already gone back.`,
      422,
    );
  }

  const amountRupees = resolveAmountRupees(amount, ceiling, headroom);
  const amountPaise = toPaise(amountRupees);
  const settledAt = paidAt || new Date();
  const warnings = [];
  const context = {
    orderId: String(order._id), cancellationId: String(record._id), amountRupees,
    label: `cancellation ${record._id}`,
  };

  // ── Phase 1 ───────────────────────────────────────────────────────────────────────
  const claimed = await orderRepository.markCancellationRefundOffline(order._id, record._id, {
    amountPaise,
    offlineMethod,
    offlineReference: reference,
    paidAt: settledAt,
    userId: actorId(req),
  });
  if (!claimed) {
    throw new AppError(
      'This cancellation\'s refund is already recorded or in progress — reload the order to '
      + 'see its current state.',
      409,
    );
  }

  // ── Phase 2 ───────────────────────────────────────────────────────────────────────
  /*
    The SAME once-only side-effect module the gateway path and the refund webhook use,
    not a copy of it: Payment row, affiliate clawback, and the customer's net LTV, all
    behind one claim. Reusing it is what guarantees an offline payout and a gateway
    payout leave the books in identical states.

    No customer email here — the gateway per-line path sends none either
    (applyCancellationRefundWebhook), and an email that fires only for cash payouts
    would be worse than no email at all.
  */
  await bestEffort(warnings, 'refund side effects', context, async () => {
    const result = await applyCancellationRefundSideEffectsOnce(
      order._id, record._id, order.payment, amountPaise,
    );
    /*
      Persist what the clawback ACTUALLY took (post-clamp), so a later revert reinstates
      exactly that and not a figure re-derived from an order that may have changed.
    */
    await orderRepository.setCancellationAppliedAmounts(order._id, record._id, {
      affiliateClawbackPaise: Math.max(0, Number(result?.affiliateClawbackPaise) || 0),
      paymentRecordedPaise: Math.max(0, Number(result?.paymentRecordedPaise) || 0),
      ltvDecrementedPaise: Math.max(0, Number(result?.ltvDecrementedPaise) || 0),
    });
  });

  await bestEffort(warnings, 'audit log', context, () =>
    auditLogger.logAction(req, 'CANCELLATION_REFUND_MARKED_OFFLINE', 'Order', order._id, {
      cancellationId: String(record._id),
      amount: amountRupees, offlineMethod, reference, paidAt: settledAt,
    }));

  return {
    amountRupees,
    warnings,
    message: `Recorded ₹${amountRupees} refunded by ${offlineMethodLabel(offlineMethod)}.`
      + (warnings.length ? ` Some follow-up steps need checking: ${warnings.join(', ')}.` : ''),
  };
};

/** Withdraw ONE cancellation's offline refund record. */
export const revertCancellationRefund = async (req, { orderId, cancellationId, reason }) => {
  const before = await orderRepository.claimCancellationRefundRevert(orderId, cancellationId, {
    userId: actorId(req), reason,
  });

  if (!before) {
    const order = await orderRepository.findById(orderId);
    if (!order) throw new AppError('Order not found', 404);
    const record = (order.cancellations || []).find((c) => String(c._id) === String(cancellationId));
    if (!record) throw new AppError('Cancellation not found on this order', 404);

    if (record.refund?.status === 'completed' && record.refund?.razorpayRefundId) {
      throw new AppError(
        'This refund went through Razorpay, so it cannot be reverted here — the money has '
        + 'genuinely left the account. Only a refund recorded as settled offline can be withdrawn.',
        409,
      );
    }
    throw new AppError(
      'There is no offline refund recorded on this cancellation to revert '
      + `(refund is ${record.refund?.status || 'not recorded'}).`,
      409,
    );
  }

  const record = (before.cancellations || []).find((c) => String(c._id) === String(cancellationId));
  const refund = record?.refund || {};
  const amountPaise = Math.max(0, Math.floor(Number(refund.amountPaise) || 0));
  /*
    Each effect is reversed by the figure it ACTUALLY applied, read from the record the
    mark wrote on its success path — never by the refund's face value, and never inferred
    from the `paymentIncremented` / `ltvAdjusted` claim flags, which are set before the
    work and stay `true` when a best-effort step throws.
  */
  const clawbackPaise = Math.max(0, Math.floor(Number(refund.affiliateClawbackPaise) || 0));
  const paymentRecordedPaise = Math.max(0, Math.floor(Number(refund.paymentRecordedPaise) || 0));
  const ltvDecrementedPaise = Math.max(0, Math.floor(Number(refund.ltvDecrementedPaise) || 0));

  const { warnings } = await reverseRefundSideEffects({
    orderId: before._id,
    // Both WERE applied on this surface (applyCancellationRefundSideEffectsOnce), so
    // both are reversed — each by what it actually moved.
    userId: ltvDecrementedPaise > 0 ? (before.user || null) : null,
    affiliateClawbackPaise: clawbackPaise,
    paymentId: before.payment || null,
    amountPaise: paymentRecordedPaise,
    ltvPaise: ltvDecrementedPaise,
    // A per-line cancellation refund never moves the payment axis, so there is nothing
    // to restore — the order stayed `paid` throughout.
    restorePaidStatus: false,
    label: `cancellation ${cancellationId}`,
    reason: 'cancellation_refund_reverted',
  });

  await bestEffort(warnings, 'audit log', { orderId: String(orderId), label: `cancellation ${cancellationId}` }, () =>
    auditLogger.logAction(req, 'CANCELLATION_REFUND_REVERTED', 'Order', orderId, {
      cancellationId: String(cancellationId),
      amount: fromPaise(amountPaise),
      offlineMethod: record?.refund?.offlineMethod,
      reference: record?.refund?.offlineReference,
      reason,
    }));

  return {
    amountRupees: fromPaise(amountPaise),
    warnings,
    message: `Withdrew the ₹${fromPaise(amountPaise)} offline refund record on this cancellation. `
      + 'It is back to "refund due".'
      + (warnings.length ? ` Some follow-up steps need checking: ${warnings.join(', ')}.` : ''),
  };
};

export default {
  markOrderRefundOffline,
  revertOrderRefund,
  markCancellationRefundOffline,
  revertCancellationRefund,
};
