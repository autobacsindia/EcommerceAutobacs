/**
 * The affiliate commission ledger — accrual, maturation, clawback.
 *
 * ── THE THREE RULES ──────────────────────────────────────────────────────────────
 *
 * 1. COMMISSION IS OUR COST, NOT THE CUSTOMER'S MONEY. Nothing here ever touches
 *    Order.discount, the invoice, or a refund amount. The buyer's discount rode the
 *    affiliate's managed Coupon and is already inside `Order.discount`.
 *
 * 2. THE BASE IS refundMathService.orderGoodsNetPaise — the SAME pot the refund path
 *    prorates against. That is not a stylistic choice: it is what makes clawback exact
 *    rather than approximate. A full refund claws back to the paise; a partial return
 *    claws back exactly the returned lines' share, because both sides are measured
 *    against one number.
 *
 * 3. THE KILL SWITCH GATES MONEY GOING OUT, NEVER MONEY COMING BACK.
 *    `isAffiliateEnabled()` guards accrual and maturation — the paths that create or
 *    release a liability. It deliberately does NOT guard the clawbacks.
 *
 *    Every clawback is invoked from behind a one-shot claim (the two refund side-effect
 *    modules) or a queue job, so returning `skipped: disabled` there is not a deferral,
 *    it is a PERMANENT LOSS: the claim is already spent and nothing will call it again.
 *    Flipping the switch off mid-refund would stop us recovering commission on returned
 *    goods while leaving every existing liability intact — the exact opposite of what an
 *    operator reaching for a kill switch intends. Clawbacks are harmless when the
 *    programme never ran: with no accrual row they return `no_commission`.
 *
 * 4. EVERY WRITE HERE IS IDEMPOTENT. Razorpay retries webhooks, refunds fire from two
 *    code paths, and the cron re-runs. Accrual is guarded by a partial-unique index;
 *    maturation by a compare-and-set; clawback by the claim already held by the two
 *    refund side-effect modules, plus a clamp to what is actually outstanding.
 *
 * ── WHAT THIS MODULE MUST NOT IMPORT ─────────────────────────────────────────────
 * `orderStatusService`, `cancellationService`, `returnController`, `razorpayService`.
 * All four call INTO this module (directly or via the workers), and razorpayService in
 * particular cannot be imported by anything it imports. Same constraint, and the same
 * reason, as services/cancellationRefundSideEffects.js.
 *
 * ── WHY EVERYTHING RUNS POST-COMMIT, OUTSIDE ANY TRANSACTION ─────────────────────
 * Because it writes ONLY AffiliateCommission rows and never the Order document, it
 * cannot deadlock against an open order transaction. That is deliberate and load-
 * bearing: the obvious "improvement" — moving accrual into
 * orderStatusService._syncCrmOnStatus so it rides the money transaction — would put an
 * Order-adjacent write inside a transaction that already holds that document. WiredTiger
 * does not fail fast on that; it waits for the 60s reaper, withTransaction retries, and
 * the whole Razorpay capture dies after ~180s. That happened, to every capture, and it
 * is not worth rediscovering.
 */

import * as Sentry from '@sentry/node';
import affiliateCommissionRepository from '../repositories/affiliateCommissionRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import returnRequestRepository from '../repositories/returnRequestRepository.js';
import { orderGoodsNetPaise, refundableForLines } from './refundMathService.js';
import { toPaise, fromPaise } from '../utils/money.js';
import { deliveredAtForItem, isFullyDelivered } from '../utils/orderFulfilment.js';
import { cancelledQuantityByItem } from '../utils/orderCancellation.js';
import { IN_FLIGHT_RETURN_STATUSES, RETURN_WINDOW_DAYS } from '../config/returnPolicy.js';
import {
  COMMISSION_STATUS,
  COMMISSION_TYPE,
  MATURATION_BATCH_SIZE,
  isAffiliateEnabled,
} from '../config/affiliate.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Commission on an amount, in paise.
 *
 * ⚠️ ALWAYS FLOOR. Same never-round-up rule as refundMathService, in the same
 * direction: a paise rounded our way is a rounding artefact, a paise rounded outward
 * is an unfunded liability repeated across every order forever.
 */
export const commissionPaise = (basePaise, percent) =>
  Math.floor((Math.max(0, basePaise) * (Number(percent) || 0)) / 100);

