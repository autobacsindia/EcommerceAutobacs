/**
 * Split shipments — creating parcels and moving them through transit.
 *
 * An order can leave in several boxes. This service owns the writes to
 * `Order.shipments[]` and keeps the order-level `status` in step by rolling it up from
 * the parcels (utils/orderFulfilment.js). It deliberately does NOT own the customer
 * email text or the loyalty side-effects — those stay with orderStatusService and the
 * notification worker, so there remains exactly one place that decides what a status
 * change means.
 *
 * ── WHY THE WRITES LOOK LIKE THIS ─────────────────────────────────────────────────
 * Creating a parcel is a compare-and-set, not a read-then-write. Two admins shipping
 * the same order concurrently would each read "1 left to ship", each validate happily,
 * and each push — shipping two units of a one-unit line. The push is therefore
 * conditional on the shipment array being unchanged since validation, and a lost race
 * re-reads and re-validates instead of retrying blindly.
 *
 * ── EMAILS ────────────────────────────────────────────────────────────────────────
 * Each parcel gets its OWN email, keyed by shipment id. The order-level status email is
 * suppressed on these transitions, because the roll-up to `shipped` fires once while
 * three parcels each deserve their own notification. See orderStatusEmailService for
 * the idempotency key that makes parcel 2's email possible at all.
 */

import orderRepository from '../repositories/orderRepository.js';
import orderStatusService from './orderStatusService.js';
import { getNotificationsQueue } from '../queue/queues.js';
import {
  SHIPMENT_STATUS,
  rollUpStatus,
  validateProposedShipment,
  remainingToShip,
  rewardShipped,
  fulfilmentSummary,
} from '../utils/orderFulfilment.js';
import { owesGoodie } from '../utils/orderLines.js';
import * as Sentry from '@sentry/node';

// Bounded retries for the compare-and-set. A conflict means another admin shipped
// something while we validated; re-reading resolves it. More than a couple of rounds
// means sustained contention on one order, which is not a real workflow.
const MAX_PUSH_ATTEMPTS = 4;

// Order states in which new parcels may be created. Shipping something that was never
// paid for, or that has been cancelled/returned, is always a mistake.
const SHIPPABLE_STATUSES = new Set(['processing', 'shipped']);

