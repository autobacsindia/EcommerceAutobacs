/**
 * Supplier bills and payments linked to an order, shown on that order (team and admin
 * order views). Owner, 2026-11-25: "when we link an order id … it will show in the
 * appropriate places". Every figure comes from the server.
 */
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrderSupplierBills, { AdminOrderPayments } from './OrderSupplierBills';
import type { SupplierBill } from './supplierBillsApi';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: jest.fn(), put: jest.fn() },
}));

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const bill = (over: Partial<SupplierBill> = {}): SupplierBill => ({
  id: 'b1', number: 'SB-0001', supplier: { id: 's9', name: 'RK New Popular' }, billNumber: '', billDate: '', dueDate: '', dueInDays: null,
  amount: 75000, amountKnown: true, paid: 0, waiting: 75000, owed: 75000, leftToAsk: 0, currency: 'INR', state: 'unpaid', stateLabel: 'Not paid',
  overdue: false, description: 'speakers', order: { id: 'o1', number: '#6E8F3D7C' }, files: [],
  payments: [{ id: 'r1', number: 'PR-0149', status: 'on_hold', statusLabel: 'On hold', amount: 75000, raisedBy: 'Priya', createdAt: '', paidAt: null }],
  createdByName: 'Anu', createdAt: '', rev: 0, can: { pay: false, edit: true, cancel: true }, ...over,
});

beforeEach(() => get.mockReset());

describe('supplier bills on an order', () => {
  it('shows each linked bill with its amount, status and payments, and links to the bills list', () => {
    wrap(<OrderSupplierBills bills={[bill()]} listHref="/team/payments?tab=owe" />);
    const box = screen.getByLabelText('Supplier bills for this order');
    expect(within(box).getByRole('button', { name: 'Supplier bill SB-0001' })).toBeInTheDocument();
    expect(box).toHaveTextContent('RK New Popular · ₹75,000');
    expect(box).toHaveTextContent('Not paid');
    expect(box).toHaveTextContent('₹75,000 owed');
    expect(box).toHaveTextContent('Payments: PR-0149 (on hold)');
    expect(within(box).getByRole('link', { name: /All bills we owe/ })).toHaveAttribute('href', '/team/payments?tab=owe');
  });

  it('shows nothing when no bill is linked (or the viewer may not see bills)', () => {
    const { container } = wrap(<OrderSupplierBills bills={[]} listHref="/x" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('the admin order page lists the order\'s payment requests and its bills', async () => {
    get.mockResolvedValue({
      requests: [{
        id: 'r2', number: 'PR-0150', status: 'submitted', statusLabel: 'Waiting for accounts', kind: 'supplier', categoryLabel: 'Supplier',
        amount: 25000, currency: 'INR', foreignAmount: null, itemIds: ['i1'], itemNames: ['Lift kit'], payee: 'ARB Supplies', createdAt: '',
        credit: { amount: 15000 }, hold: null,
      }],
      deals: [],
      bills: [bill()],
    });
    wrap(<AdminOrderPayments orderId="o1" />);
    const section = await screen.findByLabelText('Payments for this order');
    expect(get).toHaveBeenCalledWith('/payment-requests/order/o1');
    expect(within(section).getByRole('button', { name: 'PR-0150' })).toBeInTheDocument();
    expect(section).toHaveTextContent('Supplier — Lift kit · ₹25,000 to ARB Supplies');
    expect(section).toHaveTextContent('₹15,000 of it from supplier credit');
    expect(within(section).getByRole('button', { name: 'Supplier bill SB-0001' })).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: /All bills we owe/ })).toHaveAttribute('href', '/admin/payments?view=owe');
  });

  it('the admin order page shows nothing when the order has no payments or bills', async () => {
    get.mockResolvedValue({ requests: [], deals: [], bills: [] });
    const { container } = wrap(<AdminOrderPayments orderId="o2" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
