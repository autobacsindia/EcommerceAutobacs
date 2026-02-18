/**
 * Order Notification Service
 * Handles email and SMS notifications for order events
 */

import emailHandler from './emailHandler.js';
import smsHandler from './smsHandler.js';
import notificationLogger from './notificationLogger.js';

class OrderNotificationService {
  log(message) {
    if (process.env.NODE_ENV !== 'test') {
      console.log(message);
    }
  }

  /**
   * Send order placed notification
   */
  async sendOrderPlacedNotification(order, user) {
    this.log(`[Notification] Order Placed - Order #${order._id} for ${user.email}`);
    
    const emailSubject = `Order Confirmation - Order #${order._id}`;
    const emailBody = this._generateOrderPlacedEmail(order, user);
    
    const emailResult = await this._sendEmail({
      to: user.email,
      subject: emailSubject,
      body: emailBody
    });
    
    // Log notification attempt
    await notificationLogger.logEmail({
      orderId: order._id,
      userId: user._id || user.id,
      event: 'order_placed',
      recipient: user.email,
      result: emailResult,
      subject: emailSubject
    });
    
    return { success: true, message: 'Order placed notification sent' };
  }

  /**
   * Send order confirmed notification
   */
  async sendOrderConfirmedNotification(order, user) {
    this.log(`[Notification] Order Confirmed - Order #${order._id}`);
    
    const emailSubject = `Payment Confirmed - Order #${order._id}`;
    const emailBody = this._generateOrderConfirmedEmail(order, user);
    
    const emailResult = await this._sendEmail({
      to: user.email,
      subject: emailSubject,
      body: emailBody
    });
    
    // Log notification attempt
    await notificationLogger.logEmail({
      orderId: order._id,
      userId: user._id || user.id,
      event: 'order_confirmed',
      recipient: user.email,
      result: emailResult,
      subject: emailSubject
    });
    
    return { success: true };
  }

  /**
   * Send order shipped notification
   */
  async sendOrderShippedNotification(order, user) {
    this.log(`[Notification] Order Shipped - Order #${order._id}, Tracking: ${order.trackingNumber}`);
    
    const emailSubject = `Your Order Has Shipped - Order #${order._id}`;
    const emailBody = this._generateOrderShippedEmail(order, user);
    
    const emailResult = await this._sendEmail({
      to: user.email,
      subject: emailSubject,
      body: emailBody
    });
    
    // Log email notification
    await notificationLogger.logEmail({
      orderId: order._id,
      userId: user._id || user.id,
      event: 'order_shipped',
      recipient: user.email,
      result: emailResult,
      subject: emailSubject
    });
    
    // Also send SMS for critical event
    const smsMessage = `Your order #${order._id} has shipped! Track: ${order.trackingNumber}. Estimated delivery: ${this._formatDate(order.estimatedDelivery)}`;
    const smsResult = await this._sendSMS({
      to: order.shippingAddress.phone,
      message: smsMessage
    });
    
    // Log SMS notification
    await notificationLogger.logSms({
      orderId: order._id,
      userId: user._id || user.id,
      event: 'order_shipped',
      recipient: order.shippingAddress.phone,
      result: smsResult,
      messagePreview: smsMessage.substring(0, 100)
    });
    
    return { success: true };
  }

  /**
   * Send order delivered notification
   */
  async sendOrderDeliveredNotification(order, user) {
    this.log(`[Notification] Order Delivered - Order #${order._id}`);
    
    const emailSubject = `Order Delivered - Order #${order._id}`;
    const emailBody = this._generateOrderDeliveredEmail(order, user);
    
    const emailResult = await this._sendEmail({
      to: user.email,
      subject: emailSubject,
      body: emailBody
    });
    
    // Log email notification
    await notificationLogger.logEmail({
      orderId: order._id,
      userId: user._id || user.id,
      event: 'order_delivered',
      recipient: user.email,
      result: emailResult,
      subject: emailSubject
    });
    
    const smsMessage = `Your order #${order._id} has been delivered! We hope you enjoy your purchase.`;
    const smsResult = await this._sendSMS({
      to: order.shippingAddress.phone,
      message: smsMessage
    });
    
    // Log SMS notification
    await notificationLogger.logSms({
      orderId: order._id,
      userId: user._id || user.id,
      event: 'order_delivered',
      recipient: order.shippingAddress.phone,
      result: smsResult,
      messagePreview: smsMessage
    });
    
    return { success: true };
  }

