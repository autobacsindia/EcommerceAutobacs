/**
 * Regression: accounts put a supplier payment on hold (Payments → All requests),
 * but "Supplier payments — by supplier" still counted it in the money to pay, let
 * "Tick all" pay it, and never said who held it or why. The hold comes from the
 * request itself (`hold`), and every list shows it the same way.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SupplierPayQueue from './SupplierPayQueue';
import { SupplierPaymentRow } from './OrderSupplierPayments';
import type { OrderPayment, PaymentRequest } from './api';
import { addressBar } from '@/test-utils/addressBarMock';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: jest.fn(), put: jest.fn() } }));
jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const HOLD = { note: 'GST number on the bill is wrong', byName: 'Meera', role: 'staff', at: '2026-11-19T06:00:00Z' };
const request = (id: string, amount: number, over: Partial<PaymentRequest> = {}): PaymentRequest => ({
  id, number: `PR-${id}`, kind: 'supplier', status: 'approved', statusLabel: 'Approved', team: 'procurement', teamLabel: 'Procurement',
  requestedBy: 'Priya', amount, category: 'supplier', description: '', payee: { name: 'ARB Supplies', method: 'bank' },
  order: { id: 'o1', number: '#AB12' }, itemNames: ['Lift kit'], customer: { name: 'Ravi', phone: '', city: '' }, closedBy: '',
  files: [], payment: null, decisionNote: '', hold: null, history: [], createdAt: '2026-10-20T05:00:00Z',
  can: { approve: false, decline: false, pay: true, hold: true, cancel: false },
  ...over,
} as PaymentRequest);
const held = request('h', 2500, { status: 'on_hold', statusLabel: 'On hold', decisionNote: HOLD.note, hold: HOLD });

beforeEach(() => {
  addressBar.reset('/admin/payments');
  get.mockReset();
  get.mockImplementation((url: string) => Promise.resolve(url.endsWith('/to-pay/suppliers')
    ? {
      groups: [{ id: 'g1', name: 'ARB Supplies', method: 'bank', destination: 'HDFC XXXXXXXX9012', count: 3, total: 1300, onHold: 1, onHoldTotal: 2500, bankNotice: false, oldestAt: '' }],
      summary: { count: 1, total: 1300, onHoldTotal: 2500, capped: false }, truncated: false,
    }
    : { group: { id: 'g1', name: 'ARB Supplies', destination: 'HDFC XXXXXXXX9012', total: 1300, onHoldTotal: 2500, requests: [request('a', 1000), held, request('c', 300)] } }));
});

describe('Supplier payments — by supplier', () => {
  it('the supplier row shows the held money apart from what is to pay', async () => {
    wrap(<SupplierPayQueue canPay />);
    const row = await screen.findByRole('button', { name: /ARB Supplies/ });
    expect(row).toHaveTextContent('₹1,300 to pay');
    expect(row).toHaveTextContent('1 on hold · ₹2,500');
    expect(screen.getByText(/₹2,500 on hold \(not counted\)/)).toBeInTheDocument();
  });

  it('a held line says why and who held it, and cannot be ticked or paid', async () => {
    wrap(<SupplierPayQueue canPay />);
    fireEvent.click(await screen.findByRole('button', { name: /ARB Supplies/ }));
    expect(await screen.findByText(/1 on hold · ₹2,500 — not in the total; release the hold to pay/)).toBeInTheDocument();
    const note = screen.getByRole('note', { name: 'On hold' });
    expect(note).toHaveTextContent('On hold: GST number on the bill is wrong');
    expect(note).toHaveTextContent(/Held by Meera \(Accounts\) on/);

    expect(screen.getByLabelText('Pay PR-h')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Tick all'));
    expect(screen.getByLabelText('Pay PR-a')).toBeChecked();
    expect(screen.getByLabelText('Pay PR-c')).toBeChecked();
    expect(screen.getByLabelText('Pay PR-h')).not.toBeChecked();
    expect(screen.getByRole('button', { name: /Record payment of ₹1,300/ })).toBeEnabled();
  });
});

describe('the order\'s supplier payments', () => {
  const row = (over: Partial<OrderPayment>): OrderPayment => ({
    id: 'r1', number: 'PR-0090', status: 'approved', statusLabel: 'Approved', amount: 2500, itemIds: ['i1'], itemNames: ['Lift kit'],
    payee: 'ARB Supplies', paidAt: null, createdAt: '2026-11-19T05:00:00Z', kind: 'supplier', ...over,
  });

  it('shows the same hold — reason and who held it', () => {
    render(<SupplierPaymentRow r={row({ status: 'on_hold', statusLabel: 'On hold', decisionNote: HOLD.note, hold: HOLD })} onOpen={jest.fn()} />);
    const note = screen.getByRole('note', { name: 'On hold' });
    expect(within(note).getByText(/GST number on the bill is wrong/)).toBeInTheDocument();
    expect(note).toHaveTextContent(/Held by Meera \(Accounts\)/);
  });

  it('an approved payment shows no hold; a declined one shows why', () => {
    const { rerender } = render(<SupplierPaymentRow r={row({})} onOpen={jest.fn()} />);
    expect(screen.queryByRole('note', { name: 'On hold' })).not.toBeInTheDocument();
    rerender(<SupplierPaymentRow r={row({ status: 'declined', statusLabel: 'Declined', decisionNote: 'Wrong supplier' })} onOpen={jest.fn()} />);
    expect(screen.getByText('Declined: Wrong supplier')).toBeInTheDocument();
  });
});