/**
 * When this order's commission becomes payable, or null if it cannot yet.
 *
 * Pure — no I/O — so it can be asserted directly. Three conditions, all required:
 *
 *   1. Every live unit has arrived (`isFullyDelivered`).
 *
 *      ⚠️ NOT `order.status === 'delivered'`. Status is a DERIVED roll-up over parcels;
 *      reading it here would be reading a cache of the thing we actually need, and on a
 *      split order it can say `shipped` while every parcel has in fact landed.
 *
 *   2. The return window has closed on the LAST line to arrive.
 *
 *      `max`, not `min`. Within a line, deliveredAtForItem hedges toward the buyer;
 *      here we hedge toward paying LATER, which is the correct direction for a payable —
 *      the order is only safe once nothing on it can still come back.
 *
 *   3. Nothing is in flight. Handled by the caller, which needs a DB read.
 *
 * Legacy orders with no parcels fall back to the order-level delivery date inside
 * `deliveredAtForItem`, so orders that predate split shipments behave exactly as they
 * always did rather than being frozen as permanently un-matured.
 *
 * @returns {Date|null}
 */
export const maturityDateFor = (order) => {
  /*
    ⚠️ LEGACY ORDERS HAVE NO PARCELS, and `isFullyDelivered` is parcel-derived — with no
    shipments it sees zero delivered units and answers false, forever.

    Orders placed before split shipments existed would therefore never mature and their
    affiliates would never be paid, with nothing to show why. So for a parcel-less order
    we fall back to the order-level status, which is exactly what that status asserted
    before parcels existed. This mirrors the documented fallback in
    utils/orderReturns.js#deliveredQuantityByProduct and the one inside
    `deliveredAtForItem` below; all three have to agree or a legacy order behaves
    differently depending on which one you ask.
  */
  const hasParcels = Boolean((order?.shipments || []).length);
  if (hasParcels) {
    if (!isFullyDelivered(order)) return null;
  } else if (order?.status !== 'delivered') {
    return null;
  }

  const cancelled = cancelledQuantityByItem(order);
  let latest = null;

  for (const item of order?.items || []) {
    const id = String(item._id);
    // A fully cancelled line never arrived and never will, so it must not veto
    // maturity — otherwise a partly cancelled order could never pay out.
    const live = Math.max(0, (item.quantity || 0) - (cancelled.get(id) || 0));
    if (live === 0) continue;

    const at = deliveredAtForItem(order, item._id);
    if (!at) return null; // a live line with no delivery date: not fully delivered
    if (!latest || at > latest) latest = at;
  }

  if (!latest) return null;
  return new Date(latest.getTime() + RETURN_WINDOW_DAYS * DAY_MS);
};

/** Is any return on this order still moving? A raised return freezes maturation. */
const hasInFlightReturn = async (orderId) => {
  const count = await returnRequestRepository.countDocuments({
    order: orderId,
    status: { $in: IN_FLIGHT_RETURN_STATUSES },
  });
  return count > 0;
};

class AffiliateCommissionService {
  /**
   * Record the commission owed on a paid order. Called from
   * razorpayService.processPaymentSuccess, post-commit, fire-and-forget.
   *
   * Idempotent twice over: the caller gates on `createdHere` so duplicate webhooks do
   * not even reach here, and the partial-unique `{order, type:'accrual'}` index makes a
   * concurrent double-delivery impossible to double-credit. E11000 is treated as
   * success, because it means the row this call wanted already exists.
   *
   * @returns {Promise<{status:'created'|'exists'|'skipped', reason?:string}>}
   */
  async accrueForOrder(orderId) {
    if (!isAffiliateEnabled()) return { status: 'skipped', reason: 'disabled' };

    const order = await orderRepository.findById(orderId);
    if (!order) return { status: 'skipped', reason: 'order_not_found' };

    const attribution = order.affiliate;
    if (!attribution?.affiliate) return { status: 'skipped', reason: 'not_referred' };

    /*
      The rate comes from the ORDER's snapshot, never from the live Affiliate document.
      Raising someone's rate in March must not retroactively repay January — the same
      instinct that makes an order snapshot its own prices and titles.
    */
    const basePaise = orderGoodsNetPaise(order);
    const percent = attribution.commissionPercent;
    const amountPaise = commissionPaise(basePaise, percent);

    try {
      await affiliateCommissionRepository.createRow({
        affiliate: attribution.affiliate,
        order: order._id,
        user: order.user || null,
        type: COMMISSION_TYPE.ACCRUAL,
        amountPaise,
        basePaise,
        percent,
        code: attribution.code,
        source: attribution.source,
        status: COMMISSION_STATUS.PENDING,
        // maturesAt is stamped on delivery, not here. An order that never arrives never
        // becomes payable — fail-closed, deliberately.
        maturesAt: null,
      });
      return { status: 'created' };
    } catch (err) {
      if (err?.code === 11000) return { status: 'exists' };
      throw err;
    }
  }

