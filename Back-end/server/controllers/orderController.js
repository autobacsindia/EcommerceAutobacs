import orderRepository from '../repositories/orderRepository.js';
import userRepository from '../repositories/userRepository.js';
import orderService from '../services/orderService.js';
import orderStatusService from '../services/orderStatusService.js';
import orderTrackingService from '../services/orderTrackingService.js';
import leadSyncService from '../services/leadSyncService.js';
import { generateInvoicePdf, invoiceNumber } from '../services/invoiceService.js';
import { getNotificationsQueue } from '../queue/queues.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import * as Sentry from '@sentry/node';

// @desc    Get all orders for logged-in user with pagination
// @route   GET /orders
// @access  Private
export const getOrders = async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [orders, total] = await Promise.all([
    orderRepository.findByUser(req.user.id, { skip, limit: Number(limit) }),
    orderRepository.countByUser(req.user.id)
  ]);

  res.json({
    success: true,
    count: orders.length,
    orders,
    pagination: {
      currentPage: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      totalOrders: total,
      hasNext: Number(page) < Math.ceil(total / Number(limit)),
      hasPrev: Number(page) > 1
    }
  });
};

// @desc    Get all refunds (orders with refundDetails)
// @route   GET /orders/refunds
// @access  Private/Admin
export const getRefunds = async (req, res) => {
  const orders = await orderRepository.findWithRefunds(req.query.status);

  const refunds = orders.map(order => ({
    _id: order._id,
    order: {
      _id: order._id,
      orderNumber: order.orderNumber || order._id
    },
    user: {
      name: order.user ? order.user.name : 'Unknown'
    },
    amount: order.refundDetails.amount || 0,
    refundType: order.refundDetails.refundType || '',
    refundMethod: order.refundDetails.refundMethod || '',
    status: order.refundDetails.status || 'pending',
    requestedAt: order.refundDetails.requestedAt || order.updatedAt
  }));

  res.json({
    success: true,
    count: refunds.length,
    refunds
  });
};

// @desc    Get order by ID
// @route   GET /orders/:id
// @access  Private
export const getOrderById = async (req, res) => {
  const order = await orderRepository.findWithPopulated(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  // Guard: user may be null if the account was deleted after the order was placed.
  // Admins can still view orphaned orders; regular users cannot.
  const orderUserId = order.user?._id?.toString();
  const isOwner    = orderUserId && orderUserId === req.user.id;
  const isAdmin    = req.user.role === 'admin';

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ success: false, message: 'Not authorized to access this order' });
  }

  // Normalize items: product may be null if it was deleted after the order.
  // Replace null with a tombstone object so the frontend never receives null.
  const normalizedOrder = {
    ...order,
    items: order.items.map(item => ({
      ...item,
      product: item.product ?? {
        _id: item.product,
        name: '[Product no longer available]',
        images: [],
        price: item.price
      }
    }))
  };

  res.json({ success: true, order: normalizedOrder });
};

