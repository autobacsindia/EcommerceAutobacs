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
  list: (q: string, status: string) => [...supplierKeys.all, 'list', q, status] as const,
};

/** Under paymentKeys.all, so a payment change refreshes the queue too. */
export const payQueueKeys = {
  groups: () => ['payment-requests', 'to-pay-suppliers'] as const,
  group: (id: string) => ['payment-requests', 'to-pay-suppliers', id] as const,
};

export const listSuppliers = (q = '', status = 'active', after = '') => {
  const params = new URLSearchParams({ status, ...(q ? { q } : {}), ...(after ? { after } : {}) });
  return apiClient.get<{ suppliers: Supplier[]; nextAfter: string | null }>(`/suppliers?${params}`);
};
export const createSupplier = (body: SupplierInput) => apiClient.post<{ supplier: Supplier }>('/suppliers', body);
export const updateSupplier = (id: string, body: SupplierInput) => apiClient.put<{ supplier: Supplier }>(`/suppliers/${encodeURIComponent(id)}`, body);
export const setSupplierActive = (id: string, active: boolean) =>
  apiClient.post<{ supplier: Supplier }>(`/suppliers/${encodeURIComponent(id)}/active`, { active });

export const listPayGroups = () => apiClient.get<{ groups: PayGroup[]; truncated: boolean }>('/payment-requests/to-pay/suppliers');
export const getPayGroup = (id: string) => apiClient.get<{
  group: { id: string; name: string; destination: string; total: number; requests: PaymentRequest[] };
}>(`/payment-requests/to-pay/suppliers/${encodeURIComponent(id)}`);

/** Sum in paise so 0.1 + 0.2 is 0.3 — the server compares this total to the paise. */
export const sumRupees = (amounts: number[]) => Math.round(amounts.reduce((n, a) => n + Math.round(a * 100), 0)) / 100;
