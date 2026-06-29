'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@/context/AuthContext';
import { useCurrency } from '@/context/CurrencyContext';
import {
  analyticsApi,
  analyticsCsvUrl,
  PERIOD_OPTIONS,
  type AnalyticsPeriod,
  type OverviewData,
  type SalesData,
  type RevenueBreakdownData,
  type ProductPerformanceData,
  type CustomerData,
  type GeoData,
  type LoyaltyData,
  type ReturnsPaymentsData,
} from '@/lib/analyticsApi';
import {
  SectionCard,
  KpiCard,
  EmptyState,
  ChartSkeleton,
  SimpleTable,
} from '@/components/admin/analytics/primitives';

// Charts are lazy-loaded so recharts stays out of the initial admin bundle.
const loadCharts = () => import('@/components/admin/analytics/charts');
const RevenueTrendChart = dynamic(() => loadCharts().then((m) => m.RevenueTrendChart), {
  ssr: false,
  loading: () => <ChartSkeleton height={300} />,
});
const HorizontalBarChart = dynamic(() => loadCharts().then((m) => m.HorizontalBarChart), {
  ssr: false,
  loading: () => <ChartSkeleton height={200} />,
});
const VerticalBarChart = dynamic(() => loadCharts().then((m) => m.VerticalBarChart), {
  ssr: false,
  loading: () => <ChartSkeleton height={260} />,
});
const DonutChart = dynamic(() => loadCharts().then((m) => m.DonutChart), {
  ssr: false,
  loading: () => <ChartSkeleton height={260} />,
});

type TabKey = 'sales' | 'products' | 'customers' | 'loyalty' | 'returns';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'sales', label: 'Sales & Revenue' },
  { key: 'products', label: 'Products' },
  { key: 'customers', label: 'Customers & Geo' },
  { key: 'loyalty', label: 'Loyalty & Discounts' },
  { key: 'returns', label: 'Returns & Payments' },
];

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { formatPrice } = useCurrency();

  const [period, setPeriod] = useState<AnalyticsPeriod>('30d');
  const [tab, setTab] = useState<TabKey>('sales');
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [sectionData, setSectionData] = useState<Record<string, unknown> | null>(null);
  const [loadingSection, setLoadingSection] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && (!isAuthenticated || user?.role !== 'admin')) {
      router.push('/login');
    }
  }, [isAuthenticated, user, isLoading, router]);

  const isAdmin = isAuthenticated && user?.role === 'admin';

  // Overview KPIs — refetched whenever the period changes.
  useEffect(() => {
    if (!isAdmin) return;
    analyticsApi.overview(period).then(setOverview).catch(() => setOverview(null));
  }, [isAdmin, period]);

  // Active section data — refetched on period/tab change.
  const fetchSection = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingSection(true);
    setError(null);
    try {
      const fetchers: Record<TabKey, () => Promise<unknown>> = {
        sales: async () => ({
          sales: await analyticsApi.sales(period),
          breakdown: await analyticsApi.revenueBreakdown(period),
        }),
        products: () => analyticsApi.products(period),
        customers: async () => ({
          customers: await analyticsApi.customers(period),
          geo: await analyticsApi.geo(period),
        }),
        loyalty: () => analyticsApi.loyalty(period),
        returns: () => analyticsApi.returnsPayments(period),
      };
      const data = await fetchers[tab]();
      setSectionData(data as Record<string, unknown>);
    } catch (e) {
      console.error('[analytics] section fetch failed', e);
      setError('Could not load analytics. Please retry.');
      setSectionData(null);
    } finally {
      setLoadingSection(false);
    }
  }, [isAdmin, period, tab]);

  useEffect(() => {
    fetchSection();
  }, [fetchSection]);

  if (isLoading) return <CenteredSpinner />;
  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      {/* Header + period selector */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
          <p className="text-gray-600 mt-1">Historical business insights across sales, products, customers and operations</p>
        </div>
        <div className="flex items-center gap-2">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                period === opt.value ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Overview KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Revenue" value={overview ? formatPrice(overview.revenue.value) : '—'} deltaPct={overview?.revenue.deltaPct} />
        <KpiCard label="Orders" value={overview ? overview.orders.value.toLocaleString() : '—'} deltaPct={overview?.orders.deltaPct} />
        <KpiCard label="Avg Order Value" value={overview ? formatPrice(overview.aov.value) : '—'} deltaPct={overview?.aov.deltaPct} />
      </div>

      {/* Section tabs */}
      <div className="border-b border-gray-200 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {error}{' '}
          <button onClick={fetchSection} className="underline font-medium">Retry</button>
        </div>
      )}

      {loadingSection && !sectionData ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartSkeleton /> <ChartSkeleton />
        </div>
      ) : (
        <SectionBody tab={tab} data={sectionData} period={period} formatMoney={formatPrice} />
      )}

      <p className="text-xs text-gray-400">
        Behavioural funnel &amp; cart-abandonment analytics are tracked in PostHog and live in its dashboards,
        not here. This page reports on orders, customers and operations from the store database.
      </p>
    </div>
  );
}

