import BaseRepository from './baseRepository.js';
import Order from '../models/Order.js';

/**
 * "This array is still exactly N long" — as a compare-and-set condition that also works
 * on documents written before the field existed.
 *
 * ⚠️ `{ field: { $size: 0 } }` does NOT match a document that LACKS the field. Every
 * order written before `cancellations` was added to the schema has no such key, so the
 * naive guard matched 0 of 1,599 production orders and the FIRST cancellation on every
 * existing order would have failed with "another cancellation was recorded at the same
 * time". Tests could not see it: `Order.create()` materialises `cancellations: []` from
 * the schema, so the field is always present in a freshly-seeded document.
 *
 * @param {string} field
 * @param {number} expected
 * @returns {object} a query fragment
 */
const arrayUnchanged = (field, expected) => (
  expected === 0
    ? { $or: [{ [field]: { $size: 0 } }, { [field]: { $exists: false } }] }
    : { [field]: { $size: expected } }
);

class OrderRepository extends BaseRepository {
  constructor() {
    super(Order);
  }

  /**
   * A user's orders, newest first.
   *
   * @param {object} [options]
   * @param {string|null} [options.select=null] - projection. Null means the whole
   *   document, which is what every caller got before and what an un-migrated caller
   *   keeps getting. Opt in to a narrower shape explicitly.
   * @param {boolean} [options.withProducts=true] - join `items.product` for name/images.
   *   The CRM timeline sets this false: it never renders a line item, so the lookup is
   *   pure cost.
   */
  async findByUser(userId, options = {}) {
    const {
      limit = 10,
      skip = 0,
      session = null,
      select = null,
      withProducts = true,
    } = options;
    // .lean() stays TERMINAL: every conditional clause is applied to the query first.
    // Chaining after it works in Mongoose but reads as though lean were just another
    // modifier, and it is the step that stops returning a query you can keep building.
    let q = Order.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    if (select) q = q.select(select);
    if (withProducts) q = q.populate('items.product', 'name images');
    if (session) q = q.session(session);
    return q.lean();
  }

  async countByUser(userId, session = null) {
    let q = Order.countDocuments({ user: userId });
    if (session) q = q.session(session);
    return q;
  }

  // Full populate for getOrderById — returns lean object (read-only)
  async findWithPopulated(id) {
    return Order.findById(id)
      // wpId + variants (id/wpVariationId) are needed to derive the Meta catalogue
      // content_id per line item (utils/metaCatalogId.js) for CAPI + the order API.
      // The order API strips `variants` before responding (see getOrderById).
      .populate('items.product', 'name images price wpId variants._id variants.wpVariationId')
      .populate('user', 'name email phone')
      .populate('payment')
      .lean();
  }

  /**
   * Load a user's own order with product docs populated (savable Mongoose doc).
   * Used by the return flow to snapshot line prices + read Product.returnPolicy.
   *
   * PROJECTED deliberately. An unprojected `populate('items.product')` pulls whole
   * catalogue documents — description, gallery, variants, SEO — for every line, and the
   * return flow reads exactly two fields off them: `name` (for messages) and
   * `returnPolicy` (the non-returnable gate). Line price, quantity and variant all come
   * from the ORDER, which is the record of what was charged. Measured on a realistic
   * 3-line order: 20,070 B → 1,917 B (−90%).
   */
  async findOwnedWithProducts(orderId, userId) {
    return Order.findOne({ _id: orderId, user: userId }).populate('items.product', 'name returnPolicy');
  }

  /**
   * Same savable, product-populated shape as findOwnedWithProducts, but WITHOUT the
   * ownership filter — for an admin recording a return that was handled off-platform.
   * The ownership check is deliberately absent, not forgotten: the caller is behind
   * `protect + admin`, and the orders most likely to be settled over the counter are
   * legacy WooCommerce / guest orders that have no `user` to match on at all.
   */
  async findByIdWithProducts(orderId) {
    // `name` only: the offline path skips the non-returnable gate, so `returnPolicy` is
    // never read. Same measurement as above — 20,070 B → 1,728 B (−91%) on a 3-line order.
    return Order.findById(orderId).populate('items.product', 'name');
  }

  /** Mirror the return-request status onto the order summary subdoc. */
  async setReturnRequestStatus(orderId, status) {
    return Order.findByIdAndUpdate(orderId, { 'returnRequest.status': status });
  }

