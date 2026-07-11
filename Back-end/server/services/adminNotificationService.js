/**
 * Admin notification service.
 *
 * Alerts the store's support inbox when a customer submits a review or a
 * consultation request, pays for an order, or cancels one — so the team can
 * action new UGC / leads / fulfilment work without polling the admin dashboard.
 *
 * Enqueued from the review / consultation routes, razorpayService (payment
 * captured) and orderStatusService (cancellation), then processed by the
 * notification worker (send-admin-*-alert). DB access + rendering live here;
 * the raw send is provider-only in emailHandler.sendEmail — mirrors
 * reviewRequestService / orderStatusEmailService.
 */

import reviewRepository from '../repositories/reviewRepository.js';
import consultationRepository from '../repositories/consultationRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import emailHandler from './emailHandler.js';
import companyInfo from '../config/company.js';
// Same customer-facing reference the invoice PDF prints, so an alert and the
// customer's invoice always name the order identically.
import { invoiceNumber as orderRef } from './invoiceService.js';

/**
 * Internal alert recipients. Reads ADMIN_NOTIFICATION_EMAILS (comma-separated)
 * first, then the singular ADMIN_NOTIFICATION_EMAIL, then falls back to the
 * support inbox (COMPANY_EMAIL). Trimmed + de-duped; empty entries dropped.
 *
 * To add another internal recipient, just extend the env var — no code change:
 *   ADMIN_NOTIFICATION_EMAILS=support@autobacsindia.com,ops@autobacsindia.com
 */
const adminRecipients = () => {
  const raw =
    process.env.ADMIN_NOTIFICATION_EMAILS ||
    process.env.ADMIN_NOTIFICATION_EMAIL ||
    companyInfo.email;
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
};

/** Public site base, trailing slash trimmed (for admin/product deep-links). */
const appUrl = () => (process.env.FRONTEND_URL || 'https://autobacsindia.com').replace(/\/$/, '');

const stripHtml = (s = '') => String(s).replace(/<[^>]*>/g, '').trim();
const escapeHtml = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Rupee formatting. Order amounts are already stored in rupees by pricingService
 * (see invoiceService) — this only formats, it never converts.
 */
const inr = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** `Wiper Blade × 2` lines for an order's items, one per line. */
const itemLines = (order) =>
  (order.items || []).map((it) => `${it.name || 'Item'} × ${it.quantity || 0}`);

/** Snapshot of the person who placed the order (user doc wins, address is the fallback). */
const orderCustomer = (order) => {
  const user = order.user && typeof order.user === 'object' ? order.user : null;
  const addr = order.shippingAddress || {};
  return {
    name: user?.name || addr.fullName || 'Customer',
    email: user?.email || order.guestEmail || '',
    phone: addr.phone || '',
  };
};

/** Deep-link into the admin order detail screen. */
const adminOrderLink = (order) => `${appUrl()}/admin/orders/${order._id}`;

/**
 * Minimal branded HTML shell + a key/value table shared by every alert type.
 * `bannerHtml` (optional) renders above the table — used to make an actionable
 * alert (e.g. a refund owed) impossible to miss.
 */
