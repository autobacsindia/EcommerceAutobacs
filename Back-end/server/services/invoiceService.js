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
import { putPrivateAsset } from './storage/privateUploads.js';
import orderRepository from '../repositories/orderRepository.js';
import emailHandler from './emailHandler.js';
import { companyInfo } from '../config/company.js';
import counterRepository from '../repositories/counterRepository.js';
import { formatInvoiceNumber, invoiceFileName } from '../utils/invoiceFormat.js';
import { formatLongDateIST } from '../utils/datetime.js';
import paymentRepository from '../repositories/paymentRepository.js';
import { describeEmiPlan } from '../utils/paymentMethodDetails.js';

/** Payment enum → invoice-facing label. */
const PAYMENT_METHOD_LABELS = {
  credit_card: 'Credit Card',
  debit_card: 'Debit Card',
  upi: 'UPI',
  net_banking: 'Net Banking',
  wallet: 'Wallet',
  cod: 'Cash on Delivery',
};

/**
 * Resolve what to print on the "Payment Method" line.
 *
 * This used to be the hardcoded string "Credit Card/Debit Card/NetBanking/UPI" on every
 * invoice — an accurate-by-vagueness placeholder that told the customer nothing and, on
 * an EMI order, actively obscured the arrangement they are being billed interest on.
 *
 * Falls back to that original string when there is no payment row to read (legacy and
 * offline orders), so no existing invoice regresses.
 *
 * @param {Object} order - Order document; `payment` may be an id or a populated doc
 * @returns {Promise<{label: string, emiNote?: string}>}
 */
const resolvePaymentLine = async (order) => {
  const GENERIC = 'Credit Card/Debit Card/NetBanking/UPI';
  if (!order?.payment) return { label: GENERIC };

  let payment = order.payment;
  if (typeof payment !== 'object' || !payment.paymentMethod) {
    // Best-effort: an unreadable payment row must never fail an invoice render.
    try {
      payment = await paymentRepository.findById(payment._id || payment);
    } catch {
      return { label: GENERIC };
    }
  }
  if (!payment?.paymentMethod) return { label: GENERIC };

  const emiLabel = describeEmiPlan(payment);
  if (emiLabel) {
    return {
      label: emiLabel,
      emiNote:
        'Interest and any cancellation charges on this EMI plan are levied by your bank ' +
        'and do not form part of this invoice.',
    };
  }

  const label = PAYMENT_METHOD_LABELS[payment.paymentMethod]
    || payment.methodDetails?.rawMethod
    || GENERIC;

  // Card network/last4 when we have them — turns "Credit Card" into something the
  // customer can match against their statement.
  const { cardNetwork, cardLast4 } = payment.methodDetails || {};
  if (cardLast4 && (payment.paymentMethod === 'credit_card' || payment.paymentMethod === 'debit_card')) {
    return { label: `${label} · ${cardNetwork ? `${cardNetwork} ` : ''}••••${cardLast4}` };
  }
  return { label };
};

/**
 * The "not a tax invoice" legend, printed on EVERY receipt.
 *
 * Exported so the wording is asserted by tests and reused verbatim anywhere else
 * that has to state the same thing (see /terms §21) — three near-identical
 * paraphrases of a legal disclaimer is how one of them ends up saying something
 * subtly different from the others.
 */
export const NOT_A_TAX_INVOICE_TITLE = 'Not a GST tax invoice.';
export const NOT_A_TAX_INVOICE_LEGEND =
  'This document is a payment receipt and is not a tax invoice under the CGST Act, 2017. '
  + 'Input tax credit is not claimable against it. A tax invoice will be issued separately '
  + 'where applicable.';

/**
 * Label for the tax row.
 *
 * NOT "Tax (incl.)". pricingService back-calculates one blended figure from a
 * hardcoded /1.18 and its own comment calls it "for display only"; the catalogue
 * spans 18% and 28%, so every 28% line is understated. The label has to say that
 * the number is indicative rather than imply a computed tax amount.
 */
export const TAX_ROW_LABEL = 'Tax included (indicative):';

