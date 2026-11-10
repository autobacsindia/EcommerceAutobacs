import { staffKeys } from '@/hooks/queries/keys';

/** One extra charge as the server shapes it (services/orderExtraChargeService.js). */
export interface ExtraCharge {
  id: string;
  orderId: string;
  orderNumber: string;
  customer: { name: string; city: string };
  salesPerson: string;
  sequence: number;
  amount: number;
  reason: string;
  status: 'awaiting_accounts' | 'approved' | 'paid' | 'rejected' | 'cancelled';
  statusLabel: string;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string;
  decidedAt: string | null;
  decisionNote: string;
  paidVia: 'razorpay' | 'bank_transfer' | null;
  paidAt: string | null;
  receiptNo: number | null;
  payUrl: string | null;
  payBy: string | null;
  bankTransferPending: boolean;
  refund: {
    status: 'due' | 'processing' | 'completed' | 'failed';
    dueReason: string;
    method: 'razorpay' | 'offline' | null;
    reference: string;
    completedAt: string | null;
    failureReason: string;
    by: string;
  } | null;
  can: { edit: boolean; cancel: boolean; decide: boolean; sendLink: boolean; recordBank: boolean; refund: boolean };
}

/** The server's sum: the screens never add money themselves. */
export interface ExtraTotals {
  original: number;
  extrasPaid: number;
  extrasRefunded: number;
  extrasRefundDue: number;
  extrasWaiting: number;
  finalAmount: number;
}

export interface OrderExtras { extras: ExtraCharge[]; totals: ExtraTotals; canAdd: boolean }

export const extraKeys = {
  all: [...staffKeys.all, 'extra-charges'] as const,
  order: (orderId: string) => [...extraKeys.all, 'order', orderId] as const,
  list: (tab: string) => [...extraKeys.all, 'list', tab] as const,
};

export const extraUrl = (id: string, action = '') => `/staff/extra-charges/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
export const receiptHref = (id: string) => `/api/v1${extraUrl(id, 'receipt')}`;

export const EXTRA_TONE: Record<string, string> = {
  'Waiting for Accounts': 'bg-amber-100 text-amber-800',
  Paid: 'bg-green-100 text-green-800',
  Refunded: 'bg-gray-200 text-gray-700',
  'Refund due': 'bg-red-100 text-red-800',
  'Refund failed': 'bg-red-100 text-red-800',
  'Rejected by Accounts': 'bg-red-100 text-red-800',
  Cancelled: 'bg-gray-200 text-gray-700',
};
export const toneOf = (label: string) => EXTRA_TONE[label] ?? 'bg-blue-100 text-blue-800';

/** One key per form opened: pressing Save twice makes one extra. */
export const newClientKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
