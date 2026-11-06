/**
 * Payment requests (Back-end routes/paymentRequests.js): supplier payments and
 * team expenses, approved by admin and paid by accounts.
 */
import apiClient from '@/lib/api-client';
import { tokenManager } from '@/lib/http/tokenManager';

export type PaymentStatus = 'submitted' | 'approved' | 'on_hold' | 'paid' | 'declined' | 'cancelled';

export type PaymentRequest = {
  id: string;
  number: string;
  kind: 'supplier' | 'expense';
  status: PaymentStatus;
  statusLabel: string;
  team: string;
  teamLabel: string;
  requestedBy: string;
  /** Rupees — what is paid and totalled. 0 while `rupeesPending`. */
  amount: number;
  /**
   * A foreign bill (any team, and supplier payments): its currency and amount. `fxRate` is the
   * rate the rupees came to — typed on older requests, worked out from the bank
   * debit on newer ones once paid. 'INR' / null otherwise.
   */
  currency?: string;
  foreignAmount?: number | null;
  fxRate?: number | null;
  /** A foreign bill not yet paid: no rupee figure exists until the admin records the bank debit. */
  rupeesPending?: boolean;
  category: string;
  /** The readable name, for old values (fuel, purchase…) too. */
  categoryLabel?: string;
  description: string;
  payee: {
    name: string; method: 'upi' | 'bank'; upiId?: string; accountName?: string;
    accountNumber?: string; ifsc?: string; swift?: string; bankName?: string; phone?: string;
  };
  order: { id: string; number: string } | null;
  itemNames: string[];
  customer: { name: string; phone: string; city: string } | null;
  closedBy: string;
  /** Raised from the supplier directory. */
  supplier?: { id: string } | null;
  /** The supplier's bank details changed shortly before this was raised. */
  bankNotice?: { at: string; byName: string } | null;
  files: { id: string; kind: 'bill' | 'qr' | 'proof'; name: string; contentType: string; bytes: number }[];
  /** paidAt = when it was recorded; transactionAt = when the money moved (older records: absent). */
  payment: { method: string; reference: string; paidAt: string; transactionAt?: string | null; paidByName: string } | null;
  decisionNote: string;
  history: { at: string; byName: string; role: string; action: string; note: string }[];
  createdAt: string;
  can: {
    approve: boolean; decline: boolean; pay: boolean; hold: boolean; cancel: boolean; edit?: boolean; editPayment?: boolean;
    /** An expense: may link it to an order, change or remove the link (any status — no money changes). */
    linkOrder?: boolean;
  };
  /** One part of a supplier deal: its currency is the deal's and cannot change. */
  dealId?: string | null;
  /** Advance / Part payment / Balance / Full payment — '' for a one-off payment. */
  part?: '' | 'advance' | 'part' | 'balance' | 'full';
  partLabel?: string;
  /**
   * Where this payment sits in its made-to-order deal, worked out by the server
   * (supplierDealService.partSummary) — on every list, the detail and the PDF:
   * "Advance (payment 1 of 2) ₹10,000 of ₹29,000 agreed · balance after ₹19,000".
   */
  deal?: DealSummary | null;
  /** Its order (or every item it pays for) was cancelled: it can only be declined. */
  orderCancelled?: boolean;
  /** Supplier credit used on it: the bill = what is transferred + this. */
  credit?: { amount: number; entryId?: string } | null;
  /** The bill before credit (null when no credit was used). */
  bill?: number | null;
  /** Paid, and the customer cancelled the items since: the refund the supplier owes. */
  supplierRefund?: SupplierRefund | null;
  /** The requester may edit until then (null for admins, or once it can no longer be edited). */
  editableUntil?: string | null;
};

export type OrderPayment = {
  id: string; number: string; status: PaymentStatus; statusLabel: string;
  /** Rupees (0 while `rupeesPending`). A foreign bill's own amount is `foreignAmount` in `currency`. */
  amount: number;
  currency?: string;
  foreignAmount?: number | null;
  rupeesPending?: boolean;
  /** The viewer may still edit it (the requester or their team head while it waits for accounts; the admin until paid). */
  canEdit?: boolean;
  itemIds: string[]; itemNames: string[]; payee: string; paidAt: string | null; createdAt: string;
  /** 'supplier' (for items) or 'expense' (linked to the order from its page). */
  kind?: 'supplier' | 'expense';
  categoryLabel?: string;
  team?: string;
  requestedByName?: string;
  /** One part of a supplier deal: Advance / Part payment / Balance. */
  dealId?: string | null;
  part?: '' | 'advance' | 'part' | 'balance' | 'full';
  partLabel?: string;
  credit?: { amount: number } | null;
  supplierRefund?: SupplierRefund | null;
};

