/**
 * Pure formatting for the invoice number series — shared by the PDF generator
 * (services/invoiceService.js) and the confirmation email (utils/emailTemplates.js)
 * so both render the same identifier. No DB / heavy deps here.
 *
 * The underlying number is the sequential `order.invoiceNo` (assigned from the
 * "invoice" Counter). These env vars only dress up its presentation:
 *   COMPANY_INVOICE_PREFIX  e.g. "INV-"
 *   COMPANY_INVOICE_PAD     zero-pad width, e.g. 6 → "000059"
 * Defaults (blank/0) yield a plain integer ("59"), matching the reference invoice.
 */
const INVOICE_PREFIX = process.env.COMPANY_INVOICE_PREFIX || '';
const INVOICE_PAD = Number(process.env.COMPANY_INVOICE_PAD || 0);

/** Legacy fallback for orders that never had a sequential number assigned. */
const legacyRef = (order) => `AB-${order._id.toString().slice(-8).toUpperCase()}`;

/** Human-facing invoice number for display (sequential, with optional prefix/pad). */
export const formatInvoiceNumber = (order) => {
  if (order.invoiceNo == null) return legacyRef(order);
  const n = INVOICE_PAD > 0 ? String(order.invoiceNo).padStart(INVOICE_PAD, '0') : String(order.invoiceNo);
  return `${INVOICE_PREFIX}${n}`;
};

/** Attachment / download filename, e.g. "invoice-59.pdf" (matches the reference). */
export const invoiceFileName = (order) =>
  `invoice-${order.invoiceNo != null ? order.invoiceNo : order._id.toString().slice(-8).toUpperCase()}.pdf`;
