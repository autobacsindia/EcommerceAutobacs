/**
 * Customer-facing return email templates (text + branded HTML).
 *
 * One builder per lifecycle event. Kept data-free (no DB access) — the caller
 * (returnCustomerEmailService) pre-loads the return/order/user and passes them
 * in, mirroring utils/emailTemplates.js. Amounts are already in rupees.
 */

import { describeEmiPlan } from './paymentMethodDetails.js';

const inr = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Minimal branded shell shared by every customer return email. */
const shell = (company, heading, bodyHtml) => `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:28px;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#b08d3f;">${esc(company.name)}</p>
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#111827;">${esc(heading)}</h1>
      ${bodyHtml}
    </div>
    <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;text-align:center;">Questions? ${esc(company.email)}</p>
  </div>
</body></html>`;

const p = (t) => `<p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;">${t}</p>`;

/** `Wiper Blade × 2` lines for a return's items. */
const itemLines = (rr) =>
  (rr.items || []).map((it) => `${it.product?.name || 'Item'} × ${it.quantity || 1}`);

/**
 * Build the email for a given lifecycle event.
 * @param {Object} params
 * @param {'submitted'|'approved'|'courier_booked'|'received'|'rejected'|'refunded'} params.event
 * @param {Object} params.rr - ReturnRequest (items.product populated)
 * @param {Object} params.order - Order ({ orderNumber })
 * @param {Object} params.company - companyInfo
 * @param {Object} [params.payment] - Payment doc, used to add the EMI refund caveat.
 *                                    Optional: absent means no EMI notice, never a throw.
 * @returns {{ subject: string, text: string, html: string }}
 */
/** How to describe an offline payout to the customer who received it. */
const OFFLINE_METHOD_WORDS = Object.freeze({
  cash: 'cash',
  bank_transfer: 'bank transfer',
  upi: 'UPI',
  cheque: 'cheque',
  other: 'an offline payment',
});