  /**
   * Stamp the maturity date once the order is fully delivered.
   *
   * Called from the `post-order-delivered` worker. The stamp is an OPTIMISATION — it
   * turns the sweep into an indexed range scan instead of a walk of every pending row —
   * not the gate: `sweepMaturity` re-verifies everything against the live order.
   *
   * Guarded on `maturesAt: null`, so a re-delivered parcel or a retried job can never
   * push a due date forward and delay a payment that was already owed.
   */
  async stampMaturity(orderId) {
    if (!isAffiliateEnabled()) return { status: 'skipped', reason: 'disabled' };

    const order = await orderRepository.findById(orderId);
    if (!order) return { status: 'skipped', reason: 'order_not_found' };
    if (!order.affiliate?.affiliate) return { status: 'skipped', reason: 'not_referred' };

    const maturesAt = maturityDateFor(order);
    if (!maturesAt) return { status: 'skipped', reason: 'not_fully_delivered' };

    const stamped = await affiliateCommissionRepository.stampMaturity(order._id, maturesAt);
    return { status: stamped ? 'stamped' : 'unchanged', maturesAt };
  }

  /**
   * Move matured commissions pending → approved. The cron's entry point.
   *
   * The stamped date gets a row LOOKED AT; these checks are what get it APPROVED. They
   * are re-run against the live order because the stamp can be stale by days: a return
   * may have been raised, or lines cancelled, since it was written.
   */
  async sweepMaturity(now = new Date(), limit = MATURATION_BATCH_SIZE) {
    if (!isAffiliateEnabled()) return { approved: 0, skipped: 0, examined: 0 };

    let approved = 0;
    let skipped = 0;
    let examined = 0;
    let cursor = null;

    /*
      ⚠️ PAGED, NOT A SINGLE `LIMIT` — otherwise the sweep STARVES.

      The candidate query is ordered by `maturesAt` ascending, so the oldest rows come
      first. A row that is skipped is not consumed: an order with an in-flight return is
      skipped every night and keeps its place at the head of that ordering. Take a flat
      200 and 200 such rows are enough to fill the whole batch forever — no commission
      ever matures again, and the only symptom is a number that quietly stops moving.

      So we walk PAST skipped rows with a keyset cursor on `maturesAt` instead of
      re-reading the same head every time. `MAX_BATCHES` bounds one run's work, and the
      cron re-runs daily, so a genuinely enormous backlog drains over a few nights rather
      than blocking the queue or producing an unbounded write burst.
    */
    const MAX_BATCHES = 50;

    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const candidates = await affiliateCommissionRepository.findMaturable(now, limit, cursor);
      if (candidates.length === 0) break;

      examined += candidates.length;
      // Advance past this page whether or not its rows were approved.
      cursor = candidates.at(-1).maturesAt;

      const outcome = await this._processMaturationBatch(candidates, now);
      approved += outcome.approved;
      skipped += outcome.skipped;

      if (candidates.length < limit) break;
    }