/**
 * Who the receipt is addressed to, and where it was delivered.
 *
 * Pure, and exported, because the PDF itself is close to untestable: pdfkit
 * subsets its embedded font, so asserting on extracted PDF text is unreliable.
 * Keeping the decision here means the interesting part — WHICH name, WHICH
 * address, whether a GSTIN line appears at all — is asserted directly, and the
 * PDF test only has to prove it still renders.
 *
 * An enterprise order bills the registered entity at the address tied to its
 * GSTIN and may ship somewhere else entirely (routinely a different state in
 * B2B), so `shipTo` is populated only when the two genuinely differ. Individual
 * orders and the ~1,500 legacy orders with no `buyer` key fall through to
 * exactly the previous behaviour.
 *
 * @param {object} order
 * @param {object|null} user
 * @returns {{name: string, lines: string[], shipTo: string[]|null}}
 */
export const buildBillToLines = (order, user) => {
  const addr = order?.shippingAddress || {};
  const buyer = order?.buyer || {};
  const isEnterprise = buyer.type === 'enterprise';
  const billing = isEnterprise ? (buyer.billingAddress || {}) : addr;
  const recipientEmail = user?.email || order?.guestEmail;

  const name = (isEnterprise && buyer.legalName) || addr.fullName || user?.name || 'Customer';

  const lines = [
    billing.addressLine1,
    billing.addressLine2,
    [billing.city, billing.postalCode].filter(Boolean).join(' ') || null,
    billing.state,
    // Directly under the registered name, so it reads as an attribute of the
    // entity being billed rather than of the seller (whose GSTIN is in the
    // header block above).
    isEnterprise && buyer.gstin ? `GSTIN: ${buyer.gstin}` : null,
    recipientEmail,
    billing.phone || addr.phone,
  ].filter(Boolean);

  const shipDiffers = isEnterprise && (
    billing.addressLine1 !== addr.addressLine1
    || billing.city !== addr.city
    || billing.postalCode !== addr.postalCode
  );

  return {
    name,
    lines,
    shipTo: shipDiffers
      ? [
        addr.fullName,
        addr.addressLine1,
        addr.addressLine2,
        [addr.city, addr.postalCode].filter(Boolean).join(' ') || null,
        addr.state,
      ].filter(Boolean)
      : null,
  };
};

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

/**
 * Long human date for the invoice, e.g. "2 July 2026", in IST.
 *
 * This is a tax document: the date must be the Indian calendar day the order was
 * placed, not the UTC day the Railway container happens to be in. Formerly
 * `toLocaleDateString('en-US')` on the host zone, which put every order placed
 * between 00:00 and 05:30 IST on the *previous* day's invoice.
 */
