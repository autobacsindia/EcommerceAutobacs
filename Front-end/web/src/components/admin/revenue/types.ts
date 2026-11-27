/** Shapes returned by /api/v1/admin/revenue (routes/adminRevenue.js). Money is rupees, incl. GST. */

export type RevenuePeriod = 'fy' | 'all';
export type ZohoMatchState = 'linked' | 'needs_check' | 'zoho_only';

export interface RevenueMonth {
  /** "2026-04" (IST) */
  month: string;
  website: number;
  zoho: number;
  /** Paid, no sale bill yet */
  unbilled: number;
  total: number;
  sales: number;
  ordersFulfilled: number;
  needsCheck: number;
}

export interface CompanyRevenueSummary {
  period: { kind: RevenuePeriod; label: string; startDate: string | null };
  basis: 'incl_gst';
  revenue: {
    total: number;
    website: {
      total: number;
      extraCharges: number;
      bySource: Record<'web' | 'woocommerce' | 'offline', { total: number; count: number }>;
    };
    zoho: { total: number; exGst: number; creditNotes: number; unpaid: number; count: number };
    /** Money received with no Zoho invoice yet — counted in `total`, shown apart. */
    unbilled: UnbilledSummary;
  };
  sales: {
    total: number;
    website: { total: number; delivered: number; shipped: number; processing: number };
    zoho: number;
    zohoCancelled: number;
    unbilled: number;
  };
  ordersFulfilled: { total: number; website: number; zoho: number };
  /** Zoho bills that stand for a panel order (that order is not added again). */
  zohoMatched: { linked: { count: number; total: number }; needsCheck: { count: number; total: number } };
  months: RevenueMonth[];
  lastImport: { at: string; byName: string | null } | null;
}

export interface ZohoInvoiceRow {
  _id: string;
  invoiceNumber: string;
  invoiceDate: string;
  status: string;
  customerName?: string;
  total: number;
  subTotal: number;
  balance: number;
  match: {
    state: ZohoMatchState;
    by: 'auto' | 'admin';
    reason?: string;
    order?: {
      _id: string;
      totalAmount: number;
      createdAt: string;
      status: string;
      source?: string;
      shippingAddress?: { fullName?: string };
    } | null;
  };
}

export type SaleSource = 'web' | 'woocommerce' | 'offline' | 'zoho';

/** One row of GET /admin/revenue/sales — a panel order or a Zoho-only bill. */
export interface SaleRow {
  _id: string;
  kind: 'order' | 'zoho';
  source: SaleSource;
  date: string;
  /** Rupees incl. GST; for a Zoho bill, net of its credit notes. */
  amount: number;
  status: string;
  name?: string;
  number?: string;
  gross?: number;
  credited?: number;
  unpaid?: number;
}

export interface UnbilledSummary {
  total: number;
  count: number;
  /** From the Zoho Payments Received export (its unused amount). */
  zoho: number;
  /** Added by an admin with proof. */
  manual: number;
  /** Looks like a website / sales-panel order — not counted until an admin decides. */
  needsCheck: { count: number; total: number };
}

export type UnbilledState = 'open' | 'in_panel' | 'needs_check' | 'billed' | 'removed';
export type UnbilledDecision = 'count' | 'same_as_panel' | 'billed' | 'remove';

/** One row of GET /admin/revenue/unbilled. */
export interface UnbilledRow {
  _id: string;
  source: 'zoho_payment' | 'manual';
  paymentNumber?: string;
  /** Paid-sales sheet reference (its re-upload key). */
  saleRef?: string;
  receivedAt: string;
  customerName: string;
  mode?: string;
  reference?: string;
  /** Counted rupees: the unused part of a Zoho payment, or the manual amount. */
  amount: number;
  paymentTotal?: number;
  proof?: string;
  note?: string;
  state: UnbilledState;
  stateBy: 'auto' | 'admin';
  reason?: string;
  billedAs?: string;
  addedByName?: string | null;
  order?: {
    _id: string;
    totalAmount: number;
    createdAt: string;
    status: string;
    source?: string;
    shippingAddress?: { fullName?: string };
  } | null;
}

export interface ZohoImportResult {
  kind: 'invoices' | 'credit_notes' | 'payments' | 'paid_sales';
  /** Payments export only: payments Zoho has since applied to an invoice. */
  billed?: number;
  batchId?: string;
  inserted: number;
  updated: number;
  skipped: { draft: number; void: number };
  errors: string[];
  rematched: number;
  /** Credit notes whose invoice is not uploaded yet (they reduce nothing until it is). */
  creditsUnmatched: number;
}

/** The panel order code customers and staff see ("AB-1A2B3C4D"). */
export const orderRef = (id: string) => `AB-${id.slice(-8).toUpperCase()}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-04" → "Apr 2026" */
export const monthLabel = (m: string) => {
  const [y, mm] = m.split('-');
  return `${MONTHS[Number(mm) - 1] ?? mm} ${y}`;
};