const renderEmail = (heading, intro, rows, ctaLabel, ctaHref, bannerHtml = '') => {
  const cells = rows
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(
      ([k, v]) =>
        `<tr>
           <td style="padding:6px 16px 6px 0;color:#6b7280;font-size:13px;vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td>
           <td style="padding:6px 0;color:#111827;font-size:14px;">${v}</td>
         </tr>`
    )
    .join('');

  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:28px;">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#b08d3f;">${escapeHtml(companyInfo.name)} · Admin alert</p>
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#111827;">${escapeHtml(heading)}</h1>
        <p style="margin:0 0 20px;font-size:14px;color:#374151;">${escapeHtml(intro)}</p>
        ${bannerHtml}
        <table style="width:100%;border-collapse:collapse;">${cells}</table>
        <a href="${escapeHtml(ctaHref)}" style="display:inline-block;margin-top:24px;background:#111827;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:11px 20px;border-radius:6px;">${escapeHtml(ctaLabel)}</a>
      </div>
      <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;text-align:center;">Automated notification — do not reply.</p>
    </div>
  </body></html>`;
};

/**
 * Fan the alert out to every admin recipient. Sent when at least one delivery
 * succeeds; skipped-disabled when email is simply off (no Postmark) so BullMQ
 * doesn't retry a config gap forever; throws on a transient/hard failure so the
 * job retries (a retry may re-send to already-delivered admins — acceptable for
 * low-volume internal alerts).
 */
const sendToAdmins = async ({ subject, text, html }, context) => {
  let anySent = false;
  for (const to of adminRecipients()) {
    const result = await emailHandler.sendEmail({ to, subject, text, html });
    if (result?.success) anySent = true;
    else if (!result?.fallbackToConsole) {
      throw new Error(`Admin alert email failed (${context} → ${to}): ${result?.error || 'unknown error'}`);
    }
  }
  return { status: anySent ? 'sent' : 'skipped-disabled' };
};

/**
 * Notify the support inbox that a customer submitted a product review
 * (pending approval). Best-effort: safe to retry (idempotency isn't tracked —
 * a rare duplicate admin alert is harmless).
 *
 * @param {string} reviewId
 * @returns {Promise<{status: 'sent'|'skipped-disabled'|'not-found'}>}
 */
export const emailAdminReviewAlert = async (reviewId) => {
  const review = await reviewRepository
    .findById(reviewId)
    .populate('product', 'name slug')
    .populate('user', 'name email');
  if (!review) return { status: 'not-found' };

  const product = review.product && typeof review.product === 'object' ? review.product : null;
  const reviewer = review.user && typeof review.user === 'object' ? review.user : null;

  const productName = product?.name || 'Unknown product';
  const reviewerName = reviewer?.name || 'A customer';
  const reviewerEmail = reviewer?.email || '';
  const title = stripHtml(review.title);
  const comment = stripHtml(review.comment);
  const productLink = product?.slug ? `${appUrl()}/products/${product.slug}` : '';
  const adminLink = `${appUrl()}/admin/reviews`;

  const subject = `New review (${review.rating}★) on ${productName}`;
  const intro = 'A new review was submitted and is pending approval.';

  const text = [
    intro,
    '',
    `Product : ${productName}`,
    `Rating  : ${review.rating}/5`,
    `By      : ${reviewerName}${reviewerEmail ? ` <${reviewerEmail}>` : ''}`,
    title ? `Title   : ${title}` : null,
    comment ? `Comment : ${comment}` : null,
    review.isVerifiedPurchase ? 'Verified purchase: yes' : null,
    '',
    productLink ? `Product page : ${productLink}` : null,
    `Moderate     : ${adminLink}`,
  ]
    .filter((v) => v !== null)
    .join('\n');

  const html = renderEmail(
    subject,
    intro,
    [
      ['Product', escapeHtml(productName)],
      ['Rating', `${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)} (${review.rating}/5)`],
      ['By', `${escapeHtml(reviewerName)}${reviewerEmail ? ` &lt;${escapeHtml(reviewerEmail)}&gt;` : ''}`],
      ['Verified purchase', review.isVerifiedPurchase ? 'Yes' : 'No'],
      ['Title', escapeHtml(title)],
      ['Comment', escapeHtml(comment).replace(/\n/g, '<br>')],
    ],
    'Moderate reviews',
    adminLink
  );

  return sendToAdmins({ subject, text, html }, `review ${reviewId}`);
};

/**
 * Notify the support inbox that a customer submitted a consultation request.
 *
 * @param {string} consultationId
 * @returns {Promise<{status: 'sent'|'skipped-disabled'|'not-found'}>}
 */
export const emailAdminConsultationAlert = async (consultationId) => {
  const c = await consultationRepository.findById(consultationId);
  if (!c) return { status: 'not-found' };

  const adminLink = `${appUrl()}/admin/consultation`;
  const preferredDate = c.preferredDate ? new Date(c.preferredDate).toLocaleDateString('en-IN') : '';
  const upgrades = Array.isArray(c.upgrades) && c.upgrades.length ? c.upgrades.join(', ') : '';
  const waDigits = String(c.whatsapp || '').replace(/[^\d]/g, '');
  const waLink = waDigits ? `https://wa.me/${waDigits}` : '';

  const subject = `New consultation request — ${c.name} (${c.makeModel})`;
  const intro = 'A new consultation request was submitted.';

  const fields = [
    ['Name', c.name],
    ['WhatsApp', c.whatsapp],
    ['City', c.city],
    ['Vehicle', c.makeModel],
    ['Reg. no.', c.vehicleNumber],
    ['Upgrades', upgrades],
    ['Usage', c.usage],
    ['Driving style', c.drivingStyle],
    ['Mode', c.mode],
    ['Preferred date', preferredDate],
    ['Preferred time', c.preferredTime],
    ['Notes', c.notes],
  ];

  const text = [
    intro,
    '',
    ...fields.filter(([, v]) => v != null && String(v).trim() !== '').map(([k, v]) => `${k}: ${v}`),
    '',
    `Manage: ${adminLink}`,
  ].join('\n');

  const htmlRows = fields.map(([k, v]) => {
    if (k === 'WhatsApp' && waLink) {
      return [k, `<a href="${escapeHtml(waLink)}" style="color:#b08d3f;">${escapeHtml(String(v))}</a>`];
    }
    return [k, escapeHtml(String(v ?? '')).replace(/\n/g, '<br>')];
  });

  const html = renderEmail(subject, intro, htmlRows, 'Manage consultations', adminLink);

  return sendToAdmins({ subject, text, html }, `consultation ${consultationId}`);
};

