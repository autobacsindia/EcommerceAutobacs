/**
 * The progress emails between "order confirmed" and "shipped" — preparing, packed,
 * courier booked — and the one "still on it" note when a step runs long.
 *
 * Tone ("Nothing Extra", 2026-11-23): warm, short, honest. Nothing here promises a
 * date, mentions money or charges, or asks the customer to call: each email says
 * what has REALLY happened, what comes next, and where to see it. Provider-free —
 * emailHandler.sendOrderProgress sends what this builds.
 *
 * Same frame as the other order emails (utils/emailTemplates.js orderStatusEmail):
 * black header, white card, one dark button.
 */
import { storefrontOrigin, trackOrderUrl } from './storefrontUrl.js';
import { STEPS, STEP } from './customerJourney.js';

export const STEP_LABELS = Object.freeze({
  [STEP.PLACED]: 'Placed',
  [STEP.PREPARING]: 'Preparing',
  [STEP.PACKED]: 'Packed',
  [STEP.SHIPPED]: 'Shipped',
  [STEP.DELIVERED]: 'Delivered',
});

/** still_on_it: where the order is, in the customer's words (one per pre-dispatch step). */
export const STILL_ON_IT_LINES = Object.freeze({
  [STEP.PLACED]: 'our team is confirming your item and getting your order ready',
  [STEP.PREPARING]: 'your item is being prepared for dispatch',
  [STEP.PACKED]: 'your parcel is packed and waiting for the courier to collect it',
});

/** Which step each email shows as "now" in its progress strip. */
const STRIP_STEP = Object.freeze({
  preparing: STEP.PREPARING,
  packed: STEP.PACKED,
  courier_booked: STEP.PACKED,
});

const COPY = {
  preparing: {
    subject: (ref) => `We're preparing your order — ${ref}`,
    heading: "We're preparing your order",
    blurb: () => "Your item is confirmed and our team has started preparing your order. We'll write again as soon as it's packed and on its way.",
  },
  packed: {
    subject: (ref) => `Packed and ready — ${ref}`,
    heading: 'Your order is packed',
    blurb: () => "Your order is packed and ready for the courier. We'll send your tracking details as soon as the courier has it.",
  },
  courier_booked: {
    subject: (ref) => `Courier booked — ${ref}`,
    heading: "We've booked your courier",
    blurb: ({ carrierName }) => `Your parcel is packed and we've booked ${carrierName || 'our courier partner'} to collect it. Your tracking number is below — it starts showing updates once the courier picks the parcel up.`,
  },
  still_on_it: {
    subject: (ref) => `An update on your order — ${ref}`,
    heading: 'Your order is still our priority',
    blurb: ({ stage }) => `A quick update on where things stand: ${STILL_ON_IT_LINES[stage] || 'our team is working on it'}. Nothing is needed from you — we'll write again at the next step.`,
  },
};

export const PROGRESS_EMAIL_KINDS = Object.freeze(Object.keys(COPY));

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

/**
 * @param {object} params
 * @param {object} params.order
 * @param {object} [params.user] - { name, isGuest }
 * @param {'preparing'|'packed'|'courier_booked'|'still_on_it'} params.kind
 * @param {object} [params.shipment] - packed / courier_booked: the parcel
 * @param {string} [params.stage] - still_on_it: placed | preparing | packed
 * @param {object} [params.company] - { name, email }
 * @returns {{ subject: string, text: string, html: string }}
 */
