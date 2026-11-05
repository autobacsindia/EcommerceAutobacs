/**
 * Made-to-order items paid in parts (SupplierDealCard) and expenses linked to an
 * order (OrderOtherPayments). The numbers are the server's — the card only shows
 * them; the form sends the deal (never item ids) and the order link.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LineSupplierPayment, { OrderOtherPayments } from './OrderSupplierPayments';
import type { OrderPayment, SupplierDeal } from './api';

const get = jest.fn();
const post = jest.fn();
const put = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a) },
}));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({ 'Content-Type': 'application/json', 'X-XSRF-TOKEN': 't' }) },
}));

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const line = (itemId: string, name: string, stage = 'to_ship', actions: string[] = []) => ({ itemId, name, variantLabel: null, stage, actions }) as never;
const order = {
  id: 'o1', orderNumber: '#AB12', canShip: true, source: 'website', soldBy: 'Website',
  customer: { name: 'Ravi', email: '', phone: '' },
  lines: [{ itemId: 'i1', name: 'Roof rack', variantLabel: null }, { itemId: 'i2', name: 'Mat', variantLabel: null }],
} as never;

const deal = (over: Partial<SupplierDeal> = {}): SupplierDeal => ({
  id: 'd1', status: 'open', itemIds: ['i1'], itemNames: ['Roof rack'], supplierName: 'Kochi Fabricators',
  agreedTotal: 29000, paid: 10000, waiting: 0, balanceDue: 19000, leftToAsk: 19000, fullyPaid: false,
  startDate: '2026-11-08', completionDate: '2026-11-20', createdByName: 'Priya', createdAt: '2026-11-05T05:00:00Z',
  payments: [{ id: 'r1', number: 'PR-0101', part: 'advance', partLabel: 'Advance', amount: 10000, status: 'paid', statusLabel: 'Paid', createdAt: '2026-11-05T05:00:00Z', approvedAt: '2026-11-05T06:00:00Z', paidAt: '2026-11-05T07:00:00Z' }],
  history: [], can: { raise: true, edit: true, remove: false }, ...over,
});

describe('a made-to-order line', () => {
  afterEach(() => jest.clearAllMocks());

  it('shows supplier cost, paid, balance due, the dates and the payment timeline', () => {
    wrap(<LineSupplierPayment order={order} line={line('i1', 'Roof rack')} requests={[]} deals={[deal()]} />);
    const card = screen.getByRole('region', { name: /Supplier deal for Roof rack/ });
    expect(within(card).getByText('Balance due ₹19,000')).toBeInTheDocument();
    expect(within(card).getByText('Supplier cost').nextSibling).toHaveTextContent('₹29,000');
    expect(within(card).getByText('Paid so far').nextSibling).toHaveTextContent('₹10,000');
    expect(within(card).getByText('8 Nov 2026')).toBeInTheDocument();
    expect(within(card).getByText('20 Nov 2026')).toBeInTheDocument();
    const timeline = within(card).getByRole('list', { name: 'Payment timeline' });
    expect(within(timeline).getByText('Advance')).toBeInTheDocument();
    expect(within(timeline).getByText('Paid')).toBeInTheDocument();
    // No one-off payment button on a deal item.
    expect(screen.queryByRole('button', { name: /Request supplier payment/ })).toBeNull();
  });

  it('"Request next payment" sends the deal, not item ids, and offers the full balance', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ request: { id: 'r2' } }) });
    global.fetch = fetchMock as never;
    wrap(<LineSupplierPayment order={order} line={line('i1', 'Roof rack')} requests={[]} deals={[deal()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request next payment' }));
    expect(screen.getByText(/up to ₹19,000/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Pay the full balance/ }));
    expect(screen.getByLabelText('Amount (₹)')).toHaveValue('19000');
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Kochi Fabricators' } });
    fireEvent.click(screen.getByRole('radio', { name: /Bank/ }));
    fireEvent.change(screen.getByLabelText(/Account holder/), { target: { value: 'Kochi Fabricators' } });
    fireEvent.change(screen.getByLabelText(/Account number/), { target: { value: '123456789012' } });
    fireEvent.change(screen.getByLabelText(/IFSC/), { target: { value: 'HDFC0001234' } });
    fireEvent.click(screen.getByRole('button', { name: /Send|Submit|Request/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('dealId')).toBe('d1');
    expect(form.get('itemIds')).toBeNull();
    expect(form.get('amount')).toBe('19000');
  });

  it('a paid-in-full deal offers no further payment', () => {
    wrap(<LineSupplierPayment order={order} line={line('i1', 'Roof rack')} requests={[]} deals={[deal({ paid: 29000, balanceDue: 0, leftToAsk: 0, fullyPaid: true, can: { raise: false, edit: true, remove: false } })]} />);
    expect(screen.getByText('Supplier paid in full')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request next payment|Request advance/ })).toBeNull();
  });

  it('changing the dates needs a reason and sends it', async () => {
    put.mockResolvedValue({ deal: deal() });
    wrap(<LineSupplierPayment order={order} line={line('i1', 'Roof rack')} requests={[]} deals={[deal()]} />);
    fireEvent.click(screen.getByRole('button', { name: /Change total \/ dates/ }));
    expect(screen.getByLabelText('Why did it change?')).toBeRequired();
    fireEvent.change(screen.getByLabelText('Completion date'), { target: { value: '2026-11-27' } });
    fireEvent.change(screen.getByLabelText('Why did it change?'), { target: { value: 'Supplier delayed a week' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save change' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/payment-requests/deals/d1', expect.objectContaining({ completionDate: '2026-11-27', note: 'Supplier delayed a week' })));
  });

  it('an item not yet paid for offers "Made to order — pay in parts", which sets up a deal', async () => {
    post.mockResolvedValue({ deal: deal() });
    wrap(<LineSupplierPayment order={order} line={line('i2', 'Mat')} requests={[]} deals={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Made to order — pay in parts/ }));
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Kochi Fabricators' } });
    fireEvent.change(screen.getByLabelText('Agreed total with supplier (₹)'), { target: { value: '29000' } });
    fireEvent.change(screen.getByLabelText('Manufacturing start'), { target: { value: '2026-11-08' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save deal' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/payment-requests/deals', expect.objectContaining({ orderId: 'o1', itemIds: ['i2'], agreedTotal: '29000', startDate: '2026-11-08' })));
  });
});

describe('other payments for an order', () => {
  const expense: OrderPayment = {
    id: 'e1', number: 'PR-0200', status: 'submitted', statusLabel: 'Waiting for accounts approval', amount: 450,
    itemIds: [], itemNames: [], payee: 'DTDC', paidAt: null, createdAt: '2026-11-05T05:00:00Z',
    kind: 'expense', categoryLabel: 'Courier', requestedByName: 'Omar',
  };

  it('lists the linked expenses only — not the supplier payments', () => {
    const supplier: OrderPayment = { ...expense, id: 's1', number: 'PR-0199', kind: 'supplier', itemIds: ['i1'], categoryLabel: 'Supplier' };
    wrap(<OrderOtherPayments order={order} requests={[supplier, expense]} />);
    expect(screen.getByText('PR-0200')).toBeInTheDocument();
    expect(screen.getByText(/Courier · ₹450 to DTDC/)).toBeInTheDocument();
    expect(screen.queryByText('PR-0199')).toBeNull();
  });

  it('"Add expense for this order" opens the expense form for that order', async () => {
    get.mockResolvedValue({ options: { team: 'operations', baseCurrency: 'INR', currencies: [{ code: 'INR', label: '₹' }], categories: [{ value: 'fuel', label: 'Fuel', noteRequired: false }] } });
    wrap(<OrderOtherPayments order={order} requests={[]} />);
    expect(screen.getByText('None yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add expense for this order/ }));
    expect(await screen.findByText('Expense for order #AB12')).toBeInTheDocument();
  });
});
