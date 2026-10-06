/**
 * Offline order creation — the ONE implementation shared by the admin
 * "offline order" form (orderController.createOfflineOrder) and the sales team's
 * panel (salesOrderService). Callers validate their own HTTP input and build the
 * priced line items; everything from "find or create the buyer" to "settle or
 * send the payment link" lives here so the two entry points cannot drift.
 *
 * Moved verbatim out of the controller; behaviour is unchanged for the admin path.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import orderRepository from '../repositories/orderRepository.js';
import userRepository from '../repositories/userRepository.js';
import razorpayService from './razorpayService.js';
import orderStatusService from './orderStatusService.js';
import leadSyncService from './leadSyncService.js';
import AppError from '../utils/AppError.js';
import { resolveBuyerAndAcceptance } from './buyerService.js';
import { BUYER_TYPES } from '../config/buyer.js';
import { ACCEPTANCE_CHANNELS } from '../config/legalDocuments.js';
import { hashToken } from '../utils/tokenUtils.js';
import { getNotificationsQueue } from '../queue/queues.js';

/** Payment links expire after this long (matches razorpayService.createPaymentLink). */
export const PAYMENT_LINK_TTL_MS = 48 * 60 * 60 * 1000;

/** Persist an enterprise buyer's details for reuse (convenience copy, fire-and-forget). */
const saveBusinessProfile = (userId, buyer) =>
  userRepository.setBusinessProfile(userId, {
    legalName: buyer.legalName,
    gstin: buyer.gstin,
    stateCode: buyer.stateCode,
    billingAddress: buyer.billingAddress,
  });

/**
 * @param {Object} p
 * @param {Object} p.body          raw request body — buyer/GSTIN fields are read from it
 * @param {string} p.email
 * @param {string} p.phone
 * @param {string} [p.name]
 * @param {Array}  p.lineItems     priced order lines (rupees), already validated by the caller
 * @param {Object} p.shippingAddress  validated address (addressLine1/city/state/postalCode present)
 * @param {number} [p.shippingCost]
 * @param {number} [p.discount]
 * @param {'processing'|'delivered'} [p.status]  final state for paymentMode 'paid'
 * @param {string} [p.notes]
 * @param {string} [p.leadId]
 * @param {string|null} [p.salesRepId]   name-only SalesRep credited with the deal
 * @param {string|null} [p.salesUserId]  staff User who created the order (sales panel)
 * @param {'paid'|'link'} p.paymentMode
 * @param {string} p.actorId       User id recorded in status history
 * @param {string} [p.defaultNote]
 * @returns {Promise<{order: Object, customer: {id, email, isNewUser}, paymentLink: {id, shortUrl}|null}>}
 */
export async function createOfflineOrderRecord({
  body,
  email,
  phone,
  name,
  lineItems,
  shippingAddress,
  shippingCost = 0,
  discount = 0,
  status = 'processing',
  notes,
  leadId,
  salesRepId = null,
  salesUserId = null,
  paymentMode,
  actorId,
  defaultNote = 'Offline order created by admin',
}) {
  /*
    Validate the buyer BEFORE creating the customer: a mistyped GSTIN would
    otherwise 400 the request and leave behind a brand-new `mustResetPassword`
    account for a person who has no order.

    `requireAcceptance: false` because the customer is not at a browser to tick a
    box; the GSTIN is still validated identically.
  */
  const { buyer, legalAcceptance } = resolveBuyerAndAcceptance(body, {
    requireAcceptance: false,
    // The channel keeps this distinguishable from a real acceptance. No ipHash:
    // the only address available is the STAFF member's, not the customer's.
    channel: ACCEPTANCE_CHANNELS.OFFLINE_ADMIN,
    recordedBy: actorId || null,
  });

  const postalCode = String(shippingAddress.postalCode).trim();

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
    // Existing customer with no phone on file → backfill (never overwrite).
    user.phone = phone;
    await userRepository.save(user);
  }

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
    ...(salesUserId && { salesUser: salesUserId }),
    ...(buyer.type === BUYER_TYPES.ENTERPRISE && { buyer }),
    legalAcceptance,
    // Link flow converts the chosen lead on payment (deferred), so remember it.
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
        updatedBy: actorId,
        reason: 'manual_confirmation',
        notes: notes || defaultNote,
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
    // Collect via Razorpay: the order stays `awaiting_payment`. The
    // `payment_link.paid` webhook drives it paid → processing — no manual mark.
    let link;
    try {
      link = await razorpayService.createPaymentLink(order, { name: address.fullName, email: normEmail, phone });
    } catch (linkErr) {
      // Roll back so a Razorpay failure doesn't strand an unpayable order — and,
      // for a brand-new buyer, an account they can never claim.
      await orderRepository.delete(order._id).catch(() => {});
      if (isNewUser) await userRepository.delete(user._id).catch(() => {});
      throw new AppError(`Could not create payment link: ${linkErr.message}`, 502, { expose: true });
    }
    order.paymentLinkId = link.id;
    order.paymentLinkUrl = link.shortUrl;
    order.paymentLinkExpiresAt = new Date(Date.now() + PAYMENT_LINK_TTL_MS);
    await orderRepository.save(order);
    order = await orderRepository.findById(order._id);
    paymentLink = link;
  } else {
    // Already paid offline → drive through the normal status machinery so all
    // side-effects fire.
    await orderStatusService.updateOrderStatus(order._id.toString(), 'processing', {
      userId: actorId,
      isAdmin: true,
      reason: 'manual_confirmation',
      notes: 'Offline sale confirmed (paid)',
    });
    if (status === 'delivered') {
      await orderStatusService.updateOrderStatus(order._id.toString(), 'delivered', {
        userId: actorId,
        isAdmin: true,
        reason: 'customer_received',
        notes: 'Offline sale delivered',
      });
    }
    order = await orderRepository.findById(order._id);

    if (leadId) {
      await leadSyncService.safeSync(() =>
        leadSyncService.applyLeadStatus(leadId, 'won', {
          actorId,
          repId: salesRepId,
          notes: 'Closed via offline order',
          convertedOrder: order._id,
        })
      );
    }
  }

  // New buyer: mint the single-use account-claim (set-password) token NOW, as a
  // DB write independent of the queue. Email the RAW token; store only its hash.
  let magicRawToken = null;
  if (isNewUser) {
    magicRawToken = crypto.randomBytes(32).toString('hex');
    user.magicLinkToken = hashToken(magicRawToken);
    // 7 days: a link-flow order may not be paid for up to 48h.
    user.magicLinkExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await userRepository.save(user);
  }

  // ── Emails (best-effort, idempotent) ─────────────────────────────────────
  if (process.env.REDIS_URL) {
    const queue = getNotificationsQueue();
    // Invoice only for an already-paid order; the link flow invoices on payment.
    if (paymentMode !== 'link') {
      queue
        .add('send-order-invoice', { orderId: order._id.toString() })
        .catch((err) => console.error('[Queue] Failed to enqueue send-order-invoice:', err.message));
      // Paid now (not via the webhook), so it entered the team workflow here — the
      // teams are told the same way as for a Razorpay payment.
      queue
        .add('send-staff-sales-paid-alert', { orderId: order._id.toString() })
        .catch((err) => console.error('[Queue] Failed to enqueue send-staff-sales-paid-alert:', err.message));
    }
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

  return {
    order,
    customer: { id: user._id, email: user.email, isNewUser },
    paymentLink,
  };
}