/**
 * Notify the support inbox that an order was paid for and is ready to fulfil.
 *
 * Enqueued from razorpayService.processPaymentSuccess *after* the payment
 * transaction commits, and only by the delivery that created the payment — so a
 * duplicate Razorpay webhook never double-alerts. Deliberately NOT fired on order
 * creation: an unpaid order is an abandoned checkout, and already surfaces as a
 * `payment_pending` lead in the CRM.
 *
 * @param {string} orderId
 * @returns {Promise<{status: 'sent'|'skipped-disabled'|'not-found'}>}
 */
export const emailAdminOrderPlacedAlert = async (orderId) => {
  const order = await orderRepository.findById(orderId, [{ path: 'user', select: 'name email' }]);
  if (!order) return { status: 'not-found' };

  const ref = orderRef(order);
  const customer = orderCustomer(order);
  const addr = order.shippingAddress || {};
  const items = itemLines(order);
  const shipTo = [addr.city, addr.state, addr.postalCode].filter(Boolean).join(', ');
  const adminLink = adminOrderLink(order);

  const subject = `New paid order ${ref} — ${inr(order.totalAmount)}`;
  const intro = 'Payment was captured. This order is ready to fulfil.';

  const text = [
    intro,
    '',
    `Order   : ${ref}`,
    `Total   : ${inr(order.totalAmount)}`,
    `Customer: ${customer.name}${customer.email ? ` <${customer.email}>` : ''}`,
    customer.phone ? `Phone   : ${customer.phone}` : null,
    shipTo ? `Ship to : ${shipTo}` : null,
    '',
    'Items:',
    ...items.map((l) => `  - ${l}`),
    '',
    `Manage: ${adminLink}`,
  ]
    .filter((v) => v !== null)
    .join('\n');

  const html = renderEmail(
    subject,
    intro,
    [
      ['Order', escapeHtml(ref)],
      ['Total', `<strong>${escapeHtml(inr(order.totalAmount))}</strong>`],
      ['Customer', `${escapeHtml(customer.name)}${customer.email ? ` &lt;${escapeHtml(customer.email)}&gt;` : ''}`],
      ['Phone', escapeHtml(customer.phone)],
      ['Ship to', escapeHtml(shipTo)],
      ['Items', items.map((l) => escapeHtml(l)).join('<br>')],
    ],
    'Open order',
    adminLink
  );

  return sendToAdmins({ subject, text, html }, `order-placed ${orderId}`);
};

