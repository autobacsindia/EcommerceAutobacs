/**
 * Made-to-order items paid in parts (SupplierDealCard) and expenses linked to an
 * order (OrderOtherPayments). The numbers are the server's — the card only shows
 * them; the form sends the deal (never item ids) and the order link.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LineSupplierPayment, { OrderOtherPayments } from './OrderSupplierPayments';
import PaymentRequestDetail from './PaymentRequestDetail';
import PaymentRequestForm from './PaymentRequestForm';
import type { OrderPayment, PaymentRequest, SupplierDeal } from './api';

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
  currency: 'INR', rupeesPaid: 10000, advancePaidAt: '2026-11-08T07:00:00Z',
  agreedTotal: 29000, paid: 10000, waiting: 0, balanceDue: 19000, leftToAsk: 19000, fullyPaid: false,
  startDate: '2026-11-08', completionDate: '2026-11-20', createdByName: 'Priya', createdAt: '2026-11-05T05:00:00Z',
  payments: [{ id: 'r1', number: 'PR-0101', part: 'advance', partLabel: 'Advance', amount: 10000, rupees: 10000, status: 'paid', statusLabel: 'Paid', createdAt: '2026-11-05T05:00:00Z', approvedAt: '2026-11-05T06:00:00Z', paidAt: '2026-11-05T07:00:00Z' }],
  history: [], can: { raise: true, edit: true, remove: false }, ...over,
});

describe('a made-to-order line', () => {
  afterEach(() => jest.clearAllMocks());

  it('shows supplier cost, paid, balance due, the advance-paid date (automatic), completion and the timeline', () => {
    wrap(<LineSupplierPayment order={order} line={line('i1', 'Roof rack')} requests={[]} deals={[deal()]} />);
    const card = screen.getByRole('region', { name: /Supplier deal for Roof rack/ });
    expect(within(card).getByText('Balance due ₹19,000')).toBeInTheDocument();
    expect(within(card).getByText('Supplier cost').nextSibling).toHaveTextContent('₹29,000');
    expect(within(card).getByText('Paid so far').nextSibling).toHaveTextContent('₹10,000');
    expect(within(card).getByText(/Advance paid on/)).toHaveTextContent('Advance paid on: 8 Nov 2026');
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

  it('a deal not yet paid reads "not paid yet" — the start date is never typed', () => {
    wrap(<LineSupplierPayment order={order} line={line('i1', 'Roof rack')} requests={[]} deals={[deal({ startDate: '', advancePaidAt: null, paid: 0, waiting: 10000 })]} />);
    expect(screen.getByText(/Advance paid on/)).toHaveTextContent('not paid yet');
  });

  it('a THB deal shows baht, and the rupees the bank debited', () => {
    wrap(<LineSupplierPayment order={order} line={line('i1', 'Roof rack')} requests={[]} deals={[deal({
      currency: 'THB', agreedTotal: 29400, paid: 10000, balanceDue: 19400, leftToAsk: 19400, rupeesPaid: 24300,
      payments: [{ ...deal().payments[0], rupees: 24300 }],
    })]} />);
    const card = screen.getByRole('region', { name: /Supplier deal for Roof rack/ });
    expect(within(card).getByText('Balance due THB 19,400')).toBeInTheDocument();
    expect(within(card).getByText('Supplier cost').nextSibling).toHaveTextContent('THB 29,400');
    expect(within(card).getByText('₹24,300 debited so far')).toBeInTheDocument();
    expect(within(card).getByRole('list', { name: 'Payment timeline' })).toHaveTextContent('THB 10,000 (₹24,300 debited)');
  });

  it('the next part of a THB deal is asked for in baht — no currency choice', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ request: { id: 'r2' } }) });
    global.fetch = fetchMock as never;
    get.mockResolvedValue({ options: { team: 'procurement', baseCurrency: 'INR', currencies: [{ code: 'INR', label: '₹' }, { code: 'THB', label: 'Thai baht' }], categories: [] } });
    wrap(<LineSupplierPayment order={order} line={line('i1', 'Roof rack')} requests={[]} deals={[deal({ currency: 'THB', agreedTotal: 29400, leftToAsk: 19400 })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request next payment' }));
    fireEvent.click(screen.getByRole('button', { name: /Pay the full balance \(THB 19,400\)/ }));
    expect(screen.getByLabelText('Bill amount (THB)')).toHaveValue('19400');
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByLabelText('Currency')).toBeNull();
  });

  it('changing the total or completion date needs a reason and sends it (no start date to type)', async () => {
    put.mockResolvedValue({ deal: deal() });
    wrap(<LineSupplierPayment order={order} line={line('i1', 'Roof rack')} requests={[]} deals={[deal()]} />);
    fireEvent.click(screen.getByRole('button', { name: /Change total \/ date/ }));
    expect(screen.getByLabelText('Why did it change?')).toBeRequired();
    expect(screen.queryByLabelText(/Manufacturing start/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Completion date'), { target: { value: '2026-11-27' } });
    fireEvent.change(screen.getByLabelText('Why did it change?'), { target: { value: 'Supplier delayed a week' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save change' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/payment-requests/deals/d1', expect.objectContaining({ completionDate: '2026-11-27', note: 'Supplier delayed a week' })));
  });

  it('"Made to order — pay in parts" is one step: supplier, currency, total, advance, completion date', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ deal: deal(), request: { id: 'r9' } }) });
    global.fetch = fetchMock as never;
    get.mockResolvedValue({ options: { team: 'procurement', baseCurrency: 'INR', currencies: [{ code: 'INR', label: 'Indian rupee (₹)' }, { code: 'THB', label: 'Thai baht' }], categories: [] } });
    wrap(<LineSupplierPayment order={order} line={line('i2', 'Mat')} requests={[]} deals={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Made to order — pay in parts/ }));
    expect(screen.queryByLabelText(/Manufacturing start/)).toBeNull();
    fireEvent.change(await screen.findByLabelText('Currency'), { target: { value: 'THB' } });
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Sangaroon Trading' } });
    fireEvent.change(screen.getByLabelText('Total agreed with supplier (THB)'), { target: { value: '29400' } });
    fireEvent.change(screen.getByLabelText('Advance now (THB)'), { target: { value: '10000' } });
    expect(screen.getByText('Balance after the advance: THB 19,400')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Supplier finishes making it on'), { target: { value: '2026-11-20' } });
    fireEvent.change(screen.getByLabelText(/UPI ID/), { target: { value: 'sangaroon@okaxis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and send advance for approval' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/payment-requests/deals');
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(Object.fromEntries(['orderId', 'itemIds', 'currency', 'agreedTotal', 'advance', 'completionDate'].map((k) => [k, form.get(k)])))
      .toEqual({ orderId: 'o1', itemIds: '["i2"]', currency: 'THB', agreedTotal: '29400', advance: '10000', completionDate: '2026-11-20' });
    expect(form.get('startDate')).toBeNull();
  });

  it('refuses an advance above the total before sending', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    wrap(<LineSupplierPayment order={order} line={line('i2', 'Mat')} requests={[]} deals={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Made to order — pay in parts/ }));
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Kochi Fabricators' } });
    fireEvent.change(screen.getByLabelText('Total agreed with supplier (₹)'), { target: { value: '29000' } });
    fireEvent.change(screen.getByLabelText('Advance now (₹)'), { target: { value: '30000' } });
    fireEvent.change(screen.getByLabelText('Supplier finishes making it on'), { target: { value: '2026-11-20' } });
    fireEvent.change(screen.getByLabelText(/UPI ID/), { target: { value: 'kochi@okaxis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and send advance for approval' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The advance cannot be more than the agreed total (₹29,000).');
    expect(fetchMock).not.toHaveBeenCalled();
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

describe('linking an expense to an order', () => {
  afterEach(() => jest.clearAllMocks());
  const match = { id: 'o7', number: '#DD97FE16', customer: 'Ravi Kumar', total: 52000, createdAt: '2026-11-01T05:00:00Z' };
  const request = (over: Partial<PaymentRequest> = {}): PaymentRequest => ({
    id: 'e1', number: 'PR-0061', kind: 'expense', status: 'paid', statusLabel: 'Paid', team: 'procurement', teamLabel: 'Procurement',
    requestedBy: 'Neha', amount: 0, currency: 'THB', foreignAmount: 29400, rupeesPending: true, category: 'import_purchase', description: 'Sangaroon Trading',
    payee: { name: 'Sangaroon Trading', method: 'bank' }, order: null, itemNames: [], customer: null, closedBy: '', files: [], payment: null,
    decisionNote: '', history: [], createdAt: '2026-11-05T05:00:00Z',
    can: { approve: false, decline: false, pay: false, hold: false, cancel: false, linkOrder: true }, ...over,
  });

  it('the detail panel links a paid expense to an order found by number', async () => {
    get.mockImplementation((url: string) => (url.startsWith('/payment-requests/order-lookup')
      ? Promise.resolve({ orders: [match] })
      : Promise.resolve({ request: request() })));
    post.mockResolvedValue({ request: request({ order: { id: 'o7', number: '#DD97FE16' } }) });
    wrap(<PaymentRequestDetail id="e1" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Link to order/ }));
    fireEvent.change(screen.getByPlaceholderText(/Order number, customer name or phone/), { target: { value: 'dd97' } });
    fireEvent.click(await screen.findByRole('option', { name: /#DD97FE16/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Link #DD97FE16' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/payment-requests/e1/order', { orderId: 'o7' }));
    expect(await screen.findByText('#DD97FE16')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/payment-requests/order-lookup?q=dd97');
  });

  it('a linked expense can be removed; someone not allowed sees the order only', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    get.mockResolvedValue({ request: request({ order: { id: 'o7', number: '#DD97FE16' } }) });
    post.mockResolvedValue({ request: request() });
    const { unmount } = wrap(<PaymentRequestDetail id="e1" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Remove/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/payment-requests/e1/order', { orderId: null }));
    unmount();
    confirm.mockRestore();
    get.mockResolvedValue({ request: request({ order: { id: 'o7', number: '#DD97FE16' }, can: { approve: false, decline: false, pay: false, hold: false, cancel: false, linkOrder: false } }) });
    wrap(<PaymentRequestDetail id="e1" onClose={() => {}} />);
    expect(await screen.findByText('#DD97FE16')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change|Link to order/ })).toBeNull();
  });

  it('a new expense can be linked to an order as it is raised', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ request: { id: 'e2' } }) });
    global.fetch = fetchMock as never;
    get.mockImplementation((url: string) => (url.startsWith('/payment-requests/order-lookup')
      ? Promise.resolve({ orders: [match] })
      : Promise.resolve({ options: { team: 'operations', baseCurrency: 'INR', currencies: [{ code: 'INR', label: '₹' }, { code: 'USD', label: 'US dollar' }], categories: [{ value: 'fuel', label: 'Fuel', noteRequired: false }] } })));
    wrap(<PaymentRequestForm onDone={() => {}} />);
    // Every team gets the currency choice.
    expect(await screen.findByLabelText('Currency')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Order (optional)'), { target: { value: 'ravi' } });
    fireEvent.click(await screen.findByRole('option', { name: /Ravi Kumar/ }));
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '450' } });
    fireEvent.change(screen.getByLabelText('Pay to'), { target: { value: 'DTDC' } });
    fireEvent.change(screen.getByLabelText(/UPI ID/), { target: { value: 'dtdc@okaxis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('orderId')).toBe('o7');
    expect(form.get('amount')).toBe('450');
  });
});

describe('accounts sees what a supplier payment is part of', () => {
  afterEach(() => jest.clearAllMocks());
  const request = (over: Partial<PaymentRequest> = {}): PaymentRequest => ({
    id: 'r1', number: 'PR-0101', kind: 'supplier', status: 'submitted', statusLabel: 'Waiting for accounts approval', team: 'procurement', teamLabel: 'Procurement',
    requestedBy: 'Priya', amount: 10000, currency: 'INR', category: 'supplier', description: '',
    payee: { name: 'Kochi Fabricators', method: 'bank', accountName: 'Kochi Fabricators', accountNumber: '123456789012', ifsc: 'HDFC0001234' },
    order: { id: 'o1', number: '#AB12' }, itemNames: ['Roof rack'], customer: null, closedBy: 'Website', files: [], payment: null,
    decisionNote: '', history: [], createdAt: '2026-11-05T05:00:00Z',
    can: { approve: true, decline: true, pay: false, hold: false, cancel: false },
    dealId: 'd1', part: 'advance', partLabel: 'Advance',
    deal: {
      dealId: 'd1', dealStatus: 'open', supplierName: 'Sangaroon Trading', itemNames: ['Roof rack'], currency: 'THB',
      agreedTotal: 29400, partLabel: 'Advance', installment: 1, installments: 1, thisAmount: 10000, thisRupees: null,
      paidBefore: 0, waitingBefore: 0, balanceAfter: 19400, paidSoFar: 0, waiting: 10000, balanceDue: 29400, rupeesPaid: 0,
      startDate: '', completionDate: '2026-11-20',
    },
    ...over,
  });

  it('an advance shows the full deal: agreed total, which payment, paid before, balance after, dates', async () => {
    // The owner's screenshot: the panel showed only "THB 10,000"; the total was only in the history text.
    get.mockResolvedValue({ request: request() });
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    expect(await screen.findByText(/Supplier payment — Advance/)).toBeInTheDocument();
    const box = screen.getByLabelText('Made to order — supplier deal');
    const row = (k: string) => within(box).getByText(k).nextSibling;
    expect(row('Agreed total')).toHaveTextContent('THB 29,400 with Sangaroon Trading');
    expect(row('This payment')).toHaveTextContent('Advance (payment 1 of 1) · THB 10,000');
    expect(row('Paid before this')).toHaveTextContent('THB 0');
    expect(row('Balance after this')).toHaveTextContent('THB 19,400');
    expect(row('Deal today')).toHaveTextContent('paid THB 0 · balance due THB 29,400');
    expect(row('Dates')).toHaveTextContent('advance paid not yet · completion 20 Nov 2026');
  });

  it('a paid foreign part shows the rupees the bank debited', async () => {
    get.mockResolvedValue({ request: request({ status: 'paid', deal: { ...request().deal!, thisRupees: 24300, paidSoFar: 10000, rupeesPaid: 24300, balanceDue: 19400, startDate: '2026-11-06' } }) });
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    const box = await screen.findByLabelText('Made to order — supplier deal');
    expect(within(box).getByText('This payment').nextSibling).toHaveTextContent('(₹24,300 debited)');
    expect(within(box).getByText('Dates').nextSibling).toHaveTextContent('advance paid 6 Nov 2026');
  });

  it('the payments list shows which payment it is and the balance after it', async () => {
    const { DealLine } = await import('./DealSummary');
    render(<DealLine d={request().deal!} />);
    expect(screen.getByText('Advance (payment 1 of 1) · agreed THB 29,400 · balance after THB 19,400')).toBeInTheDocument();
  });

  it('a payment for a cancelled order says so', async () => {
    get.mockResolvedValue({ request: request({ status: 'approved', orderCancelled: true, can: { approve: false, decline: true, pay: false, hold: false, cancel: false } }) });
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/order \(or the item\) was cancelled, so this supplier payment cannot be paid/);
  });

  it('the deal card opens a part to edit or cancel it', async () => {
    get.mockResolvedValue({ request: request() });
    wrap(<LineSupplierPayment order={order} line={line('i1', 'Roof rack')} requests={[]} deals={[deal()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'PR-0101' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining('/payment-requests/r1')));
  });
});