class ShipmentService {
  /**
   * Create a parcel and (optionally) hand it straight to the courier.
   *
   * @param {string} orderId
   * @param {object} payload
   * @param {Array<{itemId: string, quantity: number}>} [payload.lines] - omit to take
   *   everything still owed (the "ship the rest" case, and what the legacy
   *   single-parcel ship path sends).
   * @param {boolean} [payload.includesReward] - put the won goodie in THIS box. Defaults
   *   to true when this parcel completes the order, so the gift cannot be stranded.
   * @param {string} [payload.trackingNumber]
   * @param {object} [payload.carrier] - { name, code, trackingUrl }
   * @param {Date}   [payload.estimatedDelivery]
   * @param {object} [payload.shippingSlip] - { url, publicId, uploadedAt }
   * @param {boolean} [payload.dispatch=true] - false leaves the parcel `packed`
   * @param {string} [payload.notes]
   * @param {object} [opts]
   * @param {string} [opts.userId] - admin creating it
   * @returns {Promise<{success: boolean, message: string, order?: object, shipment?: object}>}
   */
  async createShipment(orderId, payload = {}, opts = {}) {
    const { userId } = opts;
    const dispatch = payload.dispatch !== false;

    for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt += 1) {
      const order = await orderRepository.findById(orderId);
      if (!order) return { success: false, message: 'Order not found' };

      if (!SHIPPABLE_STATUSES.has(order.status)) {
        return {
          success: false,
          message: `Cannot ship an order in '${order.status}'. Only paid, un-cancelled orders can be dispatched.`,
        };
      }
      if (order.paymentStatus !== 'paid') {
        return { success: false, message: 'Cannot ship an order that has not been paid for.' };
      }

      // Default: everything still owed. This is what makes the pre-existing
      // "mark the order shipped" action keep behaving exactly as it always did —
      // it becomes one parcel containing the whole order.
      const outstanding = remainingToShip(order);
      /*
        `lines` OMITTED means "everything still owed" — the legacy whole-order dispatch.
        `lines: []` means "no sale items in this box", which is a real request: a
        goodie-only parcel sent after the goods have gone. Collapsing the two with a
        truthiness check shipped the entire remainder when the caller explicitly asked
        for nothing, so the distinction has to survive.
      */
      const source = Array.isArray(payload.lines) ? payload.lines : outstanding;
      const lines = source.map((l) => ({
        itemId: String(l.itemId),
        quantity: Number(l.quantity),
      }));

      /*
        The gift rides along when this parcel finishes the order, unless the caller said
        otherwise. Stranding it would leave the order permanently incomplete.

        `owesGoodie` is part of the condition, not an afterthought: without it an order
        with NO gift (or a coupon/karma prize, or a withdrawn one) defaults to
        "put the goodie in" the moment a parcel completes it, and validation then
        rejects the whole shipment with "this order has no goodie to send".
      */
      const completesOrder =
        outstanding.length > 0 &&
        outstanding.every((o) =>
          lines.some((l) => l.itemId === o.itemId && l.quantity >= o.quantity));
      const includesReward =
        payload.includesReward ?? (completesOrder && owesGoodie(order) && !rewardShipped(order));

      const proposed = { lines, includesReward };
      const check = validateProposedShipment(order, proposed);
      if (!check.valid) return { success: false, message: check.message };

      const now = new Date();
      const shipment = {
        sequence: (order.shipments?.length || 0) + 1,
        status: dispatch ? SHIPMENT_STATUS.SHIPPED : SHIPMENT_STATUS.PACKED,
        lines,
        includesReward,
        trackingNumber: payload.trackingNumber,
        carrier: payload.carrier,
        shippingSlip: payload.shippingSlip,
        estimatedDelivery: payload.estimatedDelivery,
        shippedAt: dispatch ? now : undefined,
        createdBy: userId,
        notes: payload.notes,
      };

      /*
        Mirror the FIRST parcel's tracking onto the order's legacy flat fields.

        `Order.trackingNumber` / `carrier` / `shippingSlip` predate parcels and are still
        read by orderTrackingService, the customer tracking panel and the order-level
        email. Keeping them in step for the single-parcel case — which is the vast
        majority of orders — means none of those readers had to change. A SECOND parcel
        deliberately does not overwrite them: there is no honest single answer once two
        boxes are in flight, and silently showing parcel 2's AWB as "the" tracking
        number is worse than leaving the first one, which the per-parcel UI supersedes.
      */
      const mirror = (order.shipments?.length || 0) === 0 ? {
        trackingNumber: payload.trackingNumber,
        carrier: payload.carrier,
        shippingSlip: payload.shippingSlip,
        estimatedDelivery: payload.estimatedDelivery,
      } : null;

      // Compare-and-set: only lands if no other parcel appeared while we validated.
      const updated = await orderRepository.pushShipmentIfUnchanged(
        orderId,
        order.shipments?.length || 0,
        shipment,
        mirror,
      );
      if (!updated) continue; // lost the race — re-read and re-validate

      const created = updated.shipments[updated.shipments.length - 1];
      await this._syncOrderStatus(updated, userId);
      if (dispatch) this._enqueueShipmentEmail(orderId, created._id.toString(), 'shipped');

      return {
        success: true,
        message: `Parcel ${created.sequence} created`,
        order: updated,
        shipment: created,
      };
    }

