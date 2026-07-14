import orderRepository from '../repositories/orderRepository.js';
import paymentRepository from '../repositories/paymentRepository.js';
import userRepository from '../repositories/userRepository.js';
import orderService from '../services/orderService.js';
import razorpayService from '../services/razorpayService.js';
import orderStatusService from '../services/orderStatusService.js';
import orderTrackingService from '../services/orderTrackingService.js';
import leadSyncService from '../services/leadSyncService.js';
import { resolveRep } from '../utils/salesRepResolver.js';
import { hashToken } from '../utils/tokenUtils.js';
import { generateInvoicePdf, invoiceFileName, assignInvoiceNumber } from '../services/invoiceService.js';
import { uploadRawToCloudinary, deleteFromCloudinary } from '../utils/cloudinaryHelpers.js';
import { getNotificationsQueue } from '../queue/queues.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
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

  const refunds = orders.map(order => {
    // Legacy cancelled+paid orders surface here with no refundDetails subdoc — present
    // them as a pending, full refund of the order total.
    const rd = order.refundDetails || {};
    return {
      _id: order._id,
      order: {
        _id: order._id,
        orderNumber: order.orderNumber || order._id
      },
      user: {
        name: order.user ? order.user.name : 'Unknown'
      },
      amount: rd.amount ?? order.totalAmount ?? 0,
      refundType: rd.refundType || 'full',
      refundMethod: rd.refundMethod || 'original_payment',
      status: rd.status || 'pending',
      requestedAt: rd.requestedAt || order.updatedAt
    };
  });

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

  // Lazily issue an invoice number for paid orders that never went through the
  // payment-success email flow (legacy/backfilled orders). The normal path
  // assigns it there; this is the fallback so a downloaded PDF always has one.
  if (order.invoiceNo == null) {
    await assignInvoiceNumber(order);
    await orderRepository.save(order);
  }

  const pdf = await generateInvoicePdf(order, user);
  const filename = invoiceFileName(order);

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
    status = 'processing', // 'processing' (paid) or 'delivered' — only for paymentMode 'paid'
    notes,
    leadId,
    repId, // name-only SalesRep credited with closing the deal (optional)
    paymentMode = 'paid', // 'paid' = settled offline (mark processing) | 'link' = collect via Razorpay
  } = req.body;

  if (!email || !phone) {
    return res.status(400).json({ success: false, message: 'Customer email and phone are required' });
  }
  if (!['paid', 'link'].includes(paymentMode)) {
    return res.status(400).json({ success: false, message: "paymentMode must be 'paid' or 'link'" });
  }
  // Validate the crediting rep up front (optional field) so a bad id fails fast
  // BEFORE we create a user/order. Shared with the lead controller.
  let salesRepId = null;
  if (repId) {
    const { rep, error } = await resolveRep(repId);
    if (error) return res.status(error.status).json({ success: false, message: error.message });
    salesRepId = rep._id;
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
  // A real delivery address is required. Offline orders were previously created
  // with placeholder values ('N/A' / '000000'), so nothing could actually ship.
  const missingAddr = ['addressLine1', 'city', 'state', 'postalCode']
    .filter((k) => !String(shippingAddress[k] || '').trim());
  if (missingAddr.length) {
    return res.status(400).json({ success: false, message: `Delivery address incomplete — please fill: ${missingAddr.join(', ')}` });
  }
  const postalCode = String(shippingAddress.postalCode).trim();
  if (!/^\d{6}$/.test(postalCode)) {
    return res.status(400).json({ success: false, message: 'Postal code must be a valid 6-digit PIN code' });
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
    } else if (!user.phone && phone) {
      // Existing customer with no phone on file → backfill from this offline
      // order (convenience contact field, never overwrite an existing value).
      // Without this the number lives only on the Lead/Order and the account
      // stays un-findable by phone.
      user.phone = phone;
      await userRepository.save(user);
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
      fullName: (shippingAddress.fullName || name || user.name || '').trim(),
      phone: String(shippingAddress.phone || phone).trim(),
      addressLine1: String(shippingAddress.addressLine1).trim(),
      addressLine2: String(shippingAddress.addressLine2 || '').trim(),
      city: String(shippingAddress.city).trim(),
      state: String(shippingAddress.state).trim(),
      postalCode,
      country: String(shippingAddress.country || 'India').trim(),
    };

    let order = await orderRepository.create({
      user: user._id,
      source: 'offline',
      salesRep: salesRepId,
      // Link flow converts the chosen lead on payment (deferred), so remember it —
      // identity-based conversion alone can miss a phone-only/consultation lead.
      crmLeadId: paymentMode === 'link' ? (leadId || null) : null,
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

    // ── Settle the order ──────────────────────────────────────────────────────
    let paymentLink = null;
    if (paymentMode === 'link') {
      // Collect via Razorpay: the order stays `awaiting_payment`. Razorpay sends
      // the link to the customer (SMS + email); the `payment_link.paid` webhook
      // then drives it paid → processing and converts the lead — no manual mark.
      let link;
      try {
        link = await razorpayService.createPaymentLink(order, { name: address.fullName, email: normEmail, phone });
      } catch (linkErr) {
        // Roll back so a Razorpay failure doesn't strand an unpayable order — and,
        // for a brand-new buyer, an account they can never claim.
        await orderRepository.delete(order._id).catch(() => {});
        if (isNewUser) await userRepository.delete(user._id).catch(() => {});
        return res.status(502).json({ success: false, message: `Could not create payment link: ${linkErr.message}` });
      }
      order.paymentLinkId = link.id;
      order.paymentLinkUrl = link.shortUrl;
      await orderRepository.save(order);
      order = await orderRepository.findById(order._id);
      paymentLink = link;
    } else {
      // Already paid offline → drive through the normal status machinery so all
      // side-effects fire (purchase tag + lead conversion on confirm; karma earn +
      // emails on delivery). Admin bypass lets us set the final state directly.
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
      // For the link flow this happens later, on payment, via the webhook.
      if (leadId) {
        await leadSyncService.safeSync(() =>
          leadSyncService.applyLeadStatus(leadId, 'won', {
            actorId: req.user.id,
            repId: salesRepId, // credit the closing rep on the conversion
            notes: 'Closed via offline order',
            convertedOrder: order._id,
          })
        );
      }
    }

    // New buyer: mint the single-use account-claim (set-password) token NOW. This
    // is a DB write and must NOT depend on the queue — otherwise a Redis outage at
    // creation time leaves the buyer with an account they can never claim (random
    // password + mustResetPassword, no token). Email the RAW token; store only its
    // hash at rest (like the reset-password flow). The email below is best-effort.
    let magicRawToken = null;
    if (isNewUser) {
      magicRawToken = crypto.randomBytes(32).toString('hex');
      user.magicLinkToken = hashToken(magicRawToken);
      // 7 days: the set-password link is emailed at creation but for a link-flow
      // order the customer may not pay (and want to log in) until up to 48h later,
      // so a 24h token would be dead on arrival. Generous but still expiring.
      user.magicLinkExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await userRepository.save(user);
    }

    // ── Emails (best-effort, idempotent) ─────────────────────────────────────
    if (process.env.REDIS_URL) {
      const queue = getNotificationsQueue();
      // Invoice only for an already-paid order. The link flow invoices on payment
      // success (processPaymentSuccess), so we don't send a receipt before payment.
      if (paymentMode !== 'link') {
        queue
          .add('send-order-invoice', { orderId: order._id.toString() })
          .catch((err) => console.error('[Queue] Failed to enqueue send-order-invoice:', err.message));
      }

      // New buyer: email the set-password (magic) link so they can claim the account.
      if (isNewUser) {
        queue
          .add('send-magic-link-email', {
            email: normEmail,
            token: magicRawToken,
            orderId: order._id.toString(),
          })
          .catch((err) => console.error('[Queue] Failed to enqueue send-magic-link-email:', err.message));
      }
    }

    res.status(201).json({
      success: true,
      message: paymentMode === 'link' ? 'Offline order created — payment link sent' : 'Offline order created',
      order,
      customer: { id: user._id, email: user.email, isNewUser },
      paymentLink, // { id, shortUrl } for the link flow, else null
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

// @desc    Process the refund for a cancelled, paid order via Razorpay (admin-triggered)
// @route   POST /orders/:id/refund
// @access  Private/Admin
export const processRefund = async (req, res) => {
  const order = await orderRepository.findById(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  // Full-refund-on-cancel only. The return/partial-refund flow is a separate workstream.
  if (order.status !== 'cancelled') {
    return res.status(400).json({
      success: false,
      message: `Refunds are only processed for cancelled orders (order is '${order.status}').`
    });
  }

  // Nothing to move unless money was actually captured. A `refunded` order is already done.
  if (order.paymentStatus !== 'paid') {
    return res.status(400).json({
      success: false,
      message: order.paymentStatus === 'refunded'
        ? 'This order has already been refunded.'
        : 'No captured payment to refund.'
    });
  }

  // Reject only a refund that's already running or done. A missing refundDetails is fine —
  // legacy/imported cancelled+paid orders never got the auto-flag and are still refundable
  // (the claim below stamps a full-refund record).
  if (order.refundDetails && ['processing', 'completed'].includes(order.refundDetails.status)) {
    return res.status(409).json({
      success: false,
      message: `Refund is already ${order.refundDetails.status}.`
    });
  }

  // Resolve the captured Razorpay payment to refund against.
  const payment = order.payment ? await paymentRepository.findById(order.payment) : null;
  if (!payment || !payment.gatewayPaymentId) {
    return res.status(422).json({
      success: false,
      message: 'No Razorpay payment id on file for this order — refund manually in the dashboard.'
    });
  }

  // Cancellation is always a FULL refund of what was captured. amounts are stored in
  // rupees; Razorpay wants paise.
  const amountPaise = Math.round(order.totalAmount * 100);

  // A ₹0 order (e.g. a 100%-off coupon) has nothing to send to the gateway — Razorpay
  // rejects a zero-amount refund. Treat it as a no-op success instead of claiming the
  // order and stranding it in a failed state. Checked before the claim so no state moves.
  if (amountPaise <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Order total is ₹0 — there is nothing to refund.'
    });
  }

  // Race-safe claim: only the first caller transitions the order into processing and proceeds.
  const claimed = await orderRepository.markRefundProcessing(order, req.user.id);
  if (!claimed) {
    return res.status(409).json({
      success: false,
      message: 'A refund for this order is already being processed.'
    });
  }

  try {
    const result = await razorpayService.refundPayment(payment.gatewayPaymentId, amountPaise, {
      orderId: order._id.toString(),
      reason: 'order_cancelled'
    });

    // `optimum`/instant refunds can come back already `processed`; normal-speed refunds
    // stay `processing` here and reach `completed` via the refund.processed webhook.
    const completed = result.status === 'processed';

    // Persist the outcome via a conditional (status==='processing') update — never a
    // read-modify-write — so a refund.processed webhook that raced this call is not
    // clobbered (and can't clobber us). No-op if the webhook already completed the order.
    await orderRepository.recordRefundResult(order._id, { refundId: result.refundId, completed });

    if (completed) {
      payment.status = 'refunded';
      payment.refundAmount = amountPaise / 100;
      payment.refundReason = 'order_cancelled';
      payment.refundedAt = new Date();
      await paymentRepository.save(payment);
    }

    return res.json({
      success: true,
      message: completed
        ? 'Refund completed.'
        : 'Refund initiated — funds typically settle in 5-7 business days.',
      refund: {
        id: result.refundId,
        status: completed ? 'completed' : 'processing',
        amount: order.totalAmount
      }
    });
  } catch (err) {
    // Roll the claim back to `failed` (conditional on still-processing) so an admin can
    // retry from the same button.
    await orderRepository.markRefundFailed(order._id, err.message);

    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        scope.setContext('refund_processing', {
          orderId: order._id.toString(),
          paymentId: payment.gatewayPaymentId,
          amountPaise
        });
        scope.setTag('payment_action', 'process_refund');
        scope.setTag('severity', 'high');
        Sentry.captureException(err);
      });
    }

    return res.status(502).json({
      success: false,
      message: `Refund failed: ${err.message}`
    });
  }
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
  const { status, reason, notes, trackingNumber, carrierCode, estimatedDelivery, metadata } = req.body;

  if (!status) {
    return res.status(400).json({ success: false, message: 'Status is required' });
  }

  // Assemble the shipping payload for a `shipped` transition. The validator has
  // already guaranteed trackingNumber + carrierCode are present for this status.
  // The optional PDF slip (req.file, PDF-validated by middleware) is pushed to
  // Cloudinary here and its URL threaded through to the order + shipped email.
  let shipping;
  if (status === 'shipped') {
    const carrier = orderTrackingService.getCarrier(carrierCode);
    if (!carrier) {
      return res.status(400).json({ success: false, message: `Unknown carrier code: ${carrierCode}` });
    }

    const trimmedTracking = String(trackingNumber).trim();

    let shippingSlip;
    if (req.file) {
      // Guard against orphaned Cloudinary uploads: only store the slip once we
      // know the transition is legal (the service re-validates too, but that runs
      // after the upload). Cheap extra read, paid only for shipped-with-a-slip.
      const existing = await orderRepository.findById(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }
      const check = orderStatusService.validateTransition(existing.status, 'shipped', true);
      if (!check.valid) {
        return res.status(400).json({ success: false, message: check.message });
      }

      const uploaded = await uploadRawToCloudinary(req.file.buffer, {
        folder: process.env.SHIPPING_SLIP_CLOUDINARY_FOLDER || 'shipping-slips',
        publicId: `slip-${req.params.id}.pdf`,
      });
      shippingSlip = { url: uploaded.secure_url, publicId: uploaded.public_id, uploadedAt: new Date() };
    }

    // ETA: honour an explicit date, else derive from the carrier's SLA so the
    // customer email always carries an estimate.
    let eta = estimatedDelivery ? new Date(estimatedDelivery) : null;
    if (!eta && carrier.estimatedDeliveryDays) {
      eta = new Date();
      eta.setDate(eta.getDate() + carrier.estimatedDeliveryDays);
    }

    shipping = {
      trackingNumber: trimmedTracking,
      carrier: {
        name: carrier.name,
        code: carrier.code,
        trackingUrl: carrier.trackingUrl + trimmedTracking,
      },
      estimatedDelivery: eta || undefined,
      shippingSlip,
    };
  }

  const result = await orderStatusService.updateOrderStatus(req.params.id, status, {
    userId: req.user.id,
    isAdmin: true,
    cancelledBy: 'admin', // only consumed when status === 'cancelled'
    reason,
    notes,
    metadata,
    shipping,
  });

  if (!result.success) {
    // The slip was uploaded before the service re-validated (needed so the URL is
    // in the shipping payload). If the transition was rejected here — e.g. a
    // concurrent status change since the pre-check — don't leave it orphaned. (raw resource)
    if (shipping?.shippingSlip?.publicId) {
      await deleteFromCloudinary(shipping.shippingSlip.publicId, 'raw').catch(() => {});
    }
    return res.status(400).json({ success: false, message: result.message });
  }

  res.json({ success: true, message: result.message, order: result.order });
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

// Fulfillment statuses an admin may filter on (mirrors the Order.status enum).
const ADMIN_ORDER_STATUSES = ['awaiting_payment', 'processing', 'shipped', 'delivered', 'returned', 'cancelled'];
// Whitelisted sort fields — anything else falls back to createdAt to avoid injecting
// an arbitrary (and unindexed) sort key.
const ADMIN_ORDER_SORT_FIELDS = new Set(['createdAt', 'totalAmount', 'status']);
// The store operates in a single timezone (India). Admin date-range filters send a
// date-only string ("YYYY-MM-DD"); we anchor it to this offset so "14 Jul" means the
// IST calendar day regardless of the server's own timezone. If the business ever goes
// multi-region this should become configurable per store.
const STORE_TZ_OFFSET = process.env.STORE_TZ_OFFSET || '+05:30';

// An immediately-empty page (no rows can match) — used when a filter resolves to an
// impossible set (e.g. a customer term matching no user) so we skip the DB round-trip.
function emptyOrdersPage(page, limit) {
  return {
    success: true,
    count: 0,
    total: 0,
    pages: 0,
    currentPage: page,
    pagination: { total: 0, pages: 0, currentPage: page, limit, hasNext: false, hasPrev: false },
    orders: [],
  };
}

// @desc    Get all orders (Admin only)
// @route   GET /orders/admin/all
// @access  Private/Admin
//
// Server-authoritative list: every filter (status, customer, order #, date range,
// amount range) and the sort are applied in MongoDB against the full collection, then
// paginated — never post-filtered on a single page. Returns a nested `pagination`
// object (with hasNext/hasPrev) that the admin table drives its navigator from.
export const getAllOrdersAdmin = async (req, res) => {
  const DEFAULT_LIMIT = 20;
  const MAX_LIMIT     = 100;

  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit) || DEFAULT_LIMIT));
  const skip  = (page - 1) * limit;

  const query = {};

  // Status — the panel sends a comma-joined multi-select; keep only real statuses.
  // If a status filter WAS supplied but nothing survives the whitelist (e.g. a stale
  // 'pending'), that's an intentional "none of these exist" filter, so return an empty
  // page rather than silently widening back to every order.
  if (req.query.status) {
    const statuses = String(req.query.status)
      .split(',')
      .map(s => s.trim())
      .filter(s => ADMIN_ORDER_STATUSES.includes(s));
    if (statuses.length === 0) return res.json(emptyOrdersPage(page, limit));
    if (statuses.length === 1) query.status = statuses[0];
    else query.status = { $in: statuses };
  }

  // Created-at range, anchored to the store timezone so a date-only "YYYY-MM-DD"
  // covers that whole IST calendar day (from 00:00 to 23:59:59.999 IST), not a
  // UTC-midnight window that would leak into the neighbouring day.
  const createdAt = {};
  if (req.query.startDate) {
    const d = new Date(`${req.query.startDate}T00:00:00.000${STORE_TZ_OFFSET}`);
    if (!isNaN(d.getTime())) createdAt.$gte = d;
  }
  if (req.query.endDate) {
    const d = new Date(`${req.query.endDate}T23:59:59.999${STORE_TZ_OFFSET}`);
    if (!isNaN(d.getTime())) createdAt.$lte = d;
  }
  if (Object.keys(createdAt).length) query.createdAt = createdAt;

  // Total-amount range (rupees, matching Order.totalAmount and the UI display).
  const amount = {};
  if (req.query.minAmount !== undefined && req.query.minAmount !== '') {
    const n = Number(req.query.minAmount);
    if (!isNaN(n)) amount.$gte = n;
  }
  if (req.query.maxAmount !== undefined && req.query.maxAmount !== '') {
    const n = Number(req.query.maxAmount);
    if (!isNaN(n)) amount.$lte = n;
  }
  if (Object.keys(amount).length) query.totalAmount = amount;

  // Customer name/email → resolve to user ids (orders only reference the user by id).
  // No matching user ⇒ no orders can match, so short-circuit to an empty page.
  if (req.query.customer && String(req.query.customer).trim()) {
    const userIds = await userRepository.findIdsByNameOrEmail(String(req.query.customer).trim());
    if (userIds.length === 0) return res.json(emptyOrdersPage(page, limit));
    query.user = { $in: userIds };
  }

  // Order-number search. There is no `orderNumber` field — the visible id is the last
  // 8 hex chars of _id — so match a full ObjectId exactly, else a trailing-hex fragment
  // of the stringified _id. Anything non-hex can never match an ObjectId-derived id.
  const searchTerm = String(req.query.orderNumber || req.query.search || '').trim();
  if (searchTerm) {
    if (mongoose.Types.ObjectId.isValid(searchTerm) && searchTerm.length === 24) {
      query._id = new mongoose.Types.ObjectId(searchTerm);
    } else if (/^[a-fA-F0-9]+$/.test(searchTerm)) {
      query.$expr = { $regexMatch: { input: { $toString: '$_id' }, regex: `${searchTerm}$`, options: 'i' } };
    } else {
      return res.json(emptyOrdersPage(page, limit));
    }
  }

  const sortField = ADMIN_ORDER_SORT_FIELDS.has(req.query.sortBy) ? req.query.sortBy : 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
  const sort = { [sortField]: sortOrder };

  const [orders, total] = await Promise.all([
    orderRepository.findAllAdmin(query, { skip, limit, sort }),
    orderRepository.count(query)
  ]);

  const pages = Math.ceil(total / limit);

  res.json({
    success: true,
    count: orders.length,
    // Flat fields kept for backward compatibility with any existing consumer.
    total,
    pages,
    currentPage: page,
    // Nested shape the admin table reads (it drives the paginator + prev/next state).
    pagination: {
      total,
      pages,
      currentPage: page,
      limit,
      hasNext: page < pages,
      hasPrev: page > 1,
    },
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