  /**
   * Move the FULFILLMENT axis to `returned` the moment operations approves a return,
   * so the admin Orders column stops reading "Delivered" while a return is in flight.
   *
   * Deliberately NOT routed through orderStatusService.updateOrderStatus(): that path
   * treats `returned` as "the money is back" — it maps paymentStatus → `refunded`,
   * claws back earned karma, releases the coupon, and emails the customer that their
   * order was returned. None of that is true at approval: the goods are still with the
   * customer and the refund amount is decided by hand after inspection. So we move the
   * fulfillment axis ONLY; the payment axis stays `paid` until the real refund lands
   * (returnController.initiateReturnRefund / the refund.* webhook), and the customer
   * already gets the "return approved" email from the return flow.
   *
   * Compare-and-set on `status: 'delivered'` is what makes it idempotent and race-safe:
   * a double-approval, or an order an admin has already moved by hand, matches zero
   * docs and no-ops instead of appending a duplicate history entry.
   *
   * @returns {Promise<boolean>} true when THIS call flipped the order.
   */
  async markReturnedOnReturnApproval(orderId, userId, note = 'Return approved — order marked returned') {
    const res = await Order.updateOne(
      { _id: orderId, status: 'delivered' },
      {
        $set: { status: 'returned' },
        $push: {
          statusHistory: {
            status: 'returned',
            timestamp: new Date(),
            updatedBy: userId,
            reason: 'return_completed',
            notes: note,
          },
        },
      }
    );
    return res.modifiedCount === 1;
  }

  /**
   * Undo the approval-time flip above when the return does NOT go through (failed
   * inspection, or the customer withdrew an approved request) — the order was in fact
   * delivered and kept, so it must not be stranded in the terminal `returned` state.
   *
   * Guarded on `status: 'returned'` AND a payment axis that hasn't been refunded, so a
   * return that already paid money back can never be walked backwards by a late call.
   *
   * @returns {Promise<boolean>} true when THIS call reverted the order.
   */
  async revertReturnToDelivered(orderId, userId, note = 'Return did not complete — order restored to delivered') {
    const res = await Order.updateOne(
      { _id: orderId, status: 'returned', paymentStatus: { $ne: 'refunded' }, 'refundDetails.status': { $ne: 'completed' } },
      {
        $set: { status: 'delivered' },
        $push: {
          statusHistory: {
            status: 'delivered',
            timestamp: new Date(),
            updatedBy: userId,
            reason: 'customer_received',
            notes: note,
          },
        },
      }
    );
    return res.modifiedCount === 1;
  }

  /**
   * Resolve an order by the Razorpay refund id we stored at initiation. Fallback path
   * for the refund webhook when notes.orderId is absent.
   */
  async findOneByRefundId(refundId, session = null) {
    let q = Order.findOne({ 'refundDetails.transactionId': refundId });
    if (session) q = q.session(session);
    return q;
  }

  /**
   * Atomically claim a cancelled, paid order's refund for processing. Compare-and-set is
   * the serialization point that makes refund initiation idempotent under a double-click
   * or concurrent admin requests: only the first caller transitions the order into
   * `processing` and gets `true`; every racing caller gets `false` and must not call the
   * gateway.
   *
   * The match also accepts an order with NO refundDetails (legacy / WooCommerce-imported
   * orders cancelled before the auto-flag existed), stamping a full-refund record so those
   * are refundable too — never a `processing`/`completed` order.
   *
   * @param {Object} order - Hydrated order (needs _id + totalAmount for a fresh record)
   * @param {string} userId - Admin performing the refund
   */
  async markRefundProcessing(order, userId, session = null) {
    const res = await Order.updateOne(
      {
        _id: order._id,
        status: 'cancelled',
        paymentStatus: 'paid',
        $or: [
          { 'refundDetails.status': { $in: ['pending', 'failed'] } },
          { refundDetails: { $exists: false } },
          { 'refundDetails.status': { $exists: false } }
        ]
      },
      {
        $set: {
          'refundDetails.amount': order.refundDetails?.amount ?? order.totalAmount,
          'refundDetails.refundType': order.refundDetails?.refundType || 'full',
          'refundDetails.refundMethod': order.refundDetails?.refundMethod || 'original_payment',
          'refundDetails.requestedAt': order.refundDetails?.requestedAt || new Date(),
          'refundDetails.status': 'processing',
          'refundDetails.processedBy': userId,
          'refundDetails.failureReason': null,
          // Re-arm the once-only Payment.refundAmount claim for this fresh attempt.
          'refundDetails.paymentRecorded': false,
          // Drop any note left by a PRIOR return refund that mirrored itself onto this
          // subdoc. refundMathService.remainingRefundable treats a "Return <id>" note as
          // "already counted via the ReturnRequest", so a stale one surviving into a
          // genuine cancellation refund would hide that refund from the running total.
          'refundDetails.notes': null,
          // Clear any id/timestamp from a prior attempt so a late webhook for the OLD
          // refund can't be mis-attributed to this new one (the mismatch guard in
          // applyRefundWebhook rejects a webhook whose id ≠ the freshly stored one).
          'refundDetails.transactionId': null,
          'refundDetails.processedAt': null
        }
      },
      session ? { session } : {}
    );
    return res.modifiedCount === 1;
  }

