/**
 * "Purchase order" (a customer buying from us) and "Procurement order" (us
 * buying from a supplier) must never look alike, and an expense is neither.
 */
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrderTypeTag from './OrderTypeTag';
import PaymentRequestList from '@/components/payments/PaymentRequestList';
import PaymentRequestDetail from '@/components/payments/PaymentRequestDetail';
import type { PaymentRequest } from '@/components/payments/api';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: jest.fn() } }));

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const expense: PaymentRequest = {
  id: 'r1', number: 'PR-0007', kind: 'expense', status: 'submitted', statusLabel: 'Waiting for accounts',
  team: 'operations', teamLabel: 'Operations', requestedBy: 'Omar', amount: 1250, category: 'fuel', description: 'Diesel',
  payee: { name: 'Fuel Station', method: 'upi', upiId: 'fuel@okaxis' }, order: null, itemNames: [], customer: null, closedBy: '',
  files: [], payment: null, decisionNote: '', createdAt: '2026-10-15T05:00:00Z', history: [],
  can: { approve: false, decline: false, pay: false, hold: false, cancel: false },
};
const supplier: PaymentRequest = {
  ...expense, id: 'r2', number: 'PR-0008', kind: 'supplier', category: '', team: 'procurement', teamLabel: 'Procurement',
  payee: { name: 'Profender India', method: 'bank' } as PaymentRequest['payee'],
};

beforeEach(() => get.mockReset());

it('the two tags read differently and look different', () => {
  render(<><OrderTypeTag type="purchase" /><OrderTypeTag type="procurement" /></>);
  const purchase = screen.getByText('Purchase order');
  const procurement = screen.getByText('Procurement order');
  expect(purchase).toHaveAttribute('title', 'A customer buying from us');
  expect(procurement).toHaveAttribute('title', 'Us buying from a supplier');
  expect(purchase.className).toMatch(/sky/);
  expect(procurement.className).toMatch(/purple/);
});

it('the payments list tags a supplier payment as a procurement order, and leaves an expense alone', async () => {
  get.mockResolvedValue({ requests: [supplier, expense], nextCursor: null });
  wrap(<PaymentRequestList filters={[{ value: 'open', label: 'Open' }]} initial="open" />);
  const supplierRow = (await screen.findByText(/PR-0008/)).closest('li')!;
  const expenseRow = screen.getByText(/PR-0007/).closest('li')!;
  expect(within(supplierRow).getByText('Procurement order')).toBeInTheDocument();
  expect(within(expenseRow).queryByText('Procurement order')).toBeNull();
  expect(within(expenseRow).queryByText('Purchase order')).toBeNull();
});

it('a supplier payment opened on its own carries the tag next to its number', async () => {
  get.mockResolvedValue({ request: supplier });
  wrap(<PaymentRequestDetail id="r2" onClose={() => {}} />);
  const panel = await screen.findByRole('complementary', { name: 'Payment request' });
  await within(panel).findByText('PR-0008');
  expect(within(panel).getByText('Procurement order')).toBeInTheDocument();
});
