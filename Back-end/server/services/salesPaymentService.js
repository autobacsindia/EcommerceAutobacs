/**
 * Requesting payment on a quotation-first GTM order — in one or more PARTS.
 *
 * An accepted quotation becomes an order with no payment link
 * (salesQuotationService.acceptQuotation). Here GTM asks for the money:
 *   - one part for the whole total, or several (e.g. to stay under Razorpay's
 *     per-payment limit); each part is its own Razorpay link (48 h);
 *   - the live parts (paid + waiting) must add up EXACTLY to the order total —
 *     no part can be requested that would take the order past it;
 *   - a waiting part can be cancelled and the balance requested again.
 *
 * Money is confirmed ONLY by the verified payment_link.paid webhook
 * (razorpayService.processPaymentPart) or the reconciliation sweep that replays
 * it; nothing here marks anything paid.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import razorpayService from './razorpayService.js';
import orderRepository from '../repositories/orderRepository.js';
import { PAYMENT_LINK_TTL_MS } from './offlineOrderService.js';
import { STAFF_TEAMS, canSell } from '../config/staff.js';
import { publicEmail } from '../utils/customerContact.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const paise = (rupees) => Math.round(Number(rupees) * 100);

export const MAX_PARTS = 10;

const isSalesHead = (u) => u?.role === 'staff' && u.staff?.active === true
  && u.staff.team === STAFF_TEAMS.SALES && u.staff.isHead === true;

/** A part's status as a person should see it: a waiting link past its expiry is expired. */
export const partStatus = (p, now = Date.now()) =>
  (p.status === 'pending' && new Date(p.expiresAt).getTime() <= now ? 'expired' : p.status);

/** Parts that still count towards the total: paid, or waiting and not expired. */
const liveParts = (order, now = Date.now()) =>
  (order.paymentParts || []).filter((p) => ['paid', 'pending'].includes(partStatus(p, now)));

/** The payment picture of an order, for the panel. */
export function paymentSummary(order, now = Date.now()) {
  const parts = (order.paymentParts || []).map((p, i) => {
    const status = partStatus(p, now);
    return {
      id: idOf(p._id),
      n: i + 1,
      amount: p.amount,
      status,
      url: status === 'pending' ? p.linkUrl : null,
      expiresAt: p.expiresAt,
      paidAt: p.paidAt || null,
    };
  });
  const paid = parts.filter((p) => p.status === 'paid').reduce((s, p) => s + paise(p.amount), 0);
  const requested = parts.filter((p) => ['paid', 'pending'].includes(p.status)).reduce((s, p) => s + paise(p.amount), 0);
  const total = paise(order.totalAmount);
  return {
    parts,
    amountPaid: paid / 100,
    amountRequested: requested / 100,
    amountToRequest: Math.max(0, total - requested) / 100,
  };
}

async function loadForPayment(actor, orderId) {
  if (!canSell(actor)) throw fail('Not authorized.', 403);
  if (!mongoose.isValidObjectId(orderId)) throw fail('Order not found.', 404);
  const order = await orderRepository.findById(orderId, [{ path: 'user', select: 'name email phone' }]);
  if (!order || !order.salesUser) throw fail('Order not found.', 404);
  if (!isSalesHead(actor) && idOf(order.salesUser) !== idOf(actor._id)) {
    throw fail('You can only request payment on your own orders.', 403);
  }
  if (order.paymentLinkId) {
    throw fail('This order already has a payment link from the old flow — manage it from the order list.', 409);
  }
  return order;
}

/**
 * Request payment in parts. `amounts` are rupees; together with the parts already
 * paid or waiting they must equal the order total exactly.
 */
