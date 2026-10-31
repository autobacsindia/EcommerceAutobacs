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
  /** Rupees, always — what is approved, paid and totalled. */
  amount: number;
  /** A foreign bill (procurement imports): its currency, amount and the quoted rate. 'INR' / null otherwise. */
  currency?: string;
  foreignAmount?: number | null;
  fxRate?: number | null;
  category: string;
  /** The readable name, for old values (fuel, purchase…) too. */
  categoryLabel?: string;
  description: string;
  payee: {
    name: string; method: 'upi' | 'bank'; upiId?: string; accountName?: string;
    accountNumber?: string; ifsc?: string; bankName?: string; phone?: string;
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
  can: { approve: boolean; decline: boolean; pay: boolean; hold: boolean; cancel: boolean; edit?: boolean; editPayment?: boolean };
  /** The requester may edit until then (null for admins, or once it can no longer be edited). */
  editableUntil?: string | null;
};

export type OrderPayment = {
  id: string; number: string; status: PaymentStatus; statusLabel: string; amount: number;
  /** The viewer may still edit it (the requester or their team head while it waits for accounts; the admin until paid). */
  canEdit?: boolean;
  itemIds: string[]; itemNames: string[]; payee: string; paidAt: string | null; createdAt: string;
};

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

/** "THB 10,000 @ ₹2.45" for a foreign bill; '' for rupees (and every older request). */
export const foreignBill = (r: Pick<PaymentRequest, 'currency' | 'foreignAmount' | 'fxRate'>) =>
  (r.currency && r.currency !== 'INR' && r.foreignAmount != null
    ? `${r.currency} ${Number(r.foreignAmount).toLocaleString('en-IN', { maximumFractionDigits: 2 })} @ ₹${r.fxRate}`
    : '');

/**
 * The rupees a foreign bill comes to, for the form's preview only — the server
 * works it out again and its figure is the one saved. null until both are valid.
 */
export const previewRupees = (foreignAmount: string, fxRate: string) => {
  const a = Number(foreignAmount);
  const r = Number(fxRate);
  if (!foreignAmount || !fxRate || !Number.isFinite(a) || !Number.isFinite(r) || a <= 0 || r <= 0) return null;
  return Math.round(Math.round(a * 100) / 100 * (Math.round(r * 1e6) / 1e6) * 100) / 100;
};

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

export const listRequests = (filters: Record<string, string>, cursor?: string) => {
  const q = new URLSearchParams({ ...filters, ...(cursor ? { cursor } : {}) });
  return apiClient.get<{ requests: PaymentRequest[]; nextCursor: string | null }>(`/payment-requests?${q}`);
};
export const getRequest = (id: string) => apiClient.get<{ request: PaymentRequest }>(`/payment-requests/${id}`);
export const actOn = (id: string, action: 'approve' | 'decline' | 'hold' | 'cancel', note = '') =>
  apiClient.post<{ request: PaymentRequest }>(`/payment-requests/${id}/${action}`, { note });
