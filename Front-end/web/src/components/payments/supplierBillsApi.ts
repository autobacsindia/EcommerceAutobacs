import apiClient from '@/lib/api-client';
import { postForm, type PaymentRequest } from './api';

/**
 * "We owe suppliers" — supplier bills we pay later (Back-end services/supplierBillService.js).
 * Every number here (paid, waiting, owed, left to ask, overdue) is worked out by the
 * server from the bill's payments; the screens only show it. Paying a bill is an
 * ordinary supplier payment request linked to it.
 */
export type BillState = 'unpaid' | 'part_paid' | 'paid' | 'cancelled';

export type BillPayment = {
  id: string; number: string; status: PaymentRequest['status']; statusLabel: string;
  amount: number; raisedBy: string; createdAt: string; paidAt: string | null;
};

export type SupplierBill = {
  id: string;
  number: string;
  supplier: { id: string; name: string };
  /** '' when the bill has not come yet (it is optional). */
  billNumber: string;
  billDate: string;
  dueDate: string;
  dueInDays: number;
  amount: number;
  paid: number;
  waiting: number;
  owed: number;
  leftToAsk: number;
  currency: 'INR';
  state: BillState;
  stateLabel: string;
  overdue: boolean;
  description: string;
  order: { id: string; number: string } | null;
  files: { id: string; name: string; contentType: string }[];
  payments: BillPayment[];
  createdByName: string;
  createdAt: string;
  rev: number;
  history?: { at: string; byName: string; action: string; note: string }[];
  can: { pay: boolean; edit: boolean; cancel: boolean };
};

export type BillShow = 'owed' | 'paid' | 'cancelled';
export type BillDue = '' | 'overdue' | 'week';
export type BillFilters = { show: BillShow; due: BillDue; supplier: string };

export type BillPage = {
  bills: SupplierBill[];
  nextCursor: string | null;
  summary?: { count: number; capped: boolean; owed: number | null };
};

export type OwedRow = {
  id: string; name: string; bills: number; owed: number; overdueBills: number; overdue: number; nextDue: string;
};
export type OwedBySupplier = { suppliers: OwedRow[]; total: { owed: number; overdue: number } };

export const billKeys = {
  all: ['supplier-bills'] as const,
  list: (f: BillFilters) => ['supplier-bills', 'list', f] as const,
  bySupplier: () => ['supplier-bills', 'by-supplier'] as const,
  one: (id: string) => ['supplier-bills', 'one', id] as const,
};

const enc = encodeURIComponent;

export function listBills(f: BillFilters, cursor = '') {
  const q = new URLSearchParams();
  if (f.show !== 'owed') q.set('show', f.show);
  if (f.due) q.set('due', f.due);
  if (f.supplier) q.set('supplier', f.supplier);
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return apiClient.get<BillPage>(`/supplier-bills${s ? `?${s}` : ''}`);
}
export const getOwedBySupplier = () => apiClient.get<OwedBySupplier>('/supplier-bills/by-supplier');
export const getBill = (id: string) => apiClient.get<{ bill: SupplierBill }>(`/supplier-bills/${enc(id)}`);
export const billFileHref = (id: string, fileId: string) => `/api/v1/supplier-bills/${enc(id)}/files/${enc(fileId)}`;

export type BillInput = {
  supplierId?: string; billNumber: string; billDate: string; dueDate: string; amount: string;
  description: string; orderId?: string | null; clientId?: string; rev?: number;
};

function billForm(fields: BillInput, files: File[]) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    form.append(k, v === null ? '' : String(v));
  }
  for (const f of files) form.append('bill', f);
  return form;
}
export const addBill = (fields: BillInput, files: File[]) =>
  postForm<{ bill: SupplierBill }>('/supplier-bills', billForm(fields, files));
export const editBill = (id: string, fields: BillInput, files: File[]) =>
  postForm<{ bill: SupplierBill }>(`/supplier-bills/${enc(id)}`, billForm(fields, files), 'PUT');
export const cancelBill = (id: string, reason: string) =>
  apiClient.post<{ bill: SupplierBill }>(`/supplier-bills/${enc(id)}/cancel`, { reason });

/** "Pay": an ordinary supplier payment request for all or part of the bill, sent to accounts. */
export function payBill(billId: string, fields: { amount: string; description: string; clientId: string }, files: File[]) {
  const form = new FormData();
  form.append('supplierBillId', billId);
  form.append('amount', fields.amount);
  if (fields.description.trim()) form.append('description', fields.description.trim());
  form.append('clientId', fields.clientId);
  for (const f of files) form.append('bill', f);
  return postForm<{ request: PaymentRequest }>('/payment-requests/supplier', form);
}

/** "Due in 3 days", "Due today", "5 days overdue". */
export function dueText(b: Pick<SupplierBill, 'dueInDays' | 'state'>) {
  if (b.state === 'paid' || b.state === 'cancelled') return '';
  if (b.dueInDays < 0) return `${-b.dueInDays} day${b.dueInDays === -1 ? '' : 's'} overdue`;
  if (b.dueInDays === 0) return 'Due today';
  return `Due in ${b.dueInDays} day${b.dueInDays === 1 ? '' : 's'}`;
}
