/**
 * Razorpay Service
 * Handles Razorpay payment integration including order creation, payment verification, and webhook handling
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import orderRepository from '../repositories/orderRepository.js';
import paymentRepository from '../repositories/paymentRepository.js';
import orderStatusService from './orderStatusService.js';
import * as Sentry from '@sentry/node';

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
          scope.setContext('payment_verification', { 
            razorpay_order_id, 
            razorpay_payment_id 
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
  async processPaymentSuccess(orderId, paymentData, userId) {
    // ── Atomic transaction: create payment → link to order → confirm status ───
    // If any step fails the transaction aborts, rolling back all writes.
    // The old manual "mark payment as failed" compensation code is no longer
    // needed — the abort handles cleanup automatically.
    const session = await mongoose.startSession();

    try {
      let paymentId;

      await session.withTransaction(async () => {
        const order = await orderRepository.findById(orderId, [], session);
        if (!order) {
          throw new Error('Order not found');
        }

        const paymentRecord = await paymentRepository.createPayment(
          {
            order: orderId,
            user: userId,
            amount: order.totalAmount,
            currency: 'INR',
            paymentMethod: this.getPaymentMethodFromRazorpay(paymentData.method),
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
        await orderRepository.save(order, session);

        const result = await orderStatusService.updateOrderStatus(orderId, 'confirmed', {
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

        paymentId = paymentRecord._id;
      });

      return {
        success: true,
        message: 'Payment processed successfully',
        orderId,
        paymentId
      };
    } catch (error) {
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
   * Map Razorpay payment method to internal payment method
   * @param {string} razorpayMethod - Razorpay payment method
   * @returns {string} Internal payment method
   */
  getPaymentMethodFromRazorpay(razorpayMethod) {
    const methodMap = {
      'card': 'credit_card',
      'debitcard': 'debit_card',
      'netbanking': 'net_banking',
      'wallet': 'wallet',
      'upi': 'upi',
      'emi': 'emi'
    };
    
    return methodMap[razorpayMethod] || razorpayMethod;
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
          
        case 'payment.failed':
          // Payment failed - update payment record
          await this.handlePaymentFailure(payload.payment.entity);
          break;
          
        case 'order.paid':
          // Order paid - redundant with payment.captured, but handle safely
          console.log('[Webhook] Order paid event (redundant):', payload.order.entity.id);
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
   * Handle payment.captured event (with full DB validation)
   * @param {Object} payload - Webhook payload
   */
  async handlePaymentCaptured(payload) {
    const paymentEntity = payload.payment.entity;
    const orderId = paymentEntity.notes?.orderId;
    
    if (!orderId) {
      console.error('[SECURITY] Webhook payment missing orderId in notes');
      throw new Error('Missing orderId in payment notes');
    }
    
    // SECURITY: Find order in DB
    const order = await orderRepository.findById(orderId);
    if (!order) {
      console.error(`[SECURITY] Webhook payment for non-existent order: ${orderId}`);
      throw new Error('Order not found');
    }
    
    // SECURITY: Validate amount (prevent amount manipulation)
    const webhookAmount = paymentEntity.amount; // in paise
    const orderAmount = order.totalAmount * 100; // convert to paise
    
    if (webhookAmount !== orderAmount) {
      console.error(
        `[SECURITY] Amount mismatch! | Order: ${orderId} | ` +
        `Expected: ${orderAmount} paise | Got: ${webhookAmount} paise`
      );
      throw new Error('Amount mismatch');
    }
    
    // SECURITY: Validate currency
    if (paymentEntity.currency !== 'INR') {
      console.error(
        `[SECURITY] Currency mismatch! | Order: ${orderId} | ` +
        `Expected: INR | Got: ${paymentEntity.currency}`
      );
      throw new Error('Currency mismatch');
    }
    
    // SECURITY: Check if already processed (idempotency).
    // order.payment is an ObjectId reference — it has no .status field.
    // Query the Payment collection directly using the gateway payment ID instead.
    const existingPayment = await paymentRepository.findByGatewayPaymentId(paymentEntity.id);
    if (existingPayment && existingPayment.status === 'completed') {
      console.log(`[Webhook] Payment already processed for order: ${orderId}`);
      return;
    }
    
    // Process payment (same as frontend verification)
    console.log(`[Webhook] Processing payment for order: ${orderId}`);
    await this.processPaymentSuccess(orderId, paymentEntity, order.user?.toString());
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
          // Only update if status is pending (don't overwrite other terminal states)
          if (order.status === 'pending') {
            await orderStatusService.updateOrderStatus(orderId, 'failed', {
              userId: null, // System update
              isAdmin: true,
              reason: 'payment_failed',
              notes: `Payment failed via Razorpay. Reason: ${paymentEntity.error_description || paymentEntity.error_reason || 'Unknown'}`,
              metadata: {
                gatewayId: paymentEntity.id,
                failureReason: paymentEntity.error_description
              }
            });
            console.log(`Order ${orderId} marked as failed due to payment failure`);
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
}

// Export singleton instance
const razorpayService = new RazorpayService();
export default razorpayService;