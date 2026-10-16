/**
 * Sales quotation — the PDF a salesperson sends a customer for a sales-panel order.
 *
 * ── ONE SOURCE OF TRUTH ─────────────────────────────────────────────────────────
 * A quotation is not a second pricing path. It is the order the salesperson
 * created (salesOrderService.createSalesOrder): every line was priced from the
 * catalogue and its offer checked there, and `order.totalAmount` is what the
 * payment link charges. This file only lays those numbers out. Nothing typed into
 * a PDF can show a price the customer would not actually pay.
 *
 * ── WHO MAY DOWNLOAD ────────────────────────────────────────────────────────────
 * The seller (their own orders), a sales head (every sales-panel order), an admin.
 * Same scope as the sales order list. A cancelled order has no quotation.
 */
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import AppError from '../utils/AppError.js';
import orderRepository from '../repositories/orderRepository.js';
import { companyInfo } from '../config/company.js';
import { QUOTATION_VALID_DAYS, QUOTATION_REMARKS } from '../config/quotation.js';
import { STAFF_TEAMS, canSell } from '../config/staff.js';
import { loadLogo, orderNumber, pdfFonts } from './invoiceService.js';
import { variantDisplayName } from '../utils/orderLines.js';
import { formatLongDateIST } from '../utils/datetime.js';
import { rupeesInWords } from '../utils/amountInWords.js';
import { publicEmail } from '../utils/customerContact.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

const DAY = 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const idOf = (v) => (v == null ? '' : String(v._id ?? v));

const isAdmin = (u) => u?.role === 'admin';
const isSales = (u) => u?.role === 'staff' && u.staff?.active === true && u.staff.team === STAFF_TEAMS.SALES;
const isSalesHead = (u) => isSales(u) && u.staff.isHead === true;

/** "#AB12CD34" → "QT-AB12CD34": the same reference the order carries, marked as a quote. */
export const quotationNumber = (order) => `QT-${String(orderNumber(order)).replace(/^#/, '')}`;

/**
 * Everything the quotation prints, from an order. Pure: no I/O, no clock unless
 * `now` is omitted — so the numbers can be asserted exactly.
 */
export function buildQuotation(order, { now = Date.now() } = {}) {
  const created = order.createdAt ? new Date(order.createdAt) : new Date(now);
  const lines = (order.items || []).map((it, i) => {
    const qty = Number(it.quantity) || 0;
    const offer = round2(it.price);
    // listPrice is stored only for a genuine markdown; otherwise the line sold at list.
    const list = it.listPrice != null && Number(it.listPrice) > offer ? round2(it.listPrice) : offer;
    return {
      n: i + 1,
      name: variantDisplayName(it.name, it.variantLabel),
      quantity: qty,
      listPrice: list,
      offerPrice: offer,
      discounted: list > offer,
      amount: round2(offer * qty),
      listAmount: round2(list * qty),
    };
  });
  const subtotalAtList = round2(lines.reduce((s, l) => s + l.listAmount, 0));
  const itemsTotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const shipping = round2(order.shippingCost);
  // The order's own total is what the customer is charged. The line sum is a
  // cross-check, never a replacement: if they ever disagree, print the charge.
  const total = round2(order.totalAmount);
  const consistent = Math.abs(itemsTotal + shipping - total) < 0.01;

  const addr = order.shippingAddress || {};
  const linkExpiry = order.paymentLinkExpiresAt ? new Date(order.paymentLinkExpiresAt) : null;
  const paid = order.paymentStatus === 'paid' || order.paymentStatus === 'refunded';
  const linkLive = !paid && order.status === 'awaiting_payment' && !!order.paymentLinkUrl
    && !!linkExpiry && linkExpiry.getTime() > now;

  return {
    number: quotationNumber(order),
    orderRef: orderNumber(order),
    date: created,
    validUntil: new Date(created.getTime() + QUOTATION_VALID_DAYS * DAY),
    customer: {
      name: order.user?.name || addr.fullName || 'Customer',
      phone: addr.phone || order.user?.phone || '',
      email: publicEmail(order.user?.email || order.guestEmail || ''),
      address: [
        addr.addressLine1,
        addr.addressLine2,
        [addr.city, addr.state].filter(Boolean).join(', '),
        addr.postalCode,
      ].filter(Boolean),
    },
    lines,
    subtotalAtList,
    discount: round2(subtotalAtList - itemsTotal),
    shipping,
    total,
    totalInWords: rupeesInWords(total),
    consistent,
    payment: {
      status: paid ? 'paid' : (linkLive ? 'link' : 'no_link'),
      url: linkLive ? order.paymentLinkUrl : null,
      linkExpiresAt: linkLive ? linkExpiry : null,
    },
    remarks: [...QUOTATION_REMARKS],
  };
}