export function orderProgressEmail({ order, user = null, kind, shipment = null, stage = null, company = {} }) {
  const copy = COPY[kind];
  if (!copy) throw new Error(`Unknown progress email kind: ${kind}`);

  const ref = `AB-${String(order._id).slice(-8).toUpperCase()}`;
  const name = order.shippingAddress?.fullName || user?.name || 'there';
  const companyName = company.name || 'Autobacs India';
  const supportEmail = company.email || 'support@autobacsindia.com';

  const trackingNumber = kind === 'courier_booked' ? String(shipment?.trackingNumber || '').trim() : '';
  const carrierName = shipment?.carrier?.name || '';
  const courierUrl = kind === 'courier_booked' ? shipment?.carrier?.trackingUrl : null;

  // A signed-in customer has an order page; a guest has the public tracker.
  const origin = storefrontOrigin();
  const orderUrl = origin && order.user && !user?.isGuest ? `${origin}/orders/${order._id}` : trackOrderUrl();

  // "Parcel 1 of 2" only when the order really goes in more than one box.
  const live = (order.shipments || []).filter((s) => s.status !== 'lost');
  const index = shipment ? live.findIndex((s) => String(s._id) === String(shipment._id)) + 1 : 0;
  const parcelNote = shipment && live.length > 1 && index > 0
    ? ` This is parcel ${index} of ${live.length}; the rest follows separately.` : '';

  const blurb = copy.blurb({ carrierName, stage }) + parcelNote;
  const now = kind === 'still_on_it' ? stage : STRIP_STEP[kind];
  const nowIndex = Math.max(0, STEPS.indexOf(now));

  const stripText = STEPS.map((s, i) => `${i < nowIndex ? '✓' : i === nowIndex ? '●' : '○'} ${STEP_LABELS[s]}`).join('  ');
  const trackingText = trackingNumber
    ? `\n\nTracking details:\n  • Courier: ${carrierName || 'our courier partner'}\n  • Tracking number: ${trackingNumber}${courierUrl ? `\n  • Track with the courier: ${courierUrl}` : ''}`
    : '';

  const text = `
Hi ${name},

${blurb}

Order: ${ref}
${stripText}${trackingText}${orderUrl ? `\n\nSee your order: ${orderUrl}` : ''}

Questions? Contact us at ${supportEmail}.

Warm regards,
${companyName}
  `.trim();

  const strip = `<table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0 4px;"><tr>${STEPS.map((s, i) => {
    const done = i < nowIndex;
    const current = i === nowIndex;
    const dot = done ? '#111' : current ? '#b8892e' : '#ddd';
    const color = done || current ? '#111' : '#aaa';
    return `<td style="text-align:center;padding:0 2px;width:20%;">
      <div style="width:12px;height:12px;border-radius:50%;background:${dot};margin:0 auto 6px;${current ? 'box-shadow:0 0 0 4px #f3e6c9;' : ''}"></div>
      <div style="font-size:12px;color:${color};${current ? 'font-weight:600;' : ''}">${STEP_LABELS[s]}</div>
    </td>`;
  }).join('')}</tr></table>`;

  const trackingBlock = trackingNumber
    ? `<div style="margin-top:20px;padding:16px 20px;background:#f7f7f7;border-radius:8px;border:1px solid #eee;">
        <p style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#888;">Tracking details</p>
        <p style="margin:4px 0;font-size:14px;">Courier: <strong>${esc(carrierName || 'our courier partner')}</strong></p>
        <p style="margin:4px 0;font-size:14px;">Tracking number: <strong>${esc(trackingNumber)}</strong></p>
        ${courierUrl ? `<p style="margin:8px 0 0;font-size:13px;"><a href="${esc(courierUrl)}" style="color:#555;">Track with the courier</a></p>` : ''}
      </div>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(copy.heading)}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:0;">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
    <div style="background:#111;padding:24px 30px;">
      <h1 style="color:#fff;margin:0;font-size:22px;">${esc(copy.heading)}</h1>
    </div>
    <div style="padding:30px;">
      <p>Hi ${esc(name)},</p>
      <p>${esc(blurb)}</p>
      <p style="color:#555;">Order: <strong>${ref}</strong></p>
      ${strip}
      ${trackingBlock}
      ${orderUrl ? `<p style="margin:24px 0 0;"><a href="${esc(orderUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:15px;font-weight:600;">See your order</a></p>` : ''}
      <p style="font-size:13px;color:#999;margin-top:24px;">Questions? Contact us at ${esc(supportEmail)}.</p>
    </div>
    <div style="text-align:center;padding:20px;border-top:1px solid #eee;font-size:12px;color:#999;">
      <p style="margin:4px 0;">© ${new Date().getFullYear()} ${esc(companyName)}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject: copy.subject(ref), text, html };
}

export default { orderProgressEmail, STEP_LABELS, STILL_ON_IT_LINES, PROGRESS_EMAIL_KINDS };
