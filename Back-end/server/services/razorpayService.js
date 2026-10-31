/**
 * Razorpay Service
 * Handles Razorpay payment integration including order creation, payment verification, and webhook handling
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import orderRepository from '../repositories/orderRepository.js';
import { applyCancellationRefundSideEffectsOnce } from './cancellationRefundSideEffects.js';
import paymentRepository from '../repositories/paymentRepository.js';
import returnRequestRepository from '../repositories/returnRequestRepository.js';
import orderStatusService from './orderStatusService.js';
import leadSyncService from './leadSyncService.js';
import { reverseReturnLtvOnce } from './returnRefundLtvService.js';
import { getNotificationsQueue } from '../queue/queues.js';
import metaCapiService from './metaCapiService.js';
import affiliateCommissionService from './affiliateCommissionService.js';
import { resolvePaymentMethod, buildMethodDetails } from '../utils/paymentMethodDetails.js';
import * as Sentry from '@sentry/node';
import { isInternalEmail } from '../utils/customerContact.js';

/**
 * Ceiling on the optional EMI-plan lookup performed during a capture. Kept well inside
 * the webhook's latency budget — losing the plan detail is cosmetic, earning a webhook
 * retry is not.
 */
const EMI_ENRICHMENT_TIMEOUT_MS = 2000;

class RazorpayService {
  constructor() {
    // Load configuration from environment variables
    this.key_id = process.env.RAZORPAY_KEY_ID;
    this.key_secret = process.env.RAZORPAY_KEY_SECRET;

    // Validate configuration
    if (!this.key_id || !this.key_secret) {
      throw new Error('Razorpay credentials not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in environment variables.');
    }

    // Log masked credentials at startup to verify the right keys are loaded
    console.log(
      `[Razorpay] Loaded key_id: ${this.key_id.slice(0, 12)}... ` +
      `secret: ${this.key_secret.slice(0, 4)}****`
    );
  }