  /**
   * Send order cancelled notification
   */
  async sendOrderCancelledNotification(order, user, refundDetails = null) {
    this.log(`[Notification] Order Cancelled - Order #${order._id}`);
    
    const emailSubject = `Order Cancelled - Order #${order._id}`;
    const emailBody = this._generateOrderCancelledEmail(order, user, refundDetails);
    
    await this._sendEmail({
      to: user.email,
      subject: emailSubject,
      body: emailBody
    });
    
    return { success: true };
  }

  /**
   * Send return request submitted notification
   */
  async sendReturnRequestSubmittedNotification(order, user) {
    this.log(`[Notification] Return Request Submitted - Order #${order._id}`);
    
    // Customer notification
    const customerSubject = `Return Request Received - Order #${order._id}`;
    const customerBody = this._generateReturnRequestSubmittedEmail(order, user);
    
    await this._sendEmail({
      to: user.email,
      subject: customerSubject,
      body: customerBody
    });
    
    // Admin notification (mock - in production, send to admin email list)
    this.log(`[Admin Alert] New return request for Order #${order._id}`);
    
    return { success: true };
  }

  /**
   * Send return request approved notification
   */
  async sendReturnApprovedNotification(order, user) {
    this.log(`[Notification] Return Approved - Order #${order._id}`);
    
    const emailSubject = `Return Request Approved - Order #${order._id}`;
    const emailBody = this._generateReturnApprovedEmail(order, user);
    
    await this._sendEmail({
      to: user.email,
      subject: emailSubject,
      body: emailBody
    });
    
    await this._sendSMS({
      to: order.shippingAddress.phone,
      message: `Your return request for order #${order._id} has been approved. Please ship the item using the provided label.`
    });
    
    return { success: true };
  }

  /**
   * Send return request rejected notification
   */
  async sendReturnRejectedNotification(order, user, reason) {
    this.log(`[Notification] Return Rejected - Order #${order._id}`);
    
    const emailSubject = `Return Request Update - Order #${order._id}`;
    const emailBody = this._generateReturnRejectedEmail(order, user, reason);
    
    await this._sendEmail({
      to: user.email,
      subject: emailSubject,
      body: emailBody
    });
    
    return { success: true };
  }

  /**
   * Send item received notification
   */
  async sendItemReceivedNotification(order, user) {
    this.log(`[Notification] Return Item Received - Order #${order._id}`);
    
    const emailSubject = `Return Item Received - Order #${order._id}`;
    const emailBody = this._generateItemReceivedEmail(order, user);
    
    await this._sendEmail({
      to: user.email,
      subject: emailSubject,
      body: emailBody
    });
    
    return { success: true };
  }

  /**
   * Send refund processed notification
   */
  async sendRefundProcessedNotification(order, user, refundDetails) {
    this.log(`[Notification] Refund Processed - Order #${order._id}, Amount: ${refundDetails.amount}`);
    
    const emailSubject = `Refund Processed - Order #${order._id}`;
    const emailBody = this._generateRefundProcessedEmail(order, user, refundDetails);
    
    await this._sendEmail({
      to: user.email,
      subject: emailSubject,
      body: emailBody
    });
    
    return { success: true };
  }

  /**
   * Send tracking update notification
   */
  async sendTrackingUpdateNotification(order, user, event) {
    this.log(`[Notification] Tracking Update - Order #${order._id}, Status: ${event.status}`);
    
    // Only send email for major events
    const majorEvents = ['picked_up', 'out_for_delivery', 'delivered', 'failed_delivery'];
    
    if (majorEvents.includes(event.status)) {
      const emailSubject = `Tracking Update - Order #${order._id}`;
      const emailBody = this._generateTrackingUpdateEmail(order, user, event);
      
      await this._sendEmail({
        to: user.email,
        subject: emailSubject,
        body: emailBody
      });
    }
    
    return { success: true };
  }

  // ============================================
  // EMAIL TEMPLATE GENERATORS
  // ============================================

