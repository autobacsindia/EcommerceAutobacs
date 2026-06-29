// Typed client for the admin historical-analytics API (backend routes/analytics.js).
// Hits relative /api/v1/analytics/* through the Next rewrite proxy — no hardcoded host.
//
// Note: this is the DB-backed reporting API. Behavioural funnel / cart-abandonment
// analytics are instrumented separately via PostHog (see lib/analytics.ts) and live in
// PostHog's dashboards, not here.
import apiClient from '@/lib/api';

export type AnalyticsPeriod = '7d' | '30d' | '90d' | '12m';

export interface AnalyticsWindow {
  from: string;
  to: string;
  label: string;
  days: number;
  granularity: 'day' | 'week' | 'month';
}

interface Envelope<T> {
  success: boolean;
  window: AnalyticsWindow;
  data: T;
}

// ── Per-domain payload shapes (mirror analyticsReportService.js) ────────────

export interface Kpi {
  value: number;
  deltaPct: number | null;
}

export interface OverviewData {
  window: { from: string; to: string; label: string; days: number };
  revenue: Kpi;
  orders: Kpi;
  aov: Kpi;
}

export interface SalesPoint {
  bucket: string;
  revenue: number;
  orders: number;
  aov: number;
}
export interface SalesData {
  granularity: 'day' | 'week' | 'month';
  series: SalesPoint[];
  totals: { revenue: number; orders: number; aov: number };
  previous: { revenue: number; orders: number; aov: number };
  deltas: { revenuePct: number | null; ordersPct: number | null; aovPct: number | null };
}

export interface BreakdownRow {
  name: string;
  revenue: number;
  units: number;
}
export interface RevenueBreakdownData {
  byCategory: BreakdownRow[];
  byBrand: BreakdownRow[];
}

export interface ProductRow {
  productId: string;
  name: string;
  revenue: number;
  units: number;
  orders: number;
}
export interface ProductPerformanceData {
  topByRevenue: ProductRow[];
  topByUnits: ProductRow[];
  stock: { in: number; low: number; out: number };
}

export interface CustomerData {
  activeCustomers: number;
  returningCustomers: number;
  newCustomers: number;
  repeatRatePct: number;
  revenuePerCustomer: number;
  totalCustomers: number;
  registrationCohorts: { bucket: string; count: number }[];
}

export interface GeoData {
  byState: { state: string; orders: number; revenue: number }[];
  topCities: { city: string; orders: number; revenue: number }[];
}

export interface LoyaltyData {
  coupons: {
    totalUses: number;
    totalDiscount: number;
    avgDiscount: number;
    top: { code: string; uses: number; discount: number; avgDiscount: number }[];
  };
  karma: {
    earned: number;
    redeemed: number;
    expired: number;
    byType: { type: string; points: number; entries: number }[];
  };
  discountImpact: {
    gross: number;
    couponDiscount: number;
    karmaDiscount: number;
    totalDiscount: number;
    discountRatePct: number;
  };
}

export interface ReturnsPaymentsData {
  returns: { total: number; returnRatePct: number; reasons: { reason: string; count: number }[] };
  refunds: { methods: { method: string; count: number; amount: number }[] };
  payments: {
    method: string;
    gateway: string;
    count: number;
    completed: number;
    amount: number;
    successRatePct: number;
  }[];
  fulfillment: {
    avgTimeToShipHours: number;
    avgTimeToDeliverHours: number;
    deliveredCount: number;
  };
}

// ── Fetch helpers ───────────────────────────────────────────────────────────

async function fetchDomain<T>(domain: string, period: AnalyticsPeriod): Promise<T> {
  const res = await apiClient.get<Envelope<T>>(
    `/analytics/${domain}?period=${encodeURIComponent(period)}`
  );
  return res.data;
}

export const analyticsApi = {
  overview: (p: AnalyticsPeriod) => fetchDomain<OverviewData>('overview', p),
  sales: (p: AnalyticsPeriod) => fetchDomain<SalesData>('sales', p),
  revenueBreakdown: (p: AnalyticsPeriod) => fetchDomain<RevenueBreakdownData>('revenue-breakdown', p),
  products: (p: AnalyticsPeriod) => fetchDomain<ProductPerformanceData>('products', p),
  customers: (p: AnalyticsPeriod) => fetchDomain<CustomerData>('customers', p),
  geo: (p: AnalyticsPeriod) => fetchDomain<GeoData>('geo', p),
  loyalty: (p: AnalyticsPeriod) => fetchDomain<LoyaltyData>('loyalty', p),
  returnsPayments: (p: AnalyticsPeriod) => fetchDomain<ReturnsPaymentsData>('returns-payments', p),
};

// URL for a CSV export of a domain (opened directly so the browser downloads it,
// carrying the auth cookie). Only domains with a csvRows mapping on the backend.
export function analyticsCsvUrl(domain: string, period: AnalyticsPeriod): string {
  return `/api/v1/analytics/${domain}?period=${encodeURIComponent(period)}&format=csv`;
}

export const PERIOD_OPTIONS: { value: AnalyticsPeriod; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '12m', label: 'Last 12 months' },
];
