/**
 * Subscriptions & dues (Back-end routes/subscriptionDues.js): the tools and
 * bills each team pays for, checked by accounts. Who may do what is the
 * server's call — each item says it in `can`.
 */
import apiClient from '@/lib/api-client';
import { postForm } from '../api';

export type SubscriptionStatus = 'pending' | 'verified' | 'rejected';
export type SubscriptionKind = 'monthly' | 'yearly' | 'one_time';
export type PayMethod = 'card' | 'upi' | 'bank_transfer';

export type Subscription = {
  id: string;
  number: string;
  name: string;
  purpose: string;
  team: string;
  teamLabel: string;
  kind: SubscriptionKind;
  kindLabel: string;
  /** As billed, in `currency`. For a usage-based bill (`variableAmount`) this is the ESTIMATE. */
  amount: number;
  /** "Amount varies (usage-based)": each cycle's actual bill is recorded in `cycles`. */
  variableAmount: boolean;
  currency: string;
  /** A rough rupee guide for a foreign bill, worked out by the server on read — never stored. */
  approxInr: number | null;
  /** The due day in India, YYYY-MM-DD. */
  dueDate: string;
  dueInDays: number;
  overdue: boolean;
  payment: { method: PayMethod; methodLabel: string; cardLast4: string; autoDebit: boolean };
  billingUrl: string;
  notes: string;
  files: { id: string; name: string; contentType: string; bytes: number }[];
  status: SubscriptionStatus;
  statusLabel: string;
  rejectReason: string;
  verifiedByName: string;
  verifiedAt: string | null;
  addedBy: string;
  addedByName: string;
  /** Deleted (archived): only ever seen in the reply to the delete itself. */
  archived: boolean;
  /** The version on screen: sent back with every change, so a stale screen cannot overwrite a newer one. */
  rev: number;
  createdAt: string;
  updatedAt: string;
  /** This due day, once marked paid: waiting for accounts / approved / rejected (paid moves the due date on). In the list too. */
  current: BillCycle | null;
  /** The paid history, oldest first (one item read only — never in the list). */
  cycles?: BillCycle[];
  history?: { at: string; byName: string; role: string; action: string; note: string }[];
  can: { edit: boolean; delete: boolean; verify: boolean; reject: boolean; markPaid: boolean };
};

/** waiting: accounts to approve · approved: the admin to pay · paid · rejected: due again. */
export type CycleState = 'waiting' | 'approved' | 'paid' | 'rejected';
export type PaidVia = 'card' | 'upi' | 'bank' | 'auto_debit';

/** One cycle marked paid: "Nov 2026 — USD 112, paid by card, PR-0912 waiting for accounts". */
export type BillCycle = {
  id: string;
  /** The cycle's due day, YYYY-MM-DD. */
  dueDate: string;
  /** The bill, in `currency`. */
  amount: number;
  currency: string;
  /** The plan amount (or estimate) at the time. */
  estimate: number | null;
  approxInr: number | null;
  /** What it cost in rupees, once known. */
  rupees: number | null;
  state: CycleState;
  stateLabel: string;
  /** The expense raised for it in Payments (none on bills recorded before "Mark paid"). */
  expense: { id: string; number: string } | null;
  alreadyPaid: boolean;
  paidVia: PaidVia | '';
  paidViaLabel: string;
  /** YYYY-MM-DD */
  paidOn: string;
  reference: string;
  amountReason: string;
  rejectReason: string;
  note: string;
  /** Who marked it paid, and when. */
  paidByName: string;
  paidAt: string;
  /** Older bills only: their invoice. New ones keep the receipt on the expense. */
  invoices: { id: string; name: string; contentType: string; bytes: number }[];
};

export type MonthlyTotal = { month: string; bills: number; rupees: number; unpriced: number };

export type SubscriptionOptions = {
  kinds: { value: SubscriptionKind; label: string }[];
  methods: { value: PayMethod; label: string }[];
  currencies: { code: string; label: string; approxInrPerUnit: number | null }[];
  baseCurrency: string;
  /** Accounts / admin: the teams they may add for. Empty for everyone else (their own team). */
  teams: { value: string; label: string }[];
  team: string | null;
  canCheck: boolean;
  paidVia: { value: PaidVia; label: string }[];
  /** "Mark paid" shows from this many days before the due day. */
  markPaidFromDays: number;
};

export type SubscriptionPage = {
  items: Subscription[];
  nextCursor: string | null;
  summary?: { count: number; capped: boolean };
};

export const subscriptionKeys = {
  all: ['subscription-dues'] as const,
  list: (filters: Record<string, string>) => [...subscriptionKeys.all, 'list', filters] as const,
  one: (id: string) => [...subscriptionKeys.all, 'one', id] as const,
  options: () => [...subscriptionKeys.all, 'options'] as const,
  monthly: (team: string) => [...subscriptionKeys.all, 'monthly', team] as const,
};

