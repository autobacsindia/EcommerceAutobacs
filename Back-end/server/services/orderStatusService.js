/**
 * Order Status Service
 * Handles order status transitions with validation and tracking
 */

import orderRepository from '../repositories/orderRepository.js';
import userRepository from '../repositories/userRepository.js';
import leadSyncService from './leadSyncService.js';
import spinService from './spinService.js';
import { getOrderQueue, getNotificationsQueue } from '../queue/queues.js';

const LOYALTY_JOB_BY_STATUS = {
  delivered: 'post-order-delivered',
  cancelled: 'post-order-cancelled',
  returned:  'post-order-refunded'   // a completed return reverses earned karma
};

// Fulfillment milestones that warrant a customer email. `processing` (the paid,
// pre-ship state) intentionally stays silent.
const CUSTOMER_NOTIFIED_STATUSES = new Set(['shipped', 'delivered', 'cancelled', 'returned']);

// Denormalized payment axis inferred from a fulfillment transition (mainly for the
// offline-order path, which sets fulfillment directly). Reaching any post-payment
// stage implies `paid`; a completed `returned` implies a refund. `cancelled` is
// deliberately absent — a cancel can precede OR follow payment, so we leave
// paymentStatus untouched. Online orders set paymentStatus straight from the
// Razorpay webhook, independent of this map.
const PAYMENT_STATUS_BY_ORDER_STATUS = {
  processing: 'paid',
  shipped: 'paid',
  delivered: 'paid',
  returned: 'refunded',
};

// Delay before the post-delivery review-request email fires. Env-configurable so
// prod can tune it (and tests/QA can shrink it). Defaults to 24 hours.
const REVIEW_REQUEST_DELAY_MS = Number(process.env.REVIEW_REQUEST_DELAY_MS) || 86_400_000;

/**
 * Define valid status transition rules
 * Each status maps to an array of allowed next statuses
 */
const STATUS_TRANSITIONS = {
  'awaiting_payment': ['processing', 'cancelled'], // → processing on payment capture
  'processing': ['shipped', 'cancelled'],
  'shipped': ['delivered'],           // no cancel after shipped — reverse via return
  'delivered': ['returned'],
  'returned': [],   // Terminal state
  'cancelled': []   // Terminal state
};

/**
 * Define which transitions require admin approval
 */
const ADMIN_ONLY_TRANSITIONS = {
  'processing': ['cancelled'], // Only admin can cancel after processing starts
  'delivered': ['returned']    // Only admin marks a delivered order returned
};

/**
 * Define status transition reasons/categories
 */
const TRANSITION_REASONS = {
  'processing': ['payment_verified', 'warehouse_assigned', 'items_picked', 'packing_started', 'manual_confirmation'],
  'shipped': ['handed_to_carrier', 'label_created', 'in_transit'],
  'delivered': ['customer_received', 'left_at_door', 'signed_for'],
  'cancelled': ['customer_request', 'out_of_stock', 'fraud_suspected', 'duplicate_order'],
  'returned': ['return_completed', 'damaged_item', 'quality_issue', 'order_cancelled']
};

class OrderStatusService {
  /**
   * Validate if a status transition is allowed
   * @param {string} currentStatus - Current order status
   * @param {string} newStatus - Desired new status
   * @param {boolean} isAdmin - Whether the user is an admin
   * @returns {Object} - { valid: boolean, message: string }
   */
  validateTransition(currentStatus, newStatus, isAdmin = false) {
    // Check if current status exists
    if (!STATUS_TRANSITIONS[currentStatus]) {
      return {
        valid: false,
        message: `Invalid current status: ${currentStatus}`
      };
    }

    // Hard rules that even an admin cannot bypass. A cancel is only valid BEFORE
    // delivery — once delivered, the money-back path is a return/refund, never a
    // cancellation. (Terminal states are also un-cancellable.)
    if (newStatus === 'cancelled' && ['delivered', 'returned', 'cancelled'].includes(currentStatus)) {
      return {
        valid: false,
        message: `Cannot cancel an order in '${currentStatus}' state. Use the return/refund flow instead.`
      };
    }

    // Check if new status is in allowed transitions
    const allowedStatuses = STATUS_TRANSITIONS[currentStatus];
    // Admins can bypass transition rules
    if (!allowedStatuses.includes(newStatus) && !isAdmin) {
      return {
        valid: false,
        message: `Cannot transition from '${currentStatus}' to '${newStatus}'. Allowed transitions: ${allowedStatuses.join(', ') || 'none'}`
      };
    }

    // Check if admin permission required
    if (ADMIN_ONLY_TRANSITIONS[currentStatus] && 
        ADMIN_ONLY_TRANSITIONS[currentStatus].includes(newStatus) && 
        !isAdmin) {
      return {
        valid: false,
        message: `Admin permission required to transition from '${currentStatus}' to '${newStatus}'`
      };
    }

    return {
      valid: true,
      message: 'Transition is valid'
    };
  }