  /**
   * Record the outcome of a gateway refund call WITHOUT a read-modify-write. Conditioning
   * the update on `refundDetails.status === 'processing'` makes it a no-op if a concurrent
   * refund.processed/failed webhook already advanced the order to a terminal state, so the
   * controller can never clobber the webhook (or vice-versa).
   *
   * @param {string} orderId
   * @param {Object} opts
   * @param {string} opts.refundId   - Razorpay refund id to stamp
   * @param {boolean} opts.completed - true when the gateway already returned `processed`
   *                                   (instant speed); false leaves it `processing` for the
   *                                   webhook to complete.
   */
  async recordRefundResult(orderId, { refundId, completed }, session = null) {
    const set = { 'refundDetails.transactionId': refundId };
    if (completed) {
      set['refundDetails.status'] = 'completed';
      set['refundDetails.processedAt'] = new Date();
      set['paymentStatus'] = 'refunded';
    }
    const res = await Order.updateOne(
      { _id: orderId, 'refundDetails.status': 'processing' },
      { $set: set },
      session ? { session } : {}
    );
    return res.modifiedCount === 1;
  }

  /**
   * Flag an in-flight refund as failed (gateway threw). Conditional on `processing` for the
   * same anti-clobber reason as recordRefundResult; an admin can retry from the button.
   */
  /**
   * Atomically claim the cumulative Payment.refundAmount write for this order, once.
   * Twin of returnRequestRepository.claimPaymentRecord — see there for why the $inc
   * needs a claim at all (controller racing its own refund.processed webhook).
   */
  async claimRefundPaymentRecord(orderId, session = null) {
    const res = await Order.updateOne(
      { _id: orderId, 'refundDetails.paymentRecorded': { $ne: true } },
      { $set: { 'refundDetails.paymentRecorded': true } },
      session ? { session } : {}
    );
    return res.modifiedCount === 1;
  }

  async markRefundFailed(orderId, reason, session = null) {
    const res = await Order.updateOne(
      { _id: orderId, 'refundDetails.status': 'processing' },
      { $set: { 'refundDetails.status': 'failed', 'refundDetails.failureReason': reason } },
      session ? { session } : {}
    );
    return res.modifiedCount === 1;
  }

  async findWithRefunds(statusFilter, session = null) {
    // Legacy / WooCommerce-imported orders cancelled while paid never got a refundDetails
    // subdoc but are still refundable — surface them as effectively 'pending' so they're
    // actionable from the refunds screen, not just the order detail page.
    const legacyDue = {
      status: 'cancelled',
      paymentStatus: 'paid',
      'refundDetails.status': { $exists: false }
    };

    // A *real* refund is always stamped with `refundDetails.requestedAt` at write
    // time. Requiring it excludes phantom subdocs (the removed `status: 'pending'`
    // schema default left every order with an empty refundDetails), so the queue is
    // correct even before the cleanup migration has run.
    const realRefund = { 'refundDetails.requestedAt': { $exists: true } };

    let query;
    if (statusFilter && statusFilter !== 'all') {
      query = statusFilter === 'pending'
        ? { $or: [{ ...realRefund, 'refundDetails.status': 'pending' }, legacyDue] }
        : { ...realRefund, 'refundDetails.status': statusFilter };
    } else {
      query = { $or: [realRefund, legacyDue] };
    }

    let q = Order.find(query)
      .populate('user', 'name email')
      .sort({ 'refundDetails.requestedAt': -1, createdAt: -1 });
    if (session) q = q.session(session);
    return q;
  }

