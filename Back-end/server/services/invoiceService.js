/**
 * Invoice Service
 *
 * Generates a PDF invoice/receipt from an already-paid Order and emails it to the
 * customer. Runs off the BullMQ notifications queue (job `send-order-invoice`),
 * never in the request path — PDF generation is CPU work and email is slow.
 *
 * Money: every amount on the Order is already stored in rupees by
 * services/pricingService.js (the single source of truth). This service does NOT
 * re-price — it only formats what the Order already carries.
 *
 * Storage is optional: the PDF is always attached to the email. When
 * INVOICE_STORE_CLOUDINARY=true it is also uploaded to Cloudinary (resource_type
 * 'raw') so it can be re-downloaded later; failure to upload never blocks the email.
 */

import PDFDocument from 'pdfkit';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cloudinary from '../config/cloudinary.js';
import orderRepository from '../repositories/orderRepository.js';
import emailHandler from './emailHandler.js';
import { companyInfo } from '../config/company.js';
import counterRepository from '../repositories/counterRepository.js';
import { formatInvoiceNumber, invoiceFileName } from '../utils/invoiceFormat.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Bundled Unicode font (ships in the Docker image via `COPY . .`) ────────────
// pdfkit's built-in Helvetica is WinAnsi-only and lacks the ₹ (U+20B9) glyph, so
// invoices need an embedded TrueType font. DejaVu Sans is redistributable and
// pdfkit subsets it on embed (only the used glyphs land in the PDF). If the files
// are ever missing we degrade to Helvetica + an "Rs." prefix rather than crash.
const FONT_DIR = join(__dirname, '..', 'assets', 'fonts');
let unicodeFonts = null;
try {
  unicodeFonts = {
    regular: readFileSync(join(FONT_DIR, 'DejaVuSans.ttf')),
    bold: readFileSync(join(FONT_DIR, 'DejaVuSans-Bold.ttf')),
  };
} catch (err) {
  console.warn(`[Invoice] Unicode fonts unavailable, falling back to Helvetica/Rs.: ${err.message}`);
}
const HAS_UNICODE = Boolean(unicodeFonts);
const FONT = HAS_UNICODE ? 'body' : 'Helvetica';
const FONT_BOLD = HAS_UNICODE ? 'bold' : 'Helvetica-Bold';
const CURRENCY = HAS_UNICODE ? '₹' : 'Rs.';

// Invoice-number display + filename formatting live in utils/invoiceFormat.js so
// the confirmation email renders the exact same identifier. Re-exported here for
// existing importers (controllers, tests).
export const invoiceNumber = formatInvoiceNumber;
export { invoiceFileName };

/**
 * Assign the next sequential invoice number to an order if it does not yet have
 * one, mutating `order.invoiceNo` in place (the caller persists it). Idempotent:
 * an order that already carries a number keeps it, so re-issues/retries never
 * burn a new number. Atomic via the "invoice" Counter.
 * @param {Object} order - Mongoose Order document
 * @returns {Promise<number>} the order's invoice number
 */
export const assignInvoiceNumber = async (order) => {
  if (order.invoiceNo != null) return order.invoiceNo;
  order.invoiceNo = await counterRepository.next('invoice');
  return order.invoiceNo;
};

/** Order reference shown on the invoice: WooCommerce number for migrated orders, else the _id suffix. */
export const orderNumber = (order) =>
  order.wpId ? `#${order.wpId}` : `#${order._id.toString().slice(-8).toUpperCase()}`;

