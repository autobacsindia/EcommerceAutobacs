/**
 * Minimum margin (owner, 2026-11-26) — the screens:
 *   - MarginBox: green when fine; red with the reason and who accepted when below
 *   - Admin → Margins: totals, lines (lowest first), products, exceptions, the minimum %
 *     — every figure from the server, the minimum saved through the server
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MarginBox from '@/components/payments/MarginBox';
import MarginsPage from './MarginsPage';

const get = jest.fn();
const put = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) },
}));
jest.mock('@/components/ui/EntityLink', () => ({ __esModule: true, default: ({ value }: { value: string }) => <span>{value}</span> }));

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

beforeEach(() => { get.mockReset(); put.mockReset(); });

describe('MarginBox', () => {
  it('a margin at or above the minimum reads green, with the figures', () => {
    render(<MarginBox m={{ sale: 100000, cost: 70000, pct: 30, minPct: 30, below: false, reason: '', acceptedByName: '', acceptedAt: null }} />);
    expect(screen.getByLabelText('Margin')).toHaveTextContent('Margin 30% (₹30,000) — customer paid ₹1,00,000, supplier cost ₹70,000');
  });

  it('below the minimum: red, with procurement’s reason and who accepted it', () => {
    render(<MarginBox m={{ sale: 100000, cost: 75000, pct: 25, minPct: 30, below: true, reason: 'Only supplier with stock', acceptedByName: 'Anu', acceptedAt: '2026-11-26T05:00:00Z' }} />);
    const box = screen.getByLabelText('Below minimum margin');
    expect(box).toHaveTextContent('Below minimum margin: 25% (₹25,000) — minimum 30%');
    expect(box).toHaveTextContent('Only supplier with stock');
    expect(box).toHaveTextContent('Lower margin accepted by Anu');
  });
});

describe('Admin → Margins', () => {
  const routes: Record<string, unknown> = {
    settings: { settings: { minPct: 30, defaultPct: 30, updatedByName: '', updatedAt: null } },
    totals: { totals: { sale: 125000, cost: 76000, margin: 49000, marginPct: 39.2, lines: 3, belowLines: 1, minPct: 30 } },
    lines: { rows: [
      { id: 'l1', orderId: 'o1', orderNumber: '#A1', orderDate: '2026-11-26T05:00:00Z', name: 'Light bar', quantity: 1, sale: 5000, cost: 4000, margin: 1000, marginPct: 20, minPct: 30, below: true, refs: ['PR-0009'], suppliers: ['Light House'] },
    ], nextCursor: null },
    products: { rows: [{ productId: 'p1', name: 'Light bar', units: 1, lines: 1, sale: 5000, cost: 4000, margin: 1000, marginPct: 20, belowLines: 1 }], nextCursor: null },
    exceptions: { rows: [{
      id: 'r1', number: 'PR-0009', status: 'approved', orderId: 'o1', orderNumber: '#A1', items: ['Light bar'], supplier: 'Light House',
      requestedByName: 'Aromal', createdAt: '2026-11-26T05:00:00Z', sale: 5000, cost: 4000, marginPct: 20, minPct: 30, shortBy: 500,
      reason: 'Clearance stock', acceptedByName: 'Anu', acceptedAt: '2026-11-26T06:00:00Z', decisionNote: '',
    }], nextCursor: null },
  };
  beforeEach(() => {
    get.mockImplementation((url: string) => {
      const path = url.replace('/admin/margins/', '').split('?')[0];
      return Promise.resolve(routes[path]);
    });
  });

  it('shows totals and the lowest-margin lines from the server', async () => {
    wrap(<MarginsPage />);
    expect(await screen.findByLabelText('Margin totals')).toHaveTextContent('₹1,25,000');
    expect(screen.getByLabelText('Margin totals')).toHaveTextContent('39.2%');
    expect(screen.getByLabelText('Margin totals')).toHaveTextContent('1 of 3 lines');
    const table = await screen.findByRole('table', { name: 'Margin by order line' });
    expect(table).toHaveTextContent('Light bar');
    expect(table).toHaveTextContent('20%');
    expect(get).toHaveBeenCalledWith(expect.stringMatching(/^\/admin\/margins\/lines\?.*sort=lowest/));
  });

  it('a date range goes to the server', async () => {
    wrap(<MarginsPage />);
    await screen.findByRole('table', { name: 'Margin by order line' });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-11-01' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringMatching(/lines\?.*from=2026-11-01/)));
  });

  it('products and the below-margin exceptions', async () => {
    wrap(<MarginsPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Products' }));
    expect(await screen.findByRole('table', { name: 'Margin by product' })).toHaveTextContent('Light bar');
    fireEvent.click(screen.getByRole('tab', { name: 'Below-margin exceptions' }));
    const list = await screen.findByRole('list', { name: 'Below-margin exceptions' });
    expect(list).toHaveTextContent('PR-0009');
    expect(list).toHaveTextContent('Margin 20% (minimum 30%)');
    expect(list).toHaveTextContent('Clearance stock');
    expect(list).toHaveTextContent('Raised by Aromal');
    expect(list).toHaveTextContent('accepted by Anu');
  });

  it('the admin changes the minimum through the server', async () => {
    put.mockResolvedValue({ settings: { minPct: 25, defaultPct: 30, updatedByName: 'Owner', updatedAt: '2026-11-26T07:00:00Z' } });
    wrap(<MarginsPage />);
    fireEvent.change(await screen.findByLabelText('Minimum margin percent'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/admin/margins/settings', { minPct: '25' }));
    expect(await screen.findByText('Saved: 25% for new supplier payments.')).toBeInTheDocument();
  });
});