/**
 * Notify the support inbox that an order was cancelled by a customer or an admin.
 *
 * Enqueued from orderStatusService on a `cancelled` transition. `system` cancels
 * (expiry/automation) are filtered out at the enqueue site — they're not a support
 * work item — and re-checked here so a stale or hand-queued job can't bypass that
 * rule. Both customer and admin cancels alert: a customer self-cancel may owe a
 * refund; an admin cancel is an audit record other staff should see.
 *
 * When the money was already captured, cancelling auto-writes a pending
 * `refundDetails` record for manual processing; that is surfaced in the subject
 * line and as a banner, because it is a work item rather than an FYI.
 *
 * @param {string} orderId
 * @returns {Promise<{status: 'sent'|'skipped-disabled'|'not-found'|'skipped-not-cancelled'|'skipped-system-cancel'}>}
 */
export const emailAdminOrderCancelledAlert = async (orderId) => {
  const order = await orderRepository.findById(orderId, [{ path: 'user', select: 'name email' }]);
  if (!order) return { status: 'not-found' };
  if (order.status !== 'cancelled') return { status: 'skipped-not-cancelled' };
  // Mirror the enqueue-site filter: alert on human cancels only, never automation.
  if (!['customer', 'admin'].includes(order.cancelledBy)) return { status: 'skipped-system-cancel' };

  const ref = orderRef(order);
  const customer = orderCustomer(order);
  const items = itemLines(order);
  const adminLink = adminOrderLink(order);
  const cancelledAt = order.cancelledAt ? new Date(order.cancelledAt) : new Date();
  const actor = order.cancelledBy === 'admin' ? 'admin' : 'customer';

  // A pending refund record is written on cancel whenever the order was already
  // paid — that, not paymentStatus, is what the team has to action.
  const refund =
    order.refundDetails?.status === 'pending' && order.refundDetails?.amount > 0
      ? order.refundDetails
      : null;

  const subject = refund
    ? `Order cancelled — REFUND DUE ${inr(refund.amount)} — ${ref}`
    : `Order cancelled by ${actor} — ${ref}`;
  const intro = refund
    ? `This order was cancelled by ${actor === 'admin' ? 'an admin' : 'the customer'} after payment was captured. A refund is pending and needs to be processed.`
    : `This order was cancelled by ${actor === 'admin' ? 'an admin' : 'the customer'}. No payment was captured, so nothing to refund.`;

  const text = [
    intro,
    '',
    refund ? `** REFUND DUE: ${inr(refund.amount)} (${refund.refundMethod || 'original_payment'}) **` : null,
    refund ? '' : null,
    `Order      : ${ref}`,
    `Order total: ${inr(order.totalAmount)}`,
    `Customer   : ${customer.name}${customer.email ? ` <${customer.email}>` : ''}`,
    customer.phone ? `Phone      : ${customer.phone}` : null,
    `Cancelled by: ${actor}`,
    `Cancelled  : ${cancelledAt.toLocaleString('en-IN')}`,
    order.cancellationReason ? `Reason     : ${order.cancellationReason}` : null,
    '',
    'Items:',
    ...items.map((l) => `  - ${l}`),
    '',
    `Manage: ${adminLink}`,
  ]
    .filter((v) => v !== null)
    .join('\n');

  const banner = refund
    ? `<div style="margin:0 0 20px;padding:14px 16px;background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:6px;">
         <p style="margin:0;font-size:13px;font-weight:700;color:#991b1b;letter-spacing:.04em;">REFUND DUE — ${escapeHtml(inr(refund.amount))}</p>
         <p style="margin:4px 0 0;font-size:12px;color:#7f1d1d;">Method: ${escapeHtml(refund.refundMethod || 'original_payment')} · Status: pending manual processing</p>
       </div>`
    : '';

  const html = renderEmail(
    subject,
    intro,
    [
      ['Order', escapeHtml(ref)],
      ['Order total', escapeHtml(inr(order.totalAmount))],
      ['Refund due', refund ? `<strong style="color:#b91c1c;">${escapeHtml(inr(refund.amount))}</strong>` : 'None — order was unpaid'],
      ['Customer', `${escapeHtml(customer.name)}${customer.email ? ` &lt;${escapeHtml(customer.email)}&gt;` : ''}`],
      ['Phone', escapeHtml(customer.phone)],
      ['Cancelled by', escapeHtml(actor)],
      ['Cancelled', escapeHtml(cancelledAt.toLocaleString('en-IN'))],
      ['Reason', escapeHtml(order.cancellationReason || '')],
      ['Items', items.map((l) => escapeHtml(l)).join('<br>')],
    ],
    refund ? 'Process refund' : 'Open order',
    adminLink,
    banner
  );

  return sendToAdmins({ subject, text, html }, `order-cancelled ${orderId}`);
};