    return { approved, skipped, examined };
  }

  /** One page of the maturation sweep. Extracted so the paging loop above stays legible. */
  async _processMaturationBatch(candidates, now) {
    let approved = 0;
    let skipped = 0;

    for (const row of candidates) {
      try {
        const order = await orderRepository.findById(row.order);

        // Re-verify condition 1+2 against the live order — lines may have been
        // cancelled, or a delivery reversed, since the stamp was written.
        if (!order || !maturityDateFor(order) || maturityDateFor(order) > now) {
          skipped += 1;
          continue;
        }

        /*
          Condition 3. A raised-but-unresolved return freezes maturation regardless of
          the clock: the goods may be coming back, and paying out first turns a refund
          into a debt we have to chase. Push, don't approve — the next sweep will pick
          it up once the return resolves.
        */
        if (await hasInFlightReturn(row.order)) {
          skipped += 1;
          continue;
        }

        // Compare-and-set on `status: 'pending'`, so a clawback that moved this row to
        // `reversed` between the read above and this write cannot be resurrected into
        // a payable.
        if (await affiliateCommissionRepository.approveOnce(row._id, now)) approved += 1;
        else skipped += 1;
      } catch (err) {
        skipped += 1;
        console.error(`[Affiliate] Maturation failed for commission ${row._id}:`, err.message);
        Sentry.captureException(err);
      }
    }

    return { approved, skipped };
  }

  /**
   * Claw back commission for specific returned/cancelled lines, proportionally.
   *
   * Reuses `refundMathService.refundableForLines`, which measures those lines against
   * the same `orderGoodsNetPaise` pot the accrual used. That is what makes this exact:
   * Σ(clawbacks) ≤ accrual by construction, a full return nets to zero to the paise, and
   * a per-product-tier order is handled for free because that function already switches
   * to each line's own snapshotted attribution.
   *
   * @param {string} orderId
   * @param {Array}  lines   [{ product, variantId?, quantity, unitPrice? }]
   * @param {string} reason
   */
  async clawbackForLines(orderId, lines, reason = 'refund') {
    if (!lines?.length) return { status: 'noop', reason: 'no_lines' };

    const order = await orderRepository.findById(orderId);
    if (!order) return { status: 'skipped', reason: 'order_not_found' };

    const accrual = await affiliateCommissionRepository.findAccrual(orderId);
    if (!accrual) return { status: 'noop', reason: 'no_commission' };

    const { netRupees } = refundableForLines(order, lines);
    const wantPaise = this._clawbackTarget(accrual, toPaise(netRupees));

    return this._writeClawback(order, accrual, wantPaise, reason);
  }

  /** Claw back the WHOLE commission — a full cancel or a full refund. */
  async clawbackForOrder(orderId, reason = 'order_cancelled') {
    const order = await orderRepository.findById(orderId);
    if (!order) return { status: 'skipped', reason: 'order_not_found' };

    const accrual = await affiliateCommissionRepository.findAccrual(orderId);
    if (!accrual) return { status: 'noop', reason: 'no_commission' };

    // Everything still standing, whatever partial clawbacks already happened.
    const outstanding = await affiliateCommissionRepository.netPaiseForOrder(orderId);
    return this._writeClawback(order, accrual, outstanding, reason);
  }

  /**
   * Claw back in proportion to a refunded AMOUNT, when the lines are not known.
   *
   * The offline/dashboard refund path: an operator recorded a rupee figure with no
   * line breakdown. Proportional to the order's goods pot, which is the best that can
   * honestly be done from an amount alone.
   */
  async clawbackForAmount(orderId, refundedGoodsPaise, reason = 'refund') {
    const order = await orderRepository.findById(orderId);
    if (!order) return { status: 'skipped', reason: 'order_not_found' };

    const accrual = await affiliateCommissionRepository.findAccrual(orderId);
    if (!accrual) return { status: 'noop', reason: 'no_commission' };

    const goodsPaise = orderGoodsNetPaise(order);
    if (goodsPaise <= 0) return { status: 'noop', reason: 'no_goods_value' };

    return this._writeClawback(
      order,
      accrual,
      this._clawbackTarget(accrual, refundedGoodsPaise),
      reason,
    );
  }

  /**
   * Void an order's commission outright — an explicit admin decision (fraud, error).
   *
   * Distinct from a clawback: a clawback records that money came back, and stays in the
   * ledger as a negative row. A void says this was never owed. `paid` rows are NOT
   * voided — that money has left the bank, and rewriting the row would stop the payout
   * reconciling with the bank statement. Recovering it is a clawback, i.e. a debt.
   */
  async voidForOrder(orderId, reason = 'admin_void') {
    const accrual = await affiliateCommissionRepository.findAccrual(orderId);
    if (!accrual) return { status: 'noop', reason: 'no_commission' };
    if (accrual.status === COMMISSION_STATUS.PAID) {
      return { status: 'skipped', reason: 'already_paid' };
    }

    const voided = await affiliateCommissionRepository.transitionOnce(
      accrual._id,
      [COMMISSION_STATUS.PENDING, COMMISSION_STATUS.APPROVED],
      { status: COMMISSION_STATUS.VOID, note: reason },
    );
    return { status: voided ? 'voided' : 'unchanged' };
  }

  /**
   * How much to claw back when `returnedPaise` of the goods pot has gone back.
   *
   * ⚠️ Computed as "the accrual MINUS what is still owed on what the customer KEPT",
   * not as "commission on what came back". The two differ by rounding, and the
   * difference matters:
   *
   *   refundMathService floors every per-line share, so Σ(floored shares) is up to one
   *   paise SHORT of the pot per line. Taking commission of that short figure leaves a
   *   residue behind on a fully returned order — a few paise that can never be paid and
   *   never go away, showing as a permanent "payable" on an order where nothing is owed.
   *   Across thousands of orders those crumbs add up to a liability that is not real.
   *
   * Framing it as the complement removes the residue by construction: return everything
   * and the kept pot is ~0, so the target is the whole accrual. It also self-corrects
   * across INCREMENTAL returns — each call computes a target that ignores earlier ones
   * and is therefore too large, and `_writeClawback`'s clamp trims it to whatever is
   * actually left. It can never under-claw, and it can never over-claw past zero.
   */
  _clawbackTarget(accrual, returnedPaise) {
    const keptPaise = Math.max(0, accrual.basePaise - Math.max(0, returnedPaise));
    const stillOwedPaise = commissionPaise(keptPaise, accrual.percent);
    return Math.max(0, accrual.amountPaise - stillOwedPaise);
  }

  /**
   * Write one clawback row, clamped to what is actually outstanding.
   *
   * ⚠️ The clamp is what makes a DOUBLE-FIRED clawback safe. The same refund can be
   * reported twice — once by the controller that initiated it and once by the
   * `refund.processed` webhook — and while the two side-effect modules each hold a
   * claim, the clamp means even a leak through both can only ever reduce this order to
   * zero. It can never go negative and start owing the affiliate money back.
   *
   * ── WHY A PAID ROW IS NEVER REWRITTEN ────────────────────────────────────────
   * If the accrual has already been paid out, this still writes a NEGATIVE `approved`
   * row rather than mutating it. That row lands in exactly the set the payout batch
   * claims (`status:'approved', payout:null`), so the debt nets off the affiliate's next
   * batch with no special code path at all — and if it exceeds what they are owed, the
   * balance goes negative and the batch builder refuses. A `paid` row records money that
   * genuinely left the bank; rewriting it would break reconciliation against the
   * statement, exactly as rewriting an order's totals would break its invoice.
   */
  async _writeClawback(order, accrual, wantPaise, reason) {
    const outstanding = await affiliateCommissionRepository.netPaiseForOrder(order._id);
    const clawPaise = Math.min(Math.max(0, wantPaise), Math.max(0, outstanding));

    if (clawPaise <= 0) return { status: 'noop', reason: 'nothing_outstanding' };

    await affiliateCommissionRepository.createRow({
      affiliate: accrual.affiliate,
      order: order._id,
      user: order.user || null,
      type: COMMISSION_TYPE.CLAWBACK,
      amountPaise: -clawPaise,
      basePaise: accrual.basePaise,
      percent: accrual.percent,
      code: accrual.code,
      source: accrual.source,
      /*
        `approved` so it is immediately claimable by the next payout batch — a debt has
        to be nettable the moment it exists, not sit pending behind a maturity date that
        will never come for a refunded order.
      */
      status: COMMISSION_STATUS.APPROVED,
      approvedAt: new Date(),
      reversalOf: accrual._id,
      note: reason,
    });

    /*
      Once nothing is left standing, the accrual itself is marked reversed — but ONLY if
      it was never paid. A `paid` row keeps its status; the negative row alongside it is
      the whole record of the debt.
    */
    const remaining = await affiliateCommissionRepository.netPaiseForOrder(order._id);
    if (remaining <= 0) {
      await affiliateCommissionRepository.transitionOnce(
        accrual._id,
        [COMMISSION_STATUS.PENDING, COMMISSION_STATUS.APPROVED],
        { status: COMMISSION_STATUS.REVERSED },
      );
    }

    return { status: 'clawed_back', amountPaise: clawPaise, rupees: fromPaise(clawPaise) };
  }
}

export default new AffiliateCommissionService();