  async findAllAdmin(query, options = {}) {
    // Same opt-in rule as findByUser: null = the whole document.
    const {
      limit = 20, skip = 0, sort = { createdAt: -1 }, session = null, select = null,
    } = options;
    let q = Order.find(query)
      .populate('user', 'name email')
      .populate('items.product', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limit);
    if (select) q = q.select(select);
    if (session) q = q.session(session);
    return q.lean();
  }

  /**
   * Orders that may have paid but were never confirmed — the reconciliation sweep's
   * candidate set. Still in the pre-payment fulfillment state, not yet marked paid,
   * carrying a gateway order id (so there is something to ask Razorpay about), and
   * created inside the [maxAge, minAge] window: old enough that a webhook would
   * normally have arrived, young enough that chasing it is still worthwhile.
   * Returns full docs (not lean) — reconcileOrder mutates + saves them.
   * @param {{ minCutoff: Date, maxCutoff: Date, limit?: number }} args
   */
  async findStuckAwaitingPayment({ minCutoff, maxCutoff, limit = 50 }) {
    return Order.find({
      status: 'awaiting_payment',
      // Chase anything not yet paid (incl. failed/cancelled — the client can report a
      // failure that the gateway actually captured), but never an `expired` order: the
      // abandoned-sweep only sets that AFTER this window closes, so it is a settled
      // "customer walked away", not a webhook to recover.
      paymentStatus: { $nin: ['paid', 'expired'] },
      razorpayOrderId: { $ne: null },
      createdAt: { $lt: minCutoff, $gt: maxCutoff },
    })
      .sort({ createdAt: 1 })
      .limit(limit);
  }

  // Status-history fetch for orderStatusService (special populate + select)
  async findForStatusHistory(id, session = null) {
    let q = Order.findById(id)
      .populate('statusHistory.updatedBy', 'name email role')
      .select('statusHistory status');
    if (session) q = q.session(session);
    return q;
  }

  /** Plain lean read — for eligibility checks that only inspect fields. */
  async findLean(id, session = null) {
    let q = Order.findById(id).lean();
    if (session) q = q.session(session);
    return q;
  }

  /**
   * The order fields the spin eligibility check actually reads — and nothing else.
   *
   * `user` is included so this single read serves BOTH the ownership check and the
   * eligibility check. The storefront polls the spin status every 3s for up to 90s
   * while the payment webhook lands, and the two used to be separate reads of the same
   * document, the second of them unprojected: a full order carries its items array,
   * both addresses and the payment snapshot, so that was several KB pulled from Atlas
   * thirty times to answer "is it paid yet".
   *
   * Keep this projection in step with checkEligibility — a field read there but missing
   * here reads as undefined, which for `paymentStatus` would fail CLOSED (no spin) and
   * for `source` or `state` would fail OPEN. tests/spinService.test.js pins it.
   */
  async findForSpinEligibility(id) {
    return Order.findById(id)
      .select('user paymentStatus status source createdAt totalAmount shippingAddress.state')
      .lean();
  }

  /**
   * Mark the denormalised Spin-to-Win reward as withdrawn, so the packing screen shows
   * DO NOT PACK. Matched on the result id too, so a stale clawback cannot stamp a
   * reward the order no longer carries.
   */
  async markSpinRewardVoided(orderId, resultId, session = null) {
    return Order.updateOne(
      { _id: orderId, 'spinReward.result': resultId },
      { $set: { 'spinReward.voidedAt': new Date() } },
      { session },
    );
  }

  /** Mirror the "packed it" tick onto the order snapshot. */
  async markSpinRewardFulfilled(orderId, resultId, fulfilledAt) {
    return Order.updateOne(
      { _id: orderId, 'spinReward.result': resultId },
      { $set: { 'spinReward.fulfilledAt': fulfilledAt } },
    );
  }

