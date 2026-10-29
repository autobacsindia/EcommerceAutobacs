/**
 * Past (offline) sales — shapes returned by Back-end services/pastSaleService.js
 * (`shape()`), and the labels the screens show for its closed lists.
 */

export type PastSaleChannel = 'store' | 'phone' | 'whatsapp' | 'home_visit' | 'event' | 'other';
export type PastSalePaymentMethod = 'cash' | 'upi' | 'card' | 'bank_transfer' | 'cheque' | 'other';

export const CHANNELS: { value: PastSaleChannel; label: string }[] = [
  { value: 'store', label: 'Store' },
  { value: 'phone', label: 'Phone' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'home_visit', label: 'Home visit' },
  { value: 'event', label: 'Event' },
  { value: 'other', label: 'Other' },
];

export const PAYMENT_METHODS: { value: PastSalePaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

export const channelLabel = (v: string | null) => CHANNELS.find((c) => c.value === v)?.label || '';
export const paymentLabel = (v: string | null) => PAYMENT_METHODS.find((p) => p.value === v)?.label || '';

export type PastSaleItem = { product: string | null; name: string; quantity: number; price: number };

export type PastSale = {
  id: string;
  saleDate: string; // YYYY-MM-DD
  invoiceNo: string;
  customer: { name: string; phone: string; email: string; city: string; state: string };
  business: { legalName: string; gstin: string } | null;
  vehicle: string;
  channel: PastSaleChannel | null;
  items: PastSaleItem[];
  itemsTotal: number;
  discount: number;
  gstAmount: number | null;
  totalAmount: number;
  amountMismatch: boolean;
  paymentMethod: PastSalePaymentMethod;
  notes: string;
  soldBy: { id: string; name: string } | null;
  enteredBy: string;
  enteredAt: string;
  batchId: string | null;
  deleted: { at: string | null; by: string } | null;
  /** Sent back with an edit, so an edit made from an old copy is refused. */
  version: string | null;
  can: { edit: boolean; delete: boolean; restore: boolean };
  history?: { at: string; by: string; action: 'created' | 'edited' | 'deleted' | 'restored'; changes: { field: string; from: string; to: string }[] }[];
};

export type PastSalePage = { sales: PastSale[]; nextCursor: string | null };
export type PastSaleTotals = {
  sellers: { id: string | null; name: string; sales: number; value: number }[];
  total: { sales: number; value: number };
};
export type PastSaleSeller = { id: string; name: string; current: boolean };

export type UploadStatus = 'ready' | 'duplicate' | 'error' | 'imported';
export type UploadResult = {
  sales: {
    rows: number[]; status: UploadStatus; reasons: string[]; warnings: string[];
    saleDate: string; invoiceNo: string; customer: string; items: number; totalAmount: number | null;
  }[];
  counts: { rows: number; sales: number; ready?: number; imported?: number; duplicates: number; errors: number };
  readyValue?: number;
  importedValue?: number;
  batchId?: string | null;
};

/** A customer's past purchases on the lead page (services/pastSaleService.customerPastSales). */
export type CustomerPastSale = {
  id: string;
  saleDate: string;
  invoiceNo: string;
  items: { name: string; quantity: number }[];
  totalAmount: number;
  paymentMethod: PastSalePaymentMethod;
  channel: PastSaleChannel | null;
  soldBy: string;
};

export const TEMPLATE_HREF = '/api/v1/staff/past-sales/template';

/** Accounts and the admin manage every sale; the GTM head sees all; a lead sees their own. */
export type Viewer = { manage: boolean; seesAll: boolean };
export function viewerOf(user: { role: string; staff: { team: string; isHead: boolean } | null } | null): Viewer {
  const manage = user?.role === 'admin' || user?.staff?.team === 'accounts';
  return { manage, seesAll: manage || (user?.staff?.team === 'sales' && !!user.staff.isHead) };
}
