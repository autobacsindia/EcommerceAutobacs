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