/** A paid supplier payment whose items were cancelled: the refund claim on it (Back-end supplierLedgerService). */
export type SupplierRefund = {
  claim: { id: string; status: 'pending' | 'approved'; amount: number; currency: string } | null;
  canClaim: boolean;
  /** Paid to a saved supplier — a refund can only be claimed from one. */
  savedSupplier: boolean;
};

/**
 * A made-to-order item paid to its supplier in parts. Every number is worked out
 * by the server from the deal's payments (balance due = agreed − paid); the page
 * only shows them.
 */
export type SupplierDeal = {
  id: string;
  status: 'open' | 'cancelled';
  itemIds: string[];
  itemNames: string[];
  supplierName: string;
  /** Every amount on the deal is in this currency (INR, THB…); `rupeesPaid` is what the bank debited. */
  currency: string;
  rupeesPaid: number;
  agreedTotal: number;
  paid: number;
  /** Raised or approved, not yet paid. */
  waiting: number;
  balanceDue: number;
  /** The most the next payment may be. */
  leftToAsk: number;
  fullyPaid: boolean;
  /** When the first payment (the advance) was paid — the supplier starts then. null until paid. */
  advancePaidAt: string | null;
  /** 'YYYY-MM-DD' or '': the day the advance was paid (set by the server, not typed). */
  startDate: string;
  completionDate: string;
  createdByName: string;
  createdAt: string;
  payments: {
    id: string; number: string; part: string; partLabel: string;
    /** What is left of the agreed total after this payment (null when declined / cancelled). */
    balanceAfter?: number | null;
    /** In the deal's currency. `rupees`: the bank debit (null for a foreign part not yet paid). */
    amount: number; rupees: number | null;
    status: PaymentStatus; statusLabel: string; createdAt: string; approvedAt: string | null; paidAt: string | null;
  }[];
  history: { at: string; byName: string; action: string; note: string }[];
  can: { raise: boolean; edit: boolean; remove: boolean };
};

export type OrderPayments = { requests: OrderPayment[]; deals: SupplierDeal[] };

/**
 * What a team may claim an expense for, and in which currencies. The server's
 * own list (Back-end config/expenseCategories.js), fetched — never copied here —
 * so the form cannot offer what the server would refuse.
 */
export type ExpenseOptions = {
  team: string;
  categories: { value: string; label: string; noteRequired: boolean }[];
  currencies: { code: string; label: string }[];
  baseCurrency: string;
};

export const getExpenseOptions = (team?: string) =>
  apiClient.get<{ options: ExpenseOptions }>(`/payment-requests/expense-options${team ? `?team=${encodeURIComponent(team)}` : ''}`);

/** "Import purchase", or the stored value for anything the server did not name. */
export const categoryName = (r: Pick<PaymentRequest, 'category' | 'categoryLabel'>) => r.categoryLabel || r.category;

