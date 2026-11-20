import apiClient from '@/lib/api-client';

/**
 * Supplier credit — what a supplier owes us (Back-end services/supplierLedgerService.js).
 * Every number here is worked out by the server; the screens only show it.
 *
 *   refund due (order cancelled after we paid)   + owes us more
 *   supplier paid back / credit used / written off − owes us less
 */
export type CreditKind = 'refund_due' | 'repaid' | 'credit_used' | 'credit_restored' | 'written_off' | 'correction_up' | 'correction_down';
export type CreditStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

export type CreditBalance = {
  currency: string;
  owed: number;
  owedText: string;
  /** Waiting for accounts, signed: + a refund claim, − a repayment. */
  pending: number;
  pendingText: string;
};

export type CreditEntry = {
  id: string;
  kind: CreditKind;
  kindLabel: string;
  status: CreditStatus;
  statusLabel: string;
  supplier: { id: string; name: string };
  currency: string;
  amount: number;
  signedAmount: number;
  amountText: string;
  order: { id: string; number: string } | null;
  paymentRequest: { id: string; number: string } | null;
  date: string;
  reference: string;
  note: string;
  createdByName: string;
  createdAt: string;
  decidedByName: string;
  decidedAt: string | null;
  decisionNote: string;
  history: { at: string; byName: string; action: string; note: string }[];
  /** Goes up with every edit; an approval or edit names the version it saw. */
  rev: number;
  /** A correction: the approved entry it corrects. */
  correctionOf: { id: string; kindLabel: string } | null;
  /** An approved entry after its approved corrections (null when never corrected). */
  correctedAmount: number | null;
  correctedAmountText: string;
  correctionPending: boolean;
  edits: CreditEdit[];
  can: { approve: boolean; decline: boolean; cancel: boolean; edit: boolean };
};

/** Who changed an entry, when, why, and what (old → new, as people read it). */
export type CreditEdit = {
  at: string;
  byName: string;
  reason: string;
  changes: { field: string; from: string; to: string }[];
};

export type CreditEditInput = {
  reason: string;
  rev: number;
  formKey: string;
  amount?: number;
  currency?: string;
  date?: string;
  reference?: string;
  note?: string;
};

export type SupplierCreditPage = {
  supplier: { id: string; name: string };
  /** First page only. */
  balances?: CreditBalance[];
  entries: CreditEntry[];
  nextAfter: string | null;
  can: { propose: boolean; writeOff: boolean };
};

export type OwingRow = CreditBalance & { supplier: { id: string; name: string } };

/** Under supplierKeys.all ('suppliers'), so a supplier change refreshes credit too. */
export const creditKeys = {
  all: ['suppliers', 'credit'] as const,
  supplier: (id: string) => [...creditKeys.all, 'supplier', id] as const,
  pending: () => [...creditKeys.all, 'pending'] as const,
  owing: () => [...creditKeys.all, 'owing'] as const,
};

const enc = encodeURIComponent;
export const getSupplierCredit = (id: string, after = '') =>
  apiClient.get<SupplierCreditPage>(`/suppliers/${enc(id)}/credit${after ? `?after=${enc(after)}` : ''}`);
export const getPendingCredit = (after = '') =>
  apiClient.get<{ entries: CreditEntry[]; nextAfter: string | null }>(`/suppliers/credit/pending${after ? `?after=${enc(after)}` : ''}`);
export const getOwing = () => apiClient.get<{ suppliers: OwingRow[]; capped: boolean }>('/suppliers/credit/owing');

export const claimRefund = (body: { paymentRequestId: string; amount?: number; note?: string }) =>
  apiClient.post<{ entry: CreditEntry }>('/suppliers/credit/claims', body);
export const recordRepayment = (supplierId: string, body: { currency: string; amount: number; date: string; reference: string; note: string; formKey: string }) =>
  apiClient.post<{ entry: CreditEntry }>(`/suppliers/${enc(supplierId)}/credit/repayments`, body);
export const writeOff = (supplierId: string, body: { currency: string; amount: number; note: string; formKey: string }) =>
  apiClient.post<{ entry: CreditEntry }>(`/suppliers/${enc(supplierId)}/credit/write-offs`, body);
export const decideCredit = (entryId: string, action: 'approve' | 'decline' | 'cancel', note = '', rev?: number) =>
  apiClient.post<{ entry: CreditEntry }>(`/suppliers/credit/${enc(entryId)}/${action}`, { note, ...(rev === undefined ? {} : { rev }) });
/** Pending: changed in place. Approved: a new amount raises a correction (waits for accounts). */
export const editCredit = (entryId: string, body: CreditEditInput) =>
  apiClient.post<{ entry: CreditEntry; correction?: CreditEntry }>(`/suppliers/credit/${enc(entryId)}/edit`, body);

export const creditReportHref = (from: string, to: string) =>
  `/api/v1/suppliers/credit/report.csv?from=${enc(from)}&to=${enc(to)}`;

/** One id per form opening: a double-clicked or retried submit saves once (the server keys on it). */
export const newFormKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** Today in India, 'YYYY-MM-DD'. */
export const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
