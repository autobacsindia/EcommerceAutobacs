import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import AdminAnalyticsPage from './page';
import { useAuth } from '@/context/AuthContext';
import { useCurrency } from '@/context/CurrencyContext';
import { analyticsApi } from '@/lib/analyticsApi';

jest.mock('@/context/AuthContext');
jest.mock('@/context/CurrencyContext');
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

// Stub the lazily-loaded recharts module so jsdom doesn't choke on SVG sizing.
jest.mock('@/components/admin/analytics/charts', () => ({
  RevenueTrendChart: () => <div data-testid="revenue-trend" />,
  HorizontalBarChart: () => <div data-testid="hbar" />,
  VerticalBarChart: () => <div data-testid="vbar" />,
  DonutChart: () => <div data-testid="donut" />,
}));

// next/dynamic → resolve to the mocked module synchronously.
jest.mock('next/dynamic', () => (loader: () => Promise<any>) => {
  const Comp = (props: any) => <div data-testid="chart" {...props} />;
  void loader;
  return Comp;
});

jest.mock('@/lib/analyticsApi', () => {
  const actual = jest.requireActual('@/lib/analyticsApi');
  return {
    ...actual,
    analyticsApi: {
      overview: jest.fn(),
      sales: jest.fn(),
      revenueBreakdown: jest.fn(),
      products: jest.fn(),
      customers: jest.fn(),
      geo: jest.fn(),
      loyalty: jest.fn(),
      returnsPayments: jest.fn(),
    },
  };
});

const api = analyticsApi as jest.Mocked<typeof analyticsApi>;

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({
    user: { _id: 'u1', name: 'Admin', role: 'admin' },
    isAuthenticated: true,
    isLoading: false,
  });
  (useCurrency as jest.Mock).mockReturnValue({ formatPrice: (n: number) => `₹${n}` });

  api.overview.mockResolvedValue({
    window: { from: '', to: '', label: '30d', days: 30 },
    revenue: { value: 12345, deltaPct: 26 },
    orders: { value: 42, deltaPct: null },
    aov: { value: 294, deltaPct: -5 },
  });
  api.sales.mockResolvedValue({
    granularity: 'day',
    series: [{ bucket: '2026-02-01', revenue: 100, orders: 1, aov: 100 }],
    totals: { revenue: 100, orders: 1, aov: 100 },
    previous: { revenue: 0, orders: 0, aov: 0 },
    deltas: { revenuePct: null, ordersPct: null, aovPct: null },
  });
  api.revenueBreakdown.mockResolvedValue({
    byCategory: [{ name: 'Brakes', revenue: 600, units: 6 }],
    byBrand: [{ name: 'Bosch', revenue: 350, units: 4 }],
  });
});

describe('AdminAnalyticsPage', () => {
  it('redirects nothing and renders KPI overview for admins', async () => {
    render(<AdminAnalyticsPage />);
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('₹12345')).toBeInTheDocument(); // revenue KPI
      expect(screen.getByText('42')).toBeInTheDocument(); // orders KPI
    });
    // delta with no prior data renders the "no prior data" hint
    expect(screen.getByText('no prior data')).toBeInTheDocument();
  });

  it('loads the sales section by default', async () => {
    render(<AdminAnalyticsPage />);
    await waitFor(() => expect(api.sales).toHaveBeenCalledWith('30d'));
    expect(api.revenueBreakdown).toHaveBeenCalledWith('30d');
    expect(screen.getByText('Revenue & orders over time')).toBeInTheDocument();
  });

  it('refetches when the period changes', async () => {
    render(<AdminAnalyticsPage />);
    await waitFor(() => expect(api.overview).toHaveBeenCalledWith('30d'));
    act(() => {
      fireEvent.click(screen.getByText('Last 7 days'));
    });
    await waitFor(() => expect(api.overview).toHaveBeenCalledWith('7d'));
    expect(api.sales).toHaveBeenCalledWith('7d');
  });

  it('switches sections on tab click', async () => {
    api.products.mockResolvedValue({
      topByRevenue: [{ productId: 'p1', name: 'Pad', revenue: 300, units: 3, orders: 2 }],
      topByUnits: [],
      stock: { in: 1, low: 1, out: 1, backorder: 0 },
    });
    render(<AdminAnalyticsPage />);
    act(() => {
      fireEvent.click(screen.getByText('Products'));
    });
    await waitFor(() => expect(api.products).toHaveBeenCalledWith('30d'));
    expect(await screen.findByText('Top products by revenue')).toBeInTheDocument();
  });

  it('shows an error with retry when a fetch fails', async () => {
    api.sales.mockRejectedValueOnce(new Error('boom'));
    render(<AdminAnalyticsPage />);
    await waitFor(() => expect(screen.getByText(/Could not load analytics/)).toBeInTheDocument());
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});