export const CYCLE_TONE: Record<CycleState, string> = {
  waiting: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

export const STATUS_TONE: Record<SubscriptionStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  verified: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

export const listSubscriptions = (filters: Record<string, string>, cursor?: string) => {
  const q = new URLSearchParams({ ...filters, ...(cursor ? { cursor } : {}) });
  return apiClient.get<SubscriptionPage>(`/subscription-dues?${q}`);
};
export const getSubscription = (id: string) => apiClient.get<{ item: Subscription }>(`/subscription-dues/${encodeURIComponent(id)}`);
export const getSubscriptionOptions = () => apiClient.get<{ options: SubscriptionOptions }>('/subscription-dues/options');
export const saveSubscription = (form: FormData, id?: string) => (id
  ? postForm<{ item: Subscription }>(`/subscription-dues/${encodeURIComponent(id)}`, form, 'PUT')
  : postForm<{ item: Subscription }>('/subscription-dues', form));
/**
 * Mark this due cycle paid: rev, alreadyPaid, paidVia, paidOn, reference, amount?, amountReason?,
 * rupees?, note?, invoice (receipt). Raises ONE expense in Payments for accounts to approve.
 */
export const markPaid = (id: string, form: FormData) =>
  postForm<{ item: Subscription }>(`/subscription-dues/${encodeURIComponent(id)}/mark-paid`, form);
/** Paid bills per month, in rupees (a team: its own; accounts / admin: every team, or `team`). */
export const getMonthlyTotals = (team = '') =>
  apiClient.get<{ months: MonthlyTotal[] }>(`/subscription-dues/monthly${team ? `?team=${encodeURIComponent(team)}` : ''}`);
export const verifySubscription = (s: Pick<Subscription, 'id' | 'rev'>) =>
  apiClient.post<{ item: Subscription }>(`/subscription-dues/${encodeURIComponent(s.id)}/verify`, { rev: s.rev });
export const rejectSubscription = (s: Pick<Subscription, 'id' | 'rev'>, reason: string) =>
  apiClient.post<{ item: Subscription }>(`/subscription-dues/${encodeURIComponent(s.id)}/reject`, { rev: s.rev, reason });
export const archiveSubscription = (s: Pick<Subscription, 'id' | 'rev'>, reason: string) =>
  apiClient.post<{ item: Subscription }>(`/subscription-dues/${encodeURIComponent(s.id)}/archive`, { rev: s.rev, reason });
export const invoiceHref = (id: string, fileId: string) =>
  `/api/v1/subscription-dues/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`;

/** "USD 20" / "₹1,500"; a usage-based bill's estimate is "~USD 100". */
export const billText = (s: Pick<Subscription, 'amount' | 'currency'> & { variableAmount?: boolean }) => `${s.variableAmount ? '~' : ''}${s.currency === 'INR'
  ? `₹${Number(s.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
  : `${s.currency} ${Number(s.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}`;

/** " (estimate)" after a usage-based bill's amount; '' for a fixed one. */
export const estimateText = (s: Pick<Subscription, 'variableAmount'>) => (s.variableAmount ? ' (estimate)' : '');

/** "Nov 2026" — the month a cycle was due in. */
export const monthText = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'short', year: 'numeric' });

/** "about ₹1,760" — a label only; '' for rupees or a currency with no rough rate. */
export const approxText = (approxInr: number | null | undefined) =>
  (approxInr ? `about ₹${Number(approxInr).toLocaleString('en-IN')}` : '');

/** "/month", "/year" or '' for a one-time purchase. */
export const perText = (kind: SubscriptionKind) => (kind === 'monthly' ? '/month' : kind === 'yearly' ? '/year' : '');

/** "2 Dec 2026" from YYYY-MM-DD, read as a calendar day (no time zone shift). */
export const dayText = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

/** "Overdue by 3 days", "Due today", "Due in 5 days". */
export function dueText(s: Pick<Subscription, 'dueInDays'>) {
  const d = s.dueInDays;
  if (d < 0) return `Overdue by ${-d} day${d === -1 ? '' : 's'}`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  return `Due in ${d} days`;
}

/** "₹54,700" */
export const rupeeText = (n: number) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** "Card 4007 · auto-debit" */
export const payText = (p: Subscription['payment']) =>
  [p.method === 'card' ? `Card ${p.cardLast4}` : p.methodLabel, p.autoDebit ? 'auto-debit' : ''].filter(Boolean).join(' · ');

/**
 * Does the text hold what looks like a full card number (12–19 digits passing
 * the Luhn check)? The same rule as the server (utils/cardNumber.js) — checked
 * here only so the form can say so before sending; the server decides.
 */
export function looksLikeCardNumber(text: string) {
  const runs = String(text || '').match(/\d(?:[ -]?\d)+/g) || [];
  return runs.some((run) => {
    const digits = run.replace(/[ -]/g, '');
    if (digits.length < 12 || digits.length > 19) return false;
    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let d = digits.charCodeAt(i) - 48;
      if (double) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
      double = !double;
    }
    return sum % 10 === 0;
  });
}
