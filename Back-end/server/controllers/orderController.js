import orderRepository from '../repositories/orderRepository.js';
import { CUSTOMER_LIST_FIELDS, ADMIN_LIST_FIELDS } from '../repositories/orderProjections.js';
import paymentRepository from '../repositories/paymentRepository.js';
import returnRequestRepository from '../repositories/returnRequestRepository.js';
import userRepository from '../repositories/userRepository.js';
import orderService from '../services/orderService.js';
import razorpayService from '../services/razorpayService.js';
import orderStatusService from '../services/orderStatusService.js';
import shipmentService from '../services/shipmentService.js';
import { remainingToShip, fulfilmentSummary } from '../utils/orderFulfilment.js';
import cancellationService from '../services/cancellationService.js';
import { remainingCancellable } from '../utils/orderCancellation.js';
import AppError from '../utils/AppError.js';
import orderTrackingService, { OTHER_CARRIER_CODE } from '../services/orderTrackingService.js';
import leadSyncService from '../services/leadSyncService.js';
import { remainingRefundable } from '../services/refundMathService.js';
import { resolveRep } from '../utils/salesRepResolver.js';
import { extractMetaTracking } from '../utils/metaTracking.js';
import { resolveBuyerAndAcceptance } from '../services/buyerService.js';
import { BUYER_TYPES } from '../config/buyer.js';
import { ACCEPTANCE_CHANNELS } from '../config/legalDocuments.js';
import { contentIdForLineItem } from '../utils/metaCatalogId.js';
import { hashToken } from '../utils/tokenUtils.js';
import { STORE_TZ_OFFSET } from '../utils/storeTime.js';
import { generateInvoicePdf, invoiceFileName, assignInvoiceNumber } from '../services/invoiceService.js';
import { getNotificationsQueue } from '../queue/queues.js';
import { describeEmiPlan, supportsPartialRefund } from '../utils/paymentMethodDetails.js';
import crypto from 'crypto';
import { putPrivateAsset, deletePrivateAsset } from '../services/storage/privateUploads.js';
import { providerOf, r2PrivateUrl } from '../services/storage/privateAssetUrl.js';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import * as Sentry from '@sentry/node';

/**
 * Project a populated Payment document down to what a client may see.
 *
 * `findWithPopulated` pulls the whole Payment row, and the response used to include
 * it verbatim — which meant every order detail response carried
 * `paymentDetails.razorpay`: the entire gateway entity, including our per-transaction
 * `fee`/`tax` (i.e. the MDR we pay — commercially sensitive), the stored card id,
 * acquirer data and internal notes. None of it has ever been read by the frontend
 * (`Order.payment` is typed as a plain id there), so this is a straight removal.
 *
 * What is deliberately KEPT: the gateway payment id (`pay_...`) — it appears on the
 * customer's own card statement and is the reference they need when raising a bank
 * dispute — and the method summary, so the order page can say how it was paid.
 *
 * @param {Object|string|null} payment - populated Payment doc, raw id, or null
 * @returns {Object|string|null} safe summary, or the input unchanged if not populated
 */
const publicPaymentSummary = (payment) => {
  if (!payment || typeof payment !== 'object') return payment ?? null;
  return {
    _id: payment._id,
    paymentMethod: payment.paymentMethod,
    paymentGateway: payment.paymentGateway,
    methodDetails: payment.methodDetails,
    // Pre-rendered "Credit Card EMI · HDFC · 6 months @ 14%" so the order page and the
    // admin view cannot drift in how they describe the same plan.
    emiPlanLabel: describeEmiPlan(payment) || undefined,
    // Debit-card EMI can only be refunded in full. Surfaced so the RETURN FORM can say
    // so before the customer submits, rather than the customer finding out after the
    // goods have already been collected. The server re-checks on submit — this flag is
    // for the message, never the enforcement.
    fullRefundOnly: !supportsPartialRefund(payment),
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    refundAmount: payment.refundAmount,
    refundedAt: payment.refundedAt,
    gatewayPaymentId: payment.gatewayPaymentId,
    // Legacy/offline rows carry a hand-set transactionId instead of a gateway id.
    transactionId: payment.transactionId,
    createdAt: payment.createdAt,
  };
};

/**
 * Why this order may not be marked `delivered` as a whole, if it may not.
 *
 * ── THE BUG THIS CLOSES ───────────────────────────────────────────────────────────
 * `shipmentService.deliverAllOutstanding` marks every EXISTING parcel delivered, which
 * is what keeps the per-line return windows open. But it can only deliver what is in a
 * box. Ship 1 of 3 items and then flip the order to `delivered` and the other 2 are
 * still sitting in `remainingToShip` — never parcelled, so `deliveredAtForItem` returns
 * null for them forever, so their return window never opens — while the customer is
 * told the whole order arrived. Nothing in validateTransition or the request validator
 * caught this, because both reason about the order-level status alone.
 *
 * ── WHY THE `shipments.length` CONDITION ──────────────────────────────────────────
 * An order with NO parcels at all is not partially shipped, it is PRE-parcel: every
 * order placed before split shipments existed, plus offline sales recorded as already
 * delivered. `remainingToShip` returns every line for those (nothing is in a box), so
 * guarding on it alone would block `delivered` on all of them. They are safe precisely
 * because `deliveredAtForItem` falls back to the order-level date when there are no
 * parcels — the behaviour they have always had.
 *
 * So the rejection targets exactly the mixed state: some units parcelled, some not.
 *
 * @param {object} order
 * @returns {string|null} an admin-facing reason, or null when the transition is fine.
 */
const blockedFromWholeOrderDelivery = (order) => {
  if (!(order?.shipments || []).length) return null;

  const outstanding = remainingToShip(order);
  if (!outstanding.length) return null;

  const named = outstanding
    .map((l) => `${l.name || 'item'} ×${l.quantity}`)
    .join(', ');
  return `Cannot mark this order delivered — ${outstanding.length} line(s) have never been shipped `
    + `(${named}). Ship or cancel them from the order's Parcels panel first.`;
};