// @desc    Download the invoice PDF for an order (streamed, auth-gated)
// @route   GET /orders/:id/invoice
// @access  Private (order owner or admin) — regenerated on demand from the order,
//          so no customer PII is ever exposed via a public URL.
export const downloadInvoice = async (req, res) => {
  const order = await orderRepository.findById(req.params.id, [{ path: 'user', select: 'name email' }]);

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  // Same authorization as getOrderById: owner or admin only.
  const orderUserId = order.user?._id?.toString();
  const isOwner = orderUserId && orderUserId === req.user.id;
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ success: false, message: 'Not authorized to access this order' });
  }

  // Invoices only exist once money has changed hands — gate on the PAYMENT axis,
  // not fulfillment (an order can be paid but not yet shipped).
  if (order.paymentStatus !== 'paid' && order.paymentStatus !== 'refunded') {
    return res.status(409).json({
      success: false,
      message: 'Invoice is available only after payment is confirmed'
    });
  }

  const user = order.user && typeof order.user === 'object' ? order.user : null;
  const pdf = await generateInvoicePdf(order, user);
  const filename = `${invoiceNumber(order)}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', pdf.length);
  return res.send(pdf);
};

// @desc    Create new order from cart
// @route   POST /orders
// @access  Private
export const createOrder = async (req, res) => {
  const { items, shippingAddress } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, message: 'No order items provided' });
  }

  try {
    const order = await orderService.createOrder(
      req.user.id,
      items,
      shippingAddress,
      { ...req.body, sessionId: req.headers['x-session-id'] }
    );

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      order
    });
  } catch (err) {
    // AppError carries a numeric statusCode (its .status is 'fail'/'error'); legacy
    // errors set a numeric .status. Prefer statusCode so coupon/karma 400s surface correctly.
    res.status(err.statusCode || (typeof err.status === 'number' ? err.status : 500)).json({ success: false, message: err.message });
  }
};

// @desc    Create guest order (no authentication required)
// @route   POST /orders/guest
// @access  Public
export const createGuestOrder = async (req, res) => {
  try {
    const { items, shippingAddress, paymentMethod, email, phone } = req.body;

    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        message: 'Either email or phone is required'
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No order items provided' });
    }

    // Find or create guest user
    const searchCriteria = email
      ? { email: email.toLowerCase() }
      : { phone };

    let user = await userRepository.findOne(searchCriteria);

    if (!user) {
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const salt           = await bcrypt.genSalt(10);
      const passwordHash   = await bcrypt.hash(randomPassword, salt);

      user = await userRepository.create({
        name: shippingAddress.fullName || 'Guest User',
        email: email?.toLowerCase(),
        phone,
        passwordHash,
        isGuest: true,
        isVerified: false,
        addresses: [shippingAddress]
      });
    } else if (user.isGuest) {
      user.addresses.push(shippingAddress);
      await userRepository.save(user);
    }

    const order = await orderService.createOrder(
      user._id,
      items,
      shippingAddress,
      { ...req.body, sessionId: req.headers['x-session-id'] },
      paymentMethod
    );

    // Persist guest email on the order so admins and notification workers
    // can reach the customer without having to join through the User document
    if (email) {
      order.guestEmail = email.toLowerCase();
      await order.save();
    }

    // Generate magic link token for account claiming
    user.magicLinkToken   = crypto.randomBytes(32).toString('hex');
    user.magicLinkExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await userRepository.save(user);

    if (email && process.env.REDIS_URL) {
      getNotificationsQueue()
        .add('send-magic-link-email', {
          email,
          token: user.magicLinkToken,
          orderId: order._id.toString()
        })
        .catch(err => console.error('[Queue] Failed to enqueue magic link email:', err.message));
    }

    res.status(201).json({
      success: true,
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        status: order.status
      },
      isGuest: true,
      message: 'Order created successfully! Check your email to claim your account.',
      ...(process.env.NODE_ENV === 'development' && {
        magicLinkToken: user.magicLinkToken,
        debugMessage: 'Token included for development testing only'
      })
    });

  } catch (error) {
    console.error('[GUEST_ORDER_ERROR]', error);

    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        scope.setContext('guest_order', {
          email: req.body?.email,
          itemCount: req.body?.items?.length
        });
        scope.setTag('order_type', 'guest_checkout');
        scope.setTag('severity', 'high');
        Sentry.captureException(error);
      });
    }

    res.status(error.statusCode || (typeof error.status === 'number' ? error.status : 500)).json({
      success: false,
      message: error.message || 'Failed to create guest order'
    });
  }
};

// @desc    Create an offline order (deal closed by the sales team off-platform)
// @route   POST /orders/admin/offline
// @access  Private/Admin
//
// Full customer treatment: find-or-create the buyer by email, attach the order to
// their history (source: 'offline'), and — for a new account — email a set-password
// (magic) link so they can log in and see it. The order is created `pending` then
// driven through the normal status machinery (confirmed → optional delivered) so it
// reuses every side-effect: purchase tag, lead conversion, karma earn, invoice/emails.
export const createOfflineOrder = async (req, res) => {
  const {
    email,
    phone,
    name,
    items,
    shippingAddress = {},
    shippingCost = 0,
    discount = 0,
    status = 'processing', // 'processing' (paid) or 'delivered'
    notes,
    leadId,
  } = req.body;

  if (!email || !phone) {
    return res.status(400).json({ success: false, message: 'Customer email and phone are required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'At least one order item is required' });
  }
  const invalidItem = items.find(
    (i) => !i.product || !(Number(i.quantity) > 0) || !(Number(i.price) >= 0)
  );
  if (invalidItem) {
    return res.status(400).json({ success: false, message: 'Each item needs a product, quantity > 0, and price >= 0' });
  }
  // Offline orders are only ever created in a paid state (the deal is done).
  if (!['processing', 'delivered'].includes(status)) {
    return res.status(400).json({ success: false, message: "Offline order status must be 'processing' or 'delivered'" });
  }

  try {
    // ── Find or create the customer ──────────────────────────────────────────
    const normEmail = email.toLowerCase();
    let user = await userRepository.findByEmail(normEmail);
    let isNewUser = false;

    if (!user) {
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, await bcrypt.genSalt(10));
      user = await userRepository.create({
        name: name || shippingAddress.fullName || 'Offline Customer',
        email: normEmail,
        phone,
        passwordHash,
        isVerified: false,
        // First login forces a password set — exactly the guest/WP-claim flow.
        mustResetPassword: true,
      });
      isNewUser = true;
    }

    // ── Build the order (amounts in rupees, matching the rest of the system) ──
    const lineItems = items.map((i) => ({
      product: i.product,
      quantity: Number(i.quantity),
      price: Number(i.price),
      name: i.name || '',
      image: i.image || '',
    }));
    const subtotal = lineItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const totalAmount = Math.max(0, subtotal + Number(shippingCost || 0) - Number(discount || 0));

    const address = {
      fullName: shippingAddress.fullName || name || user.name,
      phone: shippingAddress.phone || phone,
      addressLine1: shippingAddress.addressLine1 || 'Offline sale',
      addressLine2: shippingAddress.addressLine2 || '',
      city: shippingAddress.city || 'N/A',
      state: shippingAddress.state || 'N/A',
      postalCode: shippingAddress.postalCode || '000000',
      country: shippingAddress.country || 'India',
    };

    let order = await orderRepository.create({
      user: user._id,
      source: 'offline',
      items: lineItems,
      shippingAddress: address,
      subtotal,
      shippingCost: Number(shippingCost || 0),
      discount: Number(discount || 0),
      totalAmount,
      status: 'awaiting_payment',
      guestEmail: normEmail,
      statusHistory: [
        {
          status: 'awaiting_payment',
          timestamp: new Date(),
          updatedBy: req.user.id,
          reason: 'manual_confirmation',
          notes: notes || 'Offline order created by admin',
        },
      ],
    });

    // Drive through the normal status machinery so all side-effects fire (purchase
    // tag + lead conversion on confirm; karma earn + emails on delivery). Admin
    // bypass lets us set the final state directly.
    await orderStatusService.updateOrderStatus(order._id.toString(), 'processing', {
      userId: req.user.id,
      isAdmin: true,
      reason: 'manual_confirmation',
      notes: 'Offline sale confirmed (paid)',
    });
    if (status === 'delivered') {
      await orderStatusService.updateOrderStatus(order._id.toString(), 'delivered', {
        userId: req.user.id,
        isAdmin: true,
        reason: 'customer_received',
        notes: 'Offline sale delivered',
      });
    }
    order = await orderRepository.findById(order._id);

    // Explicitly convert the originating lead when the rep closed a specific one
    // (its identity may differ from the order's, e.g. consultation had phone-only).
    if (leadId) {
      await leadSyncService.safeSync(() =>
        leadSyncService.applyLeadStatus(leadId, 'won', {
          actorId: req.user.id,
          notes: 'Closed via offline order',
          convertedOrder: order._id,
        })
      );
    }

    // ── Emails (best-effort, idempotent) ─────────────────────────────────────
    if (process.env.REDIS_URL) {
      const queue = getNotificationsQueue();
      // Invoice/receipt for the paid order.
      queue
        .add('send-order-invoice', { orderId: order._id.toString() })
        .catch((err) => console.error('[Queue] Failed to enqueue send-order-invoice:', err.message));

      // New buyer: send a set-password (magic) link so they can claim their account.
      if (isNewUser) {
        user.magicLinkToken = crypto.randomBytes(32).toString('hex');
        user.magicLinkExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await userRepository.save(user);
        queue
          .add('send-magic-link-email', {
            email: normEmail,
            token: user.magicLinkToken,
            orderId: order._id.toString(),
          })
          .catch((err) => console.error('[Queue] Failed to enqueue send-magic-link-email:', err.message));
      }
    }

    res.status(201).json({
      success: true,
      message: 'Offline order created',
      order,
      customer: { id: user._id, email: user.email, isNewUser },
    });
  } catch (err) {
    console.error('[OFFLINE_ORDER_ERROR]', err);
    res.status(err.statusCode || (typeof err.status === 'number' ? err.status : 500)).json({
      success: false,
      message: err.message || 'Failed to create offline order',
    });
  }
};

// @desc    Cancel an order with validation and refund initiation
// @route   PUT /orders/:id/cancel
// @access  Private
export const cancelOrder = async (req, res) => {
  const order = req.order; // Attached by validateCancellation middleware
  const { reason, notes } = req.body;
  const isAdmin = req.user.role === 'admin';

  const result = await orderStatusService.updateOrderStatus(order._id.toString(), 'cancelled', {
    userId: req.user.id,
    isAdmin,
    cancelledBy: isAdmin ? 'admin' : 'customer',
    reason: reason || 'customer_request',
    notes
  });

  if (!result.success) {
    return res.status(400).json({ success: false, message: result.message });
  }

  // Stock is a coarse status (no per-unit quantity), so cancellation has no
  // stock to restore. Admins manage availability status directly.

  // The service flags a pending refund when money was captured (payment axis).
  const refundInitiated = result.order.refundDetails?.status === 'pending';

  res.json({
    success: true,
    message: 'Order cancelled successfully',
    order: result.order,
    refundInitiated,
    refundAmount: refundInitiated ? order.totalAmount : 0,
    refundTimeline: refundInitiated ? '3-5 business days' : null
  });
};

// @desc    Mark order as failed due to payment failure
// @route   PUT /orders/:id/payment-failed
// @access  Private
export const markPaymentFailed = async (req, res) => {
  const { reason, paymentId, errorDescription } = req.body;
  const order = await orderRepository.findById(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  if (order.user?.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  // Payment failure is a PAYMENT-axis fact now — it doesn't move fulfillment
  // (the order stays awaiting_payment so the customer can retry).
  if (order.status !== 'awaiting_payment' || order.paymentStatus === 'paid') {
    return res.status(400).json({
      success: false,
      message: `Cannot mark payment failed. Order status: ${order.status}, payment: ${order.paymentStatus}`
    });
  }

  order.paymentStatus = 'failed';
  order.statusHistory.push({
    status: order.status,
    timestamp: new Date(),
    updatedBy: req.user.id,
    reason: reason || 'payment_failed',
    notes: `Payment failed reported by client. ${errorDescription ? 'Error: ' + errorDescription : ''}`,
    metadata: { paymentId, errorDescription }
  });
  await orderRepository.save(order);

  // Surface as a payment-failed lead (best-effort).
  await leadSyncService.safeSync(() => leadSyncService.upsertFromOrder(order));

  res.json({ success: true, message: 'Payment marked as failed', order });
};

// @desc    Mark that the customer cancelled the payment (dismissed the popup)
// @route   PUT /orders/:id/payment-cancelled
// @access  Private
//
// Payment-axis event ONLY — the order stays `awaiting_payment` so the customer can
// still retry, and it surfaces as a distinct "payment cancelled" lead. This is
// deliberately NOT the admin order-cancel path (which sets status=cancelled).
export const cancelPayment = async (req, res) => {
  const order = await orderRepository.findById(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }
  if (order.user?.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }
  // Only meaningful before payment succeeds; a paid/shipped order can't be "payment cancelled".
  if (order.status !== 'awaiting_payment' || order.paymentStatus === 'paid') {
    return res.status(400).json({
      success: false,
      message: `Cannot cancel payment. Order status: ${order.status}, payment: ${order.paymentStatus}`
    });
  }

  order.paymentStatus = 'cancelled';
  order.statusHistory.push({
    status: order.status,
    timestamp: new Date(),
    updatedBy: req.user.id,
    reason: 'payment_cancelled',
    notes: 'Payment cancelled by the customer (popup dismissed)'
  });
  await orderRepository.save(order);

  // Surface as a "payment cancelled" lead (best-effort).
  await leadSyncService.safeSync(() => leadSyncService.upsertFromOrder(order));

  res.json({ success: true, message: 'Payment cancelled', order });
};

// @desc    Delete an order (Only cancelled or failed orders)
// @route   DELETE /orders/:id
// @access  Private
export const deleteOrder = async (req, res) => {
  const order = await orderRepository.findById(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  if (order.user?.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Not authorized to delete this order' });
  }

  // Deletable = cancelled, or an unpaid order whose payment failed.
  const isDeletable = order.status === 'cancelled' || order.paymentStatus === 'failed';
  if (!isDeletable) {
    return res.status(400).json({
      success: false,
      message: `Cannot delete order (status '${order.status}', payment '${order.paymentStatus}'). Only cancelled or payment-failed orders can be deleted.`
    });
  }

  await orderRepository.deleteDoc(order);

  res.json({ success: true, message: 'Order deleted successfully', id: req.params.id });
};

// @desc    Update order status with validation (Admin only)
// @route   PUT /orders/:id/status
// @access  Private/Admin
export const updateOrderStatus = async (req, res) => {
  const { status, reason, notes, trackingNumber, estimatedDelivery, metadata } = req.body;

  if (!status) {
    return res.status(400).json({ success: false, message: 'Status is required' });
  }

  const result = await orderStatusService.updateOrderStatus(req.params.id, status, {
    userId: req.user.id,
    isAdmin: true,
    cancelledBy: 'admin', // only consumed when status === 'cancelled'
    reason,
    notes,
    metadata
  });

  if (!result.success) {
    return res.status(400).json({ success: false, message: result.message });
  }

  const order = result.order;
  if (trackingNumber) order.trackingNumber = trackingNumber;
  if (estimatedDelivery) order.estimatedDelivery = estimatedDelivery;
  await orderRepository.save(order);

  res.json({ success: true, message: result.message, order });
};

// @desc    Bulk update order status (Admin only)
// @route   POST /orders/bulk/status
// @access  Private/Admin
export const bulkUpdateStatus = async (req, res) => {
  const { orderIds, status, reason, notes } = req.body;

  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({ success: false, message: 'No order IDs provided' });
  }

  if (!status) {
    return res.status(400).json({ success: false, message: 'Status is required' });
  }

  const results = { successful: [], failed: [] };

  await Promise.all(orderIds.map(async (orderId) => {
    try {
      const result = await orderStatusService.updateOrderStatus(orderId, status, {
        userId: req.user.id,
        isAdmin: true,
        cancelledBy: 'admin', // only consumed when status === 'cancelled'
        reason: reason || 'bulk_admin_update',
        notes: notes || 'Bulk status update from admin panel'
      });

      if (result.success) {
        results.successful.push({ orderId, status });
      } else {
        results.failed.push({ orderId, error: result.message });
      }
    } catch (error) {
      results.failed.push({ orderId, error: error.message });
    }
  }));

  res.json({
    success: true,
    message: `Processed ${orderIds.length} orders`,
    results
  });
};

// @desc    Bulk delete orders (Admin only, restricted to cancelled/failed)
// @route   POST /orders/bulk/delete
// @access  Private/Admin
export const bulkDeleteOrders = async (req, res) => {
  const { orderIds } = req.body;

  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({ success: false, message: 'No order IDs provided' });
  }

  const results      = { successful: [], failed: [] };

  await Promise.all(orderIds.map(async (orderId) => {
    try {
      const order = await orderRepository.findById(orderId);

      if (!order) {
        results.failed.push({ orderId, error: 'Order not found' });
        return;
      }

      const isDeletable = order.status === 'cancelled' || order.paymentStatus === 'failed';
      if (!isDeletable) {
        results.failed.push({
          orderId,
          error: `Cannot delete order (status '${order.status}', payment '${order.paymentStatus}'). Only cancelled or payment-failed orders can be deleted.`
        });
        return;
      }

      await orderRepository.deleteDoc(order);
      results.successful.push(orderId);
    } catch (error) {
      results.failed.push({ orderId, error: error.message });
    }
  }));

  res.json({
    success: true,
    message: `Processed ${orderIds.length} deletions`,
    results
  });
};

// @desc    Get status history for an order
// @route   GET /orders/:id/status-history
// @access  Private
export const getStatusHistory = async (req, res) => {
  const order = await orderRepository.findById(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  if (order.user?.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Not authorized to access this order' });
  }

  const result = await orderStatusService.getStatusHistory(req.params.id);

  if (!result.success) {
    return res.status(400).json({ success: false, message: result.message });
  }

  res.json({ success: true, currentStatus: result.currentStatus, history: result.history });
};

// @desc    Get valid next statuses for an order
// @route   GET /orders/:id/valid-transitions
// @access  Private
export const getValidTransitions = async (req, res) => {
  const order = await orderRepository.findById(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  if (order.user?.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Not authorized to access this order' });
  }

  const isAdmin      = req.user.role === 'admin';
  const validStatuses = orderStatusService.getValidNextStatuses(order.status, isAdmin);
  const validReasons  = {};

  validStatuses.forEach(s => {
    validReasons[s] = orderStatusService.getValidReasons(s);
  });

  res.json({
    success: true,
    currentStatus: order.status,
    validNextStatuses: validStatuses,
    validReasons
  });
};

// @route   GET /orders/analytics/status-stats
// @access  Private/Admin
export const getStatusStats = async (req, res) => {
  const { startDate, endDate } = req.query;
  const filter = {};
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate)   filter.createdAt.$lte = new Date(endDate);
  }

  const result = await orderStatusService.getStatusStatistics(filter);

  if (!result.success) {
    return res.status(400).json({ success: false, message: result.message });
  }

  res.json({ success: true, statistics: result.statistics });
};

// @desc    Get fulfillment performance metrics (Admin only)
// @route   GET /orders/analytics/fulfillment-metrics
// @access  Private/Admin
export const getFulfillmentMetrics = async (req, res) => {
  const { startDate, endDate } = req.query;
  const filter = {};
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate)   filter.createdAt.$lte = new Date(endDate);
  }

  const result = await orderStatusService.getFulfillmentMetrics(filter);

  if (!result.success) {
    return res.status(400).json({ success: false, message: result.message });
  }

  res.json({ success: true, metrics: result.metrics });
};

// @desc    Add tracking information to order (Admin only)
// @route   POST /orders/:id/tracking
// @access  Private/Admin
export const addTracking = async (req, res) => {
  const { trackingNumber, carrierCode, notes } = req.body;

  if (!carrierCode) {
    return res.status(400).json({ success: false, message: 'Carrier code is required' });
  }

  const finalTrackingNumber = trackingNumber ||
    orderTrackingService.generateTrackingNumber(carrierCode, req.params.id);

  const result = await orderTrackingService.addTrackingInfo(req.params.id, {
    trackingNumber: finalTrackingNumber,
    carrierCode,
    notes
  });

  if (!result.success) {
    return res.status(400).json({ success: false, message: result.message });
  }

  res.json({
    success: true,
    message: 'Tracking information added successfully',
    trackingNumber: finalTrackingNumber,
    trackingUrl: result.trackingUrl,
    estimatedDelivery: result.estimatedDelivery,
    order: result.order
  });
};

// @desc    Get tracking history for an order
// @route   GET /orders/:id/tracking
// @access  Private
export const getTracking = async (req, res) => {
  const order = await orderRepository.findById(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  if (order.user?.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Not authorized to access this order' });
  }

  const result = await orderTrackingService.getTrackingHistory(req.params.id);

  if (!result.success) {
    return res.status(400).json({ success: false, message: result.message });
  }

  res.json({ success: true, ...result });
};

// @desc    Add tracking event to order (Admin only)
// @route   POST /orders/:id/tracking/events
// @access  Private/Admin
export const addTrackingEvent = async (req, res) => {
  const { status, location, description, scannedBy, timestamp } = req.body;

  if (!status) {
    return res.status(400).json({ success: false, message: 'Status is required' });
  }

  const result = await orderTrackingService.addTrackingEvent(req.params.id, {
    status,
    location,
    description,
    scannedBy,
    timestamp
  });

  if (!result.success) {
    return res.status(400).json({ success: false, message: result.message });
  }

  res.json({
    success: true,
    message: 'Tracking event added successfully',
    event: result.event,
    order: result.order
  });
};

// @desc    Public tracking lookup by tracking number
// @route   GET /orders/track/:trackingNumber
// @access  Public
export const trackByNumber = async (req, res) => {
  const result = await orderTrackingService.trackByNumber(req.params.trackingNumber);

  if (!result.success) {
    return res.status(404).json({ success: false, message: result.message });
  }

  res.json({ success: true, ...result });
};

// @desc    Get list of supported carriers
// @route   GET /orders/tracking/carriers
// @access  Public
export const getCarriers = async (req, res) => {
  res.json({ success: true, carriers: orderTrackingService.getSupportedCarriers() });
};

// @desc    Simulate tracking events for testing (Admin only)
// @route   POST /orders/:id/tracking/simulate
// @access  Private/Admin
export const simulateTracking = async (req, res) => {
  const { scenario } = req.body;

  const result = await orderTrackingService.simulateTracking(
    req.params.id,
    scenario || 'normal_delivery'
  );

  if (!result.success) {
    return res.status(400).json({ success: false, message: result.message });
  }

  res.json({ success: true, message: result.message, eventsAdded: result.eventsAdded });
};

// @desc    Get tracking statistics by carrier (Admin only)
// @route   GET /orders/analytics/tracking-stats
// @access  Private/Admin
export const getTrackingStats = async (req, res) => {
  const { startDate, endDate } = req.query;
  const filter = {};
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate)   filter.createdAt.$lte = new Date(endDate);
  }

  const result = await orderTrackingService.getTrackingStatistics(filter);

  if (!result.success) {
    return res.status(400).json({ success: false, message: result.message });
  }

  res.json({ success: true, statistics: result.statistics });
};

// @desc    Get all orders (Admin only)
// @route   GET /orders/admin/all
// @access  Private/Admin
export const getAllOrdersAdmin = async (req, res) => {
  const DEFAULT_LIMIT = 20;
  const MAX_LIMIT     = 100;

  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit) || DEFAULT_LIMIT));
  const skip  = (page - 1) * limit;

  const query = {};
  if (req.query.status) query.status = req.query.status;

  const [orders, total] = await Promise.all([
    orderRepository.findAllAdmin(query, { skip, limit }),
    orderRepository.count(query)
  ]);

  res.json({
    success: true,
    count: orders.length,
    total,
    pages: Math.ceil(total / limit),
    currentPage: page,
    orders
  });
};

// @desc    Submit return request for delivered order
// @route   POST /orders/:id/return
// @access  Private
export const submitReturnRequest = async (req, res) => {
  const { items, reason, description, images } = req.body;

  const order = await orderRepository.findById(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  if (order.user?.toString() !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Not authorized to access this order' });
  }

  if (order.status !== 'delivered') {
    return res.status(400).json({ success: false, message: 'Only delivered orders can be returned' });
  }

  if (order.returnRequest && ['pending', 'approved', 'item_received'].includes(order.returnRequest.status)) {
    return res.status(400).json({
      success: false,
      message: 'A return request is already in progress for this order'
    });
  }

  const daysSinceDelivery = (new Date() - new Date(order.deliveredAt || order.fulfillmentMetrics?.deliveredAt)) / (1000 * 60 * 60 * 24);
  if (daysSinceDelivery > 30) {
    return res.status(400).json({
      success: false,
      message: 'Return window has expired. Returns must be requested within 30 days of delivery.'
    });
  }

  order.returnRequest = {
    items: items.map(item => ({
      product: item.productId,
      quantity: item.quantity,
      reason: item.reason || reason,
      condition: item.condition || 'opened'
    })),
    status: 'pending',
    reason,
    description,
    images: images || [],
    requestedAt: new Date()
  };

  await orderRepository.save(order);

  res.status(201).json({
    success: true,
    message: 'Return request submitted successfully',
    returnRequest: order.returnRequest
  });
};

// @desc    Get return request details
// @route   GET /orders/:id/return
// @access  Private
export const getReturnRequest = async (req, res) => {
  const order = await orderRepository.findById(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  if (order.user?.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Not authorized to access this order' });
  }

  if (!order.returnRequest) {
    return res.status(404).json({ success: false, message: 'No return request found for this order' });
  }

  res.json({ success: true, returnRequest: order.returnRequest });
};

// @desc    Update return request status (Admin only)
// @route   PUT /orders/:id/return/status
// @access  Private/Admin
export const updateReturnStatus = async (req, res) => {
  const { status, adminNotes, refundAmount } = req.body;

  const order = await orderRepository.findById(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  if (!order.returnRequest) {
    return res.status(404).json({ success: false, message: 'No return request found for this order' });
  }

  order.returnRequest.status = status;
  if (adminNotes) order.returnRequest.adminNotes = adminNotes;

  if (status === 'approved' && refundAmount) {
    order.refundDetails = {
      amount: refundAmount,
      status: 'pending',
      refundMethod: 'original_payment',
      requestedAt: new Date()
    };

    if (refundAmount >= order.totalAmount) {
      await orderStatusService.updateOrderStatus(order._id, 'returned', {
        userId: req.user.id,
        isAdmin: true,
        reason: 'return_completed',
        notes: 'Return request approved and refunded'
      });
      const updatedOrder = await orderRepository.findById(req.params.id);
      return res.json({
        success: true,
        message: 'Return request updated and order refunded',
        order: updatedOrder
      });
    }
  }

  await orderRepository.save(order);

  res.json({
    success: true,
    message: 'Return request status updated',
    returnRequest: order.returnRequest
  });
};
