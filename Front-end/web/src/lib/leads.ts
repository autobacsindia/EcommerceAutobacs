/**
 * Sales CRM (Leads) shared types + display maps. Mirrors the backend
 * config/leadConstants.js vocabulary. Kept in one place so the list, detail and
 * offline-order screens stay consistent.
 */

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'won' | 'lost';

export type LeadSourceType =
  | 'consultation'
  | 'payment_pending'
  | 'payment_failed'
  | 'payment_cancelled'
  | 'order_cancelled'
  | 'cart_abandoned'
  | 'dormant_user';

export interface LeadSource {
  type: LeadSourceType;
  ref?: string | Record<string, unknown>;
  refModel?: string;
  capturedAt?: string;
  snapshot?: Record<string, unknown>;
}

export interface LeadActivity {
  _id?: string;
  type: 'note' | 'call' | 'email' | 'sms' | 'status_change' | 'claim' | 'assignment' | 'conversion';
  by?: { _id: string; name?: string; email?: string } | string;
  // Name-only SalesRep credited for the action (what the timeline displays).
  rep?: { _id: string; name?: string } | string | null;
  at: string;
  notes?: string;
  meta?: Record<string, unknown>;
}

export interface Lead {
  _id: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  sources: LeadSource[];
  primarySource?: LeadSourceType;
  status: LeadStatus;
  // Named owner (displayed "who claimed this"). null = unclaimed pool.
  assignedRep?: { _id: string; name?: string; isActive?: boolean } | null;
  // The admin who performed the assignment — audit only.
  assignedTo?: { _id: string; name?: string; email?: string } | null;
  assignedAt?: string | null;
  contactedBy?: { _id: string; name?: string; email?: string } | null;
  lastContactedAt?: string | null;
  nextFollowUpAt?: string | null;
  lostReason?: string;
  hasPurchased: boolean;
  linkedUser?: {
    _id: string;
    name?: string;
    email?: string;
    phone?: string;
    paidOrderCount?: number;
    firstPurchaseAt?: string | null;
    lastOrderAt?: string | null;
    totalSpentPaise?: number;
  } | null;
  activities: LeadActivity[];
  convertedOrder?: { _id: string; orderNumber?: string; totalAmount?: number; status?: string } | null;
  convertedAt?: string | null;
  // Cycle lifecycle (reopen-with-history) — see ADR-006.
  reopenCount?: number;
  cycleStartedAt?: string;
  cycles?: LeadCycle[];
  createdAt: string;
  updatedAt: string;
}

/** A name-only sales-rep profile (no login). See backend models/SalesRep.js. */
export interface SalesRep {
  _id: string;
  name: string;
  isActive?: boolean;
  createdAt?: string;
}

export interface LeadCycle {
  startedAt?: string;
  closedAt?: string;
  outcome?: LeadStatus;
  primarySource?: LeadSourceType;
  // Populated on the lead-detail GET so the Journey can name who won a cycle
  // and link its closing order; raw ObjectId on other reads.
  assignedRep?: { _id: string; name?: string } | string | null;
  convertedOrder?: { _id: string; orderNumber?: string } | string | null;
  convertedAt?: string | null;
  lostReason?: string;
  sources?: LeadSource[];
}

/** A recent order on the lead's linked account (from orderRepository.findByUser). */
export interface OrderHistoryItem {
  _id: string;
  orderNumber?: string;
  totalAmount: number;
  status: string;
  // Payment axis + who cancelled — already on the lean order doc the API returns.
  paymentStatus?: string;
  cancelledBy?: string | null;
  createdAt: string;
}

export const LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'won', 'lost'];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  won: 'Won',
  lost: 'Lost',
};

export const LEAD_STATUS_COLORS: Record<LeadStatus, string> = {
  new: 'bg-blue-100 text-blue-800',
  contacted: 'bg-amber-100 text-amber-800',
  qualified: 'bg-purple-100 text-purple-800',
  won: 'bg-green-100 text-green-800',
  lost: 'bg-gray-200 text-gray-600',
};

export const LEAD_SOURCE_LABELS: Record<LeadSourceType, string> = {
  consultation: 'Consultancy',
  payment_pending: 'Left at checkout',
  payment_failed: 'Payment failed',
  payment_cancelled: 'Payment cancelled',
  order_cancelled: 'Order cancelled',
  cart_abandoned: 'Abandoned cart',
  dormant_user: 'Never purchased',
};

/** Who initiated an order cancellation — mirrors Order.cancelledBy on the backend. */
export type CancelledByType = 'admin' | 'customer' | 'system';

export const CANCELLED_BY_LABELS: Record<CancelledByType, string> = {
  admin: 'by admin',
  customer: 'by customer',
  system: 'automatically',
};

/**
 * Read cancel attribution off an `order_cancelled` signal snapshot (or an order
 * history row). Returns the "by admin / by customer / automatically" suffix and
 * whether money had been captured, so both the Signals list and the Order
 * history rows can say who cancelled and whether a refund was in play.
 */
export function cancelAttribution(
  src: { cancelledBy?: string | null; wasPaid?: boolean } | undefined | null
): { by: string; wasPaid: boolean } | null {
  if (!src) return null;
  const key = src.cancelledBy as CancelledByType | null | undefined;
  return { by: key ? (CANCELLED_BY_LABELS[key] ?? '') : '', wasPaid: src.wasPaid === true };
}

export const LEAD_SOURCE_COLORS: Record<LeadSourceType, string> = {
  consultation: 'bg-teal-100 text-teal-800',
  payment_pending: 'bg-orange-100 text-orange-800',
  payment_failed: 'bg-red-100 text-red-800',
  payment_cancelled: 'bg-rose-100 text-rose-800',
  order_cancelled: 'bg-red-200 text-red-900',
  cart_abandoned: 'bg-yellow-100 text-yellow-800',
  dormant_user: 'bg-slate-100 text-slate-700',
};

// LTV over this (paise) earns a VIP chip. Display-only threshold; ₹50,000.
export const VIP_MIN_SPENT_PAISE = 50_00_000;

/**
 * The single "who is this person" badge shown on list + detail. Encodes the
 * ADR-006 scenarios: a returning customer (bought before + came back), a
 * reopened cold lead, or a first-time customer. Returns null for a plain new
 * prospect (the source badge already tells that story).
 */
export function customerBadge(
  lead: Pick<Lead, 'hasPurchased' | 'reopenCount'>
): { label: string; className: string } | null {
  const reopened = (lead.reopenCount ?? 0) > 0;
  if (lead.hasPurchased && reopened) return { label: 'Returning customer', className: 'bg-emerald-100 text-emerald-800' };
  if (reopened) return { label: 'Reopened', className: 'bg-amber-100 text-amber-800' };
  if (lead.hasPurchased) return { label: 'Customer', className: 'bg-green-100 text-green-800' };
  return null;
}
