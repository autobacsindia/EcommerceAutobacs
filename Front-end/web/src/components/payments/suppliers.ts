import apiClient from '@/lib/api-client';
import type { PaymentRequest } from './api';

/**
 * The supplier directory and the admin's "to pay, by supplier" queue. The
 * server decides who sees what: the full account number reaches only the
 * people who edit suppliers (procurement, admin).
 */
export type SupplierPayment = {
  method: 'bank' | 'upi';
  upiId: string;
  accountName: string;
  /** Empty unless the viewer may edit suppliers. */
  accountNumber: string;
  accountMasked: string;
  ifsc: string;
  /** A foreign bank's SWIFT code — set instead of `ifsc` ('' on older suppliers). */
  swift: string;
  bankName: string;
};

export type Supplier = {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  notes: string;
  payment: SupplierPayment;
  active: boolean;
  bankChangedAt: string | null;
  bankChangedBy: string;
  updatedAt: string;
  can: { edit: boolean };
};

export type SupplierInput = Omit<Supplier, 'id' | 'active' | 'bankChangedAt' | 'bankChangedBy' | 'updatedAt' | 'can' | 'payment'> & {
  payment: Omit<SupplierPayment, 'accountMasked'>;
};

export type PayGroup = {
  id: string;
  name: string;
  method: 'bank' | 'upi';
  destination: string;
  count: number;
  total: number;
  onHold: number;
  bankNotice: boolean;
  oldestAt: string;
};

export const supplierKeys = {
  all: ['suppliers'] as const,
  list: (params: Record<string, string>) => [...supplierKeys.all, 'list', params] as const,
};

/** Under paymentKeys.all, so a payment change refreshes the queue too. */
export const payQueueKeys = {
  groups: (params: Record<string, string> = {}) => ['payment-requests', 'to-pay-suppliers', 'list', params] as const,
  group: (id: string) => ['payment-requests', 'to-pay-suppliers', id] as const,
};

export type SupplierPage = {
  suppliers: Supplier[];
  nextAfter: string | null;
  sort: string;
  /** First page only: how many match. */
  summary?: { count: number; capped: boolean };
};
/**
 * `params`: q (every word anywhere: name, contact, phone, GSTIN, UPI, IFSC, bank,
 * last four account digits…) or prefix (the picker: name starts with), status (active / inactive / all), method (bank /
 * upi), changed=recent, sort (name / newest / updated). The server filters.
 */
export const listSuppliers = (params: Record<string, string>, after = '') => {
  const qs = new URLSearchParams({ status: 'active', ...params, ...(after ? { after } : {}) });
  return apiClient.get<SupplierPage>(`/suppliers?${qs}`);
};
export const createSupplier = (body: SupplierInput) => apiClient.post<{ supplier: Supplier }>('/suppliers', body);
export const updateSupplier = (id: string, body: SupplierInput) => apiClient.put<{ supplier: Supplier }>(`/suppliers/${encodeURIComponent(id)}`, body);
export const setSupplierActive = (id: string, active: boolean) =>
  apiClient.post<{ supplier: Supplier }>(`/suppliers/${encodeURIComponent(id)}/active`, { active });

export type PayGroupList = {
  groups: PayGroup[];
  sort: string;
  /** The groups shown (after search / filter) and what they add up to. */
  summary?: { count: number; total: number; capped: boolean };
  truncated: boolean;
};
/** `params`: q, method (bank / upi), sort (oldest / total_desc / count_desc / name) — the server filters. */
export const listPayGroups = (params: Record<string, string> = {}) => {
  const qs = new URLSearchParams(params).toString();
  return apiClient.get<PayGroupList>(`/payment-requests/to-pay/suppliers${qs ? `?${qs}` : ''}`);
};
export const getPayGroup = (id: string) => apiClient.get<{
  group: { id: string; name: string; destination: string; total: number; requests: PaymentRequest[] };
}>(`/payment-requests/to-pay/suppliers/${encodeURIComponent(id)}`);

/** Sum in paise so 0.1 + 0.2 is 0.3 — the server compares this total to the paise. */
export const sumRupees = (amounts: number[]) => Math.round(amounts.reduce((n, a) => n + Math.round(a * 100), 0)) / 100;