function SectionBody({
  tab,
  data,
  period,
  formatMoney,
}: {
  tab: TabKey;
  data: Record<string, unknown> | null;
  period: AnalyticsPeriod;
  formatMoney: (n: number) => string;
}) {
  if (!data) return <EmptyState message="No data available" />;
  switch (tab) {
    case 'sales':
      return <SalesSection data={data} period={period} formatMoney={formatMoney} />;
    case 'products':
      return <ProductsSection data={data as unknown as ProductPerformanceData} period={period} formatMoney={formatMoney} />;
    case 'customers':
      return <CustomersSection data={data} period={period} formatMoney={formatMoney} />;
    case 'loyalty':
      return <LoyaltySection data={data as unknown as LoyaltyData} period={period} formatMoney={formatMoney} />;
    case 'returns':
      return <ReturnsSection data={data as unknown as ReturnsPaymentsData} formatMoney={formatMoney} />;
    default:
      return null;
  }
}

function ExportButton({ domain, period }: { domain: string; period: AnalyticsPeriod }) {
  return (
    <a
      href={analyticsCsvUrl(domain, period)}
      className="text-sm px-3 py-1.5 rounded-lg border text-gray-600 hover:bg-gray-50"
      download
    >
      Export CSV
    </a>
  );
}

// ── Sales ─────────────────────────────────────────────────────────────────
function SalesSection({ data, period, formatMoney }: { data: Record<string, unknown>; period: AnalyticsPeriod; formatMoney: (n: number) => string }) {
  const sales = data.sales as SalesData;
  const breakdown = data.breakdown as RevenueBreakdownData;
  return (
    <div className="space-y-6">
      <SectionCard title="Revenue & orders over time" action={<ExportButton domain="sales" period={period} />}>
        {sales?.series?.length ? <RevenueTrendChart data={sales.series} formatMoney={formatMoney} /> : <EmptyState />}
      </SectionCard>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Revenue by category">
          {breakdown?.byCategory?.length ? (
            <HorizontalBarChart data={breakdown.byCategory} labelKey="name" valueKey="revenue" formatValue={formatMoney} />
          ) : (
            <EmptyState />
          )}
        </SectionCard>
        <SectionCard title="Revenue by brand">
          {breakdown?.byBrand?.length ? (
            <HorizontalBarChart data={breakdown.byBrand} labelKey="name" valueKey="revenue" formatValue={formatMoney} color="#16a34a" />
          ) : (
            <EmptyState />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

// ── Products ────────────────────────────────────────────────────────────────
function ProductsSection({ data, period, formatMoney }: { data: ProductPerformanceData; period: AnalyticsPeriod; formatMoney: (n: number) => string }) {
  const stockData = [
    { name: 'In stock', value: data.stock?.in ?? 0 },
    { name: 'Low stock', value: data.stock?.low ?? 0 },
    { name: 'Out of stock', value: data.stock?.out ?? 0 },
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Top products by revenue" action={<ExportButton domain="products" period={period} />}>
          <SimpleTable
            rows={data.topByRevenue ?? []}
            emptyMessage="No sales in this period"
            columns={[
              { key: 'name', label: 'Product' },
              { key: 'units', label: 'Units', align: 'right' },
              { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => formatMoney(r.revenue) },
            ]}
          />
        </SectionCard>
        <SectionCard title="Top products by units">
          <SimpleTable
            rows={data.topByUnits ?? []}
            emptyMessage="No sales in this period"
            columns={[
              { key: 'name', label: 'Product' },
              { key: 'units', label: 'Units', align: 'right' },
              { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => formatMoney(r.revenue) },
            ]}
          />
        </SectionCard>
      </div>
      <SectionCard title="Active catalogue stock mix" subtitle="Current stock status across active products">
        <DonutChart data={stockData} nameKey="name" valueKey="value" />
      </SectionCard>
    </div>
  );
}

// ── Customers & geo ───────────────────────────────────────────────────────
function CustomersSection({ data, period, formatMoney }: { data: Record<string, unknown>; period: AnalyticsPeriod; formatMoney: (n: number) => string }) {
  const c = data.customers as CustomerData;
  const geo = data.geo as GeoData;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Active customers" value={(c?.activeCustomers ?? 0).toLocaleString()} />
        <KpiCard label="Returning" value={(c?.returningCustomers ?? 0).toLocaleString()} />
        <KpiCard label="Repeat rate" value={`${c?.repeatRatePct ?? 0}%`} />
        <KpiCard label="Revenue / customer" value={formatMoney(c?.revenuePerCustomer ?? 0)} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="New customer registrations">
          {c?.registrationCohorts?.length ? (
            <VerticalBarChart data={c.registrationCohorts} labelKey="bucket" valueKey="count" tickAsDate />
          ) : (
            <EmptyState />
          )}
        </SectionCard>
        <SectionCard title="Revenue by state" action={<ExportButton domain="geo" period={period} />}>
          {geo?.byState?.length ? (
            <HorizontalBarChart data={geo.byState} labelKey="state" valueKey="revenue" formatValue={formatMoney} color="#9333ea" />
          ) : (
            <EmptyState />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

// ── Loyalty & discounts ─────────────────────────────────────────────────────
function LoyaltySection({ data, period, formatMoney }: { data: LoyaltyData; period: AnalyticsPeriod; formatMoney: (n: number) => string }) {
  const di = data.discountImpact;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Coupon uses" value={(data.coupons?.totalUses ?? 0).toLocaleString()} />
        <KpiCard label="Coupon discount" value={formatMoney(data.coupons?.totalDiscount ?? 0)} />
        <KpiCard label="Karma redeemed" value={(data.karma?.redeemed ?? 0).toLocaleString()} />
        <KpiCard label="Discount rate" value={`${di?.discountRatePct ?? 0}%`} invertDelta />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Top coupons" action={<ExportButton domain="loyalty" period={period} />}>
          <SimpleTable
            rows={data.coupons?.top ?? []}
            emptyMessage="No coupon redemptions"
            columns={[
              { key: 'code', label: 'Code' },
              { key: 'uses', label: 'Uses', align: 'right' },
              { key: 'discount', label: 'Total discount', align: 'right', render: (r) => formatMoney(r.discount) },
            ]}
          />
        </SectionCard>
        <SectionCard title="Discount impact" subtitle="How much realised revenue is given back as discounts">
          <div className="space-y-3 text-sm">
            <Row label="Gross (subtotal)" value={formatMoney(di?.gross ?? 0)} />
            <Row label="Coupon discounts" value={formatMoney(di?.couponDiscount ?? 0)} />
            <Row label="Karma discounts" value={formatMoney(di?.karmaDiscount ?? 0)} />
            <Row label="Total given back" value={formatMoney(di?.totalDiscount ?? 0)} strong />
            <Row label="Karma earned (period)" value={(data.karma?.earned ?? 0).toLocaleString()} />
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// ── Returns & payments ──────────────────────────────────────────────────────
function ReturnsSection({ data, formatMoney }: { data: ReturnsPaymentsData; formatMoney: (n: number) => string }) {
  const paymentDonut = (data.payments ?? []).map((p) => ({
    name: `${p.method}${p.gateway ? ` · ${p.gateway}` : ''}`,
    value: p.count,
  }));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Returns" value={(data.returns?.total ?? 0).toLocaleString()} />
        <KpiCard label="Return rate" value={`${data.returns?.returnRatePct ?? 0}%`} invertDelta />
        <KpiCard label="Avg time to ship" value={`${data.fulfillment?.avgTimeToShipHours ?? 0} h`} />
        <KpiCard label="Avg time to deliver" value={`${data.fulfillment?.avgTimeToDeliverHours ?? 0} h`} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Payment method mix">
          {paymentDonut.length ? <DonutChart data={paymentDonut} nameKey="name" valueKey="value" /> : <EmptyState />}
        </SectionCard>
        <SectionCard title="Return reasons">
          <SimpleTable
            rows={data.returns?.reasons ?? []}
            emptyMessage="No returns in this period"
            columns={[
              { key: 'reason', label: 'Reason' },
              { key: 'count', label: 'Count', align: 'right' },
            ]}
          />
        </SectionCard>
      </div>
      <SectionCard title="Payment gateways" subtitle="Volume and success rate by method & gateway">
        <SimpleTable
          rows={data.payments ?? []}
          emptyMessage="No payments in this period"
          columns={[
            { key: 'method', label: 'Method' },
            { key: 'gateway', label: 'Gateway' },
            { key: 'count', label: 'Attempts', align: 'right' },
            { key: 'successRatePct', label: 'Success %', align: 'right', render: (r) => `${r.successRatePct}%` },
            { key: 'amount', label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
          ]}
        />
      </SectionCard>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-600">{label}</span>
      <span className={strong ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}>{value}</span>
    </div>
  );
}

function CenteredSpinner() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading...</p>
      </div>
    </div>
  );
}