export const returnEmail = ({ event, rr, order, company, payment = null }) => {
  const ref = order?.orderNumber || String(rr.order);
  const items = itemLines(rr);
  const itemsHtml = items.map((l) => `<li style="margin:2px 0;">${esc(l)}</li>`).join('');
  const itemsBlock = items.length
    ? `<ul style="margin:0 0 14px;padding-left:18px;font-size:14px;color:#374151;">${itemsHtml}</ul>`
    : '';

  let subject, heading, intro, textLines;
  // Rendered as its own highlighted block after the intro (refund event only).
  let emiNotice = null;

  switch (event) {
    case 'submitted':
      subject = `Return request received — Order #${ref}`;
      heading = 'We’ve received your return request';
      intro = `Thank you — your return request for order #${ref} has been received. Our team reviews every request within <strong>3–5 business days</strong> and will email you once a decision is made.`;
      textLines = [
        `Your return request for order #${ref} has been received.`,
        `Our team reviews every request within 3-5 business days and will email you the decision.`,
      ];
      break;
    case 'approved':
      subject = `Return approved — Order #${ref}`;
      heading = 'Your return has been approved';
      intro = `Good news — your return for order #${ref} is approved. <strong>We’ll arrange the return pickup</strong> and share the details shortly. Please keep the item in its original packaging with all accessories.`;
      textLines = [
        `Your return for order #${ref} has been approved.`,
        `We'll arrange the return pickup and share the details shortly.`,
        `Please keep the item in its original packaging with all accessories.`,
      ];
      break;
    case 'courier_booked': {
      // We book the pickup, so the customer has no way to learn the courier or AWB
      // unless we tell them — this is the most-asked question after an approval.
      const courierName = rr.courier?.provider || 'our courier partner';
      const awb = rr.courier?.trackingNumber || '';
      subject = `Return pickup arranged — Order #${ref}`;
      heading = 'Your return pickup is arranged';
      intro = `We’ve booked the return pickup for order #${ref} with <strong>${esc(courierName)}</strong>.`
        + (awb ? `<br><br><strong>Tracking / AWB:</strong> ${esc(awb)}` : '')
        + `<br><br>Please keep the item in its original packaging with all accessories, and hand it to the courier when they arrive.`;
      textLines = [
        `We've booked the return pickup for order #${ref} with ${courierName}.`,
        awb ? `Tracking / AWB: ${awb}` : null,
        `Please keep the item in its original packaging with all accessories.`,
      ].filter(Boolean);
      break;
    }
    case 'received':
      subject = `We’ve received your returned item — Order #${ref}`;
      heading = 'Your returned item is with us';
      intro = `We’ve received the returned item for order #${ref}. It’s now with our warehouse for inspection — we’ll email you as soon as the inspection is complete and your refund is processed.`;
      textLines = [
        `We've received the returned item for order #${ref}.`,
        `It's now under inspection. We'll email you once it's complete and your refund is processed.`,
      ];
      break;
    case 'rejected':
      subject = `Update on your return — Order #${ref}`;
      heading = 'About your return request';
      intro = `We’re sorry — your return request for order #${ref} could not be approved.`
        + (rr.rejectionReason ? `<br><br><strong>Reason:</strong> ${esc(rr.rejectionReason)}` : '');
      textLines = [
        `Your return request for order #${ref} could not be approved.`,
        rr.rejectionReason ? `Reason: ${rr.rejectionReason}` : null,
        `If you have questions, reply to this email or contact ${company.email}.`,
      ].filter(Boolean);
      break;
    case 'refunded': {
      const amt = rr.refund?.finalAmount || 0;
      // A refund settled OUTSIDE the gateway is already in the customer's hands — cash
      // over the counter, a bank transfer, UPI. Telling them it "is on its way" and to
      // allow 5-9 business days would be plainly wrong, and invites a support ticket
      // (or a chargeback) asking where the second payment went.
      const isOffline = rr.refund?.method === 'offline';
      if (isOffline) {
        const how = OFFLINE_METHOD_WORDS[rr.refund?.offlineMethod] || 'an offline payment';
        const refText = rr.refund?.reference ? ` Reference: ${rr.refund.reference}.` : '';
        subject = `Refund confirmed — ${inr(amt)} — Order #${ref}`;
        heading = 'Your refund has been processed';
        intro = `This confirms a refund of <strong>${inr(amt)}</strong> for order #${ref}, paid to you by <strong>${esc(how)}</strong>.${esc(refText)}`;
        const offlineParts = [];
        if (rr.refund?.shippingDeduction) offlineParts.push(`Shipping deduction: ${inr(rr.refund.shippingDeduction)}`);
        if (rr.refund?.restockingDeduction) offlineParts.push(`Restocking (10%): ${inr(rr.refund.restockingDeduction)}`);
        textLines = [
          `This confirms a refund of ${inr(amt)} for order #${ref}, paid to you by ${how}.${refText}`,
          ...offlineParts,
          `If you have not received it, reply to this email and we'll sort it out.`,
        ];
        break;
      }
      subject = `Refund initiated — ${inr(amt)} — Order #${ref}`;
      heading = 'Your refund is on its way';
      intro = `We’ve initiated a refund of <strong>${inr(amt)}</strong> for order #${ref} to your original payment method. It typically settles in <strong>5–9 business days</strong>, depending on your bank or payment provider.`;
      const parts = [];
      if (rr.refund?.shippingDeduction) parts.push(`Shipping deduction: ${inr(rr.refund.shippingDeduction)}`);
      if (rr.refund?.restockingDeduction) parts.push(`Restocking (10%): ${inr(rr.refund.restockingDeduction)}`);
      // EMI orders: the refund covers PRINCIPAL only. Interest the bank has already
      // billed, and any cancellation charge it levies, are the bank's and cannot be
      // reversed by us or by Razorpay. Saying so here — plainly, in the same email that
      // announces the refund — is what stops "you refunded me less than I paid" becoming
      // a chargeback. See utils/paymentMethodDetails.js for how the plan is detected.
      emiNotice = describeEmiPlan(payment);
      if (emiNotice) {
        parts.push(
          `Paid via ${emiNotice} — your bank refunds the principal only. Interest already billed and any cancellation charge set by your bank are not refundable.`
        );
      }
      textLines = [
        `We've initiated a refund of ${inr(amt)} for order #${ref} to your original payment method.`,
        ...parts,
        `It typically settles in 5-9 business days.`,
      ];
      break;
    }
    default:
      subject = `Update on your return — Order #${ref}`;
      heading = 'Return update';
      intro = `There’s an update on your return for order #${ref}.`;
      textLines = [`There's an update on your return for order #${ref}.`];
  }

  const text = [
    heading,
    '',
    ...textLines,
    items.length ? `\nItems:\n${items.map((l) => `  - ${l}`).join('\n')}` : '',
    '',
    `— ${company.name}`,
  ].filter((l) => l !== null).join('\n');

  const emiBlock = emiNotice
    ? `<div style="margin:0 0 14px;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;">
         <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#92400e;">Paid via ${esc(emiNotice)}</p>
         <p style="margin:0;font-size:13px;color:#92400e;line-height:1.6;">Your bank refunds the <strong>principal only</strong>. Interest already billed on this EMI plan, and any cancellation charge your bank applies, are set by the bank and cannot be refunded by us or by Razorpay.</p>
       </div>`
    : '';

  const html = shell(company, heading, `${p(intro)}${emiBlock}${itemsBlock}`);
  return { subject, text, html };
};

export default { returnEmail };