  _generateOrderPlacedEmail(order, user) {
    return `
Dear ${user.name},

Thank you for your order! We've received your order and are processing it.

Order Details:
- Order Number: ${order._id}
- Order Date: ${this._formatDate(order.createdAt)}
- Total Amount: ₹${order.totalAmount.toFixed(2)}

Items Ordered:
${order.items.map(item => `- ${item.name} (Qty: ${item.quantity}) - ₹${(item.price * item.quantity).toFixed(2)}`).join('\n')}

Shipping Address:
${order.shippingAddress.fullName}
${order.shippingAddress.addressLine1}
${order.shippingAddress.addressLine2 ? order.shippingAddress.addressLine2 + '\n' : ''}${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.postalCode}

We'll notify you once your order is confirmed and shipped.

Best regards,
Autobacs Team
    `.trim();
  }

  _generateOrderConfirmedEmail(order, user) {
    return `
Dear ${user.name},

Great news! Your payment has been confirmed and your order is now being processed.

Order Number: ${order._id}
Estimated Delivery: ${this._formatDate(order.estimatedDelivery || new Date(Date.now() + 5 * 24 * 60 * 60 * 1000))}

We'll send you a notification with tracking information once your order ships.

Thank you for shopping with Autobacs!

Best regards,
Autobacs Team
    `.trim();
  }

  _generateOrderShippedEmail(order, user) {
    return `
Dear ${user.name},

Exciting news! Your order has been shipped and is on its way to you.

Order Number: ${order._id}
Tracking Number: ${order.trackingNumber}
Carrier: ${order.carrier?.name || 'Standard Shipping'}
Estimated Delivery: ${this._formatDate(order.estimatedDelivery)}

Track your package: ${order.carrier?.trackingUrl || `Track with number: ${order.trackingNumber}`}

Shipping Address:
${order.shippingAddress.fullName}
${order.shippingAddress.addressLine1}
${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.postalCode}

Best regards,
Autobacs Team
    `.trim();
  }

  _generateOrderDeliveredEmail(order, user) {
    return `
Dear ${user.name},

Your order has been delivered! We hope you're happy with your purchase.

Order Number: ${order._id}
Delivery Date: ${this._formatDate(order.deliveredAt || new Date())}

If you have any issues or questions about your order, please don't hesitate to contact us.

We'd love to hear about your experience! Consider leaving a review for the products you purchased.

Thank you for choosing Autobacs!

Best regards,
Autobacs Team
    `.trim();
  }

  _generateOrderCancelledEmail(order, user, refundDetails) {
    const refundText = refundDetails ? `

Refund Information:
- Refund Amount: ₹${refundDetails.amount?.toFixed(2) || order.totalAmount.toFixed(2)}
- Refund Method: ${this._formatRefundMethod(refundDetails.refundMethod || 'original_payment')}
- Expected Timeline: ${refundDetails.timeline || '3-5 business days'}

Your refund will be processed shortly and you'll receive confirmation once completed.
    ` : '';

    return `
Dear ${user.name},

Your order has been cancelled as requested.

Order Number: ${order._id}
Cancellation Date: ${this._formatDate(order.cancelledAt || new Date())}
Reason: ${order.cancellationReason || 'Customer request'}
${refundText}
If you have any questions about this cancellation, please contact our support team.

Best regards,
Autobacs Team
    `.trim();
  }

  _generateReturnRequestSubmittedEmail(order, user) {
    return `
Dear ${user.name},

We've received your return request for order #${order._id}.

Return Request Details:
- Order Number: ${order._id}
- Requested Date: ${this._formatDate(order.returnRequest.requestedAt)}
- Reason: ${this._formatReturnReason(order.returnRequest.reason)}
- Items: ${order.returnRequest.items.length} item(s)

Our team will review your request within 24-48 hours. You'll receive an email once your return is approved or if we need additional information.

Thank you for your patience.

Best regards,
Autobacs Customer Service
    `.trim();
  }

  _generateReturnApprovedEmail(order, user) {
    return `
Dear ${user.name},

Good news! Your return request has been approved.

Order Number: ${order._id}
Return Label: ${order.returnRequest.returnShippingLabel || 'Will be sent separately'}

Next Steps:
1. Pack the items securely in their original packaging
2. Print and attach the return shipping label
3. Drop off the package at the nearest shipping location
4. Keep your tracking receipt for your records

Once we receive and inspect the items, we'll process your refund within 5-7 business days.

If you have any questions, please don't hesitate to contact us.

Best regards,
Autobacs Customer Service
    `.trim();
  }