  /**
   * Push a parcel onto an order, but ONLY if its shipment list is still exactly as the
   * caller saw it when validating.
   *
   * This is the over-ship guard, and it has to be a compare-and-set rather than a
   * read-then-write: two admins shipping the same order at the same time each read
   * "1 unit left", each validate happily, and each push — committing two units of a
   * one-unit line. The array-length precondition means the second push matches no document,
   * so the caller re-reads and re-validates against the parcel that actually landed.
   *
   * @param {string} orderId
   * @param {number} expectedShipmentCount - shipments.length observed during validation
   * @param {object} shipment - the subdocument to append
   * @param {object|null} [mirror] - legacy order-level tracking fields to $set in the
   *   SAME write (first parcel only), so the flat trackingNumber/carrier readers stay
   *   consistent with the parcel rather than drifting behind a second round trip.
   * @returns {Promise<object|null>} the updated order, or null if it lost the race
   */
  /**
   * Projected, lean read for the fulfilment views (parcels + what is still owed).
   *
   * MEASURED, not assumed: on a mature order (~37 KB, 60 statusHistory +
   * 60 trackingEvents entries) the full hydrated `findById` cost 1.43 ms against
   * 0.24 ms for this — 83% faster; 55% even on a fresh 5 KB order. The gap widens over
   * an order's life because `statusHistory` and `trackingEvents` grow without bound and
   * are pulled back on every read, while nothing in the fulfilment view reads either.
   *
   * This path runs on EVERY customer order-page view and every admin order-page view,
   * which is why it was worth the projection.
   *
   * `user` is projected deliberately — getShipments authorises on it, and dropping it
   * would turn the ownership check into a silent deny.
   *
   * Read-only: the returned object is a plain document, never saved.
   */
  async findForFulfilment(orderId) {
    return Order.findById(orderId)
      // `cancellations` is NOT optional here: remainingToShip / isFullyDelivered /
      // fulfilmentSummary all subtract cancelled units. Omitting it would make this
      // read see zero cancellations and offer already-refunded units for shipping.
      .select('user items shipments cancellations status deliveredAt fulfillmentMetrics.deliveredAt spinReward')
      .lean();
  }

  async pushShipmentIfUnchanged(orderId, expectedShipmentCount, shipment, mirror = null) {
    const update = { $push: { shipments: shipment } };
    if (mirror) {
      const set = {};
      for (const [k, v] of Object.entries(mirror)) if (v !== undefined) set[k] = v;
      if (Object.keys(set).length) update.$set = set;
    }
    /*
      ⚠️ `arrayUnchanged`, NOT a bare `$size` — see its note at the top of this file.
      `{ shipments: { $size: 0 } }` matches no order written before `shipments` was
      added to the schema, because those documents have no such key. That is every
      pre-split-shipment order in production, so the FIRST parcel on each of them
      failed all four attempts and surfaced as "Another parcel was created for this
      order at the same time" — a phantom race on an order nobody else was touching.
      The identical bug was caught and fixed for `cancellations`; this call site was
      missed because its guard predates the helper.
    */
    return Order.findOneAndUpdate(
      { _id: orderId, ...arrayUnchanged('shipments', expectedShipmentCount) },
      update,
      { new: true },
    );
  }

  /**
   * Move one parcel to a new status, stamping the matching timestamp.
   *
   * Matched on the parcel's CURRENT status as well as its id, so a double-click or a
   * retried job cannot re-stamp `deliveredAt` — a second call matches nothing and the
   * caller sees `null`, which is the signal that the transition already happened.
   *
   * @param {string} orderId
   * @param {string} shipmentId
   * @param {string} fromStatus - the status the parcel must currently hold
   * @param {string} toStatus
   * @param {object} [extra] - additional $set fields, keyed WITHOUT the array prefix
   * @returns {Promise<object|null>} updated order, or null if it was not in `fromStatus`
   */
  async transitionShipment(orderId, shipmentId, fromStatus, toStatus, extra = {}) {
    const stamp = { shipped: 'shippedAt', delivered: 'deliveredAt' }[toStatus];
    const set = { 'shipments.$.status': toStatus };
    if (stamp) set[`shipments.$.${stamp}`] = new Date();
    for (const [k, v] of Object.entries(extra)) set[`shipments.$.${k}`] = v;

    return Order.findOneAndUpdate(
      { _id: orderId, shipments: { $elemMatch: { _id: shipmentId, status: fromStatus } } },
      { $set: set },
      { new: true },
    );
  }