  /**
   * The public key id the storefront embeds (Affordability/EMI widget), or null when
   * it is missing or not shaped like a Razorpay key id.
   *
   * This is the SAME value createOrder hands to checkout, so the widget and checkout
   * can never drift apart again: the EMI strip once died on every PDP because the
   * frontend baked in its own copy of the key that went stale after a rotation.
   *
   * The shape check is a guard against a mis-paste: if the secret ever lands in
   * RAZORPAY_KEY_ID it must not be published to every visitor.
   * @returns {string|null}
   */
  getPublicKeyId() {
    const keyId = typeof this.key_id === 'string' ? this.key_id.trim() : '';
    return /^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId) ? keyId : null;
  }

  /**
   * Create a Razorpay order
   * @param {Object} orderData - Order information
   * @param {string} orderData.orderId - Internal order ID
   * @param {number} orderData.amount - Amount in smallest currency unit (paise for INR)
   * @param {string} orderData.currency - Currency code (default: INR)
   * @param {string} orderData.receipt - Order receipt identifier
   * @returns {Promise<Object>} Razorpay order object
   */
  async createOrder(orderData) {
    try {
      const { orderId, amount, currency = 'INR', receipt } = orderData;
      
      // Validate required parameters
      if (!orderId || !amount) {
        throw new Error('orderId and amount are required');
      }
      
      // Create Razorpay order using API
      const Razorpay = await import('razorpay');
      const instance = new Razorpay.default({
        key_id: this.key_id,
        key_secret: this.key_secret
      });
      
      const options = {
        amount: amount, // Amount in paise
        currency: currency,
        receipt: receipt || `receipt_${orderId}`,
        payment_capture: 1, // Auto-capture payment
        notes: {
          orderId: orderId
        }
      };
      
      const razorpayOrder = await instance.orders.create(options);
      
      return {
        success: true,
        // key_id is public by design (it ships to the browser in the checkout
        // options). Returning it here keeps the checkout key and the secret that
        // signs the order in lockstep, instead of the frontend baking in its own.
        keyId: this.key_id,
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        receipt: razorpayOrder.receipt
      };
    } catch (error) {
      // Razorpay SDK rejects with a plain object (not an Error) on API errors.
      // Extract the human-readable description from wherever the SDK puts it.
      const desc =
        error?.error?.description ||
        error?.description ||
        error?.message ||
        (typeof error === 'object' ? JSON.stringify(error) : String(error));

      console.error('[Razorpay] order creation failed:', desc);
      throw new Error(`Failed to create Razorpay order: ${desc}`);
    }
  }

  /**
   * Create a Razorpay Payment Link for an existing (awaiting_payment) order.
   * Razorpay delivers the link to the customer over SMS + email itself. When the
   * customer pays, the `payment_link.paid` webhook resolves this order via the
   * link's `notes.orderId` / `reference_id` and drives it to paid → processing.
   *
   * @param {Object} order - our Order (needs _id, totalAmount, orderNumber)
   * @param {{name?:string, email?:string, phone?:string}} customer
   * @param {{attempt?: number}} [opts] - 2+ when re-issuing after an expired or
   *   cancelled link. Razorpay requires a unique reference_id per link, so a
   *   re-issue is `<orderId>-r<attempt>`; the webhook resolves the order from
   *   `notes.orderId` first, which never changes.
   * @returns {Promise<{id:string, shortUrl:string}>}
   */
  async createPaymentLink(order, { name, email, phone } = {}, { attempt = 1, part = null } = {}) {
    // An internal `.invalid` address (phone-only customer, staff account) has no
    // mailbox — never hand it to Razorpay to email. The link then goes by SMS.
    if (isInternalEmail(email)) email = undefined;
    // A payment PART (quotation-first sales orders) charges its own amount; a
    // whole-order link charges the order total, exactly as before.
    const amount = Math.round(((part ? part.amount : order.totalAmount) || 0) * 100); // paise
    if (!amount || amount < 100) {
      throw new Error('Payment link amount must be at least ₹1');
    }
    if (!email && !phone) {
      throw new Error('A phone or email is required to send a payment link');
    }
    try {
      const Razorpay = await import('razorpay');
      const instance = new Razorpay.default({ key_id: this.key_id, key_secret: this.key_secret });

      const link = await instance.paymentLink.create({
        amount,
        currency: 'INR',
        accept_partial: false,
        description: part
          ? `Autobacs India — order ${order.orderNumber || order._id} (payment ${part.index} of ${part.of})`
          : `Autobacs India — order ${order.orderNumber || order._id}`,
        // Unique per link (Razorpay rejects a repeated reference_id).
        reference_id: part
          ? `${order._id.toString()}-p${part.ref}`
          : attempt > 1 ? `${order._id.toString()}-r${attempt}` : order._id.toString(),
        customer: {
          ...(name ? { name } : {}),
          ...(email ? { email } : {}),
          ...(phone ? { contact: phone } : {}),
        },
        notify: { sms: !!phone, email: !!email }, // Razorpay sends it
        reminder_enable: true,
        // How the webhook finds us; a part also carries which part it is.
        notes: { orderId: order._id.toString(), ...(part ? { partRef: String(part.ref) } : {}) },
        expire_by: Math.floor(Date.now() / 1000) + 48 * 60 * 60, // 48h
      });

      return { id: link.id, shortUrl: link.short_url };
    } catch (error) {
      const desc =
        error?.error?.description ||
        error?.description ||
        error?.message ||
        (typeof error === 'object' ? JSON.stringify(error) : String(error));
      console.error('[Razorpay] payment link creation failed:', desc);
      throw new Error(`Failed to create payment link: ${desc}`);
    }
  }

  /**
   * Cancel a payment link so it can no longer be paid. Used before re-issuing or
   * cancelling an unpaid order, so an order never has two payable links.
   *
   * Razorpay refuses to cancel a link that is already PAID — that error is
   * surfaced (not swallowed), so the caller stops instead of issuing a second link
   * for money that has already been taken.
   *
   * @param {string} linkId
   * @returns {Promise<{status: string}>}
   */
  async cancelPaymentLink(linkId) {
    const Razorpay = await import('razorpay');
    const instance = new Razorpay.default({ key_id: this.key_id, key_secret: this.key_secret });
    try {
      const link = await instance.paymentLink.cancel(linkId);
      return { status: link?.status || 'cancelled' };
    } catch (error) {
      const desc =
        error?.error?.description ||
        error?.description ||
        error?.message ||
        String(error);
      console.error('[Razorpay] payment link cancel failed:', desc);
      throw new Error(`Failed to cancel payment link: ${desc}`);
    }
  }

  /**
   * Fetch a payment link's live status ('created' | 'paid' | 'expired' | 'cancelled' …).
   * @param {string} linkId
   * @returns {Promise<{status: string}>}
   */
  async fetchPaymentLinkStatus(linkId) {
    const Razorpay = await import('razorpay');
    const instance = new Razorpay.default({ key_id: this.key_id, key_secret: this.key_secret });
    const link = await instance.paymentLink.fetch(linkId);
    return { status: link?.status || 'unknown' };
  }

  /**
   * A payment link with the CAPTURED payments made through it, each as a full
   * payment entity — for the sweep that recovers a part whose webhook never came.
   * @returns {Promise<{status: string, payments: Object[]}>}
   */
  async fetchPaymentLinkCaptures(linkId) {
    const Razorpay = await import('razorpay');
    const instance = new Razorpay.default({ key_id: this.key_id, key_secret: this.key_secret });
    const link = await instance.paymentLink.fetch(linkId);
    const ids = (link?.payments || []).filter((p) => p.status === 'captured').map((p) => p.payment_id);
    const payments = await Promise.all(ids.map((id) => instance.payments.fetch(id)));
    return { status: link?.status || 'unknown', payments: payments.filter((p) => p?.status === 'captured') };
  }

  /**
   * Verify Razorpay payment signature
   * @param {Object} paymentData - Payment verification data
   * @param {string} paymentData.razorpay_order_id - Razorpay order ID
   * @param {string} paymentData.razorpay_payment_id - Razorpay payment ID
   * @param {string} paymentData.razorpay_signature - Payment signature
   * @returns {Promise<Object>} Verification result
   */
  async verifyPayment(paymentData) {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = paymentData;
      
      // Create signature string
      const shasum = crypto.createHmac('sha256', this.key_secret);
      shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
      const digest = shasum.digest('hex');
      
      // Compare signatures
      if (digest !== razorpay_signature) {
        throw new Error('Payment verification failed: Invalid signature');
      }
      
      // Fetch payment details from Razorpay
      const Razorpay = await import('razorpay');
      const instance = new Razorpay.default({
        key_id: this.key_id,
        key_secret: this.key_secret
      });
      
      const payment = await instance.payments.fetch(razorpay_payment_id);
      
      return {
        success: true,
        verified: true,
        paymentId: razorpay_payment_id,
        payment: payment
      };
    } catch (error) {
      // Capture payment verification failures in Sentry
      if (process.env.SENTRY_DSN) {
        Sentry.withScope((scope) => {
          // Destructured consts above are block-scoped to the try; reference the
          // in-scope paymentData here to avoid a ReferenceError in this catch.
          scope.setContext('payment_verification', {
            razorpay_order_id: paymentData?.razorpay_order_id,
            razorpay_payment_id: paymentData?.razorpay_payment_id
          });
          scope.setTag('payment_action', 'verify_payment');
          Sentry.captureException(error);
        });
      }
      return {
        success: false,
        verified: false,
        message: error.message
      };
    }
  }

  /**
   * Process successful payment and update order status
   * @param {string} orderId - Internal order ID
   * @param {Object} paymentData - Razorpay payment data
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Processing result
   */
  async processPaymentSuccess(orderId, paymentData, userId, { gatewayOffer = null } = {}) {
    // EMI tenure/rate needs a separate expanded fetch. Do it here, OUTSIDE and BEFORE
    // the transaction — a slow or failing metadata call must not hold a Mongo
    // transaction open, and must not be able to abort the capture. Non-EMI payments
    // return immediately without touching the network.
    paymentData = await this._enrichEmiPlan(paymentData);

    // ── Atomic transaction: create payment → link to order → confirm status ───
    // If any step fails the transaction aborts, rolling back all writes.
    // The old manual "mark payment as failed" compensation code is no longer
    // needed — the abort handles cleanup automatically.
    const session = await mongoose.startSession();

    try {
      let paymentId;
      // Tracks whether THIS delivery created the payment vs. adopted a row a concurrent
      // delivery already committed. Only the creator fires post-commit side-effects
      // (invoice email), so duplicate webhooks never double-send.
      let createdHere = false;

      await session.withTransaction(async () => {
        // Reset per-attempt: withTransaction re-runs this callback on a WriteConflict.
        createdHere = false;

        const order = await orderRepository.findById(orderId, [], session);
        if (!order) {
          throw new Error('Order not found');
        }

        // ── IDEMPOTENCY GUARD (in-transaction) ────────────────────────────────
        // A concurrent/duplicate webhook may already have recorded this capture.
        // Under snapshot isolation this read alone can't see an uncommitted sibling
        // txn — the UNIQUE index on gatewayPaymentId is the real serialization point:
        // the losing insert surfaces as a retryable WriteConflict, withTransaction
        // retries, and THIS read then sees the committed row and bails. Belt + braces.
        const existing = await paymentRepository.findByGatewayPaymentId(paymentData.id, session);
        if (existing) {
          paymentId = existing._id;
          // Self-heal the order axis if a prior partial run left it unlinked/unpaid.
          if (String(order.payment) !== String(existing._id) || order.paymentStatus !== 'paid' || (gatewayOffer && !order.gatewayOffer)) {
            order.payment = existing._id;
            order.paymentStatus = 'paid';
            if (gatewayOffer && !order.gatewayOffer) order.gatewayOffer = gatewayOffer;
            await orderRepository.save(order, session);
          }
          return;
        }

        const paymentRecord = await paymentRepository.createPayment(
          {
            order: orderId,
            user: userId,
            // What was actually captured: less than the total when a Razorpay offer applied.
            amount: gatewayOffer ? gatewayOffer.amountPaid : order.totalAmount,
            currency: 'INR',
            // Pass the WHOLE entity, not `.method` — that is what lets a debit card be
            // told apart from a credit card (both arrive as method: 'card').
            paymentMethod: resolvePaymentMethod(paymentData),
            methodDetails: buildMethodDetails(paymentData),
            paymentGateway: 'razorpay',
            gatewayOrderId: paymentData.order_id,
            gatewayPaymentId: paymentData.id,
            gatewaySignature: paymentData.signature,
            status: 'completed',
            paymentDetails: { razorpay: paymentData }
          },
          session
        );

        order.payment = paymentRecord._id;
        // Payment axis is authoritative here — set it directly (idempotent on retry).
        order.paymentStatus = 'paid';
        if (gatewayOffer) order.gatewayOffer = gatewayOffer;
        await orderRepository.save(order, session);

        // Advance fulfillment into `processing` only from the pre-payment state.
        // On a webhook retry the order is already processing → skip the transition
        // (paymentStatus above is already correct), so this stays idempotent.
        if (order.status === 'awaiting_payment') {
          const result = await orderStatusService.updateOrderStatus(orderId, 'processing', {
            userId: null,
            isAdmin: true,
            reason: 'payment_verified',
            notes: `Payment received via Razorpay. Payment ID: ${paymentData.id}`,
            metadata: { gatewayId: paymentData.id, transactionId: paymentData.id },
            session
          });
          if (!result.success) {
            throw new Error(`Failed to update order status: ${result.message}`);
          }
        }

        paymentId = paymentRecord._id;
        createdHere = true;
      });

      // Post-commit side effects, only by the delivery that created the payment so
      // duplicate webhooks never double-send (see _afterOrderPaid).
      if (createdHere) this._afterOrderPaid(orderId);

      return {
        success: true,
        message: createdHere ? 'Payment processed successfully' : 'Payment already processed',
        orderId,
        paymentId,
        alreadyProcessed: !createdHere
      };
    } catch (error) {
      // A concurrent delivery may have won the race and the unique index rejected our
      // insert (WriteConflict retries exhausted, or a non-transient duplicate key). If a
      // payment row now exists for this capture, the end state is correct — report an
      // idempotent success instead of paging on-call with a critical alert.
      const isDuplicate =
        error?.code === 11000 || /writeconflict|duplicate key/i.test(error?.message || '');
      if (isDuplicate) {
        try {
          const existing = await paymentRepository.findByGatewayPaymentId(paymentData.id);
          if (existing) {
            return {
              success: true,
              message: 'Payment already processed (concurrent delivery)',
              orderId,
              paymentId: existing._id,
              alreadyProcessed: true
            };
          }
        } catch { /* fall through to error handling below */ }
      }

      if (process.env.SENTRY_DSN) {
        Sentry.withScope((scope) => {
          scope.setContext('payment_processing', { orderId, paymentId: paymentData.id, userId });
          scope.setTag('payment_action', 'process_payment_success');
          scope.setTag('severity', 'critical');
          Sentry.captureException(error);
        });
      }
      throw new Error(`Failed to process payment: ${error.message}`);
    } finally {
      await session.endSession();
    }
  }

  /**
   * One PART of a quotation-first sales order was paid (its own Razorpay link).
   *
   * Same guarantees as processPaymentSuccess, per part:
   *   - the captured amount must equal THIS part's amount exactly (else it throws
   *     "Amount mismatch" — never a silent accept);
   *   - one Payment row per gateway payment (unique gatewayPaymentId), so a
   *     duplicate or concurrent webhook settles to exactly one record;
   *   - the ORDER becomes paid — and the team workflow, invoice and alerts fire —
   *     only once, when the paid parts reach the order total.
   * A part paid on a link that was cancelled meanwhile (a race with Razorpay) is
   * still recorded: the money is real. If that takes the paid sum past the total,
   * it is logged loudly so an admin can refund the excess.
   */
  async processPaymentPart(orderId, linkId, paymentEntity) {
    if (paymentEntity.currency !== 'INR') {
      console.error(`[SECURITY] Currency mismatch! | Order: ${orderId} | Part link: ${linkId} | Got: ${paymentEntity.currency}`);
      throw new Error('Currency mismatch');
    }
    paymentEntity = await this._enrichEmiPlan(paymentEntity);

    const session = await mongoose.startSession();
    let orderNowPaid = false;
    let partNowPaid = false;
    try {
      await session.withTransaction(async () => {
        orderNowPaid = false;
        partNowPaid = false;
        const order = await orderRepository.findById(orderId, [], session);
        if (!order) throw new Error('Order not found');
        const part = (order.paymentParts || []).find((p) => p.linkId === linkId);
        if (!part) throw new Error('Payment part not found');

        const expected = Math.round(Number(part.amount) * 100);
        if (paymentEntity.amount !== expected) {
          console.error(`[SECURITY] Amount mismatch on payment part | Order: ${orderId} | Link: ${linkId} | Expected: ${expected} paise | Got: ${paymentEntity.amount} paise`);
          throw new Error('Amount mismatch');
        }

        // Idempotency: this capture is already recorded on this part.
        if (part.status === 'paid' && part.gatewayPaymentId === paymentEntity.id) return;
        if (part.status === 'paid') {
          // A second, different capture on one link — should be impossible (links
          // are single-use). Record nothing; flag it for a human.
          console.error(`[PAYMENT] Second capture ${paymentEntity.id} on already-paid part ${linkId} of order ${orderId} — refund it in Razorpay`);
          return;
        }

        let payment = await paymentRepository.findByGatewayPaymentId(paymentEntity.id, session);
        if (!payment) {
          payment = await paymentRepository.createPayment({
            order: order._id,
            user: order.user,
            amount: part.amount,
            currency: 'INR',
            paymentMethod: resolvePaymentMethod(paymentEntity),
            methodDetails: buildMethodDetails(paymentEntity),
            paymentGateway: 'razorpay',
            gatewayOrderId: paymentEntity.order_id,
            gatewayPaymentId: paymentEntity.id,
            status: 'completed',
            paymentDetails: { razorpay: paymentEntity, paymentPartLink: linkId },
          }, session);
        }

        if (part.status === 'cancelled') {
          console.error(`[PAYMENT] Part ${linkId} of order ${orderId} was paid after it was cancelled — recording the money`);
        }
        part.status = 'paid';
        part.gatewayPaymentId = paymentEntity.id;
        part.payment = payment._id;
        part.paidAt = new Date();
        partNowPaid = true;

        const paidPaise = (order.paymentParts || [])
          .filter((p) => p.status === 'paid')
          .reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0);
        const totalPaise = Math.round(Number(order.totalAmount) * 100);
        if (paidPaise > totalPaise) {
          console.error(`[PAYMENT] Order ${orderId} received ₹${paidPaise / 100} against ₹${totalPaise / 100} — refund the excess`);
        }

        if (order.paymentStatus !== 'paid' && paidPaise >= totalPaise) {
          order.paymentStatus = 'paid';
          // The first part paid stands as "the" payment for code that reads one.
          const firstPaid = [...order.paymentParts]
            .filter((p) => p.status === 'paid')
            .sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt))[0];
          order.payment = firstPaid?.payment || payment._id;
          await orderRepository.save(order, session);
          if (order.status === 'awaiting_payment') {
            const result = await orderStatusService.updateOrderStatus(orderId, 'processing', {
              userId: null,
              isAdmin: true,
              reason: 'payment_verified',
              notes: `Fully paid via Razorpay in ${order.paymentParts.filter((p) => p.status === 'paid').length} payment(s). Last: ${paymentEntity.id}`,
              metadata: { gatewayId: paymentEntity.id, transactionId: paymentEntity.id },
              session,
            });
            if (!result.success) throw new Error(`Failed to update order status: ${result.message}`);
          }
          orderNowPaid = true;
        } else {
          await orderRepository.save(order, session);
        }
      });
    } catch (error) {
      // A concurrent delivery recorded it first (unique gatewayPaymentId) — fine.
      if (error?.code === 11000 || /writeconflict|duplicate key/i.test(error?.message || '')) {
        const existing = await paymentRepository.findByGatewayPaymentId(paymentEntity.id);
        if (existing) return { partPaid: false, orderPaid: false, alreadyProcessed: true };
      }
      throw error;
    } finally {
      await session.endSession();
    }

    if (orderNowPaid) this._afterOrderPaid(orderId);
    return { partPaid: partNowPaid, orderPaid: orderNowPaid, alreadyProcessed: !partNowPaid };
  }

  /**
   * Everything that happens once an order is PAID, after the transaction commits:
   * invoice + admin + team alerts (queue), affiliate accrual, Meta CAPI Purchase.
   * Called exactly once per order — by processPaymentSuccess (one payment) or by
   * processPaymentPart when the LAST part is paid. Best-effort and never throws:
   * the money is already captured.
   */
  _afterOrderPaid(orderId) {
    // ── Order confirmation + invoice email (best-effort, post-commit) ─────────
    // Enqueued only after the transaction commits so a rolled-back payment never
    // emails an invoice, and only by the delivery that actually created the payment
    // so duplicate webhooks don't double-enqueue. A Redis/queue failure must not
    // fail the payment itself.
    if (process.env.REDIS_URL) {
      const queue = getNotificationsQueue();
      queue
        .add('send-order-invoice', { orderId })
        .catch((err) =>
          console.error(`[Queue] Failed to enqueue send-order-invoice for ${orderId}:`, err.message)
        );

      // Tell the support inbox there is a paid order to fulfil. Same
      // create-once gate as the invoice, so a duplicate webhook can't re-alert.
      queue
        .add('send-admin-order-placed-alert', { orderId })
        .catch((err) =>
          console.error(`[Queue] Failed to enqueue send-admin-order-placed-alert for ${orderId}:`, err.message)
        );

      // Every paid order now enters the team workflow (website or sales panel):
      // tell the Accounts, Procurement and Operations heads, and the sales person
      // on their own orders. Same create-once gate, so a webhook retry can't re-alert.
      queue
        .add('send-staff-sales-paid-alert', { orderId })
        .catch((err) =>
          console.error(`[Queue] Failed to enqueue send-staff-sales-paid-alert for ${orderId}:`, err.message)
        );
    }

    /*
      ── Affiliate commission accrual (best-effort, once) ──────────────────────
      Same `createdHere` gate as the emails above, so a duplicate webhook cannot
      double-credit an affiliate — and the partial-unique {order, type:'accrual'}
      index is the second line of defence for two concurrent deliveries that each
      believe they created the payment.

      Fire-and-forget on purpose: this is OUR cost ledger, not the customer's money.
      A failure here must never fail a payment that has already been captured. It is
      recoverable — the row can be written by hand — whereas a thrown capture is not.

      Deliberately NOT moved inside the transaction above. It writes only
      AffiliateCommission rows, never the Order, which is exactly what keeps it clear
      of the WiredTiger self-deadlock that once made every capture fail after ~180s.
    */
    {
      affiliateCommissionService
        .accrueForOrder(orderId)
        .catch((err) =>
          console.error(`[Affiliate] Commission accrual failed for ${orderId}:`, err.message)
        );
    }

    // ── Meta Conversions API: server-side Purchase (best-effort, once) ────────
    // Same create-once gate as the emails, so duplicate webhooks never double-
    // count. Deduped against the client Pixel by event_id = order id. Fetched
    // WITH product+user populated so content_ids and hashed identifiers resolve.
    // Fire-and-forget: a Meta outage must never fail a captured payment.
    if (metaCapiService.isEnabled()) {
      orderRepository
        .findWithPopulated(orderId)
        .then((populated) => (populated ? metaCapiService.sendPurchaseEvent(populated) : null))
        .catch((err) => console.error(`[MetaCAPI] Purchase dispatch failed for ${orderId}:`, err.message));
    }
  }

  /**
   * Issue a refund against a captured Razorpay payment.
   *
   * The Refund API executes immediately — there is NO dashboard-approval step. For
   * `normal` speed the refund lands in the customer's account over ~5-7 days and the
   * returned `status` is `pending`/`processing`; the terminal `processed`/`failed`
   * outcome arrives asynchronously via the refund.* webhook. Callers should treat a
   * successful return here as "refund accepted", not "money delivered".
   *
   * @param {string} paymentId - Razorpay payment id (pay_...) to refund
   * @param {number} amountPaise - Amount to refund in paise (must be ≤ captured amount)
   * @param {Object} [opts]
   * @param {string} [opts.orderId] - Internal order id, stamped into refund notes so the
   *                                  webhook can resolve the order (mirrors payment.notes).
   * @param {string} [opts.returnId] - ReturnRequest id, stamped into refund notes so the
   *                                  webhook reconciles the authoritative per-return record
   *                                  (an order may have several returns; the order-level
   *                                  refundDetails summary can only hold one).
   * @param {string} [opts.reason] - Free-text reason, stored in refund notes.
   * @param {string} [opts.speed='normal'] - 'normal' (free) or 'optimum' (instant, fee).
   * @returns {Promise<{success: boolean, refundId: string, status: string, amount: number}>}
   */
  async refundPayment(paymentId, amountPaise, { orderId, returnId, cancellationId, reason, speed = 'normal' } = {}) {
    if (!paymentId || !amountPaise) {
      throw new Error('paymentId and amount are required');
    }

    const Razorpay = await import('razorpay');
    const instance = new Razorpay.default({
      key_id: this.key_id,
      key_secret: this.key_secret
    });

    try {
      const refund = await instance.payments.refund(paymentId, {
        amount: amountPaise,
        speed,
        notes: {
          orderId: orderId || '',
          // Present only for return-refunds; routes the webhook to the authoritative
          // ReturnRequest so multi-return orders reconcile per-return, not per-order.
          ...(returnId ? { returnId } : {}),
          // Same idea for a PARTIAL cancellation: the authoritative record is the
          // Order.cancellations[] entry, not order.refundDetails, because one order can
          // hold several cancellation refunds that would otherwise fight over that
          // single summary field. Without this the webhook has nothing to route on and
          // a normal-speed refund never leaves `processing`.
          ...(cancellationId ? { cancellationId } : {}),
          reason: reason || 'order_cancelled'
        }
      });

      return {
        success: true,
        refundId: refund.id,
        status: refund.status, // 'pending' | 'processed' | 'failed'
        amount: refund.amount
      };
    } catch (error) {
      // Same plain-object error shape the Razorpay SDK throws on order creation.
      const desc =
        error?.error?.description ||
        error?.description ||
        error?.message ||
        (typeof error === 'object' ? JSON.stringify(error) : String(error));

      console.error(`[Razorpay] refund failed for payment ${paymentId}:`, desc);
      throw new Error(`Failed to create Razorpay refund: ${desc}`);
    }
  }

  /**
   * Fetch every payment Razorpay has recorded against one of our gateway orders.
   * Used by the reconciliation sweep to discover captures whose webhook never
   * arrived. Encapsulates the SDK so callers stay transport-agnostic.
   * @param {string} razorpayOrderId - gateway order id (order_...)
   * @returns {Promise<Array<Object>>} payment entities (possibly empty)
   */
  async fetchOrderPayments(razorpayOrderId) {
    if (!razorpayOrderId) return [];
    const Razorpay = await import('razorpay');
    const instance = new Razorpay.default({ key_id: this.key_id, key_secret: this.key_secret });
    const res = await instance.orders.fetchPayments(razorpayOrderId);
    return res?.items || [];
  }

  /**
   * Reconcile a single stuck order against Razorpay. Asks the gateway for the
   * payments on the order's razorpayOrderId; if a CAPTURED one exists and matches
   * our amount/currency, it is driven through the SAME idempotent success path the
   * webhook uses. This is the safety net for a missed/misconfigured webhook — money
   * captured at the gateway can never be silently stranded in awaiting_payment.
   *
   * Idempotent and safe to run repeatedly: _validatePaymentAgainstOrder reports an
   * already-processed capture, and processPaymentSuccess is itself idempotent.
   *
   * @param {Object} order - our Order doc (needs _id, razorpayOrderId, totalAmount, user)
   * @returns {Promise<{recovered: boolean, reason?: string, paymentId?: string}>}
   */
  async reconcileOrder(order) {
    if (!order?.razorpayOrderId) return { recovered: false, reason: 'no_razorpay_order' };

    const payments = await this.fetchOrderPayments(order.razorpayOrderId);
    // Only a CAPTURED payment means money actually left the customer. `authorized`
    // (not captured) or `failed`/`created` must not confirm the order.
    const captured = payments.find((p) => p.status === 'captured');
    if (!captured) return { recovered: false, reason: 'no_captured_payment' };

    // Amount/currency guard (throws on mismatch — a real security anomaly the caller
    // will surface to Sentry) + idempotency check, identical to the webhook path.
    const { alreadyProcessed, gatewayOffer } = await this._validatePaymentAgainstOrder(order, captured);
    if (alreadyProcessed) return { recovered: false, reason: 'already_processed' };

    await this.processPaymentSuccess(order._id.toString(), captured, order.user?.toString(), { gatewayOffer });
    return { recovered: true, paymentId: captured.id };
  }

  /**
   * Map a Razorpay payment to our internal payment method.
   *
   * Delegates to utils/paymentMethodDetails.js — accepts the whole payment entity so a
   * debit card (`method: 'card'` + `card.type: 'debit'`) is distinguishable from a credit
   * card. A bare method string is still accepted for older callers, and degrades to the
   * previous card→credit_card behaviour.
   *
   * @param {Object|string} payment - Razorpay payment entity, or a bare method string
   * @returns {string} Internal payment method
   */
  getPaymentMethodFromRazorpay(payment) {
    return resolvePaymentMethod(payment);
  }

  /**
   * Best-effort enrichment of an EMI payment with its plan (issuer, tenure, rate).
   *
   * The webhook payload carries `card.issuer`/`card.type` but not the tenure — that
   * needs a fetch with `expand[]=emi`. Support cannot answer "why am I being charged
   * interest?" without it, so we go and get it.
   *
   * Deliberately called BEFORE the payment transaction opens and deliberately
   * swallowing every error: this is reporting metadata, and a gateway hiccup here must
   * never abort a capture and strand the customer's money in an unrecorded state.
   *
   * HARD-BOUNDED. This runs inside the webhook handler, which has its own latency
   * budget at Razorpay's end — a slow fetch here would delay our 200 and earn a webhook
   * retry, turning a cosmetic metadata call into duplicate deliveries. The SDK has no
   * usable default timeout, so the call is raced against one and simply abandoned if it
   * loses; the payment records without tenure/rate, which is exactly the pre-existing
   * behaviour.
   *
   * @param {Object} paymentData - Razorpay payment entity
   * @returns {Promise<Object>} the entity, plan-enriched where possible
   */
  async _enrichEmiPlan(paymentData) {
    const isEmi = paymentData?.method === 'emi' || paymentData?.method === 'cardless_emi';
    if (!isEmi || paymentData.emi_plan || paymentData.emi) return paymentData;

    try {
      const Razorpay = await import('razorpay');
      const instance = new Razorpay.default({ key_id: this.key_id, key_secret: this.key_secret });
      const expanded = await Promise.race([
        instance.payments.fetch(paymentData.id, { 'expand[]': 'emi' }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('EMI plan fetch timed out')), EMI_ENRICHMENT_TIMEOUT_MS)
        ),
      ]);
      // Merge rather than replace: the caller's entity is the signature-verified one.
      if (expanded?.emi || expanded?.emi_plan) {
        return { ...paymentData, emi: expanded.emi, emi_plan: expanded.emi_plan };
      }
    } catch (error) {
      console.warn(`[Razorpay] EMI plan enrichment skipped for ${paymentData.id}: ${error.message}`);
    }
    return paymentData;
  }

  /**
   * Handle Razorpay webhook events (SECURED)
   * @param {Object} webhookData - Parsed webhook data (already signature-verified)
   * @param {string} eventType - Event type (validated whitelist)
   * @returns {Promise<Object>} Processing result
   */
  async handleWebhook(webhookData, eventType) {
    try {
      const payload = webhookData.payload;
      
      switch (eventType) {
        case 'payment.captured':
          // SECURITY STEP 5: Cross-check order in DB
          await this.handlePaymentCaptured(payload);
          break;
          
        case 'payment_link.paid':
          // A Razorpay Payment Link (offline "collect payment" flow) was paid.
          await this.handlePaymentLinkPaid(payload);
          break;

        case 'payment.failed':
          // Payment failed - update payment record
          await this.handlePaymentFailure(payload.payment.entity);
          break;
          
        case 'order.paid':
          // Order paid - redundant with payment.captured, but handle safely
          console.log('[Webhook] Order paid event (redundant):', payload.order.entity.id);
          break;

        case 'refund.processed':
          // Terminal success for a normal-speed refund — money has left our balance
          // and reached the customer. Flip refundDetails → completed.
          await this.applyRefundWebhook(payload.refund.entity, 'completed');
          break;

        case 'refund.failed':
          // Terminal failure — the refund could not be completed at the gateway.
          await this.applyRefundWebhook(payload.refund.entity, 'failed');
          break;

        default:
          // Should not reach here (filtered by route)
          console.log('[Webhook] Unhandled event type:', eventType);
      }
      
      return {
        success: true,
        message: 'Webhook processed successfully'
      };
    } catch (error) {
      // Capture webhook processing errors in Sentry
      if (process.env.SENTRY_DSN) {
        Sentry.withScope((scope) => {
          scope.setContext('webhook_processing', { 
            eventType,
            eventId: webhookData?.id
          });
          scope.setTag('payment_action', 'handle_webhook');
          Sentry.captureException(error);
        });
      }
      throw new Error(`Webhook processing failed: ${error.message}`);
    }
  }
  
  /**
   * Shared webhook payment integrity guard. Validates the captured amount
   * (rounded to paise — a floating rupee total must NOT false-mismatch against a
   * link created with Math.round) and the currency against our order, and reports
   * whether this gateway payment was already processed (idempotency). Throws on a
   * real amount/currency mismatch.
   * @returns {Promise<{alreadyProcessed: boolean}>}
   */
  async _validatePaymentAgainstOrder(order, paymentEntity) {
    if (paymentEntity.currency !== 'INR') {
      console.error(`[SECURITY] Currency mismatch! | Order: ${order._id} | Expected: INR | Got: ${paymentEntity.currency}`);
      throw new Error('Currency mismatch');
    }
    const expected = Math.round((order.totalAmount || 0) * 100); // paise
    let gatewayOffer = null;
    if (paymentEntity.amount !== expected) {
      // The one legitimate shortfall: a Razorpay offer applied at checkout. Anything
      // else — more than the total, or less without Razorpay vouching for it — is
      // the anomaly this guard exists for.
      gatewayOffer = paymentEntity.amount > 0 && paymentEntity.amount < expected
        ? await this._resolveGatewayOffer(order, paymentEntity, expected)
        : null;
      if (!gatewayOffer) {
        console.error(`[SECURITY] Amount mismatch! | Order: ${order._id} | Expected: ${expected} paise | Got: ${paymentEntity.amount} paise`);
        throw new Error('Amount mismatch');
      }
      console.log(`[Payment] Razorpay offer accepted | Order: ${order._id} | Paid ${paymentEntity.amount} of ${expected} paise | Offer: ${gatewayOffer.offerIds.join(',')}`);
    }
    // order.payment is an ObjectId reference — query the Payment collection by the
    // gateway payment id for the real processed status.
    const existingPayment = await paymentRepository.findByGatewayPaymentId(paymentEntity.id);
    return { alreadyProcessed: !!(existingPayment && existingPayment.status === 'completed'), gatewayOffer };
  }

  /** GET a Razorpay REST resource with our keys. Server-to-server; never trusts the client. */
  async _razorpayGet(path) {
    const auth = Buffer.from(`${this.key_id}:${this.key_secret}`).toString('base64');
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Razorpay GET ${path.split('?')[0]} → ${res.status}`);
    return res.json();
  }

  /**
   * Is a short payment explained by a Razorpay offer? Every fact comes from
   * Razorpay's own API, never from the webhook body or the browser:
   *   1. the payment belongs to THIS order's Razorpay order;
   *   2. that Razorpay order is for our full total, Razorpay calls it `paid`, and
   *      what it received is exactly this payment;
   *   3. Razorpay lists at least one offer applied to the payment;
   *   4. when the offer's terms can be read, the shortfall is within its benefit.
   * Returns the offer snapshot for the order, or null (→ the caller rejects).
   * A Razorpay outage here is thrown, not swallowed: the webhook retries and the
   * hourly reconciliation tries again — a paid order must not be rejected for good
   * because an API call timed out.
   */
  async _resolveGatewayOffer(order, paymentEntity, expectedPaise) {
    if (!order.razorpayOrderId || paymentEntity.order_id !== order.razorpayOrderId) return null;

    const [rzpOrder, expanded] = await Promise.all([
      this._razorpayGet(`/orders/${encodeURIComponent(order.razorpayOrderId)}`),
      this._razorpayGet(`/payments/${encodeURIComponent(paymentEntity.id)}?expand[]=offers`),
    ]);
    if (rzpOrder.amount !== expectedPaise || rzpOrder.status !== 'paid') return null;
    if (rzpOrder.amount_paid !== paymentEntity.amount || expanded.amount !== paymentEntity.amount) return null;
    if (expanded.status !== 'captured') return null;

    const offerIds = (expanded.offers?.items || []).map((o) => o?.id).filter(Boolean);
    if (!offerIds.length) return null;

    const shortfallPaise = expectedPaise - paymentEntity.amount;
    const terms = await this._findOfferTerms(offerIds[0]);
    if (terms?.capPaise != null && shortfallPaise > terms.capPaise) {
      console.error(`[SECURITY] Offer shortfall exceeds its benefit | Order: ${order._id} | Short ${shortfallPaise} paise, offer cap ${terms.capPaise}`);
      return null;
    }

    return {
      offerIds,
      name: terms?.name || '',
      discount: shortfallPaise / 100,
      amountPaid: paymentEntity.amount / 100,
      paymentId: paymentEntity.id,
    };
  }

  /**
   * An offer's name and benefit cap, for display and the extra cap check. Razorpay
   * has no fetch-one-offer endpoint, so this walks the (bounded) offer list.
   * Best-effort: null when not found or the list is unavailable.
   */
  async _findOfferTerms(offerId) {
    try {
      for (let skip = 0; skip < 200; skip += 50) {
        const page = await this._razorpayGet(`/offers?count=50&skip=${skip}`);
        const offer = (page.items || []).find((o) => o.id === offerId);
        if (offer) {
          const benefit = offer.rules?.items?.[0]?.benefits?.items?.[0];
          const max = Number(benefit?.max_benefit_value) || 0;
          const flat = Number(benefit?.value) || 0;
          // Percentage offers carry a cap in max_benefit_value; flat ones only `value`.
          const capPaise = benefit?.type === 'instant_discount' ? (max > 0 ? max : flat) : null;
          return { name: offer.display_text || offer.name || '', capPaise: capPaise || null };
        }
        if (!page.has_more) break;
      }
    } catch (err) {
      console.warn(`[Payment] Could not read Razorpay offer ${offerId}:`, err.message);
    }
    return null;
  }

  /**
   * Handle payment.captured event (with full DB validation)
   * @param {Object} payload - Webhook payload
   */
  async handlePaymentCaptured(payload) {
    const paymentEntity = payload.payment.entity;
    const orderId = paymentEntity.notes?.orderId;

    // A payment made through a Payment Link carries no orderId on the payment
    // entity — the parallel `payment_link.paid` event resolves those. Ignore
    // gracefully (200) instead of throwing, so a link payment's payment.captured
    // doesn't 500 the webhook on every offline link sale.
    if (!orderId) {
      console.warn('[Webhook] payment.captured has no orderId in notes — ignoring (payment_link.paid handles link payments)');
      return;
    }

    // SECURITY: Find order in DB
    const order = await orderRepository.findById(orderId);
    if (!order) {
      console.error(`[SECURITY] Webhook payment for non-existent order: ${orderId}`);
      throw new Error('Order not found');
    }

    const { alreadyProcessed, gatewayOffer } = await this._validatePaymentAgainstOrder(order, paymentEntity);
    if (alreadyProcessed) {
      console.log(`[Webhook] Payment already processed for order: ${orderId}`);
      return;
    }

    // Process payment (same as frontend verification)
    console.log(`[Webhook] Processing payment for order: ${orderId}`);
    await this.processPaymentSuccess(orderId, paymentEntity, order.user?.toString(), { gatewayOffer });
  }

  /**
   * Handle payment_link.paid — the offline "collect payment" flow. Resolves our
   * order from the payment LINK entity (its `notes.orderId` / `reference_id`),
   * since a payment made via a link may not carry those on the payment entity.
   * Reuses the same amount/currency/idempotency guards and success path.
   * @param {Object} payload - webhook payload (payment_link.entity + payment.entity)
   */
  async handlePaymentLinkPaid(payload) {
    const link = payload.payment_link?.entity;
    const paymentEntity = payload.payment?.entity;
    if (!paymentEntity) {
      throw new Error('Missing payment entity in payment_link.paid');
    }

    const orderId = link?.notes?.orderId || link?.reference_id || paymentEntity.notes?.orderId;
    if (!orderId) {
      console.error('[SECURITY] payment_link.paid missing orderId (notes/reference)');
      throw new Error('Missing orderId in payment link');
    }

    const order = await orderRepository.findById(orderId);
    if (!order) {
      console.error(`[SECURITY] payment_link.paid for non-existent order: ${orderId}`);
      throw new Error('Order not found');
    }

    // A payment PART (quotation-first sales order): settled against that part's
    // own amount, never the order total.
    if (link?.id && (order.paymentParts || []).some((p) => p.linkId === link.id)) {
      console.log(`[Webhook] Processing payment part ${link.id} for order: ${orderId}`);
      await this.processPaymentPart(orderId, link.id, paymentEntity);
      return;
    }

    // Same amount (rounded)/currency/idempotency guards as a captured payment.
    const { alreadyProcessed, gatewayOffer } = await this._validatePaymentAgainstOrder(order, paymentEntity);
    if (alreadyProcessed) {
      console.log(`[Webhook] Payment link already processed for order: ${orderId}`);
      return;
    }

    // Ensure downstream code that reads notes.orderId still works.
    paymentEntity.notes = { ...(paymentEntity.notes || {}), orderId };
    console.log(`[Webhook] Processing payment-link payment for order: ${orderId}`);
    await this.processPaymentSuccess(orderId, paymentEntity, order.user?.toString(), { gatewayOffer });
  }

  /**
   * Handle payment failure
   * @param {Object} paymentEntity - Razorpay payment entity
   * @returns {Promise<void>}
   */
  async handlePaymentFailure(paymentEntity) {
    try {
      const paymentRecord = await paymentRepository.findByGatewayPaymentId(paymentEntity.id);
      if (paymentRecord) {
        paymentRecord.status = 'failed';
        paymentRecord.failureReason = paymentEntity.error_description || paymentEntity.error_reason;
        await paymentRepository.save(paymentRecord);
      }

      const orderId = paymentEntity.notes ? paymentEntity.notes.orderId : null;

      if (orderId) {
        const order = await orderRepository.findById(orderId);
        if (order) {
          // Payment failure now lives purely on the PAYMENT axis — it does NOT
          // change fulfillment status (the order stays `awaiting_payment`, so the
          // customer can retry). Only flip an order that hasn't already paid.
          if (order.status === 'awaiting_payment' && order.paymentStatus !== 'paid') {
            order.paymentStatus = 'failed';
            await orderRepository.save(order);
            // Surface it to the Sales CRM as a payment-failed lead (best-effort).
            await leadSyncService.safeSync(() => leadSyncService.upsertFromOrder(order));
            console.log(`Order ${orderId} paymentStatus set to failed`);
          }
        }
      }
      
      console.log(`Payment failure processed for payment ${paymentEntity.id}`);
    } catch (error) {
      console.error('Error handling payment failure:', error);
      // Capture payment failure handling errors
      if (process.env.SENTRY_DSN) {
        Sentry.withScope((scope) => {
          scope.setContext('payment_failure_handling', {
            paymentId: paymentEntity?.id,
            orderId: paymentEntity?.notes?.orderId
          });
          scope.setTag('payment_action', 'handle_payment_failure');
          Sentry.captureException(error);
        });
      }
    }
  }

  /**
   * Apply a terminal refund webhook (refund.processed / refund.failed) to our records.
   *
   * Resolves the order via the refund's `notes.orderId` (stamped at initiation), falling
   * back to a lookup by the stored refund id. Idempotent: replayed webhooks and a refund
   * that already reached this terminal state are no-ops.
   *
   * @param {Object} refundEntity - Razorpay refund entity (payload.refund.entity)
   * @param {'completed'|'failed'} finalStatus - Terminal refundDetails.status to apply
   */
  async applyRefundWebhook(refundEntity, finalStatus) {
    const refundId = refundEntity.id;
    const orderId = refundEntity.notes?.orderId;
    const returnId = refundEntity.notes?.returnId;

    // Return refunds are reconciled against their authoritative ReturnRequest.refund
    // record (per-line, keyed by razorpayRefundId), which is correct even when one
    // order has several returns. The order.refundDetails path below is only for the
    // one-refund order-cancellation flow (no returnId).
    if (returnId) {
      return this.applyReturnRefundWebhook(refundId, returnId, refundEntity, finalStatus);
    }

    // Same for a partial cancellation: its authoritative record is the
    // Order.cancellations[] entry. Without this branch the refund falls through to the
    // order-level path below, mismatches on `refundDetails.transactionId`, and the
    // cancellation is left in `processing` for ever — with its LTV decrement and its
    // Payment.refundAmount increment never running.
    const cancellationId = refundEntity.notes?.cancellationId;
    if (cancellationId) {
      return this.applyCancellationRefundWebhook(refundId, cancellationId, refundEntity, finalStatus);
    }

    let order = null;
    if (orderId) {
      order = await orderRepository.findById(orderId);
    }
    if (!order) {
      order = await orderRepository.findOneByRefundId(refundId);
    }

    if (!order || !order.refundDetails) {
      console.error(`[Webhook] refund.${finalStatus} for unresolvable order | refundId: ${refundId} | orderId: ${orderId || 'n/a'}`);
      return;
    }

    // Guard: only act on OUR refund. A mismatched id means a different/stale refund.
    if (order.refundDetails.transactionId && order.refundDetails.transactionId !== refundId) {
      console.warn(`[Webhook] refund id mismatch for order ${order._id} | stored: ${order.refundDetails.transactionId} | webhook: ${refundId}`);
      return;
    }

    // Idempotency: already in this terminal state → nothing to do.
    if (order.refundDetails.status === finalStatus) {
      return;
    }

    order.refundDetails.status = finalStatus;
    order.refundDetails.transactionId = refundId;

    if (finalStatus === 'completed') {
      order.refundDetails.processedAt = order.refundDetails.processedAt || new Date();
      // Payment axis: mark the order and its Payment row refunded. amounts are stored in
      // rupees (see processPaymentSuccess); the webhook amount is paise → divide by 100.
      order.paymentStatus = 'refunded';
      if (order.payment && await orderRepository.claimRefundPaymentRecord(order._id)) {
        // Accumulate, don't assign: this used to overwrite refundAmount, so a second
        // partial refund on the same payment erased the first. The guards above (id
        // mismatch + already-in-finalStatus) are read-then-write and so cannot settle a
        // race with processRefund's own completion path — the atomic claim can.
        await paymentRepository.recordRefund(
          order.payment, (refundEntity.amount || 0) / 100, 'order_cancelled'
        );
      }
    } else {
      order.refundDetails.failureReason =
        refundEntity.error?.description || 'Refund failed at gateway';
    }

    await orderRepository.save(order);
    console.log(`[Webhook] refund.${finalStatus} applied to order ${order._id} (refundId ${refundId})`);

    // Notifications (best-effort, post-save). Reached only on a genuine terminal
    // transition — the early returns above de-dupe replayed webhooks — so each fires
    // at most once per real refund outcome. A Redis/queue failure must never fail the
    // webhook (Razorpay would retry the whole event and re-apply is idempotent anyway).
    if (process.env.REDIS_URL) {
      const queue = getNotificationsQueue();
      if (finalStatus === 'completed') {
        // Tell the customer their money is on the way. Reuses the idempotent
        // status-email path (guarded by Order.notifiedStatuses['refunded']).
        // NOTE: that guard keys on the status string, so it notifies once per order.
        // Fine while refunds are full-only; a future partial/multi-refund flow must
        // switch to per-refund-id idempotency or a second completed refund goes unsent.
        queue
          .add('send-order-status-email', { orderId: order._id.toString(), status: 'refunded' })
          .catch((err) =>
            console.error(`[Queue] Failed to enqueue refund status email for ${order._id}:`, err.message)
          );
      } else if (finalStatus === 'failed') {
        // Refund failed at the gateway — the customer is still owed money and only a
        // human can resolve it. Alert the support inbox. (Guarded on the explicit
        // 'failed' status so a future non-terminal finalStatus can't misfire this.)
        queue
          .add('send-admin-refund-failed-alert', { orderId: order._id.toString() })
          .catch((err) =>
            console.error(`[Queue] Failed to enqueue send-admin-refund-failed-alert for ${order._id}:`, err.message)
          );
      }
    }
  }

  /**
   * Apply a terminal refund webhook to a PARTIAL-CANCELLATION refund.
   *
   * The authoritative record is `Order.cancellations[].refund`, keyed by
   * razorpayRefundId — one order can hold several cancellation refunds, and reconciling
   * them through the single `order.refundDetails` summary would let the last one
   * overwrite the rest.
   *
   * Every write is a CONDITIONAL update matched on the record's current state, so a
   * replayed webhook, or one racing the controller that initiated the refund, is a
   * no-op rather than a double-count.
   *
   * @param {string} refundId
   * @param {string} cancellationId - from the refund's notes
   * @param {Object} refundEntity
   * @param {'completed'|'failed'} finalStatus
   */
  async applyCancellationRefundWebhook(refundId, cancellationId, refundEntity, finalStatus) {
    const orderId = refundEntity.notes?.orderId;
    let order = orderId ? await orderRepository.findById(orderId).catch(() => null) : null;
    if (!order) {
      order = await orderRepository.findOne({ 'cancellations.refund.razorpayRefundId': refundId })
        .catch(() => null);
    }
    if (!order) {
      console.error(`[Webhook] cancellation refund.${finalStatus} for unresolvable order | refundId: ${refundId} | cancellationId: ${cancellationId}`);
      return;
    }

    const record = (order.cancellations || [])
      .find((c) => String(c._id) === String(cancellationId));
    if (!record) {
      console.error(`[Webhook] cancellation refund.${finalStatus} for unknown cancellation ${cancellationId} on order ${order._id}`);
      return;
    }

    // Guard: only act on OUR refund. A mismatched id means a stale or different one.
    if (record.refund?.razorpayRefundId && record.refund.razorpayRefundId !== refundId) {
      console.warn(`[Webhook] cancellation refund id mismatch on order ${order._id} | stored: ${record.refund.razorpayRefundId} | webhook: ${refundId}`);
      return;
    }
    // Idempotency: already terminal → nothing to do.
    if (record.refund?.status === finalStatus) return;

    const settled = await orderRepository.settleCancellationRefund(
      order._id, record._id, finalStatus,
      finalStatus === 'completed'
        ? { razorpayRefundId: refundId }
        : {
          razorpayRefundId: refundId,
          failureReason: refundEntity.error?.description || 'Refund failed at gateway',
        },
    );
    // Matched on `processing`, so null means the controller already settled it — the
    // instant-refund path. Not an error, just nothing left to do.
    if (!settled) return;

    if (finalStatus !== 'completed') return;

    /*
      The two non-idempotent side effects, behind the same once-only claim the
      controller uses. An instant refund whose webhook lands after the controller has
      already run them must not count the same money twice.
    */
    await applyCancellationRefundSideEffectsOnce(
      order._id, record._id, order.payment, refundEntity.amount || 0);
  }

  /**
   * Apply a terminal refund webhook to a RETURN refund. The authoritative record is
   * ReturnRequest.refund (per-line, keyed by razorpayRefundId), so this reconciles
   * THAT — safe when an order has multiple returns whose refunds would otherwise fight
   * over the single order.refundDetails summary. Idempotent: a replayed webhook or an
   * already-terminal refund is a no-op.
   *
   * @param {string} refundId - Razorpay refund id (payload.refund.entity.id)
   * @param {string} returnId - ReturnRequest id from refund notes
   * @param {Object} refundEntity - Razorpay refund entity
   * @param {'completed'|'failed'} finalStatus
   */
  async applyReturnRefundWebhook(refundId, returnId, refundEntity, finalStatus) {
    // Resolve the return by id, falling back to the stored refund id (parity with the
    // order path's notes-then-refundId resolution).
    let rr = await returnRequestRepository.findById(returnId).catch(() => null);
    if (!rr) {
      rr = await returnRequestRepository.findOne({ 'refund.razorpayRefundId': refundId });
    }
    if (!rr || !rr.refund) {
      console.error(`[Webhook] return refund.${finalStatus} for unresolvable return | refundId: ${refundId} | returnId: ${returnId || 'n/a'}`);
      return;
    }

    // Guard: only act on OUR refund. A mismatched id means a stale/different refund.
    if (rr.refund.razorpayRefundId && rr.refund.razorpayRefundId !== refundId) {
      console.warn(`[Webhook] return refund id mismatch for return ${rr._id} | stored: ${rr.refund.razorpayRefundId} | webhook: ${refundId}`);
      return;
    }
    // Idempotency: already in this terminal state → nothing to do.
    if (rr.refund.status === finalStatus) return;

    rr.refund.razorpayRefundId = refundId;
    rr.refund.status = finalStatus;
    if (finalStatus === 'completed') {
      rr.refund.completedAt = rr.refund.completedAt || new Date();
    } else {
      rr.refund.failureReason = refundEntity.error?.description || 'Refund failed at gateway';
    }
    await returnRequestRepository.save(rr);

    // Net-LTV reversal for a normal-speed refund that settles here (the immediate
    // path handles instant refunds). Once-only claim de-dupes across both paths.
    if (finalStatus === 'completed') await reverseReturnLtvOnce(rr._id.toString());

    // Best-effort order-level reflection. The order summary is a LATEST-refund pointer,
    // not the source of truth (see returnController), so we update it and the payment
    // axis carefully: the order is only marked fully `refunded` when a single return's
    // refund covers the whole order value — a partial per-line return leaves it `paid`.
    const order = await orderRepository.findById(rr.order).catch(() => null);
    if (order) {
      order.refundDetails = order.refundDetails || {};
      order.refundDetails.status = finalStatus;
      order.refundDetails.transactionId = refundId;
      if (finalStatus === 'completed') {
        order.refundDetails.amount = rr.refund.finalAmount;
        order.refundDetails.processedAt = order.refundDetails.processedAt || new Date();
        // Record the money on the Payment row for EVERY completed return refund, not
        // just a full-value one — a partial refund used to leave the payment reading
        // ₹0 refunded, so finance (and the headroom check) could not see it had gone.
        // recordRefund accumulates and flips `refunded` itself once the total covers
        // the capture; the order's own paymentStatus stays keyed to the full case.
        // Claimed once, so this and initiateReturnRefund's completion path cannot both
        // $inc the same refund when an instant refund races its own webhook.
        if (order.payment && await returnRequestRepository.claimPaymentRecord(rr._id)) {
          await paymentRepository.recordRefund(
            order.payment, (refundEntity.amount || 0) / 100, 'return_refund'
          );
        }
        if (rr.refund.finalAmount >= order.totalAmount) {
          order.paymentStatus = 'refunded';
        }
      } else {
        order.refundDetails.failureReason = refundEntity.error?.description || 'Refund failed at gateway';
      }
      await orderRepository.save(order);

      // Notifications. The customer "refund initiated" email is already sent at
      // initiation; here we only alert support on a terminal FAILURE (money still
      // owed). Reuse the wired order-level refund-failed alert — it reads the
      // order.refundDetails we just stamped to 'failed'.
      if (finalStatus === 'failed' && process.env.REDIS_URL) {
        getNotificationsQueue()
          .add('send-admin-refund-failed-alert', { orderId: order._id.toString() })
          .catch((err) =>
            console.error(`[Queue] Failed to enqueue return refund-failed alert for order ${order._id}:`, err.message)
          );
      }
    }
    console.log(`[Webhook] return refund.${finalStatus} applied to return ${rr._id} (refundId ${refundId})`);
  }
}

// Export singleton instance
const razorpayService = new RazorpayService();
export default razorpayService;