  _generateReturnRejectedEmail(order, user, reason) {
    return `
Dear ${user.name},

We've reviewed your return request for order #${order._id}.

Unfortunately, we're unable to approve your return request at this time.

Reason: ${reason || 'Does not meet return policy requirements'}

If you believe this is an error or have questions about this decision, please contact our customer service team. We're here to help!

Contact us: support@autobacs.com

Best regards,
Autobacs Customer Service
    `.trim();
  }

  _generateItemReceivedEmail(order, user) {
    return `
Dear ${user.name},

We've received your returned item(s) for order #${order._id}.

Our quality team is now inspecting the items. This process typically takes 2-3 business days.

Once the inspection is complete, we'll process your refund and send you a confirmation email.

Thank you for your patience.

Best regards,
Autobacs Customer Service
    `.trim();
  }

  _generateRefundProcessedEmail(order, user, refundDetails) {
    return `
Dear ${user.name},

Your refund has been processed!

Order Number: ${order._id}
Refund Amount: ₹${refundDetails.amount.toFixed(2)}
Refund Method: ${this._formatRefundMethod(refundDetails.refundMethod)}
Transaction ID: ${refundDetails.transactionId || 'Processing'}

${refundDetails.refundMethod === 'original_payment' ? 
  'The refund will appear in your original payment method within 5-7 business days.' :
  refundDetails.refundMethod === 'store_credit' ?
  'Store credit has been added to your account.' :
  'Bank transfer will be completed within 7-10 business days.'
}

If you have any questions, please contact our support team.

Thank you for shopping with Autobacs!

Best regards,
Autobacs Team
    `.trim();
  }

  _generateTrackingUpdateEmail(order, user, event) {
    const statusMessages = {
      picked_up: 'Your package has been picked up by our shipping carrier.',
      out_for_delivery: 'Great news! Your package is out for delivery today.',
      delivered: 'Your package has been delivered!',
      failed_delivery: 'Delivery attempt failed. Our carrier will try again.'
    };

    return `
Dear ${user.name},

Tracking Update for Order #${order._id}

Status: ${statusMessages[event.status] || event.description}
Location: ${event.location || 'In transit'}
Time: ${this._formatDate(event.timestamp)}

Tracking Number: ${order.trackingNumber}

${event.status === 'failed_delivery' ? 
  'Please ensure someone is available to receive the package. Contact the carrier if you need to reschedule delivery.' :
  ''
}

Best regards,
Autobacs Team
    `.trim();
  }

  // ============================================
  // COMMUNICATION METHODS
  // ============================================

  /**
   * Send email using SendGrid
   */
  async _sendEmail({ to, subject, body }) {
    try {
      // Attempt to send via email handler
      const result = await emailHandler.sendEmail({
        to,
        subject,
        text: body
      });
      
      // Fallback to console if service not enabled
      if (result.fallbackToConsole && process.env.NODE_ENV !== 'test') {
        console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📧 EMAIL NOTIFICATION (Mock - Service Disabled)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
To: ${to}
Subject: ${subject}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${body}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        `);
      }
      
      return result;
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[OrderNotificationService] Email send error:', error.message);
      }
      return {
        success: false,
        error: error.message,
        provider: 'sendgrid'
      };
    }
  }

  /**
   * Send SMS using Twilio
   */
  async _sendSMS({ to, message }) {
    try {
      // Attempt to send via SMS handler
      const result = await smsHandler.sendSms({
        to,
        message
      });
      
      // Fallback to console if service not enabled
      if (result.fallbackToConsole && process.env.NODE_ENV !== 'test') {
        console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 SMS NOTIFICATION (Mock - Service Disabled)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
To: ${to}
Message: ${message}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        `);
      }
      
      return result;
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[OrderNotificationService] SMS send error:', error.message);
      }
      return {
        success: false,
        error: error.message,
        provider: 'twilio'
      };
    }
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  _formatDate(date) {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  _formatRefundMethod(method) {
    const methods = {
      original_payment: 'Original Payment Method',
      store_credit: 'Store Credit',
      bank_transfer: 'Bank Transfer'
    };
    return methods[method] || method;
  }

  _formatReturnReason(reason) {
    const reasons = {
      defective: 'Product Defective or Damaged',
      wrong_item: 'Wrong Item Received',
      not_as_described: 'Not as Described',
      changed_mind: 'Changed Mind',
      other: 'Other'
    };
    return reasons[reason] || reason;
  }
}

export default new OrderNotificationService();
