/**
 * Admin notification service.
 *
 * Alerts the store's support inbox when a customer submits a review or a
 * consultation request, so the team can action new UGC / leads without polling
 * the admin dashboard.
 *
 * Enqueued from the review / consultation routes and processed by the
 * notification worker (send-admin-review-alert / send-admin-consultation-alert).
 * DB access + rendering live here; the raw send is provider-only in
 * emailHandler.sendEmail — mirrors reviewRequestService / orderStatusEmailService.
 */

import reviewRepository from '../repositories/reviewRepository.js';
import consultationRepository from '../repositories/consultationRepository.js';
import emailHandler from './emailHandler.js';
import companyInfo from '../config/company.js';

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

/** Minimal branded HTML shell + a key/value table shared by both alert types. */
const renderEmail = (heading, intro, rows, ctaLabel, ctaHref) => {
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

export default { emailAdminReviewAlert, emailAdminConsultationAlert };