// ── PDF ───────────────────────────────────────────────────────────────────────

const { HAS_UNICODE, FONT, FONT_BOLD, CURRENCY, unicodeFonts } = pdfFonts;

const C = {
  ink: '#111a16',
  body: '#3b4641',
  muted: '#6b7671',
  line: '#dfe5e2',
  zebra: '#f5f8f6',
  brand: '#0a5c33',
  brandDark: '#08331f',
  band: '#0d1612',
  gold: '#c9a870',
};

const money = (n) => `${CURRENCY} ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Render a quotation (from buildQuotation) to PDF bytes. */
export async function renderQuotationPdf(q) {
  const logo = await loadLogo();
  // Resolved before the synchronous pdfkit render, which cannot await.
  const qr = q.payment.url
    ? await QRCode.toBuffer(q.payment.url, { margin: 1, width: 300, errorCorrectionLevel: 'M' })
    : null;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `Quotation ${q.number}`, Author: companyInfo.name } });
      if (HAS_UNICODE) {
        doc.registerFont('body', unicodeFonts.regular);
        doc.registerFont('bold', unicodeFonts.bold);
      }
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = 595.28;
      const H = 841.89;
      const L = 42;
      const R = W - 42;
      const BOTTOM = H - 70;

      // ── Header band: logo + document title ──────────────────────────────────
      doc.rect(0, 0, W, 118).fill(C.band);
      doc.rect(0, 118, W, 4).fill(C.brand);
      let logoRight = L;
      if (logo) {
        try {
          const img = doc.openImage(logo);
          const scale = Math.min(170 / img.width, 56 / img.height);
          doc.image(logo, L, 30, { width: img.width * scale, height: img.height * scale });
          logoRight = L + img.width * scale;
        } catch { /* text header below still identifies the seller */ }
      }
      if (logoRight === L) {
        doc.font(FONT_BOLD).fontSize(20).fillColor('#fff').text('ROAVION', L, 40);
      }
      doc.font(FONT).fontSize(8.5).fillColor('#a9b8b0').text('Powered by AutoBacs India', L, 92);

      doc.font(FONT_BOLD).fontSize(26).fillColor('#fff').text('QUOTATION', 300, 30, { width: R - 300, align: 'right', characterSpacing: 2 });
      doc.font(FONT).fontSize(9).fillColor('#cfd9d4');
      doc.text(q.number, 300, 66, { width: R - 300, align: 'right' });
      doc.text(`Date: ${formatLongDateIST(q.date)}`, 300, doc.y + 2, { width: R - 300, align: 'right' });
      doc.fillColor(C.gold).text(`Valid until: ${formatLongDateIST(q.validUntil)}`, 300, doc.y + 2, { width: R - 300, align: 'right' });

      // ── From / To ───────────────────────────────────────────────────────────
      let y = 146;
      const colW = (R - L - 24) / 2;
      const block = (x, title, heading, lines) => {
        doc.font(FONT_BOLD).fontSize(7.5).fillColor(C.brand).text(title, x, y, { width: colW, characterSpacing: 1.2 });
        doc.font(FONT_BOLD).fontSize(11).fillColor(C.ink).text(heading, x, doc.y + 4, { width: colW });
        doc.font(FONT).fontSize(8.8).fillColor(C.body);
        lines.filter(Boolean).forEach((line) => doc.text(line, x, doc.y + 1.5, { width: colW }));
        return doc.y;
      };
      const fromBottom = block(L, 'FROM', companyInfo.name, [
        companyInfo.address,
        [companyInfo.city, companyInfo.pincode].filter(Boolean).join(' - '),
        companyInfo.state,
        [companyInfo.phone, companyInfo.email].filter(Boolean).join('  ·  '),
        companyInfo.gstin ? `GSTIN: ${companyInfo.gstin}` : null,
      ]);
      const toBottom = block(L + colW + 24, 'QUOTATION FOR', q.customer.name, [
        ...q.customer.address,
        q.customer.phone ? `Phone: ${q.customer.phone}` : null,
        q.customer.email ? `Email: ${q.customer.email}` : null,
      ]);
      y = Math.max(fromBottom, toBottom) + 16;

      // Order reference strip. The salesperson is deliberately NOT on the quotation:
      // the customer deals with the company, through its own phone and email.
      doc.roundedRect(L, y, R - L, 26, 6).fill(C.zebra);
      doc.font(FONT).fontSize(8.8).fillColor(C.muted).text(`Order ref ${q.orderRef}`, L + 12, y + 8, { width: R - L - 24, align: 'right' });
      y += 40;

      // ── Items table ─────────────────────────────────────────────────────────
      const col = {
        n: { x: L + 8, w: 18 },
        item: { x: L + 30, w: 178 },
        qty: { x: L + 210, w: 28 },
        list: { x: L + 240, w: 84 },
        offer: { x: L + 326, w: 84 },
        // Wide enough for ₹ 99,99,999.00 on one line.
        amount: { x: L + 412, w: R - L - 420 },
      };
      const header = () => {
        doc.roundedRect(L, y, R - L, 24, 4).fill(C.brand);
        doc.font(FONT_BOLD).fontSize(8.2).fillColor('#fff');
        doc.text('#', col.n.x, y + 8, { width: col.n.w });
        doc.text('ITEM', col.item.x, y + 8, { width: col.item.w });
        doc.text('QTY', col.qty.x, y + 8, { width: col.qty.w, align: 'center' });
        doc.text('PRICE', col.list.x, y + 8, { width: col.list.w, align: 'right' });
        doc.text('OFFER PRICE', col.offer.x, y + 8, { width: col.offer.w, align: 'right' });
        doc.text('AMOUNT', col.amount.x, y + 8, { width: col.amount.w, align: 'right' });
        y += 24;
      };
      header();

      q.lines.forEach((line, i) => {
        doc.font(FONT).fontSize(9);
        const nameH = doc.heightOfString(line.name, { width: col.item.w });
        const rowH = Math.max(26, nameH + 14);
        if (y + rowH > BOTTOM) {
          doc.addPage();
          y = 50;
          header();
        }
        if (i % 2 === 1) doc.rect(L, y, R - L, rowH).fill(C.zebra);
        const ty = y + 7;
        doc.fillColor(C.muted).font(FONT).fontSize(9).text(String(line.n), col.n.x, ty, { width: col.n.w });
        doc.fillColor(C.ink).text(line.name, col.item.x, ty, { width: col.item.w });
        doc.fillColor(C.body).text(String(line.quantity), col.qty.x, ty, { width: col.qty.w, align: 'center' });
        doc.fillColor(line.discounted ? C.muted : C.body)
          .text(money(line.listPrice), col.list.x, ty, { width: col.list.w, align: 'right', strike: line.discounted });
        doc.fillColor(line.discounted ? C.brand : C.body).font(line.discounted ? FONT_BOLD : FONT)
          .text(money(line.offerPrice), col.offer.x, ty, { width: col.offer.w, align: 'right' });
        doc.fillColor(C.ink).font(FONT_BOLD).text(money(line.amount), col.amount.x, ty, { width: col.amount.w, align: 'right' });
        y += rowH;
        doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(C.line).stroke();
      });

      // ── Totals ──────────────────────────────────────────────────────────────
      if (y + 150 > BOTTOM) { doc.addPage(); y = 50; }
      y += 14;
      const totalsTop = y;
      const tx = L + 300;
      const tw = R - tx;
      const row = (label, value, opts = {}) => {
        doc.font(opts.bold ? FONT_BOLD : FONT).fontSize(9.5).fillColor(opts.color || C.body)
          .text(label, tx, y, { width: tw / 2 });
        doc.text(value, tx + tw / 2, y, { width: tw / 2, align: 'right' });
        y += 17;
      };
      row('Subtotal', money(q.subtotalAtList));
      if (q.discount > 0) row('Your discount', `− ${money(q.discount)}`, { color: C.brand, bold: true });
      row('Delivery', q.shipping > 0 ? money(q.shipping) : 'Extra, as applicable');
      y += 4;
      doc.roundedRect(tx - 10, y, tw + 10, 34, 6).fill(C.brand);
      doc.font(FONT_BOLD).fontSize(11).fillColor('#fff').text('TOTAL', tx, y + 11, { width: 60 });
      // The figure gets the rest of the box, shrinking for a crore-sized total
      // rather than wrapping its paise onto a second line.
      const totalText = money(q.total);
      const totalW = tw - 60 - 10; // 10pt inside the box's right edge
      let size = 14;
      while (size > 9 && doc.font(FONT_BOLD).fontSize(size).widthOfString(totalText) > totalW) size -= 0.5;
      doc.fontSize(size).text(totalText, tx + 60, y + 17 - size / 2, { width: totalW, align: 'right', lineBreak: false });
      y += 44;
      doc.font(FONT).fontSize(8.6).fillColor(C.body).text(q.totalInWords, tx - 10, y, { width: tw + 10, align: 'right' });

      // Payment box (left of the totals, top-aligned with them)
      const py = totalsTop;
      const pw = 270;
      doc.roundedRect(L, py, pw, 128, 8).lineWidth(0.8).strokeColor(C.line).stroke();
      if (q.payment.status === 'paid') {
        doc.font(FONT_BOLD).fontSize(20).fillColor(C.brand).text('PAID', L + 16, py + 34, { width: pw - 32 });
        doc.font(FONT).fontSize(9).fillColor(C.body).text('Payment received — thank you. Your order is being prepared.', L + 16, doc.y + 4, { width: pw - 32 });
      } else if (q.payment.status === 'link' && qr) {
        doc.image(qr, L + 12, py + 12, { width: 104, height: 104 });
        const bx = L + 126;
        const bw = pw - 140;
        doc.font(FONT_BOLD).fontSize(10.5).fillColor(C.ink).text('Scan to pay securely', bx, py + 18, { width: bw });
        doc.font(FONT).fontSize(8.4).fillColor(C.body)
          .text('UPI, cards and net banking via Razorpay.', bx, doc.y + 3, { width: bw })
          .text(`Link valid until ${formatLongDateIST(q.payment.linkExpiresAt)}.`, bx, doc.y + 3, { width: bw });
        doc.fillColor(C.brand).text('Open payment link', bx, doc.y + 6, { width: bw, link: q.payment.url, underline: true });
      } else {
        doc.font(FONT_BOLD).fontSize(10.5).fillColor(C.ink).text('Ready to order?', L + 16, py + 22, { width: pw - 32 });
        doc.font(FONT).fontSize(8.8).fillColor(C.body)
          .text(`Contact our sales team${companyInfo.phone ? ` on ${companyInfo.phone}` : ''} for a secure payment link.`, L + 16, doc.y + 4, { width: pw - 32 });
      }

      // ── Remarks ─────────────────────────────────────────────────────────────
      y = Math.max(y + 14, py + 128) + 18;
      if (y + 90 > BOTTOM) { doc.addPage(); y = 50; }
      doc.font(FONT_BOLD).fontSize(8).fillColor(C.brand).text('TERMS & REMARKS', L, y, { characterSpacing: 1.2 });
      doc.font(FONT).fontSize(8.6).fillColor(C.body);
      q.remarks.forEach((r) => doc.text(`•  ${r}`, L, doc.y + 4, { width: R - L }));

      // ── Footer on every page ────────────────────────────────────────────────
      const range = doc.bufferedPageRange();
      for (let p = range.start; p < range.start + range.count; p += 1) {
        doc.switchToPage(p);
        doc.rect(0, H - 46, W, 46).fill(C.band);
        doc.font(FONT).fontSize(8).fillColor('#cfd9d4').text(
          `Thank you for choosing ${companyInfo.name}.  ${[companyInfo.phone, companyInfo.email].filter(Boolean).join('  ·  ')}`,
          L, H - 32, { width: R - L - 120, lineBreak: false },
        );
        doc.fillColor('#8fa198').text(`${q.number} · page ${p - range.start + 1} of ${range.count}`, R - 140, H - 32, { width: 140, align: 'right', lineBreak: false });
        doc.fillColor('#8fa198').fontSize(7).text('This is a quotation, not a tax invoice.', L, H - 19, { width: R - L, lineBreak: false });
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * The quotation PDF for one sales-panel order, for someone allowed to see it.
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
export async function getQuotationPdf(actor, orderId) {
  if (!isAdmin(actor) && !canSell(actor)) throw fail('Not authorized.', 403);
  const order = await orderRepository.findById(orderId, [
    { path: 'user', select: 'name email phone' },
    { path: 'salesUser', select: 'name phone' },
  ]);
  if (!order || !order.salesUser) throw fail('Order not found.', 404);
  if (!isAdmin(actor) && !isSalesHead(actor) && idOf(order.salesUser) !== idOf(actor._id)) {
    throw fail('You can only download quotations for your own orders.', 403);
  }
  if (order.status === 'cancelled') throw fail('This order was cancelled — it has no quotation.', 409);

  const q = buildQuotation(order);
  if (!q.consistent) {
    // Printed anyway with the charged total; flag it so the mismatch is investigated.
    console.warn(`[Quotation] line total + delivery differs from order total on ${q.orderRef}`);
  }
  const buffer = await renderQuotationPdf(q);
  return { buffer, filename: `Quotation-${q.number}.pdf` };
}