/** "THB 22,950" — a foreign bill as billed; '' for rupees. */
export const billAmount = (r: Pick<PaymentRequest, 'currency' | 'foreignAmount'>) =>
  (r.currency && r.currency !== 'INR' && r.foreignAmount != null
    ? `${r.currency} ${Number(r.foreignAmount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
    : '');

/** "THB 10,000 @ ₹2.45" once its rupees are known, "THB 22,950" before; '' for rupees (and every older request). */
export const foreignBill = (r: Pick<PaymentRequest, 'currency' | 'foreignAmount' | 'fxRate'>) => {
  const bill = billAmount(r);
  if (!bill || !r.fxRate) return bill;
  return `${bill} @ ₹${Number(r.fxRate).toLocaleString('en-IN', { maximumFractionDigits: 4 })}`;
};

/** The headline money: "₹24,500", or "THB 22,950" while a foreign bill's rupees are not known yet. */
export const amountText = (r: Pick<PaymentRequest, 'amount' | 'currency' | 'foreignAmount' | 'rupeesPending'>) =>
  (r.rupeesPending ? billAmount(r) : rupees(r.amount));

/** "IFSC HDFC0001234" / "SWIFT KASITHBK" — whichever the bank has; '' for neither. */
export const bankCode = (p: { ifsc?: string; swift?: string }) =>
  (p.swift ? `SWIFT ${p.swift}` : p.ifsc ? `IFSC ${p.ifsc}` : '');

export const STATUS_TONE: Record<PaymentStatus, string> = {
  submitted: 'bg-amber-100 text-amber-800',
  approved: 'bg-sky-100 text-sky-800',
  on_hold: 'bg-orange-100 text-orange-800',
  paid: 'bg-green-100 text-green-800',
  declined: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-200 text-gray-700',
};

export const paymentKeys = {
  all: ['payment-requests'] as const,
  list: (filters: Record<string, string>) => [...paymentKeys.all, 'list', filters] as const,
  one: (id: string) => [...paymentKeys.all, 'one', id] as const,
  forOrder: (orderId: string) => [...paymentKeys.all, 'order', orderId] as const,
  options: (team: string) => [...paymentKeys.all, 'options', team] as const,
  filterOptions: () => [...paymentKeys.all, 'filter-options'] as const,
  orderLookup: (q: string) => [...paymentKeys.all, 'order-lookup', q] as const,
};

export const slipHref = (id: string) => `/api/v1/payment-requests/${encodeURIComponent(id)}/slip`;
export const fileHref = (id: string, fileId: string) => `/api/v1/payment-requests/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`;

export const errorMessage = (e: unknown, fallback: string) =>
  (e as { rawData?: { message?: string; errors?: { msg?: string }[] } })?.rawData?.message
  || (e as { rawData?: { errors?: { msg?: string }[] } })?.rawData?.errors?.[0]?.msg
  || fallback;

/** A date for a <input type="datetime-local"> (the browser's local time, minutes). */
export const toLocalInput = (d: Date | string = new Date()) => {
  const x = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
};
/** Back to an exact instant for the server (the input has no timezone; the browser's is used). */
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : '');

export const rupees = (n: number) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** An amount in its currency: "₹29,000" or "THB 29,400". */
export const money = (n: number, currency = 'INR') => (!currency || currency === 'INR'
  ? rupees(n)
  : `${currency} ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`);

/** What a payment on an order reads as: "₹1,250", "THB 10,000 (₹24,300 debited)" or "THB 10,000". */
export const paymentMoney = (r: { amount: number; currency?: string; foreignAmount?: number | null }) => (r.currency && r.currency !== 'INR' && r.foreignAmount != null
  ? `${money(r.foreignAmount, r.currency)}${r.amount > 0 ? ` (${rupees(r.amount)} debited)` : ''}`
  : rupees(r.amount));

/** An order to link an expense to — only what identifies it on screen. */
export type OrderMatch = { id: string; number: string; customer: string; total: number | null; createdAt: string };
export const lookupOrders = (q: string) =>
  apiClient.get<{ orders: OrderMatch[] }>(`/payment-requests/order-lookup?q=${encodeURIComponent(q)}`);
/** Link an expense to an order, change it, or remove it (null). */
export const linkOrder = (id: string, orderId: string | null) =>
  apiClient.post<{ request: PaymentRequest }>(`/payment-requests/${encodeURIComponent(id)}/order`, { orderId });

/** Multipart POST (the JSON client can't send files), with the same CSRF header it uses. */
export async function postForm<T>(endpoint: string, form: FormData, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  await tokenManager.ensureCsrfToken();
  const headers = tokenManager.getHeaders() as Record<string, string>;
  delete headers['Content-Type']; // the browser sets the multipart boundary
  const res = await fetch(`/api/v1${endpoint}`, { method, body: form, headers, credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.message || 'That did not work'), { rawData: body });
  return body as T;
}

/**
 * How many match the filters and what they add up to (first page only; `total` is null when capped).
 * `pending`: foreign bills counted but not in the total — their rupees come when paid.
 */
export type ListSummary = { count: number; total: number | null; capped: boolean; pending?: number | null };
export type RequestPage = { requests: PaymentRequest[]; nextCursor: string | null; sort?: string; summary?: ListSummary };
export const listRequests = (filters: Record<string, string>, cursor?: string) => {
  const q = new URLSearchParams({ ...filters, ...(cursor ? { cursor } : {}) });
  return apiClient.get<RequestPage>(`/payment-requests?${q}`);
};
/** For the "Raised by" filter (admin / accounts). */
/** The list's filter choices: "What for" (the viewer's team's, or every team's) and, for admin / accounts, "Raised by". */
export type PaymentPerson = { id: string; name: string; team: string };
export type ListFilterOptions = { categories: { value: string; label: string }[]; people: PaymentPerson[] };
export const getListFilterOptions = () => apiClient.get<ListFilterOptions>('/payment-requests/filter-options');
export const getRequest = (id: string) => apiClient.get<{ request: PaymentRequest }>(`/payment-requests/${id}`);
export const actOn = (id: string, action: 'approve' | 'decline' | 'hold' | 'cancel', note = '') =>
  apiClient.post<{ request: PaymentRequest }>(`/payment-requests/${id}/${action}`, { note });

/** 'YYYY-MM-DD' → "8 Nov 2026" (a calendar day: no time zone shift). */
export const dayText = (d: string) => (d
  ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  : 'Not set');

/** One payment's place in its deal. Amounts are in `currency`; `thisRupees` / `rupeesPaid` are bank debits. */
export type DealSummary = {
  dealId: string; dealStatus: string; supplierName: string; itemNames: string[]; currency: string;
  agreedTotal: number; partLabel: string; installment: number | null; installments: number;
  thisAmount: number; thisRupees: number | null;
  paidBefore: number; waitingBefore: number; balanceAfter: number;
  paidSoFar: number; waiting: number; balanceDue: number; rupeesPaid: number;
  startDate: string; completionDate: string;
};