  /**
   * Get valid next statuses for current status
   * @param {string} currentStatus - Current order status
   * @param {boolean} isAdmin - Whether the user is an admin
   * @returns {Array} - Array of valid next statuses
   */
  getValidNextStatuses(currentStatus, isAdmin = false) {
    const allNextStatuses = STATUS_TRANSITIONS[currentStatus] || [];
    
    if (!isAdmin) {
      // Filter out admin-only transitions
      return allNextStatuses.filter(nextStatus => {
        return !ADMIN_ONLY_TRANSITIONS[currentStatus] || 
               !ADMIN_ONLY_TRANSITIONS[currentStatus].includes(nextStatus);
      });
    }
    
    return allNextStatuses;
  }

  /**
   * Get valid reasons for a status transition
   * @param {string} status - Target status
   * @returns {Array} - Array of valid reasons
   */
  getValidReasons(status) {
    return TRANSITION_REASONS[status] || [];
  }

  /**
   * Update order status with validation and history tracking
   * @param {string} orderId - Order ID
   * @param {string} newStatus - New status to set
   * @param {Object} options - Additional options
   * @param {string} options.userId - ID of user making the change
   * @param {boolean} options.isAdmin - Whether user is admin
   * @param {string} options.reason - Reason for status change
   * @param {string} options.notes - Additional notes
   * @param {Object} options.metadata - Additional metadata
   * @returns {Promise<Object>} - Updated order or error
   */
  async updateOrderStatus(orderId, newStatus, options = {}) {
    const {
      userId,
      isAdmin = false,
      reason,
      notes,
      metadata = {},
      // Who initiated a cancellation ('admin' | 'customer' | 'system'). Ignored for
      // non-cancel transitions. Defaults from isAdmin when a cancel omits it.
      cancelledBy,
      // Fulfillment/tracking payload for a `shipped` transition. Ignored otherwise.
      // { trackingNumber, carrier: {name,code,trackingUrl}, estimatedDelivery,
      //   shippingSlip: {url,publicId,uploadedAt} }. Persisted BEFORE the status
      // email is enqueued so the worker sees the tracking info + slip.
      shipping,
      // Set by services/shipmentService.js when a parcel event drove this transition.
      // Each parcel sends its OWN email (one per box), so the order-level status email
      // would be a duplicate — the roll-up to `shipped` happens once while three
      // parcels each deserve a notification. The review-request job is NOT suppressed:
      // it still fires exactly once, on final delivery.
      suppressStatusEmail = false,
      session = null
    } = options;

    try {
      const order = await orderRepository.findById(orderId, [], session);
      if (!order) {
        throw new Error('Order not found');
      }

      const currentStatus = order.status;

      // Validate transition
      const validation = this.validateTransition(currentStatus, newStatus, isAdmin);
      if (!validation.valid) {
        throw new Error(validation.message);
      }

      // Validate reason if provided
      if (reason) {
        const validReasons = this.getValidReasons(newStatus);
        
        // Allow 'admin_update' reason for admins, even if not in the strict validation list
        // This supports manual overrides from the admin panel
        const isAllowedAdminUpdate = isAdmin && reason === 'admin_update';
        
        if (!isAllowedAdminUpdate && validReasons.length > 0 && !validReasons.includes(reason)) {
          throw new Error(`Invalid reason '${reason}' for status '${newStatus}'. Valid reasons: ${validReasons.join(', ')}`);
        }
      }

      // Update status
      order.status = newStatus;

      // Keep the denormalized payment axis in step (Phase 1 of the two-axis split).
      const mappedPayment = PAYMENT_STATUS_BY_ORDER_STATUS[newStatus];
      if (mappedPayment) order.paymentStatus = mappedPayment;

      // Add to status history (will be handled by pre-save middleware, but we add details here)
      const historyEntry = {
        status: newStatus,
        timestamp: new Date(),
        updatedBy: userId,
        reason,
        notes,
        metadata
      };

      // Manually add to history with full details
      if (!order.statusHistory) {
        order.statusHistory = [];
      }
      order.statusHistory.push(historyEntry);

      // Update fulfillment metrics based on status
      await this.updateFulfillmentMetrics(order, newStatus);

      // Update specific fields based on status
      switch (newStatus) {
        case 'cancelled':
          order.cancelledAt = new Date();
          if (reason) {
            order.cancellationReason = reason;
          }
          order.cancelledBy = cancelledBy || (isAdmin ? 'admin' : 'customer');

          /*
            Money already captured → flag a pending refund for manual processing.
            We only RECORD the intent here. Idempotent: never overwrite an existing
            refund record.

            ⚠️ SKIPPED when the order carries partial cancellations. Those hold their
            OWN per-line refund records (Order.cancellations[].refund), priced net of
            the order's discount. Flagging a second, order-level refund for the FULL
            total alongside them offers the admin two buttons that each pay the customer
            — and because a `pending` cancellation refund is not yet counted against the
            headroom, both would succeed. That is a double refund of real money.
          */
          if (order.paymentStatus === 'paid'
              && !order.refundDetails?.requestedAt
              && !(order.cancellations || []).length) {
            order.refundDetails = {
              requestedAt: new Date(),
              amount: order.totalAmount,
              refundType: 'full',
              refundMethod: 'original_payment',
              itemsRefunded: (order.items || []).map(item => ({
                product: item.product,
                quantity: item.quantity,
                amount: item.price * item.quantity
              })),
              status: 'pending',
              notes: `Auto-flagged on cancellation (${order.cancelledBy}). Reason: ${reason || 'n/a'}`
            };
          }
          break;
        case 'shipped':
          // Persist tracking + carrier + optional slip here (before save) so the
          // status email enqueued below always sees them. Fixes the old race where
          // the controller set trackingNumber only AFTER the email was queued.
          if (shipping) {
            if (shipping.trackingNumber) order.trackingNumber = shipping.trackingNumber;
            if (shipping.carrier) order.carrier = shipping.carrier;
            if (shipping.estimatedDelivery) order.estimatedDelivery = shipping.estimatedDelivery;
            if (shipping.shippingSlip) order.shippingSlip = shipping.shippingSlip;
          }
          break;
        case 'delivered':
          order.deliveredAt = new Date();
          if (order.fulfillmentMetrics) {
            order.fulfillmentMetrics.deliveredAt = new Date();
          }
          break;
      }

      await orderRepository.save(order, session);

      // Loyalty side-effects run in the background (idempotent, gated on order state):
      //   delivered → award earned karma; cancelled/refunded → reverse redeemed karma,
      //   release the coupon, and (refund) claw back earned karma.
      this._enqueueLoyaltyEffect(order._id.toString(), newStatus);

      // Customer-facing emails run in the background too: a status-change email for
      // shipped/delivered/cancelled/refunded, plus a delayed review-request on delivery.
      this._enqueueStatusNotification(order._id.toString(), newStatus, { suppressStatusEmail });

      // Internal alert to the support inbox when a customer cancels on their own.
      this._enqueueAdminOrderAlert(order, newStatus);

      // CRM side-effects: tag the customer on first payment, and move the lead
      // pipeline (convert on paid, detach on admin-cancel). Best-effort, awaited
      // so it's deterministic for callers/tests but never fatal.
      //
      // `session` MUST be forwarded. These writes touch THIS order, and when the
      // caller wraps us in a transaction (the Razorpay capture path does) a
      // session-less write to a document the open transaction has already modified
      // self-deadlocks — see the note on _syncCrmOnStatus.
      await this._syncCrmOnStatus(order, newStatus, session);

      // Spin-to-Win clawback: a cancelled or returned order gives its prize back.
      // Awaited (not queued) for the same reason as the CRM sync — deterministic for
      // callers and tests — but never fatal, because a reward is not worth failing a
      // legitimate status transition over.
      await this._voidSpinRewardOnStatus(order, newStatus, session);

      return {
        success: true,
        order,
        message: `Order status updated to '${newStatus}'`
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Enqueue the background loyalty reconciliation job for a status, if any.
   * Best-effort and idempotent — the worker re-reads order state, so a no-op or a
   * retried job is harmless. Silently skips when Redis isn't configured.
   * @private
   */
  _enqueueLoyaltyEffect(orderId, newStatus) {
    const jobName = LOYALTY_JOB_BY_STATUS[newStatus];
    if (!jobName || !process.env.REDIS_URL) return;
    getOrderQueue()
      .add(jobName, { orderId })
      .catch(err => console.error(`[OrderStatus] Failed to enqueue ${jobName}:`, err.message));
  }

  /**
   * Enqueue the customer-facing status-change email (and, on delivery, the delayed
   * review-request email). Best-effort and idempotent — the worker re-reads order
   * state and both jobs guard on Order.notifiedStatuses / reviewRequestedAt, so a
   * retry is harmless. Silently skips when Redis isn't configured.
   * @private
   */
  _enqueueStatusNotification(orderId, newStatus, { suppressStatusEmail = false } = {}) {
    if (!CUSTOMER_NOTIFIED_STATUSES.has(newStatus) || !process.env.REDIS_URL) return;

    const queue = getNotificationsQueue();
    if (!suppressStatusEmail) {
      queue
        .add('send-order-status-email', { orderId, status: newStatus })
        .catch(err => console.error(`[OrderStatus] Failed to enqueue send-order-status-email:`, err.message));
    }

    // A day after delivery, ask the customer to review what they bought.
    if (newStatus === 'delivered') {
      queue
        .add('send-review-request', { orderId }, { delay: REVIEW_REQUEST_DELAY_MS })
        .catch(err => console.error(`[OrderStatus] Failed to enqueue send-review-request:`, err.message));
    }
  }

  /**
   * Enqueue the internal support-inbox alert for an order cancellation.
   *
   * Alerts on `cancelledBy: 'customer'` OR `'admin'` — support wants a record of
   * every human cancellation (a customer self-cancel is a possible refund to
   * process; an admin cancel is an audit trail + refund the acting admin may not
   * have processed). `system` cancels (expiry/automation) are deliberately excluded
   * — they're not a support work item and would be pure noise. The worker re-checks
   * this off the persisted order, so the filter is an optimisation, not the only guard.
   *
   * Best-effort — the alert must never fail the status transition. Silently skips
   * when Redis isn't configured.
   * @private
   */
  _enqueueAdminOrderAlert(order, newStatus) {
    if (newStatus !== 'cancelled' || !['customer', 'admin'].includes(order.cancelledBy) || !process.env.REDIS_URL) return;

    getNotificationsQueue()
      .add('send-admin-order-cancelled-alert', { orderId: order._id.toString() })
      .catch(err => console.error(`[OrderStatus] Failed to enqueue send-admin-order-cancelled-alert:`, err.message));
  }

  /**
   * Sync CRM state off an order status change. `confirmed` is the first paid
   * transition (Razorpay webhook / manual confirm), so that's where we stamp the
   * customer's purchase denorm. The lead pipeline is refreshed for the states
   * that carry a signal — paid ⇒ convert, cancelled ⇒ detach, failed ⇒ refresh.
   * Admin-cancelled orders are handled by upsertFromOrder as a detach, never a
   * new lead. Wrapped so a CRM hiccup can never fail an order update.
   * @private
   */
  /**
   * Withdraw the order's Spin-to-Win prize when the money goes back.
   *
   * Closes the obvious abuse: buy → spin → win the expensive goodie → cancel the order
   * → repeat, which would otherwise be a free warehouse. spinService.voidForOrder is
   * idempotent (it flips granted → void atomically and only the winning caller touches
   * stock), so a re-entered transition or a retried job cannot return the same unit
   * twice.
   *
   * Failure is logged, never thrown: a prize clawback must not be able to block a
   * customer's cancellation or a refund from completing.
   * @private
   */
  async _voidSpinRewardOnStatus(order, newStatus, session = null) {
    if (!['cancelled', 'returned', 'refunded'].includes(newStatus)) return;
    // spinService.voidForOrder opens its OWN transaction and writes this order
    // (markSpinRewardVoided). Running that inside a caller's transaction would make
    // it wait on a lock that transaction holds while that transaction waits on us —
    // the self-deadlock documented on _syncCrmOnStatus. No caller passes a session
    // for a cancel/return today; refuse loudly rather than let the first one that
    // does hang the money path for 60s.
    if (session) {
      console.error(
        '[OrderStatus] Spin reward clawback SKIPPED: cannot run inside a caller transaction ' +
        `(order ${order._id}, status ${newStatus}). Void the reward after the transaction commits.`
      );
      return;
    }
    const reason = newStatus === 'cancelled'
      ? 'order_cancelled'
      : (newStatus === 'returned' ? 'order_returned' : 'order_refunded');
    try {
      await spinService.voidForOrder(order._id, reason);
    } catch (err) {
      console.error('[OrderStatus] Spin reward clawback failed:', err?.message);
    }
  }

  /**
   * @param {Object} order
   * @param {string} newStatus
   * @param {import('mongoose').ClientSession|null} [session] - the caller's open
   *   transaction, if any. MUST be forwarded to every write that touches THIS order
   *   or its user.
   *
   *   Why it matters: `markPurchaseCountedOnce` updates the same Order document the
   *   enclosing transaction has already written via `orderRepository.save(order,
   *   session)`. A session-less write to a document held by an open transaction does
   *   not fail fast — WiredTiger makes it wait for the lock. The transaction cannot
   *   commit because it is awaiting that write, and the write cannot proceed because
   *   the transaction holds the lock. Nothing breaks the tie until the server's
   *   `transactionLifetimeLimitSeconds` reaper (60s) aborts the transaction; then
   *   `withTransaction` retries and deadlocks again, until its 120s retry deadline
   *   expires and the whole capture throws `Transaction ... has been aborted`.
   *
   *   That is exactly what happened on the Razorpay capture path: every
   *   `awaiting_payment → processing` transition inside `processPaymentSuccess`
   *   stalled ~60s per attempt and took ~180s to fail. `leadSyncService` stays
   *   OUTSIDE the transaction on purpose — it writes Lead/Consultation documents,
   *   never this order, so it cannot deadlock, and keeping CRM upserts out of the
   *   money transaction keeps its write set small.
   */
  async _syncCrmOnStatus(order, newStatus, session = null) {
    try {
      // `processing` is the first paid fulfillment stage (payment captured), so
      // that's where we stamp the customer's purchase denorm.
      if (newStatus === 'processing' && order.user) {
        // Guard against double-counting: an order can re-enter `processing`
        // (admin backward transition, webhook retry) and markPurchased's $inc is
        // unconditional. Flip a once-only flag atomically first; only the first
        // caller records the purchase + net LTV. Order.totalAmount is rupees →
        // store integer paise (refunds decrement later, per ADR-006).
        const firstCount = await orderRepository.markPurchaseCountedOnce(order._id, session);
        if (firstCount) {
          const amountPaise = Math.round((order.totalAmount || 0) * 100);
          await userRepository.markPurchased(order.user, { amountPaise }, session);
        }
      }
      // Reverse net LTV + paid-count when the money goes back: a paid order that is
      // cancelled, or a completed return/refund. The once-only guard only fires for
      // orders that were actually counted, so unpaid cancels and retried jobs are
      // no-ops. Mirrors the `processing` increment above. (PAY-2 / ADR-006)
      if (['cancelled', 'returned'].includes(newStatus) && order.user) {
        const firstReversal = await orderRepository.markPurchaseReversedOnce(order._id, session);
        if (firstReversal) {
          const amountPaise = Math.round((order.totalAmount || 0) * 100);
          await userRepository.reversePurchase(order.user, { amountPaise }, session);
        }
      }
      if (['processing', 'delivered', 'cancelled', 'returned'].includes(newStatus)) {
        await leadSyncService.safeSync(() => leadSyncService.upsertFromOrder(order));
      }
    } catch (err) {
      console.error('[OrderStatus] CRM sync failed:', err?.message);
    }
  }

  /**
   * Update fulfillment metrics based on status change
   * @param {Object} order - Order document
   * @param {string} newStatus - New status
   * @private
   */
  async updateFulfillmentMetrics(order, newStatus) {
    if (!order.fulfillmentMetrics) {
      order.fulfillmentMetrics = {};
    }

    const now = new Date();

    switch (newStatus) {
      case 'processing':
        // First paid stage — also stamps the confirmation baseline for metrics.
        order.fulfillmentMetrics.processingStartedAt = now;
        order.fulfillmentMetrics.confirmedAt = order.fulfillmentMetrics.confirmedAt || now;
        break;

      case 'shipped':
        order.fulfillmentMetrics.shippedAt = now;

        // Calculate time to ship (from processing start to shipping)
        if (order.fulfillmentMetrics.processingStartedAt) {
          const startTime = new Date(order.fulfillmentMetrics.processingStartedAt);
          const timeToShipMs = now - startTime;
          order.fulfillmentMetrics.timeToShip = Math.round(timeToShipMs / (1000 * 60 * 60)); // hours
        }
        break;
      
      case 'delivered':
        order.fulfillmentMetrics.deliveredAt = now;
        
        // Calculate time to deliver (from shipping to delivery)
        if (order.fulfillmentMetrics.shippedAt) {
          const shippedTime = new Date(order.fulfillmentMetrics.shippedAt);
          const timeToDeliverMs = now - shippedTime;
          order.fulfillmentMetrics.timeToDeliver = Math.round(timeToDeliverMs / (1000 * 60 * 60)); // hours
        }
        break;
    }
  }

  /**
   * Add entry to status history
   * @param {string} orderId - Order ID
   * @param {Object} historyEntry - History entry data
   * @returns {Promise<Object>} - Updated order
   */
  async addStatusHistory(orderId, historyEntry, session = null) {
    try {
      const order = await orderRepository.findById(orderId, [], session);
      if (!order) {
        throw new Error('Order not found');
      }

      if (!order.statusHistory) {
        order.statusHistory = [];
      }

      order.statusHistory.push({
        ...historyEntry,
        timestamp: historyEntry.timestamp || new Date()
      });

      await orderRepository.save(order, session);

      return {
        success: true,
        order
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Get status history for an order
   * @param {string} orderId - Order ID
   * @returns {Promise<Array>} - Status history
   */
  async getStatusHistory(orderId) {
    try {
      const order = await orderRepository.findForStatusHistory(orderId);

      if (!order) {
        throw new Error('Order not found');
      }

      return {
        success: true,
        currentStatus: order.status,
        history: order.statusHistory || []
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Check if order can be cancelled by customer
   * @param {Object} order - Order document
   * @returns {Object} - { canCancel: boolean, reason: string }
   */
  canCustomerCancel(order) {
    const cancellableStatuses = ['awaiting_payment', 'processing'];
    
    if (!cancellableStatuses.includes(order.status)) {
      return {
        canCancel: false,
        reason: `Orders with status '${order.status}' cannot be cancelled by customers. Please contact support.`
      };
    }

    return {
      canCancel: true,
      reason: 'Order can be cancelled'
    };
  }

  /**
   * Get order status statistics
   * @param {Object} filter - MongoDB filter object
   * @returns {Promise<Object>} - Status statistics
   */
  async getStatusStatistics(filter = {}) {
    try {
      const stats = await orderRepository.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalValue: { $sum: '$totalAmount' }
          }
        },
        {
          $project: {
            status: '$_id',
            count: 1,
            totalValue: 1,
            _id: 0
          }
        }
      ]);

      return {
        success: true,
        statistics: stats
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Get fulfillment performance metrics
   * @param {Object} filter - MongoDB filter object
   * @returns {Promise<Object>} - Performance metrics
   */
  async getFulfillmentMetrics(filter = {}) {
    try {
      const metrics = await orderRepository.aggregate([
        { $match: { ...filter, status: { $in: ['delivered', 'shipped'] } } },
        {
          $group: {
            _id: null,
            avgTimeToShip: { $avg: '$fulfillmentMetrics.timeToShip' },
            avgTimeToDeliver: { $avg: '$fulfillmentMetrics.timeToDeliver' },
            minTimeToShip: { $min: '$fulfillmentMetrics.timeToShip' },
            maxTimeToShip: { $max: '$fulfillmentMetrics.timeToShip' },
            minTimeToDeliver: { $min: '$fulfillmentMetrics.timeToDeliver' },
            maxTimeToDeliver: { $max: '$fulfillmentMetrics.timeToDeliver' },
            totalOrders: { $sum: 1 }
          }
        }
      ]);

      return {
        success: true,
        metrics: metrics[0] || {
          avgTimeToShip: 0,
          avgTimeToDeliver: 0,
          totalOrders: 0
        }
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }
}

// Export singleton instance
const orderStatusService = new OrderStatusService();
export default orderStatusService;

// Export class for testing
export { OrderStatusService, STATUS_TRANSITIONS, ADMIN_ONLY_TRANSITIONS, TRANSITION_REASONS };