const fmtDate = (d) => formatLongDateIST(d);

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
  // Resolved here, outside the synchronous pdfkit render below (which cannot await).
  const paymentLine = await resolvePaymentLine(order);

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
      // The Roavion primary logo is white-on-transparent (built for the dark
      // navbar), so it would be invisible on the white page. Render it the way
      // the brand intends — on a dark rounded chip — which also keeps it legible
      // regardless of the asset's internal colours. Height drives the header band.
      let logoBottom = headerTop + 66;
      if (logo) {
        try {
          const FIT_W = 210;
          const FIT_H = 84;
          const PAD_X = 18;
          const PAD_Y = 14;
          const img = doc.openImage(logo);
          const scale = Math.min(FIT_W / img.width, FIT_H / img.height);
          const drawnW = img.width * scale;
          const drawnH = img.height * scale;
          const chipW = drawnW + PAD_X * 2;
          const chipH = drawnH + PAD_Y * 2;
          doc.save();
          doc.roundedRect(LEFT, headerTop, chipW, chipH, 10).fill('#111');
          doc.restore();
          doc.image(logo, LEFT + PAD_X, headerTop + PAD_Y, { fit: [drawnW, drawnH] });
          logoBottom = headerTop + chipH;
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
      let y = Math.max(doc.y, logoBottom) + 24;
      doc.font(FONT_BOLD).fontSize(28).fillColor('#111').text('INVOICE', LEFT, y);
      y = doc.y + 16;

      // ── Bill-to (left) + invoice meta (right) ────────────────────────────────
      // WHO is billed and where it shipped is decided by buildBillToLines above
      // (pure + tested); this only draws the result.
      const billTo = buildBillToLines(order, user);
      const billTop = y;
      doc.font(FONT_BOLD).fontSize(10).fillColor('#111')
        .text(billTo.name, LEFT, billTop, { width: 250 });
      doc.font(FONT).fontSize(9).fillColor('#444');
      billTo.lines.forEach((line) => doc.text(line, LEFT, doc.y, { width: 250 }));

      if (billTo.shipTo) {
        doc.moveDown(0.4);
        doc.font(FONT_BOLD).fontSize(8).fillColor('#555')
          .text('DELIVERED TO', LEFT, doc.y, { width: 250 });
        doc.font(FONT).fontSize(9).fillColor('#444');
        billTo.shipTo.forEach((line) => doc.text(line, LEFT, doc.y, { width: 250 }));
      }
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
      metaRow('Payment Method:', paymentLine.label);
      // EMI only: the interest sits outside this invoice entirely (it is billed by the
      // customer's bank), so say so on the document rather than leaving them to infer it.
      if (paymentLine.emiNote) metaRow('', paymentLine.emiNote);

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
      // "Tax (incl.)" overstated what this number is. services/pricingService.js
      // back-calculates ONE blended rate with a hardcoded /1.18 and its own
      // comment says it is "for display only" — car accessories span 18% and 28%,
      // so every 28% line is understated. The label now says so.
      if (order.tax) sumRow(TAX_ROW_LABEL, rs(order.tax));
      sumRow(
        'Shipping Charges (Extra):',
        shippingExtra ? 'Calculated at delivery' : rs(order.shippingCost),
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

      /*
        ── The status legend ────────────────────────────────────────────────────
        This document is NOT a GST tax invoice and must not be mistaken for one.
        Three things are missing before it could be: pricingService derives a
        single blended tax figure from a hardcoded 18% (the catalogue spans 18%
        and 28%), there is no CGST/SGST vs IGST split even though place of supply
        is derivable, and there are no HSN codes anywhere.

        That mattered less while no buyer GSTIN appeared on it. Now that one does,
        a B2B buyer would reasonably read this as a document they can claim input
        tax credit against — and they cannot. The legend is what closes that gap
        until the compliance work lands.

        It prints on EVERY invoice, not just enterprise ones. Showing it only on
        B2B documents would imply the consumer ones ARE tax invoices, which is the
        same false statement pointed the other way.
      */
      const legendTop = 742;
      doc.save();
      doc.roundedRect(LEFT, legendTop, RIGHT - LEFT, 40, 4)
        .fillAndStroke('#faf8f2', '#e0d6bd');
      doc.restore();
      doc.font(FONT_BOLD).fontSize(8).fillColor('#6b5b2e')
        .text(NOT_A_TAX_INVOICE_TITLE, LEFT + 10, legendTop + 8, { width: RIGHT - LEFT - 20 });
      doc.font(FONT).fontSize(7.5).fillColor('#6b5b2e')
        .text(NOT_A_TAX_INVOICE_LEGEND, LEFT + 10, doc.y + 1, { width: RIGHT - LEFT - 20 });

      doc.font(FONT).fontSize(8).fillColor('#999').text(
        'This is a computer-generated receipt and does not require a signature.',
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
 * Best-effort archival copy of the invoice PDF. Gated by
 * INVOICE_STORE_CLOUDINARY=true (currently OFF — the invoice reaches the
 * customer as an email attachment, and this is only a re-download copy).
 *
 * Never throws: an archival copy failing must not stop the invoice email, which
 * is the part the customer actually depends on.
 *
 * On R2 this lands in the PRIVATE bucket, so the returned `url` is ''. An
 * invoice carries the customer's name, address and the amount they paid; it had
 * no business sitting at a permanent unauthenticated URL, which is what the
 * Cloudinary path gives it. Readers resolve a short-lived signed URL from the
 * stored ref instead — see services/storage/privateAssetUrl.js.
 *
 * @returns {Promise<{url: string, publicId: string, provider: string}|null>}
 */
export const uploadInvoicePdf = async (buffer, order) => {
  if (process.env.INVOICE_STORE_CLOUDINARY !== 'true') return null;

  try {
    const stored = await putPrivateAsset({
      buffer,
      folder: process.env.INVOICE_CLOUDINARY_FOLDER || 'invoices',
      // Deterministic: one object per invoice number, so a re-render of the same
      // invoice replaces it rather than accumulating near-duplicates.
      basename: `${invoiceNumber(order)}.pdf`,
      contentType: 'application/pdf',
      overwrite: true,
    });
    return { url: stored.url, publicId: stored.publicId, provider: stored.provider };
  } catch (err) {
    console.error(`[Invoice] archival upload failed for ${invoiceNumber(order)}: ${err.message}`);
    return null;
  }
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
      order.invoiceUrl = stored.url;              // '' on the R2 path — see the model
      order.invoicePublicId = stored.publicId;
      order.invoiceProvider = stored.provider;
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