/** Rupee formatting for the PDF (₹ when the Unicode font is embedded, else "Rs."). */
const rs = (n) =>
  `${CURRENCY} ${Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Long human date, e.g. "July 2, 2026", matching the reference invoice. */
const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

// ── Company logo (fetched from the navbar's Cloudinary asset, cached) ──────────
// pdfkit only embeds PNG/JPEG, so the configured URL is normalised to f_png for
// Cloudinary assets. The buffer is fetched at most once per process on success;
// on any failure we return null (text-only header) and retry on the next invoice.
let cachedLogo;
const pngUrl = (url) => {
  if (!url || !url.includes('/upload/')) return url;
  // Rewrite an existing format token (e.g. f_auto → f_png); else inject f_png as a
  // leading transformation. Preserves other transforms, the version, and the path.
  if (/[/,]f_[a-z0-9]+/i.test(url)) return url.replace(/([/,])f_[a-z0-9]+/i, '$1f_png');
  return url.replace('/upload/', '/upload/f_png/');
};

const loadLogo = async () => {
  if (cachedLogo !== undefined) return cachedLogo; // cached success (Buffer) or explicit null-config
  const url = pngUrl(companyInfo.logoUrl);
  if (!url) return (cachedLogo = null);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  timer.unref?.(); // never let the abort timer keep the event loop (or Jest) alive
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const isPng = buf.subarray(0, 4).toString('hex') === '89504e47';
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    if (!isPng && !isJpeg) throw new Error('unsupported image format');
    cachedLogo = buf; // cache only on success so transient failures retry next time
    return cachedLogo;
  } catch (err) {
    console.warn(`[Invoice] Logo fetch failed, rendering text header: ${err.message}`);
    return null; // not cached — retry on the next invoice
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Build the invoice PDF for an order. Mirrors the ROAVION reference invoice:
 * logo + seller block header, bill-to / meta columns, a dark items table, and a
 * totals summary. Shipping is rendered as "extra, paid on delivery" when the
 * order carries no shipping charge (the common case), otherwise the real amount.
 * @param {Object} order - Mongoose Order document (or plain object)
 * @param {Object} [user] - User document for name/email fallback
 * @returns {Promise<Buffer>} PDF file bytes
 */
export const generateInvoicePdf = async (order, user = null) => {
  const logo = await loadLogo();

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      if (HAS_UNICODE) {
        doc.registerFont('body', unicodeFonts.regular);
        doc.registerFont('bold', unicodeFonts.bold);
      }
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const LEFT = 50;
      const RIGHT = 545; // A4 width (595.28) minus the 50pt right margin
      const addr = order.shippingAddress || {};
      const created = order.createdAt ? new Date(order.createdAt) : new Date();
      const shippingExtra = !(Number(order.shippingCost) > 0);

      // ── Header: logo (left) + seller identity (right) ────────────────────────
      const headerTop = 45;
      if (logo) {
        try {
          doc.image(logo, LEFT, headerTop, { fit: [150, 60] });
        } catch (err) {
          console.warn(`[Invoice] Logo embed failed: ${err.message}`);
        }
      }

      const sellerX = 320;
      const sellerW = RIGHT - sellerX;
      doc.font(FONT_BOLD).fontSize(11).fillColor('#111')
        .text('ROAVION – Powered by AutoBacs India', sellerX, headerTop, { width: sellerW });
      doc.font(FONT).fontSize(9).fillColor('#444');
      [
        companyInfo.name,
        companyInfo.address,
        [companyInfo.city, companyInfo.pincode].filter(Boolean).join(' '),
        [companyInfo.state, addr.country || 'India'].filter(Boolean).join(', '),
        companyInfo.phone,
        companyInfo.email,
        companyInfo.gstin ? `GSTIN: ${companyInfo.gstin}` : null,
      ].filter(Boolean).forEach((line) => doc.text(line, sellerX, doc.y, { width: sellerW }));

      // ── Invoice title ────────────────────────────────────────────────────────
      let y = Math.max(doc.y, headerTop + 66) + 24;
      doc.font(FONT_BOLD).fontSize(28).fillColor('#111').text('INVOICE', LEFT, y);
      y = doc.y + 16;

      // ── Bill-to (left) + invoice meta (right) ────────────────────────────────
      const billTop = y;
      doc.font(FONT_BOLD).fontSize(10).fillColor('#111')
        .text(addr.fullName || user?.name || 'Customer', LEFT, billTop, { width: 250 });
      doc.font(FONT).fontSize(9).fillColor('#444');
      const recipientEmail = user?.email || order.guestEmail;
      [
        addr.addressLine1,
        addr.addressLine2,
        [addr.city, addr.postalCode].filter(Boolean).join(' '),
        addr.state,
        recipientEmail,
        addr.phone,
      ].filter(Boolean).forEach((line) => doc.text(line, LEFT, doc.y, { width: 250 }));
      const billBottom = doc.y;

      const metaLabelX = 330;
      const metaValueX = 425;
      const metaValueW = RIGHT - metaValueX;
      let my = billTop;
      const metaRow = (label, value) => {
        const rowTop = my;
        doc.font(FONT_BOLD).fontSize(9).fillColor('#555')
          .text(label, metaLabelX, rowTop, { width: metaValueX - metaLabelX - 6 });
        doc.font(FONT).fillColor('#222')
          .text(value, metaValueX, rowTop, { width: metaValueW });
        my = Math.max(my, doc.y) + 4;
      };
      metaRow('Invoice Number:', invoiceNumber(order));
      metaRow('Invoice Date:', fmtDate(new Date()));
      metaRow('Order Number:', orderNumber(order));
      metaRow('Order Date:', fmtDate(created));
      metaRow('Payment Method:', 'Credit Card/Debit Card/NetBanking/UPI');

      y = Math.max(billBottom, my) + 24;

      // ── Items table (dark header bar) ────────────────────────────────────────
      const col = { product: LEFT + 10, qty: 350, price: 450 };
      const priceW = RIGHT - 10 - col.price; // 10pt inset off the right margin
      doc.rect(LEFT, y, RIGHT - LEFT, 24).fill('#111');
      doc.font(FONT_BOLD).fontSize(10).fillColor('#fff');
      doc.text('Product', col.product, y + 7);
      doc.text('Quantity', col.qty, y + 7);
      doc.text('Price', col.price, y + 7, { width: priceW, align: 'right' });
      y += 24;

      (order.items || []).forEach((it) => {
        const qty = it.quantity || 0;
        const lineTotal = qty * (it.price || 0);
        const name = it.name || 'Item';
        const rowTop = y + 6;
        doc.font(FONT).fontSize(9).fillColor('#333');
        doc.text(name, col.product, rowTop, { width: col.qty - col.product - 10 });
        const rowHeight = doc.heightOfString(name, { width: col.qty - col.product - 10 });
        doc.text(String(qty), col.qty, rowTop);
        doc.text(rs(lineTotal), col.price, rowTop, { width: priceW, align: 'right' });
        y = rowTop + Math.max(rowHeight, 12) + 6;
        doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor('#e5e5e5').lineWidth(1).stroke();
        if (y > 690) {
          doc.addPage();
          y = 50;
        }
      });

      // ── Totals summary (right-aligned rows) ──────────────────────────────────
      const sumLabelX = 300;
      const sumLabelW = 145;
      const sumValueX = 450;
      const sumValueW = RIGHT - 10 - sumValueX; // align values to the table's price inset
      y += 6;
      const sumRow = (label, value, opts = {}) => {
        const rowTop = y;
        const size = opts.big ? 11 : 9;
        doc.font(FONT_BOLD).fontSize(size).fillColor('#111')
          .text(label, sumLabelX, rowTop, { width: sumLabelW, align: 'right' });
        doc.font(opts.big ? FONT_BOLD : FONT).fontSize(size).fillColor(opts.muted ? '#666' : '#111')
          .text(value, sumValueX, rowTop, { width: sumValueW, align: 'right' });
        y = Math.max(rowTop + size + 6, doc.y + 4);
      };

      sumRow('Subtotal:', rs(order.subtotal));
      if (order.couponDiscount)
        sumRow(`Coupon${order.couponCode ? ` (${order.couponCode})` : ''}:`, `- ${rs(order.couponDiscount)}`);
      if (order.karmaDiscount) sumRow('Karma points:', `- ${rs(order.karmaDiscount)}`);
      if (order.tax) sumRow('Tax (incl.):', rs(order.tax));
      sumRow(
        'Shipping Charges (Extra):',
        shippingExtra ? 'Shipping charges extra' : rs(order.shippingCost),
        { muted: shippingExtra }
      );
      doc.moveTo(sumLabelX, y).lineTo(RIGHT, y).strokeColor('#111').lineWidth(1).stroke();
      y += 6;
      sumRow(
        shippingExtra ? 'Total (Excluding Shipping Charges):' : 'Total:',
        rs(order.totalAmount),
        { big: true }
      );

      // ── Footer note ──────────────────────────────────────────────────────────
      if (shippingExtra) {
        y += 16;
        doc.font(FONT_BOLD).fontSize(9).fillColor('#333')
          .text('* Note: ', LEFT, y, { continued: true })
          .font(FONT).fillColor('#555')
          .text('Shipping to be paid at the time of delivery.');
      }

      doc.font(FONT).fontSize(8).fillColor('#999').text(
        'This is a computer-generated invoice and does not require a signature.',
        LEFT,
        790,
        { align: 'center', width: RIGHT - LEFT }
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

/**
 * Best-effort upload of the invoice PDF to Cloudinary (resource_type 'raw').
 * Gated by INVOICE_STORE_CLOUDINARY=true. Never throws — returns null on failure.
 * @returns {Promise<{url: string, publicId: string}|null>}
 */
export const uploadInvoicePdf = (buffer, order) => {
  if (process.env.INVOICE_STORE_CLOUDINARY !== 'true') return Promise.resolve(null);

  return new Promise((resolve) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: process.env.INVOICE_CLOUDINARY_FOLDER || 'invoices',
        resource_type: 'raw',
        public_id: invoiceNumber(order),
        overwrite: true,
      },
      (error, result) => {
        if (error) {
          console.error(`[Invoice] Cloudinary upload failed for ${invoiceNumber(order)}: ${error.message}`);
          return resolve(null);
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
};

/**
 * Orchestrator: load the order, generate + (optionally) store the invoice, and
 * email it to the customer exactly once. Idempotent via order.invoiceEmailedAt.
 * Called by the notifications worker on `send-order-invoice`.
 * @param {string} orderId
 * @returns {Promise<{status: 'sent'|'skipped'|'no-recipient'|'not-found'}>}
 */
export const emailOrderInvoice = async (orderId) => {
  const order = await orderRepository.findById(orderId, [{ path: 'user', select: 'name email' }]);
  if (!order) return { status: 'not-found' };
  if (order.invoiceEmailedAt) return { status: 'skipped' };

  const user = order.user && typeof order.user === 'object' ? order.user : null;
  const to = user?.email || order.guestEmail;
  if (!to) {
    console.warn(`[Invoice] No recipient email for order ${orderId} — skipping invoice email`);
    return { status: 'no-recipient' };
  }

  // Atomically claim the send slot BEFORE doing any work, so two concurrent jobs
  // can't both pass the null-check above and double-send. Loser skips. (BE-2)
  const claimed = await orderRepository.claimInvoiceEmail(orderId);
  if (!claimed) return { status: 'skipped' };
  // Keep the in-memory doc in sync with the DB claim so the success-path save below
  // doesn't overwrite the stamped timestamp with null.
  order.invoiceEmailedAt = new Date();

  try {
    // Issue the sequential invoice number before rendering so it appears on the
    // PDF and email. Idempotent — a retry (which re-claims after a released slot)
    // reuses the number already persisted on the order, so no number is wasted.
    await assignInvoiceNumber(order);

    const pdf = await generateInvoicePdf(order, user);

    const stored = await uploadInvoicePdf(pdf, order);
    if (stored) {
      order.invoiceUrl = stored.url;
      order.invoicePublicId = stored.publicId;
    }

    const result = await emailHandler.sendOrderConfirmation({
      to,
      order,
      user,
      attachments: [
        {
          Name: invoiceFileName(order),
          Content: pdf.toString('base64'),
          ContentType: 'application/pdf',
        },
      ],
    });

    if (!result?.success) {
      throw new Error(`Invoice email failed for order ${orderId}: ${result?.error || 'unknown error'}`);
    }

    await orderRepository.save(order); // persists invoiceUrl; claim keeps invoiceEmailedAt set
    return { status: 'sent' };
  } catch (err) {
    // Release the claim so BullMQ can retry rather than silently dropping the invoice.
    // Persist any Cloudinary URL we obtained on the way (same object, null timestamp).
    order.invoiceEmailedAt = null;
    await orderRepository.save(order).catch(() => {});
    throw err;
  }
};

export default {
  generateInvoicePdf,
  uploadInvoicePdf,
  emailOrderInvoice,
  invoiceNumber,
  invoiceFileName,
  orderNumber,
  assignInvoiceNumber,
};