  /**
   * Record a partial cancellation, and in the SAME atomic write pull the cancelled
   * units back out of any unshipped parcel they were sitting in.
   *
   * ── WHY BOTH IN ONE WRITE ────────────────────────────────────────────────────────
   * A `packed` parcel has not left, so its units are cancellable — but they are also
   * still counted as committed by remainingToShip. Cancelling without editing the
   * parcel would leave the same unit both cancelled-and-refunded AND in a box a packer
   * is about to hand to a courier. Two writes would leave a window where exactly that
   * is true, and a crash between them would make it permanent.
   *
   * Conditional on the cancellations array being unchanged since validation, so two
   * admins cancelling the same line concurrently cannot both pass — the loser re-reads
   * and re-validates against the winner's write rather than over-cancelling.
   *
   * @param {string} orderId
   * @param {number} expectedCancellationCount - array length seen at validation time
   * @param {object} cancellation - the record to push
   * @param {Array<{shipmentId: string, lines: Array}>} [parcelEdits] - replacement
   *   `lines` for each packed parcel the cancellation touches. An empty `lines` array
   *   is legitimate: the whole box was cancelled and the parcel is now empty.
   * @returns {Promise<object|null>} updated order, or null if it lost the race
   */
  async pushCancellationIfUnchanged(
    orderId, expectedCancellationCount, cancellation, parcelEdits = [], expectedShipmentCount = null,
  ) {
    const update = { $push: { cancellations: cancellation } };
    /*
      Conditions are combined under $and, not spread into one object.

      Both fragments can be an `$or` (the empty-array case), and a second `$or` key
      would simply overwrite the first — silently dropping one of the two guards. $and
      keeps both.
    */
    const conditions = [arrayUnchanged('cancellations', expectedCancellationCount)];

    /*
      The guard covers the SHIPMENTS array too, not just cancellations.

      Both arrays consume the same pool of units. Validating "2 units are free", then
      conditioning the write only on `cancellations` being unchanged, leaves a
      concurrent createShipment free to commit those very units between the two — so the
      order both ships and refunds them. Pinning the shipment count as well means that
      race loses here and re-validates, exactly as a competing cancellation does.

      Null keeps the old single-array behaviour for any caller that has not been updated.
    */
    if (expectedShipmentCount !== null) {
      conditions.push(arrayUnchanged('shipments', expectedShipmentCount));
    }

    const filter = { _id: orderId, $and: conditions };

    if (parcelEdits.length) {
      /*
        Positional-filtered update: `shipments.$[p].lines` for each edited parcel.
        arrayFilters is what lets ONE write touch several parcels; `shipments.$` would
        only reach the first match, silently leaving the rest holding cancelled units.

        Each filter pins `status: 'packed'` as well as the id. Without it, a parcel
        dispatched between our read and this write would have its lines rewritten while
        in transit — units removed from a box the courier already has, and refunded.
        With it, the filter matches nothing, the parcel is left intact, and the
        shipment-count guard above has already failed the write anyway.
      */
      update.$set = {};
      const arrayFilters = [];
      parcelEdits.forEach((edit, i) => {
        update.$set[`shipments.$[p${i}].lines`] = edit.lines;
        arrayFilters.push({ [`p${i}._id`]: edit.shipmentId, [`p${i}.status`]: 'packed' });
      });
      return Order.findOneAndUpdate(filter, update, { new: true, arrayFilters });
    }

    return Order.findOneAndUpdate(filter, update, { new: true });
  }

  /**
   * Claim one cancellation's refund for processing — the serialization point that makes
   * refund initiation idempotent.
   *
   * Matched on the refund still being `pending`, so a double-clicked "Refund" or a
   * retried job matches nothing and returns null rather than sending a SECOND refund to
   * Razorpay for the same lines. Same compare-and-set shape as the whole-order refund
   * claim, for the same reason.
   *
   * @returns {Promise<object|null>} updated order, or null if it was not pending
   */
  async claimCancellationRefund(orderId, cancellationId, amountPaise) {
    return Order.findOneAndUpdate(
      {
        _id: orderId,
        cancellations: {
          $elemMatch: {
            _id: cancellationId,
            /*
              `failed` is claimable, not just `pending`. A gateway failure rolls the
              record back to `failed` precisely so it can be retried — the admin panel
              shows a "Retry refund" button for it. Matching only `pending` made that
              button permanently return "already being processed", which is both wrong
              and the opposite of what happened. Excluded by name rather than by
              matching a list of allowed values, so a status added later fails closed.
            */
            'refund.status': { $nin: ['processing', 'completed', 'not_applicable'] },
          },
        },
      },
      {
        $set: {
          'cancellations.$.refund.status': 'processing',
          'cancellations.$.refund.amountPaise': amountPaise,
          'cancellations.$.refund.initiatedAt': new Date(),
        },
      },
      { new: true },
    );
  }

