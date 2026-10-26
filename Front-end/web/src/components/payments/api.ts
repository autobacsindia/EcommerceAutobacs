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
  amount: number;
  category: string;
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
  payment: { method: string; reference: string; paidAt: string; paidByName: string } | null;
  decisionNote: string;
  history: { at: string; byName: string; role: string; action: string; note: string }[];
  createdAt: string;
  can: { approve: boolean; decline: boolean; pay: boolean; hold: boolean; cancel: boolean; edit?: boolean; editPayment?: boolean };
  /** The requester may edit until then (null for admins, or once it can no longer be edited). */
  editableUntil?: string | null;
};

export type OrderPayment = {
  id: string; number: string; status: PaymentStatus; statusLabel: string; amount: number;
  /** The viewer may still edit it (time limit for the requester; the admin until paid). */
  canEdit?: boolean;
  itemIds: string[]; itemNames: string[]; payee: string; paidAt: string | null; createdAt: string;
};

export const EXPENSE_CATEGORIES = [
  { value: 'fuel', label: 'Fuel' },
  { value: 'travel', label: 'Travel' },
  { value: 'food', label: 'Food' },
  { value: 'purchase', label: 'Purchase for the company' },
  { value: 'other', label: 'Other' },
] as const;

export const STATUS_TONE: Record<PaymentStatus, string> = {
  submitted: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
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
};

export const slipHref = (id: string) => `/api/v1/payment-requests/${encodeURIComponent(id)}/slip`;
export const fileHref = (id: string, fileId: string) => `/api/v1/payment-requests/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`;

export const errorMessage = (e: unknown, fallback: string) =>
  (e as { rawData?: { message?: string; errors?: { msg?: string }[] } })?.rawData?.message
  || (e as { rawData?: { errors?: { msg?: string }[] } })?.rawData?.errors?.[0]?.msg
  || fallback;

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