/**
 * Notify the support inbox that a refund FAILED at the payment gateway.
 *
 * Enqueued from razorpayService.applyRefundWebhook on a `refund.failed` webhook.
 * This is the most actionable alert we send: the money did NOT reach the customer,
 * the order is stuck in a `failed` refund state, and only a human can retry it
 * (re-initiate the refund, or arrange a manual/bank payout). Surfaced with a red
 * banner and a direct link to the order.
 *
 * Best-effort/retry-safe: a replayed refund.failed webhook is de-duped upstream
 * (applyRefundWebhook no-ops once status is already `failed`), so this only fires
 * on the genuine transition. A rare duplicate admin alert is harmless.
 *
 * @param {string} orderId
 * @returns {Promise<{status: 'sent'|'skipped-disabled'|'not-found'}>}
 */
export const emailAdminRefundFailedAlert = async (orderId) => {
  const order = await orderRepository.findById(orderId, [{ path: 'user', select: 'name email' }]);
  if (!order) return { status: 'not-found' };

  const ref = orderRef(order);
  const customer = orderCustomer(order);
  const adminLink = adminOrderLink(order);
  const refund = order.refundDetails || {};
  const amount = refund.amount || order.totalAmount;
  const method = refund.refundMethod || 'original_payment';
  const reason = refund.failureReason || 'Unknown gateway error';
  const refundId = refund.transactionId || '';

  const subject = `⚠ REFUND FAILED — ${inr(amount)} owed — ${ref}`;
  const intro =
    'A refund could not be completed at the payment gateway. The customer has NOT been refunded — this order needs a manual retry or an alternative payout.';

  const text = [
    intro,
    '',
    `** REFUND FAILED: ${inr(amount)} (${method}) STILL OWED **`,
    '',
    `Order      : ${ref}`,
    `Amount     : ${inr(amount)}`,
    `Method     : ${method}`,
    `Gateway err: ${reason}`,
    refundId ? `Refund id  : ${refundId}` : null,
    `Customer   : ${customer.name}${customer.email ? ` <${customer.email}>` : ''}`,
    customer.phone ? `Phone      : ${customer.phone}` : null,
    '',
    `Retry refund: ${adminLink}`,
  ]
    .filter((v) => v !== null)
    .join('\n');

  const banner = `<div style="margin:0 0 20px;padding:14px 16px;background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:6px;">
       <p style="margin:0;font-size:13px;font-weight:700;color:#991b1b;letter-spacing:.04em;">REFUND FAILED — ${escapeHtml(inr(amount))} STILL OWED</p>
       <p style="margin:4px 0 0;font-size:12px;color:#7f1d1d;">${escapeHtml(reason)}</p>
     </div>`;

  const html = renderEmail(
    subject,
    intro,
    [
      ['Order', escapeHtml(ref)],
      ['Amount owed', `<strong style="color:#b91c1c;">${escapeHtml(inr(amount))}</strong>`],
      ['Method', escapeHtml(method)],
      ['Gateway error', escapeHtml(reason)],
      ['Refund id', escapeHtml(refundId)],
      ['Customer', `${escapeHtml(customer.name)}${customer.email ? ` &lt;${escapeHtml(customer.email)}&gt;` : ''}`],
      ['Phone', escapeHtml(customer.phone)],
    ],
    'Retry refund',
    adminLink,
    banner
  );

  return sendToAdmins({ subject, text, html }, `refund-failed ${orderId}`);
};

export default {
  emailAdminReviewAlert,
  emailAdminConsultationAlert,
  emailAdminOrderPlacedAlert,
  emailAdminOrderCancelledAlert,
  emailAdminRefundFailedAlert,
};