export async function requestPayment(actor, orderId, amounts, req) {
  const order = await loadForPayment(actor, orderId);
  if (order.paymentStatus !== 'pending' || order.status !== 'awaiting_payment') {
    throw fail('This order is already paid or closed.', 409);
  }

  const wanted = (Array.isArray(amounts) ? amounts : []).map((a) => paise(a));
  if (wanted.length === 0) throw fail('Enter at least one amount.', 400);
  if (wanted.some((a) => !Number.isFinite(a) || a < 100)) throw fail('Each part must be at least ₹1.', 400);

  const now = Date.now();
  const existingLive = liveParts(order, now);
  if (existingLive.length + wanted.length > MAX_PARTS) {
    throw fail(`An order can be paid in at most ${MAX_PARTS} parts.`, 400);
  }
  const already = existingLive.reduce((s, p) => s + paise(p.amount), 0);
  const total = paise(order.totalAmount);
  const asking = wanted.reduce((s, a) => s + a, 0);
  if (already + asking !== total) {
    const remaining = (total - already) / 100;
    throw fail(
      `The parts must add up to the amount still to request: ₹${remaining.toLocaleString('en-IN')} `
      + `(you entered ₹${(asking / 100).toLocaleString('en-IN')}).`,
      400,
    );
  }

  // Create every link; if Razorpay refuses one, cancel the ones made in this batch.
  const everMade = (order.paymentParts || []).length;
  const customer = {
    name: order.shippingAddress?.fullName || order.user?.name,
    email: publicEmail(order.user?.email || order.guestEmail) || undefined,
    phone: order.shippingAddress?.phone || order.user?.phone,
  };
  const ofCount = existingLive.length + wanted.length;
  const made = [];
  try {
    for (let i = 0; i < wanted.length; i += 1) {
      const amount = wanted[i] / 100;
      const link = await razorpayService.createPaymentLink(order, customer, {
        part: { amount, ref: everMade + i + 1, index: existingLive.length + i + 1, of: ofCount },
      });
      made.push({
        amount,
        linkId: link.id,
        linkUrl: link.shortUrl,
        expiresAt: new Date(Date.now() + PAYMENT_LINK_TTL_MS),
        status: 'pending',
        createdBy: actor._id,
        createdAt: new Date(),
      });
    }
  } catch (err) {
    await Promise.all(made.map((p) => razorpayService.cancelPaymentLink(p.linkId).catch(() => {})));
    if (/maximum amount/i.test(err.message || '')) {
      throw fail(
        'Razorpay refused one of these amounts as more than it allows in one payment on our account. '
        + 'Split it into smaller parts (or ask Accounts to get the limit raised). No links were sent.',
        422,
      );
    }
    throw fail(`Could not create the payment links: ${err.message}`, 502);
  }

  // Save only if nobody else changed the parts meanwhile (the count is the guard).
  const saved = await orderRepository.model.findOneAndUpdate(
    {
      _id: order._id,
      paymentStatus: 'pending',
      status: 'awaiting_payment',
      ...(everMade === 0 ? { $or: [{ paymentParts: { $exists: false } }, { paymentParts: { $size: 0 } }] } : { paymentParts: { $size: everMade } }),
    },
    { $push: { paymentParts: { $each: made } } },
    { new: true },
  ).populate('user', 'name email phone');
  if (!saved) {
    await Promise.all(made.map((p) => razorpayService.cancelPaymentLink(p.linkId).catch(() => {})));
    throw fail('Someone else changed the payment requests on this order just now — reload and try again.', 409);
  }

  auditLogger.logAction(req, 'UPDATE', 'Order', order._id, {
    change: 'payment_parts_requested', parts: made.map((p) => p.amount), total: order.totalAmount,
  });
  return paymentSummary(saved);
}

/** Cancel a waiting part, so its amount can be requested again. */
export async function cancelPart(actor, orderId, partId, req) {
  const order = await loadForPayment(actor, orderId);
  const part = (order.paymentParts || []).find((p) => idOf(p._id) === String(partId));
  if (!part) throw fail('Payment part not found.', 404);
  if (part.status === 'paid') throw fail('This part is already paid.', 409);
  if (part.status === 'cancelled') return paymentSummary(order);

  if (partStatus(part) === 'pending') {
    try {
      await razorpayService.cancelPaymentLink(part.linkId);
    } catch (err) {
      // Razorpay refuses to cancel a link that was just paid — the webhook will
      // record it; never offer that amount again.
      throw fail(`Could not cancel this link — it may have just been paid. Reload in a minute. (${err.message})`, 409);
    }
  }
  const saved = await orderRepository.model.findOneAndUpdate(
    { _id: order._id, paymentParts: { $elemMatch: { _id: part._id, status: { $in: ['pending', 'expired'] } } } },
    { $set: { 'paymentParts.$.status': 'cancelled', 'paymentParts.$.cancelledAt': new Date() } },
    { new: true },
  );
  if (!saved) throw fail('This part changed just now — reload it.', 409);
  auditLogger.logAction(req, 'UPDATE', 'Order', order._id, { change: 'payment_part_cancelled', amount: part.amount });
  return paymentSummary(saved);
}