  /**
   * Settle a claimed cancellation refund.
   *
   * Matched on `processing` so only the claim above can be settled — a stray call
   * against an already-completed record no-ops instead of re-stamping it.
   *
   * @param {string} status - 'completed' or 'failed'
   * @param {object} [extra] - refund subfields, keyed WITHOUT the array prefix
   */
  async settleCancellationRefund(orderId, cancellationId, status, extra = {}) {
    const set = { 'cancellations.$.refund.status': status };
    if (status === 'completed') set['cancellations.$.refund.completedAt'] = new Date();
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) set[`cancellations.$.refund.${k}`] = v;
    }
    return Order.findOneAndUpdate(
      {
        _id: orderId,
        cancellations: { $elemMatch: { _id: cancellationId, 'refund.status': 'processing' } },
      },
      { $set: set },
      { new: true },
    );
  }

  /**
   * Once-only claim for a completed cancellation refund's non-idempotent side effects:
   * the atomic `$inc` on Payment.refundAmount and the customer's LTV decrement.
   *
   * Both flags flip in ONE conditional write, matched on them still being false, so an
   * instant refund whose `refund.processed` webhook races the controller cannot count
   * the same money twice. Returns null when someone else already claimed.
   */
  async claimCancellationRefundSideEffects(orderId, cancellationId) {
    return Order.findOneAndUpdate(
      {
        _id: orderId,
        cancellations: {
          $elemMatch: {
            _id: cancellationId,
            'refund.paymentIncremented': { $ne: true },
          },
        },
      },
      {
        $set: {
          'cancellations.$.refund.paymentIncremented': true,
          'cancellations.$.refund.ltvAdjusted': true,
        },
      },
      { new: true },
    );
  }

  async save(order, session = null) {
    if (session) return order.save({ session });
    return order.save();
  }

  async deleteDoc(order, session = null) {
    if (session) return order.deleteOne({ session });
    return order.deleteOne();
  }

  /** Count a user's orders that "count" as a prior purchase (coupon firstOrderOnly). */
  async countActiveByUser(userId, session = null) {
    let q = Order.countDocuments({ user: userId, status: { $nin: ['cancelled', 'failed'] } });
    if (session) q = q.session(session);
    return q;
  }

  async markKarmaAwarded(orderId, session = null) {
    return Order.updateOne({ _id: orderId }, { karmaAwarded: true }, session ? { session } : {});
  }

  /**
   * Atomically flag this order's purchase as counted. Returns true ONLY on the
   * first successful flip, so the caller runs the CRM purchase denorm + net-LTV
   * increment exactly once per order — even if the order re-enters `processing`
   * (admin backward transition, webhook retry). Compare-and-set is race-safe.
   */
  async markPurchaseCountedOnce(orderId, session = null) {
    const res = await Order.updateOne(
      { _id: orderId, purchaseCounted: { $ne: true } },
      { $set: { purchaseCounted: true } },
      session ? { session } : {}
    );
    return res.modifiedCount === 1;
  }

  /**
   * Atomically flag this order's purchase as REVERSED. Returns true ONLY on the
   * first flip, and ONLY for an order that was actually counted — so the caller
   * runs the net-LTV / paid-count reversal exactly once, and never for an order
   * that never contributed (unpaid cancel, retried refund job). Mirror of
   * markPurchaseCountedOnce. (PAY-2 / ADR-006)
   */
  async markPurchaseReversedOnce(orderId, session = null) {
    const res = await Order.updateOne(
      { _id: orderId, purchaseCounted: true, purchaseReversed: { $ne: true } },
      { $set: { purchaseReversed: true } },
      session ? { session } : {}
    );
    return res.modifiedCount === 1;
  }

  /**
   * Atomically claim the invoice-email slot: stamp invoiceEmailedAt only if it was
   * still unset. Returns true for the single winning caller, false if the invoice
   * was already sent or is being sent by a concurrent job. Replaces the old
   * read-then-write check that could double-send under concurrent BullMQ delivery.
   * On send failure the caller releases the claim (invoiceEmailedAt = null). (BE-2)
   */
  async claimInvoiceEmail(orderId, session = null) {
    const res = await Order.updateOne(
      { _id: orderId, invoiceEmailedAt: null },
      { $set: { invoiceEmailedAt: new Date() } },
      session ? { session } : {}
    );
    return res.modifiedCount === 1;
  }
}

export default new OrderRepository();
