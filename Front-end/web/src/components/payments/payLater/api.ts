import { staffKeys } from '@/hooks/queries/keys';
import type { SalesTypeChangeOption, SalesTypeInfo } from '@/components/staff/sales/types';

/** The pay-later block the server puts on an order (Back-end utils/payLater.js shapePayLater). */
export interface PayLaterState {
  label: string;
  due: boolean;
  approvedAt: string;
  approvedBy: string;
  reason: string;
  dispatchedAt: string | null;
  dueAt: string | null;
  overdueDays: number;
  linkSentAt: string | null;
  payUrl: string | null;
  payUrlExpiresAt: string | null;
  linkBlocked: string | null;
  reminders: number;
}

/** One row of the "Shipped – payment due" list (services/payLaterService.js shapeRow). */
export interface PayLaterRow {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  amount: number;
  paidAt: string | null;
  customer: { name: string; phone: string; city: string };
  salesPerson: string;
  bankTransferPending: boolean;
  payLater: PayLaterState | null;
}

/** The server's sum: the screens never add money themselves. */
export interface PayLaterSummary {
  owed: number;
  count: number;
  overdue: number;
  dueDays: number;
}

export interface PayLaterOption {
  /** B2B / B2C + accounts' check; null on a website order. */
  salesType?: SalesTypeInfo | null;
  /** "Change to B2B / B2C" on the order page; null on a website order. */
  typeChange?: SalesTypeChangeOption | null;
  canApprove: boolean;
  /** Ship before payment is on, unpaid and nothing sent: it can be taken back. */
  canWithdraw?: boolean;
  /** The latest take-back, if any (who and why are in `notes`). */
  withdrawn?: { at: string | null; notes: string } | null;
  why?: string | null;
  approved?: PayLaterRow;
  dueDays: number;
  owed?: number;
}

export const payLaterKeys = {
  all: [...staffKeys.all, 'pay-later'] as const,
  list: (view: string) => [...payLaterKeys.all, 'list', view] as const,
  option: (orderId: string) => [...payLaterKeys.all, 'option', orderId] as const,
};

/** One row of the B2B / B2C lists (services/salesTypeService.js shapeRow). */
export interface SalesTypeRow {
  id: string;
  orderNumber: string;
  createdAt: string;
  status: string;
  paymentStatus: string;
  amount: number;
  customer: { name: string; phone: string; city: string };
  salesPerson: string;
  bankTransferPending: boolean;
  salesType: SalesTypeInfo;
  typeChange?: SalesTypeChangeOption | null;
  payLater: PayLaterState | null;
}

export const salesTypeKeys = {
  all: [...staffKeys.all, 'sales-type'] as const,
  list: (view: string) => [...salesTypeKeys.all, 'list', view] as const,
};

export const LINK_BLOCKED_TEXT: Record<string, string> = {
  part_cancelled: 'Part of this order was cancelled, so no link went out for the old total. Settle the amount with the customer.',
};

/** Colour for the label the server sends. */
export const payLaterTone = (label: string) => {
  if (/overdue/i.test(label)) return 'bg-red-100 text-red-800';
  if (/^Paid/.test(label)) return 'bg-green-100 text-green-800';
  if (/closed/i.test(label)) return 'bg-gray-200 text-gray-700';
  return 'bg-amber-100 text-amber-800';
};