/**
 * Cancel every waiting part (used when the whole unpaid order is cancelled).
 * Refuses if any part is already paid: money has been taken.
 */
export async function retireAllParts(order) {
  const parts = order.paymentParts || [];
  if (parts.some((p) => p.status === 'paid')) {
    throw fail('Part of this order is already paid — it cannot simply be cancelled. Ask an admin to refund the paid part.', 409);
  }
  for (const p of parts) {
    if (partStatus(p) === 'pending') {
      try {
        await razorpayService.cancelPaymentLink(p.linkId);
      } catch (err) {
        throw fail(`Could not cancel a payment link — it may have just been paid. Reload in a minute. (${err.message})`, 409);
      }
    }
  }
}

export default { requestPayment, cancelPart, paymentSummary, retireAllParts };

// ── Payment request PDF ─────────────────────────────────────────────────────

/**
 * The page GTM sends once the customer accepts: the order, then every payment
 * part with its amount and status — and, for each waiting part, a scan-to-pay QR
 * and its link. Built from the order on the server, so it cannot differ from
 * what each link charges.
 */
export async function getPaymentRequestPdf(actor, orderId) {
  const order = await loadForPayment(actor, orderId);
  if (order.status === 'cancelled') throw fail('This order was cancelled.', 409);
  const summary = paymentSummary(order);
  if (summary.parts.length === 0) throw fail('Request payment first — there are no payment links yet.', 409);

  const [{ default: PDFDocument }, { default: QRCode }, invoice, { companyInfo }, { formatLongDateIST }] = await Promise.all([
    import('pdfkit'), import('qrcode'), import('./invoiceService.js'), import('../config/company.js'), import('../utils/datetime.js'),
  ]);
  const { loadLogo, orderNumber, pdfFonts } = invoice;
  const { HAS_UNICODE, FONT, FONT_BOLD, CURRENCY, unicodeFonts } = pdfFonts;
  const logo = await loadLogo();
  const ref = orderNumber(order);
  const money = (n) => `${CURRENCY} ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const qrs = await Promise.all(summary.parts.map((p) => (p.url
    ? QRCode.toBuffer(p.url, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
    : null)));
  const STATUS = { paid: 'PAID', pending: 'WAITING FOR PAYMENT', expired: 'LINK EXPIRED', cancelled: 'CANCELLED' };

  const buffer = await new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `Payment request ${ref}`, Author: companyInfo.name } });
      if (HAS_UNICODE) { doc.registerFont('body', unicodeFonts.regular); doc.registerFont('bold', unicodeFonts.bold); }
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = 595.28; const H = 841.89; const L = 42; const R = W - 42;
      doc.rect(0, 0, W, 110).fill('#0d1612');
      doc.rect(0, 110, W, 4).fill('#0a5c33');
      if (logo) {
        try {
          const img = doc.openImage(logo);
          const scale = Math.min(160 / img.width, 52 / img.height);
          doc.image(logo, L, 28, { width: img.width * scale, height: img.height * scale });
        } catch { /* title below still identifies the company */ }
      }
      doc.font(FONT_BOLD).fontSize(22).fillColor('#fff').text('PAYMENT REQUEST', 280, 30, { width: R - 280, align: 'right', characterSpacing: 1.5 });
      doc.font(FONT).fontSize(9).fillColor('#cfd9d4')
        .text(`Order ${ref}`, 280, 62, { width: R - 280, align: 'right' })
        .text(`Date: ${formatLongDateIST(new Date())}`, 280, doc.y + 2, { width: R - 280, align: 'right' });

      let y = 140;
      const name = order.shippingAddress?.fullName || order.user?.name || 'Customer';
      doc.font(FONT_BOLD).fontSize(12).fillColor('#111a16').text(`Dear ${name},`, L, y);
      doc.font(FONT).fontSize(9.5).fillColor('#3b4641').text(
        `Thank you for confirming your order. The total of ${money(order.totalAmount)} is collected in `
        + `${summary.parts.length === 1 ? 'one payment' : `${summary.parts.length} payments`}, each a secure Razorpay link `
        + '(UPI, cards and net banking). Please pay each waiting part below — scan its code or open its link.',
        L, doc.y + 6, { width: R - L },
      );
      y = doc.y + 16;

      // Summary strip
      doc.roundedRect(L, y, R - L, 40, 6).fill('#f5f8f6');
      doc.font(FONT).fontSize(8.5).fillColor('#6b7671')
        .text('ORDER TOTAL', L + 14, y + 8).text('RECEIVED', L + 190, y + 8).text('STILL TO PAY', L + 360, y + 8);
      doc.font(FONT_BOLD).fontSize(11).fillColor('#111a16')
        .text(money(order.totalAmount), L + 14, y + 21)
        .text(money(summary.amountPaid), L + 190, y + 21)
        .text(money(Math.max(0, order.totalAmount - summary.amountPaid)), L + 360, y + 21);
      y += 58;

      summary.parts.forEach((p, i) => {
        const boxH = qrs[i] ? 128 : 54;
        if (y + boxH > H - 80) { doc.addPage(); y = 50; }
        doc.roundedRect(L, y, R - L, boxH, 8).lineWidth(0.8).strokeColor('#dfe5e2').stroke();
        doc.font(FONT_BOLD).fontSize(11).fillColor('#111a16').text(`Payment ${p.n} of ${summary.parts.length}`, L + 16, y + 14);
        doc.font(FONT_BOLD).fontSize(15).fillColor('#0a5c33').text(money(p.amount), L + 16, y + 32);
        doc.font(FONT_BOLD).fontSize(8.5).fillColor(p.status === 'paid' ? '#0a5c33' : p.status === 'pending' ? '#b45309' : '#6b7671')
          .text(STATUS[p.status] || p.status.toUpperCase(), L + 200, y + 16, { characterSpacing: 0.8 });
        if (p.status === 'paid' && p.paidAt) {
          doc.font(FONT).fontSize(8.5).fillColor('#3b4641').text(`Received ${formatLongDateIST(p.paidAt)} — thank you.`, L + 200, y + 32);
        }
        if (qrs[i]) {
          doc.image(qrs[i], R - 120, y + 12, { width: 104, height: 104 });
          doc.font(FONT).fontSize(8.5).fillColor('#3b4641')
            .text('Scan to pay, or open:', L + 200, y + 34, { width: R - 140 - (L + 200) })
            .fillColor('#0a5c33').text(p.url, L + 200, doc.y + 3, { width: R - 140 - (L + 200), link: p.url, underline: true })
            .fillColor('#6b7671').text(`Link valid until ${formatLongDateIST(p.expiresAt)}.`, L + 200, doc.y + 6, { width: R - 140 - (L + 200) });
        }
        y += boxH + 12;
      });

      if (y + 60 > H - 80) { doc.addPage(); y = 50; }
      doc.font(FONT).fontSize(8.5).fillColor('#6b7671').text(
        'Your order is confirmed and prepared once every part is paid. You receive a payment receipt by SMS/email '
        + `from Razorpay for each part. Questions? Call ${companyInfo.phone || 'our sales team'}.`,
        L, y + 6, { width: R - L },
      );

      const range = doc.bufferedPageRange();
      for (let pg = range.start; pg < range.start + range.count; pg += 1) {
        doc.switchToPage(pg);
        doc.rect(0, H - 40, W, 40).fill('#0d1612');
        doc.font(FONT).fontSize(8).fillColor('#cfd9d4').text(
          `${companyInfo.name}  ·  ${[companyInfo.phone, companyInfo.email].filter(Boolean).join('  ·  ')}`,
          L, H - 25, { width: R - L - 120, lineBreak: false },
        );
        doc.fillColor('#8fa198').text(`${ref} · page ${pg - range.start + 1} of ${range.count}`, R - 140, H - 25, { width: 140, align: 'right', lineBreak: false });
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
  return { buffer, filename: `Payment-request-${String(ref).replace(/^#/, '')}.pdf` };
}
