/**
 * Razorpay Service
 * Handles Razorpay payment integration including order creation, payment verification, and webhook handling
 */

import crypto from 'crypto';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import orderStatusService from './orderStatusService.js';

class RazorpayService {
  constructor() {
    // Load configuration from environment variables
    this.key_id = process.env.RAZORPAY_KEY_ID;
    this.key_secret = process.env.RAZORPAY_KEY_SECRET;
    
    // Validate configuration
    if (!this.key_id || !this.key_secret) {
      throw new Error('Razorpay credentials not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in environment variables.');
    }
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
      throw new Error(`Failed to create Razorpay order: ${error.message}`);
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
    try {
      // Find the order
      const order = await Order.findById(orderId);
      if (!order) {
        throw new Error('Order not found');
      }
      
      // Create payment record
      const paymentRecord = new Payment({
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
        paymentDetails: {
          razorpay: paymentData
        }
      });
      
      await paymentRecord.save();
      
      // Link payment to order
      order.payment = paymentRecord._id;
      await order.save();
      
      // Update order status to confirmed
      const result = await orderStatusService.updateOrderStatus(orderId, 'confirmed', {
        userId: null, // System update
        isAdmin: true,
        reason: 'payment_verified',
        notes: `Payment received via Razorpay. Payment ID: ${paymentData.id}`,
        metadata: {
          gatewayId: paymentData.id,
          transactionId: paymentData.id
        }
      });
      
      if (!result.success) {
        throw new Error(`Failed to update order status: ${result.message}`);
      }
      
      return {
        success: true,
        message: 'Payment processed successfully',
        orderId: orderId,
        paymentId: paymentRecord._id
      };
    } catch (error) {
      // If we created a payment record, mark it as failed
      try {
        const paymentRecord = await Payment.findOne({ order: orderId, gatewayPaymentId: paymentData.id });
        if (paymentRecord) {
          paymentRecord.status = 'failed';
          paymentRecord.failureReason = error.message;
          await paymentRecord.save();
        }
      } catch (updateError) {
        // Log but don't throw to avoid masking original error
        console.error('Failed to update payment record status:', updateError);
      }
      
      throw new Error(`Failed to process payment: ${error.message}`);
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
   * Handle Razorpay webhook events
   * @param {string|Buffer} rawBody - Raw webhook body for signature verification
   * @param {string} signature - Webhook signature
   * @returns {Promise<Object>} Processing result
   */
  async handleWebhook(rawBody, signature) {
    try {
      // Verify webhook signature
      const shasum = crypto.createHmac('sha256', this.key_secret);
      shasum.update(rawBody);
      const digest = shasum.digest('hex');
      
      if (digest !== signature) {
        throw new Error('Webhook signature verification failed');
      }
      
      const webhookData = JSON.parse(rawBody.toString());
      const event = webhookData.event;
      const payload = webhookData.payload;
      
      switch (event) {
        case 'payment.captured':
          // Payment captured - already handled in frontend verification
          console.log('Payment captured:', payload.payment.entity.id);
          break;
          
        case 'payment.failed':
          // Payment failed - update payment record
          await this.handlePaymentFailure(payload.payment.entity);
          break;
          
        case 'order.paid':
          // Order paid - already handled in frontend verification
          console.log('Order paid:', payload.order.entity.id);
          break;
          
        default:
          console.log('Unhandled Razorpay webhook event:', event);
      }
      
      return {
        success: true,
        message: 'Webhook processed successfully'
      };
    } catch (error) {
      throw new Error(`Webhook processing failed: ${error.message}`);
    }
  }

  /**
   * Handle payment failure
   * @param {Object} paymentEntity - Razorpay payment entity
   * @returns {Promise<void>}
   */
  async handlePaymentFailure(paymentEntity) {
    try {
      // 1. Try to find and update payment record if it exists
      const paymentRecord = await Payment.findOne({ gatewayPaymentId: paymentEntity.id });
      if (paymentRecord) {
        paymentRecord.status = 'failed';
        paymentRecord.failureReason = paymentEntity.error_description || paymentEntity.error_reason;
        await paymentRecord.save();
      }

      // 2. Update Order status to 'failed'
      // Extract orderId from notes if available
      const orderId = paymentEntity.notes ? paymentEntity.notes.orderId : null;
      
      if (orderId) {
        const order = await Order.findById(orderId);
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
    }
  }
}

// Export singleton instance
const razorpayService = new RazorpayService();
export default razorpayService;