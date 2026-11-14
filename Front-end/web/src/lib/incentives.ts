/**
 * Roav Points (sales incentives) — types and small helpers shared by the admin
 * screen, the champion banner and the sales board. All figures are computed
 * by the server (backend services/incentives/); nothing here does money maths.
 */
export interface Slab { name: string; minPoints: number; ratePerPoint: number }
export interface NextSlab { name: string; minPoints: number; pointsToGo: number }

export interface Statement {
  earnerKey: string;
  name: string;
  orders: number;
  returnedOrders: number;
  ratingCount: number;
  ratingAvg: number | null;
  ledgerPoints: number;
  returnRate: number;
  returnFactor: number;
  ratingFactor: number;
  finalPoints: number;
  slab: string | null;
  ratePerPoint: number;
  payoutPaise: number;
  payout: number;
  multipliersDropped?: boolean;
  next?: NextSlab | null;
}

export interface MonthHistory { action: 'locked' | 'approved' | 'reopened'; at: string; byName: string; reason?: string }

export interface MonthView {
  month: string;
  status: 'open' | 'locked' | 'approved';
  rulesVersion: number;
  statements: Statement[];
  champion: Champion | null;
  history: MonthHistory[];
  totalPayout: number;
  lockedAt?: string;
  approvedAt?: string;
}

export interface Champion {
  month: string;
  name: string;
  finalPoints: number;
  payout: number;
  slab: string | null;
  ratingAvg: number | null;
  showBanner: boolean;
}

export interface LedgerRow {
  _id: string;
  type: 'earn' | 'reverse';
  orderNumber: string;
  component: string;
  points: number;
  reason: string | null;
  eventAt: string;
  month?: string;
  earnerName?: string;
  inputs?: {
    valueExGst?: number; discountPercent?: number; discountKeep?: number; specialSourcing?: boolean;
    isB2B?: boolean; label?: string; quantity?: number; landedLate?: boolean;
  };
}

/** GET /incentives/me — my month (snapshot once the month is closed). */
export interface MyMonth {
  month: string;
  status: 'open' | 'locked' | 'approved';
  rulesVersion: number;
  statement: Statement | null;
  points: number;
  slab: string | null;
  payout: number;
  next: NextSlab | null;
  slabs: Slab[];
  policy: {
    rating: Rules['rating'];
    returnRateThresholdPercent: number;
    returnPenaltyMultiplier: number;
    perOrderBonus: number;
    perOrderBonusMinValue: number;
  };
  bonusOrders: number;
  ratingsExcluded: number;
}

export interface MyOrderLine {
  _id: string;
  type: 'earn' | 'reverse';
  component: string;
  points: number;
  reason: string | null;
  eventAt: string;
  rev?: number;
  label?: string;
  quantity?: number;
  fraction?: number;
  earnMonth?: string;
  landedLate?: boolean;
}

export type MyOrderStatus = 'counted' | 'partly_reversed' | 'reversed' | 'pending';

export interface MyOrder {
  order: string;
  orderNumber: string;
  date: string | null;
  customerName: string;
  valueExGst: number | null;
  discountPercent: number | null;
  discountKeep: number | null;
  portions: { from: number; to: number; multiplier: number }[];
  specialSourcing: boolean;
  sourcingKeep: number | null;
  isB2B: boolean;
  basePoints: number;
  bonusPoints: number;
  points: number;
  status: MyOrderStatus;
  rating: { stars: number; comment: string; counted: boolean } | null;
  lines: MyOrderLine[];
}

export interface MyPendingOrder { order: string; orderNumber: string; date: string; customerName: string; status: 'pending' }

export interface MyOrdersPage { orders: MyOrder[]; nextCursor: string | null; pending: MyPendingOrder[]; ratingDetails: boolean }

export interface MyRatings {
  visible: boolean;
  ratings: { orderNumber: string; customerName: string; stars: number; comment: string; at: string; counted: boolean }[];
}

export interface Rules {
  basePointsPerRupee: number;
  gstRate: number;
  brackets: { upTo: number | null; multiplier: number }[];
  discountKeep: { maxPercent: number | null; keep: number }[];
  discountTolerancePercent: number;
  b2bDealerDiscountPercent: number;
  specialSourcingKeep: number;
  perOrderBonus: number;
  perOrderBonusMinValue: number;
  priorityProducts: { key: string; label: string; productIds: string[]; b2c: number; b2b: number }[];
  returnWindowDays: number;
  returnRateThresholdPercent: number;
  returnPenaltyMultiplier: number;
  rating: { minCount: number; highAvg: number; highMultiplier: number; lowAvg: number; lowMultiplier: number };
  slabs: Slab[];
  multiplierSlabCap: string | null;
  championBannerDays: number;
}

export interface RuleVersion { version: number; effectiveFrom: string; note: string; createdByName: string; createdAt: string; rules: Rules }

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** The current IST month, 'YYYY-MM'. */
export function currentMonthIST(now = new Date()): string {
  const d = new Date(now.getTime() + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export const points = (n: number) => Math.round(n).toLocaleString('en-IN');
export const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What a ledger row was for, in plain words. */
export function describeRow(r: LedgerRow): string {
  const what = r.component === 'core' ? 'Order value'
    : r.component === 'order' ? 'Paid order bonus'
      : r.component.startsWith('bonus:') ? (r.inputs?.label || 'Priority product') : r.component;
  if (r.type === 'earn') return what;
  const why = { return: 'returned', refund: 'refunded', cancel: 'cancelled', recompute: 'recalculated' }[r.reason || ''] || 'reversed';
  return `${what} — ${why}`;
}

/** What a line on "My Roav Points" was for, in plain words. */
export function describeMyLine(l: MyOrderLine, month?: string): string {
  const what = l.component === 'core' ? 'Order value'
    : l.component === 'order' ? 'Paid order bonus'
      : l.component.startsWith('bonus:') ? (l.label || 'Priority product') : l.component;
  if (l.type === 'earn') return l.rev ? `${what} (recalculated)` : what;
  const why: Record<string, string> = {
    return: 'returned', refund: 'refunded', cancel: 'cancelled', recompute: 'recalculated (seller or sourcing changed)',
  };
  // A reversal landing in a later month says which month the points were earned in.
  const late = l.earnMonth && l.earnMonth !== month ? ` — from ${monthLabel(l.earnMonth)}` : '';
  return `${what} — ${why[l.reason || ''] || 'reversed'}${late}`;
}

/** The rating multiplier, in plain words, from the month's counted ratings. */
export function ratingStatus(count: number, avg: number | null, rule: Rules['rating']): { label: string; factor: number } {
  if (count < rule.minCount) {
    return { label: `${count} of ${rule.minCount} ratings needed — no change yet`, factor: 1 };
  }
  if (avg != null && avg >= rule.highAvg) return { label: `Average ${avg}★ — bonus ×${rule.highMultiplier}`, factor: rule.highMultiplier };
  if (avg != null && avg < rule.lowAvg) return { label: `Average ${avg}★ — reduced ×${rule.lowMultiplier}`, factor: rule.lowMultiplier };
  return { label: `Average ${avg ?? '—'}★ — no change`, factor: 1 };
}
