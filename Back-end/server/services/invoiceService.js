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
import cloudinary from '../config/cloudinary.js';
import orderRepository from '../repositories/orderRepository.js';
import emailHandler from './emailHandler.js';
import { companyInfo, companyAddressLine } from '../config/company.js';

/** Human-facing order number derived from the Mongo _id (no separate counter). */
export const invoiceNumber = (order) =>
  `AB-${order._id.toString().slice(-8).toUpperCase()}`;

/** Rupee formatting for the PDF. Uses "Rs." — the default PDF font lacks the ₹ glyph. */
const rs = (n) =>
  `Rs. ${Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Build the invoice PDF for an order.
 * @param {Object} order - Mongoose Order document (or plain object)
 * @param {Object} [user] - User document for name/email fallback
 * @returns {Promise<Buffer>} PDF file bytes
 */
export const generateInvoicePdf = (order, user = null) =>
  new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const addr = order.shippingAddress || {};
      const created = order.createdAt ? new Date(order.createdAt) : new Date();

      // ── Header: seller identity ──────────────────────────────────────────────
      doc.fontSize(20).text(companyInfo.name, { continued: false });
      doc.moveDown(0.2);
      doc.fontSize(9).fillColor('#555');
      const sellerLine = companyAddressLine();
      if (sellerLine) doc.text(sellerLine);
      if (companyInfo.phone) doc.text(`Phone: ${companyInfo.phone}`);
      if (companyInfo.email) doc.text(`Email: ${companyInfo.email}`);
      if (companyInfo.gstin) doc.text(`GSTIN: ${companyInfo.gstin}`);
      doc.fillColor('#000');

      // ── Invoice meta ─────────────────────────────────────────────────────────
      doc.moveDown(1);
      doc.fontSize(16).text('Tax Invoice', { align: 'right' });
      doc.fontSize(10).fillColor('#555');
      doc.text(`Invoice No: ${invoiceNumber(order)}`, { align: 'right' });
      doc.text(`Date: ${created.toLocaleDateString('en-IN')}`, { align: 'right' });
      doc.text(`Order Status: ${order.status || 'confirmed'}`, { align: 'right' });
      doc.fillColor('#000');

      // ── Bill-to ──────────────────────────────────────────────────────────────
      doc.moveDown(1);
      doc.fontSize(11).text('Bill To:', { underline: true });
      doc.fontSize(10).fillColor('#333');
      doc.text(addr.fullName || user?.name || 'Customer');
      const custLines = [
        addr.addressLine1,
        addr.addressLine2,
        [addr.city, addr.state, addr.postalCode].filter(Boolean).join(', '),
        addr.country,
      ].filter(Boolean);
      custLines.forEach((l) => doc.text(l));
      if (addr.phone) doc.text(`Phone: ${addr.phone}`);
      const recipientEmail = user?.email || order.guestEmail;
      if (recipientEmail) doc.text(`Email: ${recipientEmail}`);
      doc.fillColor('#000');

      // ── Items table ──────────────────────────────────────────────────────────
      doc.moveDown(1.2);
      const tableTop = doc.y;
      const colX = { item: 50, qty: 320, price: 380, amount: 470 };
      doc.fontSize(10).fillColor('#000');
      doc.text('Item', colX.item, tableTop);
      doc.text('Qty', colX.qty, tableTop);
      doc.text('Price', colX.price, tableTop);
      doc.text('Amount', colX.amount, tableTop);
      doc
        .moveTo(50, tableTop + 15)
        .lineTo(545, tableTop + 15)
        .strokeColor('#ccc')
        .stroke();

      let y = tableTop + 22;
      (order.items || []).forEach((it) => {
        const qty = it.quantity || 0;
        const price = it.price || 0;
        const lineTotal = qty * price;
        const name = it.name || 'Item';
        doc.fontSize(9).fillColor('#333');
        doc.text(name, colX.item, y, { width: 250 });
        const rowHeight = doc.heightOfString(name, { width: 250 });
        doc.text(String(qty), colX.qty, y);
        doc.text(rs(price), colX.price, y);
        doc.text(rs(lineTotal), colX.amount, y);
        y += Math.max(rowHeight, 14) + 6;
        if (y > 720) {
          doc.addPage();
          y = 50;
        }
      });

      doc.moveTo(50, y).lineTo(545, y).strokeColor('#ccc').stroke();
      y += 10;

      // ── Totals ───────────────────────────────────────────────────────────────
      const totalsRow = (label, value, opts = {}) => {
        doc.fontSize(opts.bold ? 11 : 10).fillColor(opts.bold ? '#000' : '#333');
        if (opts.bold) doc.font('Helvetica-Bold');
        doc.text(label, colX.price - 90, y, { width: 150, align: 'right' });
        doc.text(value, colX.amount, y, { width: 75, align: 'right' });
        if (opts.bold) doc.font('Helvetica');
        y += 16;
      };

      totalsRow('Subtotal', rs(order.subtotal));
      if (order.couponDiscount)
        totalsRow(`Coupon${order.couponCode ? ` (${order.couponCode})` : ''}`, `- ${rs(order.couponDiscount)}`);
      if (order.karmaDiscount) totalsRow('Karma points', `- ${rs(order.karmaDiscount)}`);
      totalsRow('Shipping', rs(order.shippingCost));
      if (order.tax) totalsRow('Tax (incl.)', rs(order.tax));
      y += 4;
      totalsRow('Total Paid', rs(order.totalAmount), { bold: true });

      // ── Footer ───────────────────────────────────────────────────────────────
      doc.moveDown(2);
      doc
        .fontSize(8)
        .fillColor('#999')
        .text(
          'This is a computer-generated invoice and does not require a signature.',
          50,
          760,
          { align: 'center', width: 495 }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });

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
        Name: `${invoiceNumber(order)}.pdf`,
        Content: pdf.toString('base64'),
        ContentType: 'application/pdf',
      },
    ],
  });

  // Only mark as emailed when the provider actually accepted it, so a transient
  // failure lets BullMQ retry rather than silently dropping the invoice.
  if (result?.success) {
    order.invoiceEmailedAt = new Date();
    await orderRepository.save(order);
    return { status: 'sent' };
  }

  // Persist any Cloudinary URL we obtained even if the email failed this attempt.
  if (stored) await orderRepository.save(order);
  throw new Error(`Invoice email failed for order ${orderId}: ${result?.error || 'unknown error'}`);
};

export default { generateInvoicePdf, uploadInvoicePdf, emailOrderInvoice, invoiceNumber };
