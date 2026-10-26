/** Shapes returned by the /staff sales endpoints (Back-end services/salesOrderService.js). */
import type { LineStage } from '@/components/staff/work/types';

export type SalesOrderItem = {
  name: string;
  variantLabel: string | null;
  quantity: number;
  price: number;
  /** Catalogue price when the line was sold at an offer; null = full price. */
  listPrice: number | null;
  /** Not in the catalogue — named and priced by the seller. */
  custom?: boolean;
};

/** One payment request on a quotation-first order (its own Razorpay link). */
export type PaymentPart = {
  id: string;
  n: number;
  amount: number;
  status: 'pending' | 'paid' | 'expired' | 'cancelled';
  /** Only while it can be paid. */
  url: string | null;
  expiresAt: string;
  paidAt: string | null;
};

export type PaymentSummary = {
  parts: PaymentPart[];
  amountPaid: number;
  /** Paid + still waiting. */
  amountRequested: number;
  /** What no link covers yet. */
  amountToRequest: number;
};

export type PayMethod = 'bank' | 'upi_qr' | 'other';
export type PayDetails = {
  method: PayMethod;
  bank: { accountName: string; accountNumber: string; ifsc: string; bankName: string } | null;
  upiId: string;
  hasQr: boolean;
  note: string;
  setBy: string;
  setAt: string | null;
};

/** Above this, a GPay / UPI payment is asked to come by bank transfer (the server prints the same). */
export const QR_LIMIT = 50000;
export const QR_LIMIT_NOTE = 'For amounts above ₹50,000, please pay by bank transfer.';
export const payDetailsQrHref = (orderId: string) => `/api/v1/staff/sales/orders/${encodeURIComponent(orderId)}/pay-details/qr`;

/** The WhatsApp text: the same lines the PDF and #accounts get (utils/salesPayDetails.js). */
export function payDetailsMessage(o: { orderNumber: string; totalAmount: number; customer: { name: string } }, d: PayDetails, fmt: (n: number) => string): string {
  const first = o.customer.name.trim().split(/\s+/)[0] || 'there';
  const bank = (b: NonNullable<PayDetails['bank']>) => [
    `Account name: ${b.accountName}`, `Account number: ${b.accountNumber}`, `IFSC: ${b.ifsc}`, ...(b.bankName ? [`Bank: ${b.bankName}`] : []),
  ];
  const lines = [`Hi ${first}, thank you for your order ${o.orderNumber}. Amount to pay: ${fmt(o.totalAmount)}.`, ''];
  if (d.method === 'bank' && d.bank) lines.push('Pay by bank transfer (NEFT / RTGS / IMPS):', ...bank(d.bank));
  if (d.method === 'upi_qr') {
    lines.push(`Pay by GPay / UPI: scan the QR we sent${d.upiId ? ` or pay to ${d.upiId}` : ''}.`);
    if (o.totalAmount > QR_LIMIT) lines.push(QR_LIMIT_NOTE);
    if (d.bank) lines.push('', 'Bank transfer:', ...bank(d.bank));
  }
  if (d.method === 'other') lines.push(d.note);
  else if (d.note) lines.push('', d.note);
  lines.push('', 'After paying, please send us the payment screenshot or the UTR / transaction number.');
  return lines.join('\n');
}

export type SalesOrder = {
  id: string;
  orderNumber: string;
  createdAt: string;
  status: string;
  paymentStatus: string;
  totalAmount: number;
  items: SalesOrderItem[];
  customer: { name: string; email: string; phone: string };
  shippingAddress: {
    fullName?: string;
    phone?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  } | null;
  salesPerson: string;
  /** Sales-panel order, or a website order (team workflow). */
  source?: 'sales' | 'website';
  /** Where the team workflow has got to; null for orders paid before it existed. */
  workflowSummary?: string | null;
  /** The stage behind `workflowSummary`, for its colour. */
  workflowStage?: LineStage | null;
  /** null once paid / closed. */
  linkState: 'active' | 'expired' | null;
  paymentLinkUrl: string | null;
  paymentLinkExpiresAt: string | null;
  razorpayPaymentId: string | null;
  paymentMethod: string | null;
  /** 'parts': quotation-first order, paid through payment requests; 'link': older single link. */
  paymentFlow?: 'link' | 'parts';
  payment?: PaymentSummary;
  /** A bank transfer is recorded and waiting for accounts to find it in the bank. */
  bankTransferPending?: boolean;
  /** Paid by bank transfer: what accounts confirmed. */
  offlinePayment?: { method: 'bank_transfer'; reference: string; confirmedBy: string } | null;
  /** How the customer is told to pay besides (or instead of) a Razorpay link. */
  payDetails?: PayDetails | null;
  hold?: SalesHold | null;
};

export type QuotationLine = {
  product: string | null;
  variantId: string | null;
  variantLabel: string | null;
  custom: boolean;
  name: string;
  image: string;
  quantity: number;
  price: number;
  listPrice: number | null;
};

/** "On hold — customer thinking" on a quotation or an unpaid order; null when not held. */
export type SalesHold = {
  since: string | null;
  /** Follow-up date (start of that day, India time). */
  until: string;
  note: string;
  by: string;
  /** The follow-up date has arrived: the record is back in the active list. */
  due: boolean;
};

export type Quotation = {
  id: string;
  /** "QT-7F3A91C2", or "QT-7F3A91C2-v2" from the second version. */
  number: string;
  version: number;
  status: 'open' | 'expired' | 'accepted' | 'cancelled';
  customer: { name: string; email: string; phone: string };
  shippingAddress: SalesOrder['shippingAddress'];
  items: QuotationLine[];
  totalAmount: number;
  notes: string;
  validUntil: string;
  salesPerson: string | null;
  /** Set once the customer accepted. */
  orderId: string | null;
  createdAt: string;
  updatedAt: string;
  revisions: { version: number; totalAmount: number; savedAt: string }[];
  hold?: SalesHold | null;
};

export type QuotationPage = { quotations: Quotation[]; nextCursor: string | null; scope: 'mine' | 'team' };

/** The quotation PDF (opened in a new tab to view, download or share). */
export const quotationPdfHref = (quotationId: string) =>
  `/api/v1/staff/sales/quotations/${encodeURIComponent(quotationId)}/pdf`;

/** The payment-request PDF: every part with its amount, link and QR. */
export const paymentRequestHref = (orderId: string) =>
  `/api/v1/staff/sales/orders/${encodeURIComponent(orderId)}/payment-request`;

export type SalesOrderPage = { success: boolean; orders: SalesOrder[]; nextCursor: string | null; scope?: 'mine' | 'team' };

export type SalesProduct = {
  id: string;
  name: string;
  sku: string;
  image: string;
  price: number;
  available: boolean;
  variants: { id: string; label: string; price: number; available: boolean }[];
};

export const errorMessage = (e: unknown, fallback: string) =>
  (e as { rawData?: { message?: string } })?.rawData?.message || fallback;

const whole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const paise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Rupees, showing paise only when there are any (an offer can be ₹4,499.50). */
export const rupees = (n: number) => (Number.isInteger(Math.round(n * 100) / 100) ? whole : paise).format(n);

/**
 * The quotation PDF for a sales order (opened in a new tab to view, download or
 * share). Prices come from the order on the server — the PDF cannot differ from
 * what the payment link charges.
 */
export const quotationHref = (orderId: string) => `/api/v1/staff/sales/orders/${encodeURIComponent(orderId)}/quotation`;