// @desc    Get all orders for logged-in user with pagination
// @route   GET /orders
// @access  Private
export const getOrders = async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [orders, total] = await Promise.all([
    // Projected: the list card renders 7 fields; the whole document averages 1829 B
    // against 440 B of those. See CUSTOMER_LIST_FIELDS for the measurement.
    orderRepository.findByUser(req.user.id, {
      skip, limit: Number(limit), select: CUSTOMER_LIST_FIELDS,
    }),
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
/**
 * Resolve a shipping slip's ref into something a browser can open.
 *
 * A Cloudinary slip keeps its stored public URL. An R2 slip has none — it sits
 * in the private bucket — so one is minted per view, short-lived, and only for a
 * caller this handler has already authorised. That is the whole reason a slip
 * can be private at all: the two things that ever read it (this handler and the
 * shipped-email attachment) are both server-side.
 *
 * Returns the slip unchanged when there is nothing to resolve, and never throws:
 * a signing failure must degrade to "no slip link" rather than 500 the entire
 * order page.
 */
const withSignedSlip = async (slip) => {
  if (!slip?.publicId || providerOf(slip) !== 'r2') return slip;
  try {
    const url = await r2PrivateUrl({ key: slip.publicId, downloadAs: 'shipping-slip.pdf' });
    return { ...slip, url };
  } catch (err) {
    console.error(`[Order] could not sign shipping slip ${slip.publicId}: ${err.message}`);
    return slip;
  }
};

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
  // Also attach `metaContentId` (the Meta catalogue retailer_id) per item so the
  // client Pixel's Purchase event uses ids that match the feed, and strip the
  // heavy `variants` array we only populated to derive that id.
  // Drop phantom return/refund summaries. Historically these nested-path subdocs
  // got a `status: 'pending'` schema default, so every order carried an empty
  // returnRequest/refundDetails with no `requestedAt`. Real ones are always stamped
  // with `requestedAt` at write time, so that field is the authoritative marker.
  // The model default is now removed, but existing orders stay polluted until the
  // cleanup migration runs — so guard the response here too.
  const hasRealReturnRequest = !!order.returnRequest?.requestedAt;
  const hasRealRefund = !!order.refundDetails?.requestedAt;

  /*
    Slips are signed for BOTH the legacy order-level field and every parcel.
    Signing only the order-level one would work today (the admin page renders
    just that) and break silently the moment the parcel list grows a slip link.
  */
  const [signedSlip, signedShipments] = await Promise.all([
    withSignedSlip(order.shippingSlip),
    Array.isArray(order.shipments)
      ? Promise.all(order.shipments.map(async (sh) => ({
        ...sh, shippingSlip: await withSignedSlip(sh.shippingSlip),
      })))
      : Promise.resolve(order.shipments),
  ]);

  const normalizedOrder = {
    ...order,
    shippingSlip: signedSlip,
    shipments: signedShipments,
    returnRequest: hasRealReturnRequest ? order.returnRequest : undefined,
    refundDetails: hasRealRefund ? order.refundDetails : undefined,
    // Strip the raw gateway entity (MDR, card id, acquirer data) before it leaves the
    // server; keep the method summary + EMI plan the order page renders.
    payment: publicPaymentSummary(order.payment),
    items: order.items.map(item => {
      const metaContentId = contentIdForLineItem(item.product, item.variantId);
      // Strip internal-only fields we populated solely to derive metaContentId —
      // `variants` (heavy) and `wpId` (internal WooCommerce migration id) must not
      // leak to the client.
      const product = item.product
        ? (() => { const { variants: _variants, wpId: _wpId, ...rest } = item.product; return rest; })()
        : { _id: item.product, name: '[Product no longer available]', images: [], price: item.price };
      return { ...item, product, metaContentId };
    })
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
/**
 * Persist an enterprise buyer's details for reuse at the next checkout.
 *
 * ⚠️ A CONVENIENCE COPY, NOT A RECORD. The order already snapshotted its own
 * `buyer` block; this only prefills a future form. It is fire-and-forget on
 * purpose — the order is committed by the time we get here, so a failed profile
 * write must be logged, never surfaced as a failed purchase.
 */
const saveBusinessProfile = (userId, buyer) =>
  userRepository.setBusinessProfile(userId, {
    legalName: buyer.legalName,
    gstin: buyer.gstin,
    stateCode: buyer.stateCode,
    billingAddress: buyer.billingAddress,
  });

/**
 * SHA-256 of the real client IP, for the legal-acceptance record.
 *
 * `cf-connecting-ip` first, not `req.ip`: behind Cloudflare `req.ip` is the edge,
 * so every acceptance would record the same hash and the field would prove
 * nothing. Hashed rather than stored raw — the evidentiary value is "the same
 * person who placed the order accepted", which a hash carries without us holding
 * an IP against a name. Mirrors how Order hashes guest IPs.
 */
const acceptanceIpHash = (req) => {
  const ip = req?.headers?.['cf-connecting-ip'] || req?.ip || req?.connection?.remoteAddress;
  return ip ? crypto.createHash('sha256').update(String(ip)).digest('hex') : null;
};

export const createOrder = async (req, res) => {
  const { items, shippingAddress } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, message: 'No order items provided' });
  }

  try {
    // Buyer category, GSTIN and the accepted terms version are resolved BEFORE
    // anything is written. Throws a 400 on an invalid GSTIN or a missing
    // acceptance, so an order can never exist without a recorded consent.
    const { buyer, legalAcceptance } = resolveBuyerAndAcceptance(req.body, {
      ipHash: acceptanceIpHash(req),
    });

    const order = await orderService.createOrder(
      req.user.id,
      items,
      shippingAddress,
      {
        ...req.body,
        buyer,
        legalAcceptance,
        sessionId: req.headers['x-session-id'],
        tracking: extractMetaTracking(req),
      }
    );

    // Save the enterprise details for next time. Best-effort: a profile write
    // must never fail an order that is already committed.
    if (buyer.type === BUYER_TYPES.ENTERPRISE) {
      saveBusinessProfile(req.user.id, buyer).catch((err) =>
        console.error('[Order] businessProfile save failed:', err.message)
      );
    }

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

    /*
      Resolve and VALIDATE the buyer before anything is written.

      This used to run after the guest User was created, so a mistyped GSTIN 400'd
      the request and left a stranded account behind — the same shape as the
      careers upload that wrote PII before validating it. Nothing is persisted
      until the whole request is known to be good.
    */
    const { buyer, legalAcceptance } = resolveBuyerAndAcceptance(req.body, {
      ipHash: acceptanceIpHash(req),
    });

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
      { ...req.body, buyer, legalAcceptance, sessionId: req.headers['x-session-id'] },
      paymentMethod
    );

    /*
      ⚠️ GUEST ACCOUNTS ONLY.

      This endpoint is UNAUTHENTICATED and looks a user up by email, so `user`
      here may be a real REGISTERED customer who happens to share the address a
      stranger typed. Writing the request's buyer block onto that account would
      let anyone overwrite a real customer's saved legal name and GSTIN — which
      then prefills their next checkout, so the bad value would be re-submitted on
      every subsequent order.

      A guest row is safe: it exists only to carry this order until the claim flow
      attaches it, and it is created from this same request.
    */
    if (buyer.type === BUYER_TYPES.ENTERPRISE && user.isGuest) {
      saveBusinessProfile(user._id, buyer).catch((err) =>
        console.error('[Order] guest businessProfile save failed:', err.message)
      );
    }

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
    /*
      Validate the buyer BEFORE creating the customer, for the same reason as the
      guest path: an admin mistyping a GSTIN would otherwise 400 the request and
      leave behind a brand-new `mustResetPassword` account for a person who has no
      order — an account they could be prompted to claim.

      `requireAcceptance: false` because the customer is not at a browser to tick a
      box; the GSTIN is still validated identically. See the note at the buyer
      block below.
    */
    const { buyer, legalAcceptance } = resolveBuyerAndAcceptance(req.body, {
      requireAcceptance: false,
      // The channel is what keeps this distinguishable from a real acceptance.
      // No ipHash: the only address available here is the ADMIN's, which is not
      // evidence of anything the customer did.
      channel: ACCEPTANCE_CHANNELS.OFFLINE_ADMIN,
      recordedBy: req.user?.id || null,
    });

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
      // Offline orders carry the admin-picked variant + its manually-entered price
      // (this path is authoritative-by-admin, not re-priced from the catalogue).
      variantId: i.variantId || null,
      variantLabel: i.variantLabel || null,
      quantity: Number(i.quantity),
      price: Number(i.price),
      // Snapshot the catalogue list price ONLY when the rep gave a genuine
      // markdown (list strictly above the charged price). A full-price sale
      // stays null — i.e. null canonically means "sold at the original price,
      // no discount", so reporting is simply: listPrice ? listPrice - price : 0.
      listPrice:
        i.listPrice != null && Number(i.listPrice) > Number(i.price)
          ? Number(i.listPrice)
          : null,
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

    // Offline is the MOST likely enterprise path — an admin recording a dealer or
    // workshop deal is exactly the B2B case. Resolved at the top of the try block
    // so nothing is persisted before the GSTIN is known to be good.
    let order = await orderRepository.create({
      user: user._id,
      source: 'offline',
      salesRep: salesRepId,
      ...(buyer.type === BUYER_TYPES.ENTERPRISE && { buyer }),
      // Recorded with track + versions so an offline enterprise order is not a
      // hole in the audit trail, but `acceptedAt` reflects when the ADMIN
      // recorded it, which is why it is not evidence of the customer's click.
      legalAcceptance,
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

    if (buyer.type === BUYER_TYPES.ENTERPRISE) {
      saveBusinessProfile(user._id, buyer).catch((err) =>
        console.error('[Order] offline businessProfile save failed:', err.message)
      );
    }

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

  /*
    An order that has ALREADY had lines cancelled tracks its money per line, not in the
    order-level `refundDetails`. Cancelling the rest through the plain status transition
    would move it to `cancelled` while recording no refund at all for the lines still
    live — orderStatusService skips its auto-flag once cancellations exist (so the
    per-line records are not double-claimed), and processRefund refuses such orders.
    The money for the remaining lines would simply never go back.

    So route the remainder through the same per-line path: it prices each line net of
    the order's discount, records a refund for it, and rolls the order up to `cancelled`
    itself. `remainingCancellable` is empty when nothing is live — a second call on an
    already-fully-cancelled order — and we fall through to the normal transition, which
    is idempotent about the status.
  */
  /*
    A PARTIALLY SHIPPED order goes down the same per-line road, for a different reason.

    At `shipped` one box has left and the rest may still be on the shelf. The plain
    whole-order transition cannot express that: it would cancel goods already in transit
    and flag an order-level refund for the FULL total, including the parcel the customer
    is about to receive. Routing the un-shipped remainder through cancellationService
    cancels exactly the lines nobody has touched (remainingCancellable excludes anything
    in a shipped or delivered parcel), prices each net of the order's discount, and
    leaves the order at `shipped` because a live parcel is still on its way.

    Reached only when something IS still cancellable — canCustomerCancel and the
    validateCancellation middleware reject a fully-shipped order before we get here.
  */
  if ((order.cancellations || []).length || order.status === 'shipped') {
    const live = remainingCancellable(order);
    if (live.length) {
      const result = await cancellationService.cancelLines(
        order._id.toString(),
        {
          lines: live.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
          reason: reason || 'customer_request',
          notes,
        },
        { userId: req.user.id },
      );
      if (!result.success) {
        return res.status(400).json({ success: false, message: result.message });
      }
      /*
        Say what actually happened. cancelLines only rolls the order up to `cancelled`
        when the LAST live line goes; on a partially shipped order a parcel is still in
        transit, so "Order cancelled successfully" would contradict the tracking page the
        customer is about to open. Read the outcome off the order rather than assuming.
      */
      const wholeOrderCancelled = result.order?.status === 'cancelled';
      return res.json({
        success: true,
        message: wholeOrderCancelled
          ? 'Order cancelled successfully'
          : `Cancelled ${live.length} item(s) that had not shipped yet. The rest of your order is still on its way.`,
        order: result.order,
        partial: !wholeOrderCancelled,
        cancelledLines: live.length,
        refundInitiated: result.refund?.status === 'pending',
        refundAmount: result.refund?.amountRupees ?? 0,
        refundTimeline: result.refund?.status === 'pending' ? '3-5 business days' : null,
      });
    }
  }

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

  /*
    An order with partial cancellations tracks its money per line, in
    Order.cancellations[].refund — each priced net of the order's discount by
    refundMathService. This route refunds `order.totalAmount` in one go, which for such
    an order is both the wrong figure and a second claim on the same capture. Refuse and
    point at the per-cancellation refunds.

    Belt and braces with the guard in orderStatusService that stops the whole-order
    refund ever being flagged on these orders: a legacy order flagged before that guard
    existed would otherwise still offer this button.
  */
  if ((order.cancellations || []).length) {
    return res.status(409).json({
      success: false,
      message: 'This order was cancelled line by line. Refund each cancellation from the '
        + "order's Cancellations panel — those amounts are already net of the order's discount.",
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

  // Cancellation is always a FULL refund of what was captured. `totalAmount` is already
  // net of any coupon/karma discount (pricingService computes it as the charged figure
  // and the webhook integrity guard asserts it equals the captured paise), so unlike the
  // per-line return path this needs no discount proration — it refunds exactly the
  // capture. Amounts are stored in rupees; Razorpay wants paise.
  //
  // The cap is still applied: an order that already had money sent back via a return
  // refund would otherwise over-draw and be rejected by the gateway with an opaque error.
  //
  // It is a guard, NOT a guarantee. It sees our own records plus `Payment.refundAmount`;
  // a refund issued by hand in the Razorpay dashboard writes neither (its webhook
  // resolves to no order), so that case still reaches the gateway and fails there. The
  // catch below is what makes that survivable — it rolls the claim back to `failed` so
  // the admin can retry with a corrected amount.
  const siblingReturns = await returnRequestRepository.find({ order: order._id }).select('refund').lean();
  const headroom = remainingRefundable(order, siblingReturns, null, payment);
  const refundRupees = Math.min(order.totalAmount, headroom.remainingRupees);

  if (refundRupees < order.totalAmount) {
    return res.status(422).json({
      success: false,
      message: `Only ₹${headroom.remainingRupees} of ₹${headroom.capturedRupees} is still refundable on this order `
        + `(₹${headroom.alreadyRefundedRupees} already refunded). Refund the balance manually in the Razorpay dashboard.`
    });
  }

  const amountPaise = Math.round(refundRupees * 100);

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

    // Accumulate onto the payment row (see paymentRepository.recordRefund) rather than
    // assigning, so a prior partial refund on the same payment is not erased. Gated on
    // a once-only claim because that write is an atomic $inc: the refund.processed
    // webhook for an instant refund can land before `recordRefundResult` above has
    // persisted, and would otherwise count the same money a second time.
    if (completed && await orderRepository.claimRefundPaymentRecord(order._id)) {
      await paymentRepository.recordRefund(payment._id, amountPaise / 100, 'order_cancelled');
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
  const { status, reason, notes, trackingNumber, carrierCode, carrierName, estimatedDelivery, metadata } = req.body;

  if (!status) {
    return res.status(400).json({ success: false, message: 'Status is required' });
  }

  // Assemble the shipping payload for a `shipped` transition. The validator has
  // already guaranteed trackingNumber + carrierCode are present for this status.
  // The optional PDF slip (req.file, PDF-validated by middleware) is pushed to
  // Cloudinary here and its URL threaded through to the order + shipped email.
  let shipping;
  if (status === 'shipped') {
    // `OTHER` is the free-text carrier: the admin types the courier's name and we
    // persist that instead of a built-in one (no tracking-URL pattern exists for it).
    const { carrier, error: carrierError } = orderTrackingService.resolveCarrier(carrierCode, carrierName);
    if (!carrier) {
      return res.status(400).json({ success: false, message: carrierError });
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

      /*
        The public id used to be `slip-<orderId>.pdf`, i.e. one slot per ORDER. With
        several parcels per order, uploading parcel 2's slip overwrote parcel 1's at the
        same Cloudinary id — and because parcel 1's stored URL points at that id, it then
        served parcel 2's PDF. Anyone opening parcel 1's slip, or the customer receiving
        it by email, got the wrong courier paperwork.

        A random suffix gives every parcel its own object. Cloudinary ids are otherwise
        opaque, so nothing reads them back by convention.
      */
      const slipNonce = crypto.randomBytes(6).toString('hex');
      const uploaded = await putPrivateAsset({
        buffer: req.file.buffer,
        folder: process.env.SHIPPING_SLIP_CLOUDINARY_FOLDER || 'shipping-slips',
        basename: `slip-${req.params.id}-${slipNonce}.pdf`,
        contentType: req.file.mimetype || 'application/pdf',
        // The basename already carries a random suffix, so an overwrite could
        // only be a collision — and overwriting would resurrect exactly the
        // wrong-parcel bug described above.
        overwrite: false,
      });
      /*
        `url` is '' on the R2 path: a slip goes to the PRIVATE bucket there,
        because it carries the customer's name and delivery address and nothing
        external needs it public — the shipped email attaches the PDF and the
        admin console gets a link minted per view. Both readers resolve from
        publicId + provider (see services/storage/privateAssetUrl.js), so the
        empty url is expected, not a failure.
      */
      shippingSlip = {
        url: uploaded.url,
        publicId: uploaded.publicId,
        provider: uploaded.provider,
        uploadedAt: new Date(),
      };
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
      carrier: orderTrackingService.buildCarrierSubdoc(carrier, trimmedTracking),
      estimatedDelivery: eta || undefined,
      shippingSlip,
    };
  }

  /*
    A `shipped` transition now goes through the parcel model.

    With no `lines` in the body this creates ONE parcel containing everything the order
    still owes — byte-for-byte the old behaviour ("mark the whole order shipped"), but
    recorded as a shipment so tracking, the slip and the delivery date belong to a box
    rather than to the order. Every other status keeps the original path.

    The order-level trackingNumber/carrier/slip are still written by orderStatusService
    (via `shipping`) for the single-parcel case, so existing readers — the customer
    tracking panel, orderTrackingService — keep working untouched.
  */
  let result;
  if (status === 'shipped') {
    const created = await shipmentService.createShipment(req.params.id, {
      lines: Array.isArray(req.body.lines) && req.body.lines.length ? req.body.lines : undefined,
      includesReward: req.body.includesReward,
      trackingNumber: shipping.trackingNumber,
      carrier: shipping.carrier,
      estimatedDelivery: shipping.estimatedDelivery,
      shippingSlip: shipping.shippingSlip,
      notes,
    }, { userId: req.user.id });

    if (!created.success) {
      if (shipping?.shippingSlip?.publicId) {
        await deletePrivateAsset({
          publicId: shipping.shippingSlip.publicId,
          resourceType: 'raw',
          provider: shipping.shippingSlip.provider,
        }).catch(() => {});
      }
      return res.status(400).json({ success: false, message: created.message });
    }

    /*
      No second status call here, deliberately. createShipment already rolled the order
      up to `shipped` through orderStatusService (which is what writes status history,
      fulfilment metrics and the CRM sync), and it mirrored the tracking fields onto the
      order in the same atomic write as the parcel. Calling updateOrderStatus again to
      "persist the tracking" would push a duplicate status-history entry and re-run every
      side effect on every single dispatch.
    */
    result = { success: true, message: created.message, order: created.order };
  } else {
    /*
      Marking the whole order delivered has to deliver its PARCELS too.

      Once an order has parcels, the per-line return window reads their delivery dates,
      not the order's. Flipping only `Order.status` left every parcel at `shipped`, so
      `deliveredAtForItem` returned null for every line and the return window never
      opened — the order said "delivered" while the customer's Return button stayed
      hidden and the backend refused every request.

      Idempotent, and runs BEFORE the status change so the roll-up it triggers agrees
      with what the admin asked for. Orders with no parcels are untouched.
    */
    let parcelsDelivered = 0;
    if (status === 'delivered') {
      /*
        Refuse before delivering anything when part of the order was never parcelled.
        Checked FIRST so a rejected request leaves no half-delivered parcels behind —
        deliverAllOutstanding is not reversible.
      */
      const existing = await orderRepository.findById(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }
      const blocked = blockedFromWholeOrderDelivery(existing);
      if (blocked) {
        return res.status(400).json({ success: false, message: blocked });
      }

      // No userId: the updateOrderStatus call directly below records this admin's
      // action once. See deliverAllOutstanding's note on why it rolls up nothing itself.
      ({ delivered: parcelsDelivered } =
        await shipmentService.deliverAllOutstanding(req.params.id));
    }

    result = await orderStatusService.updateOrderStatus(req.params.id, status, {
      userId: req.user.id,
      isAdmin: true,
      cancelledBy: 'admin', // only consumed when status === 'cancelled'
      reason,
      notes,
      metadata,
      shipping,
      // Each parcel just emailed its own "delivered"; an order-level email on top would
      // be a second notification for the same event. Suppressed only when parcels
      // actually sent one, so a parcel-less order still gets its single email.
      suppressStatusEmail: parcelsDelivered > 0,
    });
  }

  if (!result.success) {
    // The slip was uploaded before the service re-validated (needed so the URL is
    // in the shipping payload). If the transition was rejected here — e.g. a
    // concurrent status change since the pre-check — don't leave it orphaned. (raw resource)
    if (shipping?.shippingSlip?.publicId) {
      await deletePrivateAsset({
        publicId: shipping.shippingSlip.publicId,
        resourceType: 'raw',
        provider: shipping.shippingSlip.provider,
      }).catch(() => {});
    }
    return res.status(400).json({ success: false, message: result.message });
  }

  res.json({ success: true, message: result.message, order: result.order });
};

/**
 * List the parcels on an order, what is still owed, and the derived fulfilment label.
 * Owner or admin — the customer needs this to see "parcel 1 of 2 arriving Tuesday".
 *
 * @route GET /orders/:id/shipments
 */
export const getShipments = async (req, res) => {
  // Projected lean read: this runs on every customer and admin order-page view, and the
  // full document carries unbounded statusHistory/trackingEvents this view never reads.
  // See orderRepository.findForFulfilment for the measurement.
  const order = await orderRepository.findForFulfilment(req.params.id);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const isOwner = order.user?.toString() === req.user.id;
  if (!isOwner && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Not authorized to view this order' });
  }

  res.json({
    success: true,
    shipments: order.shipments || [],
    remaining: remainingToShip(order),
    summary: fulfilmentSummary(order),
  });
};

/**
 * Cancellations on an order + what may still be cancelled + the summary label.
 *
 * @route GET /orders/:id/cancellations
 * @access Private (order owner or admin)
 */
export const getCancellations = async (req, res) => {
  const order = await orderRepository.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);

  const isOwner = order.user?.toString() === req.user.id;
  if (!isOwner && req.user.role !== 'admin') {
    throw new AppError('Not authorized to view this order', 403);
  }

  const view = await cancellationService.getCancellations(req.params.id);
  res.json({
    success: true,
    cancellations: view.cancellations,
    // Only an admin may act on this, and exposing what is cancellable to a customer
    // would imply a control they do not have.
    remaining: req.user.role === 'admin' ? view.remaining : [],
    summary: view.summary,
  });
};

/**
 * Cancel a chosen subset of the order's live lines, and record what they are worth.
 *
 * Deliberately does NOT send the refund. Recording is a local, always-correct write;
 * the gateway call can fail or time out, and a failed refund must leave the
 * cancellation intact and retryable rather than forcing an undo. The client calls
 * POST .../cancellations/:cancellationId/refund next.
 *
 * @route POST /orders/:id/cancellations
 * @access Private/Admin
 */
export const createCancellation = async (req, res) => {
  const { lines, reason, notes } = req.body;

  if (!Array.isArray(lines) || !lines.length) {
    throw new AppError('Select at least one item to cancel.', 400);
  }

  const result = await cancellationService.cancelLines(
    req.params.id,
    { lines, reason, notes },
    { userId: req.user.id },
  );

  // 404 only for a genuinely missing order; every other refusal is a rule the admin
  // broke (over-cancelling, a shipped line, debit EMI) and reads as 400.
  if (!result.success) {
    throw new AppError(result.message, result.message === 'Order not found' ? 404 : 400);
  }

  res.status(201).json({
    success: true,
    message: result.message,
    order: result.order,
    cancellation: result.cancellation,
    refund: result.refund,
  });
};

/**
 * Send a recorded cancellation's refund to Razorpay. Idempotent.
 *
 * @route POST /orders/:id/cancellations/:cancellationId/refund
 * @access Private/Admin
 */
export const refundCancellation = async (req, res) => {
  const result = await cancellationService.refundCancellation(
    req.params.id,
    req.params.cancellationId,
    { userId: req.user.id },
  );

  if (!result.success) throw new AppError(result.message, result.statusCode || 400);

  res.json({
    success: true,
    message: result.message,
    refund: result.refund,
    alreadyRefunded: Boolean(result.alreadyRefunded),
  });
};

/**
 * Create one parcel from a chosen subset of the order's outstanding lines.
 *
 * @route POST /orders/:id/shipments
 * @access Private/Admin
 */
export const createShipment = async (req, res) => {
  const { lines, includesReward, trackingNumber, carrierCode, carrierName, estimatedDelivery, notes, dispatch } = req.body;

  const { carrier, error: carrierError } = orderTrackingService.resolveCarrier(carrierCode, carrierName);
  if (!carrier) return res.status(400).json({ success: false, message: carrierError });

  const trimmedTracking = String(trackingNumber || '').trim();
  if (!trimmedTracking) {
    return res.status(400).json({ success: false, message: 'A tracking number is required for a parcel.' });
  }

  // ETA: honour an explicit date, else derive from the carrier's SLA so the parcel
  // email always carries an estimate — same rule as the single-parcel path.
  let eta = estimatedDelivery ? new Date(estimatedDelivery) : null;
  if (!eta && carrier.estimatedDeliveryDays) {
    eta = new Date();
    eta.setDate(eta.getDate() + carrier.estimatedDeliveryDays);
  }

  /*
    Same guard the `shipped` branch already carries. `lines` is client-supplied and is
    handed straight to `.map()` downstream, so a string (or any non-array) becomes a
    500 instead of a 400. `undefined` is meaningful — it means "everything outstanding" —
    so only a present-but-wrong-shaped value is rejected.
  */
  if (lines !== undefined && !Array.isArray(lines)) {
    return res.status(400).json({ success: false, message: '`lines` must be an array of { itemId, quantity }.' });
  }

  const result = await shipmentService.createShipment(req.params.id, {
    lines,
    includesReward,
    trackingNumber: trimmedTracking,
    carrier: orderTrackingService.buildCarrierSubdoc(carrier, trimmedTracking),
    estimatedDelivery: eta || undefined,
    notes,
    dispatch,
  }, { userId: req.user.id });

  if (!result.success) return res.status(400).json({ success: false, message: result.message });
  res.status(201).json({ success: true, message: result.message, shipment: result.shipment, order: result.order });
};

/**
 * Mark one parcel delivered. Idempotent — a double-click reports the parcel as already
 * delivered rather than re-stamping the date and re-emailing the customer.
 *
 * @route PATCH /orders/:id/shipments/:shipmentId/delivered
 * @access Private/Admin
 */
export const markShipmentDelivered = async (req, res) => {
  const result = await shipmentService.markShipmentDelivered(
    req.params.id, req.params.shipmentId, { userId: req.user.id },
  );
  if (!result.success) return res.status(400).json({ success: false, message: result.message });
  res.json({ success: true, message: result.message, order: result.order });
};

/**
 * Hand an already-packed parcel to the courier.
 *
 * @route PATCH /orders/:id/shipments/:shipmentId/dispatch
 * @access Private/Admin
 */
export const dispatchShipment = async (req, res) => {
  const { trackingNumber, carrierCode, carrierName, estimatedDelivery } = req.body || {};

  // Tracking may be supplied now (packed first, courier chosen later) or already be on
  // the parcel from when it was built. Only resolve a carrier if one was actually sent.
  let carrier;
  if (carrierCode) {
    const resolved = orderTrackingService.resolveCarrier(carrierCode, carrierName);
    if (!resolved.carrier) {
      return res.status(400).json({ success: false, message: resolved.error });
    }
    carrier = orderTrackingService.buildCarrierSubdoc(resolved.carrier, String(trackingNumber || '').trim());
  }

  const result = await shipmentService.dispatchShipment(req.params.id, req.params.shipmentId, {
    trackingNumber: trackingNumber ? String(trackingNumber).trim() : undefined,
    carrier,
    estimatedDelivery: estimatedDelivery ? new Date(estimatedDelivery) : undefined,
  }, { userId: req.user.id });

  if (!result.success) return res.status(400).json({ success: false, message: result.message });
  res.json({ success: true, message: result.message, order: result.order });
};

/**
 * Write off a parcel the courier lost. Its units return to the remaining-to-ship pool
 * so a replacement can be sent.
 *
 * @route PATCH /orders/:id/shipments/:shipmentId/lost
 * @access Private/Admin
 */
export const markShipmentLost = async (req, res) => {
  const result = await shipmentService.markShipmentLost(req.params.id, req.params.shipmentId, {
    userId: req.user.id,
    notes: req.body?.notes,
  });
  if (!result.success) return res.status(400).json({ success: false, message: result.message });
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
      /*
        ── BULK MUST GO THROUGH THE PARCEL MODEL TOO ───────────────────────────────
        This used to call updateOrderStatus directly for every status, which quietly
        undid both of the guarantees the single-order path at PUT /:id/status works to
        keep:

          • `delivered` left every parcel sitting at `shipped`. Once an order HAS
            parcels the per-line return window reads THEIR dates, so every window
            stayed shut — the customer's Return button never appeared and the backend
            refused every request. Exactly the bug the single-order path documents
            having fixed; bulk was simply missed.

          • `shipped` set the status with no parcel and (per validateBulkStatusUpdate)
            no tracking number at all, leaving an order that claims to be in transit
            with an empty `shipments[]` and no AWB for anyone to chase.

        Both now behave as the single-order path does. Anything bulk cannot do safely is
        reported per-order in `failed`, so the admin sees precisely which orders need the
        Parcels panel instead of getting a silent wrong write.
      */
      let parcelsNotified = 0;

      if (status === 'delivered') {
        const order = await orderRepository.findById(orderId);
        if (!order) {
          results.failed.push({ orderId, error: 'Order not found' });
          return;
        }
        const blocked = blockedFromWholeOrderDelivery(order);
        if (blocked) {
          results.failed.push({ orderId, error: blocked });
          return;
        }
        ({ delivered: parcelsNotified } = await shipmentService.deliverAllOutstanding(orderId));
      }

      if (status === 'shipped') {
        const order = await orderRepository.findById(orderId);
        if (!order) {
          results.failed.push({ orderId, error: 'Order not found' });
          return;
        }
        /*
          Creating a parcel needs a carrier + AWB, and a bulk request carries neither —
          one shared tracking number across many orders would be wrong data on all but
          one of them. So bulk refuses to create parcels and says so.
        */
        const outstanding = remainingToShip(order);
        if (outstanding.length) {
          results.failed.push({
            orderId,
            error: `${outstanding.length} line(s) still need a parcel with its own carrier and `
              + 'tracking number. Ship this order from its Parcels panel.',
          });
          return;
        }
        // Everything is already boxed — dispatching needs no new courier data, because
        // each parcel keeps the AWB it was packed with.
        ({ dispatched: parcelsNotified } = await shipmentService.dispatchAllPacked(orderId));

        /*
          Nothing left to dispatch and the order already reads `shipped` — every parcel
          is in transit or delivered. Stop here rather than re-running the status update.

          It would not change the status, but it WOULD enqueue an order-level "your order
          has shipped" email. The per-parcel emails are keyed on (status, shipmentId) and
          the order-level one on (status, null), so the order-level key was never
          recorded for a parcel-shipped order — the idempotency guard would not catch it
          and the customer gets a second dispatch notice for goods already with them.
        */
        if (parcelsNotified === 0 && order.status === 'shipped') {
          results.successful.push({ orderId, status, note: 'already shipped' });
          return;
        }
      }

      const result = await orderStatusService.updateOrderStatus(orderId, status, {
        userId: req.user.id,
        isAdmin: true,
        cancelledBy: 'admin', // only consumed when status === 'cancelled'
        reason: reason || 'bulk_admin_update',
        notes: notes || 'Bulk status update from admin panel',
        // Each parcel just emailed the customer itself; an order-level email on top
        // would be a second notification for the same event. Suppressed only when
        // parcels actually sent one, so a parcel-less order still gets its single email.
        suppressStatusEmail: parcelsNotified > 0,
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
  const { trackingNumber, carrierCode, carrierName, notes } = req.body;

  if (!carrierCode) {
    return res.status(400).json({ success: false, message: 'Carrier code is required' });
  }

  // A number can only be auto-generated in a carrier's own format; we don't know
  // an unlisted courier's, so the admin must supply the real AWB for `OTHER`.
  if (carrierCode === OTHER_CARRIER_CODE && !String(trackingNumber || '').trim()) {
    return res.status(400).json({
      success: false,
      message: 'Tracking number is required when the carrier is "Other"'
    });
  }

  const finalTrackingNumber = trackingNumber ||
    orderTrackingService.generateTrackingNumber(carrierCode, req.params.id);

  const result = await orderTrackingService.addTrackingInfo(req.params.id, {
    trackingNumber: finalTrackingNumber,
    carrierCode,
    carrierName,
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
// Payment-axis states an admin may filter on (mirrors Order.paymentStatus enum).
const ADMIN_PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'cancelled', 'expired'];
// The CLEAN default Orders view: the operational queue only — in-flight/awaiting payment
// (pending) plus paid & refunded. Unpaid outcomes (failed/cancelled/expired) are excluded
// by default; they belong to the CRM Leads section and are reachable here only via an
// explicit `paymentStatus` filter. Nothing is deleted — just hidden from the default view.
const ORDERS_DEFAULT_PAYMENT_STATUSES = ['pending', 'paid', 'refunded'];
// Whitelisted sort fields — anything else falls back to createdAt to avoid injecting
// an arbitrary (and unindexed) sort key.
const ADMIN_ORDER_SORT_FIELDS = new Set(['createdAt', 'totalAmount', 'status']);

/**
 * Normalize a search term for the ORDER-ID lane only.
 *
 * Orders have no separate order number — the admin table renders the last 8 hex chars
 * of `_id` prefixed with a `#`. So the value an admin copies off the screen (or out of
 * an email) arrives as "#7f3a91b2", which fails a bare hex test and silently skipped the
 * id lane entirely, returning an empty page for an order the admin was looking straight
 * at. Strip the display prefix and any internal spacing here.
 *
 * Only the id lane uses this; the customer/recipient lanes keep matching the raw term,
 * so a name or email containing a '#' is unaffected.
 */
const orderIdTerm = (term) => String(term).replace(/^#+/, '').replace(/\s+/g, '');
// The store operates in a single timezone (India). Admin date-range filters send a
// date-only string ("YYYY-MM-DD"); we anchor it to this offset so "14 Jul" means the
// IST calendar day regardless of the server's own timezone. Shared with the admin
// stat tiles (utils/storeTime.js) so a period computed there and a date range filtered
// here describe the same window.

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

  // Search terms are parsed up front because they also relax the payment-axis default
  // below — an explicit search must not be silently narrowed by it. The two params' full
  // contract is documented at the search block further down, where they're applied.
  const unifiedTerm = String(req.query.search || '').trim();
  const orderNumberTerm = String(req.query.orderNumber || '').trim();
  const hasSearchTerm = Boolean(unifiedTerm || orderNumberTerm);

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

  // Payment axis. An explicit `paymentStatus` filter (e.g. the "Unpaid / abandoned"
  // toggle sending failed,cancelled,expired) is honoured as-is. Otherwise, when the admin
  // has ALSO not narrowed by fulfillment status, we impose the clean default so the
  // Orders queue isn't cluttered with never-paid orders (which live in Leads). Same
  // "intentional none" semantics as the status filter above.
  //
  // A SEARCH also lifts the default. The default exists to keep the *browse* queue clean,
  // but a search means "find me this order" — and the orders an admin most often goes
  // looking for by name or id are exactly the failed/cancelled/expired ones a customer is
  // calling about. Leaving the default on made those searches return an empty page for an
  // order that plainly exists. The payment badge on each row keeps the state visible.
  if (req.query.paymentStatus) {
    const payStatuses = String(req.query.paymentStatus)
      .split(',')
      .map(s => s.trim())
      .filter(s => ADMIN_PAYMENT_STATUSES.includes(s));
    if (payStatuses.length === 0) return res.json(emptyOrdersPage(page, limit));
    query.paymentStatus = payStatuses.length === 1 ? payStatuses[0] : { $in: payStatuses };
  } else if (!req.query.status && !hasSearchTerm) {
    query.paymentStatus = { $in: ORDERS_DEFAULT_PAYMENT_STATUSES };
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

  // Customer name/email/phone → resolve to user ids (orders only reference the user
  // by id). This is the ADVANCED, customer-only filter; the main `search` box below
  // is broader. No matching user ⇒ no orders can match, so short-circuit to empty.
  if (req.query.customer && String(req.query.customer).trim()) {
    const userIds = await userRepository.findIdsByNameOrEmail(String(req.query.customer).trim());
    if (userIds.length === 0) return res.json(emptyOrdersPage(page, limit));
    query.user = { $in: userIds };
  }

  // Search. Two params, by design:
  //  • `search` — the UNIFIED box. Matches an order by ANY of: order id (full
  //    ObjectId or a trailing-hex fragment of _id — the visible order # is the last
  //    8 hex chars), the buyer (user name/email/phone → ids), or the order's own
  //    recipient details (shippingAddress.fullName / .phone + guest contact email,
  //    which cover guest and offline orders whose `user` link is thin/absent).
  //    Previously the box only accepted order-id hex, so typing a customer name
  //    returned an empty page.
  //  • `orderNumber` — the LEGACY strict order-id lookup, kept for API compatibility
  //    (a numeric fragment must not spuriously match phone numbers here).
  // Both are parsed at the top of this handler because they also lift the payment-axis
  // default above.
  if (unifiedTerm) {
    const or = [];

    // Order-id lane. 24-char hex = full ObjectId; a shorter hex run = trailing
    // fragment of the stringified _id. Non-hex simply skips this lane.
    const idTerm = orderIdTerm(unifiedTerm);
    if (mongoose.Types.ObjectId.isValid(idTerm) && idTerm.length === 24) {
      or.push({ _id: new mongoose.Types.ObjectId(idTerm) });
    } else if (/^[a-fA-F0-9]+$/.test(idTerm)) {
      or.push({ $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: `${idTerm}$`, options: 'i' } } });
    }

    // Buyer lane — resolve matching users to ids.
    const userIds = await userRepository.findIdsByNameOrEmail(unifiedTerm);
    if (userIds.length > 0) or.push({ user: { $in: userIds } });

    // Recipient / guest-contact lanes stored directly on the order (regex-escaped).
    const rx = new RegExp(unifiedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    or.push(
      { 'shippingAddress.fullName': rx },
      { 'shippingAddress.phone': rx },
      { guestEmail: rx },
    );

    // If the caller already narrowed by `customer` (query.user set above), keep both
    // constraints via $and so the two never clobber each other's key.
    if (query.user) {
      query.$and = [{ user: query.user }, { $or: or }];
      delete query.user;
    } else {
      query.$or = or;
    }
  } else if (orderNumberTerm) {
    const idTerm = orderIdTerm(orderNumberTerm);
    if (mongoose.Types.ObjectId.isValid(idTerm) && idTerm.length === 24) {
      query._id = new mongoose.Types.ObjectId(idTerm);
    } else if (/^[a-fA-F0-9]+$/.test(idTerm)) {
      query.$expr = { $regexMatch: { input: { $toString: '$_id' }, regex: `${idTerm}$`, options: 'i' } };
    } else {
      return res.json(emptyOrdersPage(page, limit));
    }
  }

  // Spin-to-Win: "orders carrying a goodie that still needs packing".
  //   spinReward=any       → won anything
  //   spinReward=unpacked  → won something, not yet in a parcel  ← the one that matters
  // Backed by the partial index on { 'spinReward.fulfilledAt', createdAt } declared in
  // config/db.js; without that this would COLLSCAN a growing orders collection.
  const rewardFilter = String(req.query.spinReward || '').trim();
  if (rewardFilter === 'any') {
    query['spinReward.result'] = { $exists: true };
  } else if (rewardFilter === 'unpacked') {
    query['spinReward.result'] = { $exists: true };
    query['spinReward.fulfilledAt'] = null;
    // A voided reward (order cancelled/refunded) must NOT sit in the packing queue —
    // it is explicitly a do-not-pack.
    query['spinReward.voidedAt'] = null;
  }

  const sortField = ADMIN_ORDER_SORT_FIELDS.has(req.query.sortBy) ? req.query.sortBy : 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
  const sort = { [sortField]: sortOrder };

  const [orders, total] = await Promise.all([
    // Projected — see ADMIN_LIST_FIELDS. Covers the table, the status control, the
    // refund badge and both CSV exports; `statusHistory` (the heaviest field, and one
    // that grows with every transition) is read by none of them.
    orderRepository.findAllAdmin(query, { skip, limit, sort, select: ADMIN_LIST_FIELDS }),
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