    return {
      success: false,
      message: 'Another parcel was created for this order at the same time. Please review and try again.',
    };
  }

  /**
   * Mark one parcel delivered.
   *
   * Idempotent by construction: the write is matched on the parcel still being
   * `shipped`, so a double-click or a retried job finds nothing to update and is
   * reported as already-delivered rather than re-stamping the date and re-emailing.
   *
   * @param {string} orderId
   * @param {string} shipmentId
   * @param {object} [opts]
   * @param {string} [opts.userId]
   * @returns {Promise<{success: boolean, message: string, order?: object, alreadyDelivered?: boolean}>}
   */
  async markShipmentDelivered(orderId, shipmentId, opts = {}) {
    const updated = await orderRepository.transitionShipment(
      orderId, shipmentId, SHIPMENT_STATUS.SHIPPED, SHIPMENT_STATUS.DELIVERED,
    );

    if (!updated) {
      const order = await orderRepository.findById(orderId);
      if (!order) return { success: false, message: 'Order not found' };
      const parcel = (order.shipments || []).find((s) => String(s._id) === String(shipmentId));
      if (!parcel) return { success: false, message: 'Parcel not found on this order' };
      if (parcel.status === SHIPMENT_STATUS.DELIVERED) {
        return { success: true, message: 'Parcel was already delivered', order, alreadyDelivered: true };
      }
      return {
        success: false,
        message: `Parcel ${parcel.sequence} is '${parcel.status}' — only a shipped parcel can be marked delivered.`,
      };
    }

    await this._syncOrderStatus(updated, opts.userId);
    this._enqueueShipmentEmail(orderId, String(shipmentId), 'delivered');

    return { success: true, message: 'Parcel marked delivered', order: updated };
  }

  /**
   * Hand an already-packed parcel to the courier.
   *
   * Without this a `packed` parcel is a trap: its units are consumed from
   * `remainingToShip`, so they can never be put in another box, and no transition moves
   * it onward — the order could never reach `shipped` or `delivered`.
   *
   * Matched on the parcel still being `packed`, so a retry is a no-op rather than a
   * second dispatch email.
   */
  async dispatchShipment(orderId, shipmentId, payload = {}, opts = {}) {
    const extra = {};
    if (payload.trackingNumber) extra.trackingNumber = payload.trackingNumber;
    if (payload.carrier) extra.carrier = payload.carrier;
    if (payload.estimatedDelivery) extra.estimatedDelivery = payload.estimatedDelivery;

    const updated = await orderRepository.transitionShipment(
      orderId, shipmentId, SHIPMENT_STATUS.PACKED, SHIPMENT_STATUS.SHIPPED, extra,
    );
    if (!updated) {
      return { success: false, message: 'Parcel not found, or it has already been dispatched.' };
    }

    await this._syncOrderStatus(updated, opts.userId);
    this._enqueueShipmentEmail(orderId, String(shipmentId), 'shipped');
    return { success: true, message: 'Parcel dispatched', order: updated };
  }

  /**
   * Write off a parcel the courier lost. Its units return to "still owed" so a
   * replacement can be sent, which also drags the order back off `delivered`/`shipped`
   * if nothing else is in transit.
   */
  async markShipmentLost(orderId, shipmentId, opts = {}) {
    const updated = await orderRepository.transitionShipment(
      orderId, shipmentId, SHIPMENT_STATUS.SHIPPED, SHIPMENT_STATUS.LOST,
      opts.notes ? { notes: opts.notes } : {},
    );
    if (!updated) {
      return { success: false, message: 'Parcel not found, or it is not currently in transit.' };
    }
    await this._syncOrderStatus(updated, opts.userId);
    return { success: true, message: 'Parcel written off as lost', order: updated };
  }

  /**
   * Mark every outstanding parcel delivered, because the whole order was.
   *
   * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────
   * The admin status dropdown still offers `delivered` for the whole order, and that is
   * a reasonable thing to want. But setting `Order.status` alone leaves every parcel at
   * `shipped`, and once an order HAS parcels the per-line return window reads their
   * dates — not the order's. The result was an order that says "delivered" while
   * `deliveredAtForItem` returns null for every line, so the return window never opens:
   * the backend refuses every return and the customer's Return button never appears.
   *
   * Marking the parcels is therefore not a nicety, it is what keeps the order's status
   * and its parcels from describing two different realities.
   *
   * Idempotent: each transition is matched on the parcel still being `shipped`, so
   * parcels already delivered are skipped rather than re-stamped or re-emailed.
   *
   * ── WHY THIS TAKES NO `userId`, UNLIKE ITS SIBLINGS ─────────────────────────────
   * markShipmentDelivered / markShipmentLost / createShipment each end with
   * `_syncOrderStatus(updated, opts.userId)`, which rolls the order up and attributes
   * the change. This one deliberately does NOT: its only caller is the admin
   * "mark the whole order delivered" path, which calls orderStatusService.updateOrderStatus
   * itself the moment this returns, with the admin's own id. Rolling up here as well
   * would push a SECOND status-history entry for one action and re-run every side
   * effect — the same duplicate this file already avoids after createShipment.
   *
   * So attribution is the caller's job here, and accepting a `userId` we then ignore
   * would advertise a guarantee this method does not make.
   *
   * @returns {Promise<{delivered: number}>} how many parcels this actually moved
   */
  async deliverAllOutstanding(orderId) {
    const order = await orderRepository.findById(orderId);
    if (!order) return { delivered: 0 };

    const pending = (order.shipments || []).filter(
      (sh) => sh.status === SHIPMENT_STATUS.SHIPPED || sh.status === SHIPMENT_STATUS.PACKED);

    let delivered = 0;
    for (const parcel of pending) {
      // A packed parcel has to be dispatched before it can arrive, or the transition
      // chain (and its shippedAt stamp) would be skipped entirely.
      if (parcel.status === SHIPMENT_STATUS.PACKED) {
        await orderRepository.transitionShipment(
          orderId, parcel._id, SHIPMENT_STATUS.PACKED, SHIPMENT_STATUS.SHIPPED, {});
      }
      const updated = await orderRepository.transitionShipment(
        orderId, parcel._id, SHIPMENT_STATUS.SHIPPED, SHIPMENT_STATUS.DELIVERED, {});
      if (updated) {
        delivered += 1;
        this._enqueueShipmentEmail(orderId, String(parcel._id), 'delivered');
      }
    }
    return { delivered };
  }

  /**
   * Read-only view for the admin/customer screens.
   * Uses the projected lean read — see orderRepository.findForFulfilment for the
   * measurement that earned it.
   */
  async getFulfilment(orderId) {
    const order = await orderRepository.findForFulfilment(orderId);
    if (!order) return null;
    return {
      shipments: order.shipments || [],
      remaining: remainingToShip(order),
      summary: fulfilmentSummary(order),
    };
  }

  /**
   * Bring `Order.status` in line with its parcels.
   *
   * Routed through orderStatusService so a roll-up keeps every meaning a status change
   * has always had — status history, fulfilment metrics, the CRM sync, and the
   * once-only loyalty effects (karma is awarded when the roll-up reaches `delivered`,
   * i.e. when the LAST parcel lands, guarded by `karmaAwarded`).
   *
   * The customer status email is suppressed: parcels send their own, one each. The
   * review-request job is NOT suppressed — it still fires once on final delivery.
   * @private
   */
  async _syncOrderStatus(order, userId) {
    const next = rollUpStatus(order);
    if (!next || next === order.status) return;

    const attempt = () => orderStatusService.updateOrderStatus(order._id.toString(), next, {
      userId,
      isAdmin: true,
      reason: 'admin_update',
      notes: `Rolled up from parcels (${fulfilmentSummary(order).label})`,
      suppressStatusEmail: true,
    });

    /*
      ── WHY THERE IS NO TRANSACTION AROUND THIS ────────────────────────────────────
      Writing the parcel and rolling the status up are two writes, and the obvious
      instinct is to wrap them. Two reasons not to:

      1. They both target the SAME document — the order. CLAUDE.md's transaction rule is
         about MULTI-document writes (order + payment record + stock + email trigger),
         where a mid-write failure orphans one of several records. There is no second
         record here to leave orphaned.
      2. This repo has already paid for that instinct once. A session-less write to a
         document an open transaction had itself written self-deadlocked until Mongo's
         60-second reaper, and it broke every Razorpay capture. orderStatusService does
         CRM and spin-clawback work with careful session-threading rules; dragging it
         into a transaction from here re-opens exactly that trap.

      What makes the gap safe instead is that the status is DERIVED. The parcels are the
      source of truth, `Order.status` is a cached roll-up of them, and every fulfilment
      view computes its label from the parcels rather than the cached status — so a stale
      status is a recoverable inconsistency, not lost data. The next parcel event on the
      order recomputes it from scratch.

      So: retry once (a transient write conflict is the likely failure), and if it still
      will not land, say so loudly enough that someone can repair it.
    */
    let result = await attempt();
    if (!result?.success) result = await attempt();

    if (!result?.success) {
      const message =
        `[Shipment] Roll-up to '${next}' FAILED for order ${order._id}: ${result?.message || 'unknown error'}. `
        + 'The parcel is committed and the customer notified; Order.status is stale until '
        + 'the next parcel event recomputes it. Parcels remain the source of truth.';
      console.error(message);
      Sentry.captureMessage(message, 'error');
    }
  }

  /**
   * Queue the per-parcel customer email.
   *
   * Best-effort and silent without Redis, matching every other notification path here.
   * The job carries the shipment id, which is what lets the worker send a SECOND
   * "shipped" email for a second parcel — the order-level guard alone would swallow it.
   * @private
   */
  _enqueueShipmentEmail(orderId, shipmentId, kind) {
    if (!process.env.REDIS_URL) return;
    getNotificationsQueue()
      .add('send-shipment-email', { orderId, shipmentId, kind })
      .catch((err) =>
        console.error(`[Shipment] Failed to enqueue ${kind} email for parcel ${shipmentId}:`, err.message));
  }
}

export default new ShipmentService();
