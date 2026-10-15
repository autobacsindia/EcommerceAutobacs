/**
 * Payment request screens: the form sends what the API needs; the detail shows
 * only the actions the server allows and records a payment with its reference;
 * the order panel offers a supplier payment only for payable, uncovered items.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentRequestForm from './PaymentRequestForm';
import PaymentRequestDetail from './PaymentRequestDetail';
import OrderSupplierPayments from './OrderSupplierPayments';
import type { PaymentRequest } from './api';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({ 'Content-Type': 'application/json', 'X-XSRF-TOKEN': 't' }) },
}));

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const base: PaymentRequest = {
  id: 'r1', number: 'PR-0007', kind: 'expense', status: 'approved', statusLabel: 'Approved — waiting for accounts to pay',
  team: 'operations', teamLabel: 'Operations', requestedBy: 'Omar', amount: 1250, category: 'fuel', description: 'Diesel',
  payee: { name: 'Fuel Station', method: 'upi', upiId: 'fuel@okaxis' }, order: null, itemNames: [], customer: null, closedBy: '',
  files: [{ id: 'f1', kind: 'bill', name: 'bill.jpg', contentType: 'image/jpeg', bytes: 1000 }],
  payment: null, decisionNote: '', createdAt: '2026-10-15T05:00:00Z',
  history: [{ at: '2026-10-15T05:00:00Z', byName: 'Omar', role: 'operations', action: 'submitted', note: '' }],
  can: { approve: false, decline: false, pay: true, hold: true, cancel: false },
};

let fetchMock: jest.Mock;
beforeEach(() => {
  get.mockReset(); post.mockReset();
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ request: { ...base, status: 'submitted' } }) });
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('raising', () => {
  it('sends an expense as multipart with the payee as JSON', async () => {
    const onDone = jest.fn();
    wrap(<PaymentRequestForm onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('What for'), { target: { value: 'travel' } });
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '840' } });
    fireEvent.change(screen.getByLabelText('Pay to'), { target: { value: 'Kerala Taxi' } });
    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: 'taxi@okicici' } });
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Airport pickup for supplier visit' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/payment-requests/expenses');
    const form = init.body as FormData;
    expect(form.get('category')).toBe('travel');
    expect(form.get('amount')).toBe('840');
    expect(JSON.parse(String(form.get('payee')))).toEqual({ name: 'Kerala Taxi', method: 'upi', upiId: 'taxi@okicici', phone: '' });
    expect(init.headers['X-XSRF-TOKEN']).toBe('t');
  });

  it('a supplier payment carries the order and the chosen items', async () => {
    const onDone = jest.fn();
    wrap(<PaymentRequestForm onDone={onDone} supplier={{ orderId: 'o1', orderNumber: '#AB12', customer: 'Ravi', closedBy: 'Website', lines: [{ itemId: 'i1', name: 'Lift kit' }, { itemId: 'i2', name: 'Mat' }] }} />);
    fireEvent.click(screen.getByLabelText('Mat'));
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '38000' } });
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'ARB Supplies' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Bank transfer' }));
    fireEvent.change(screen.getByLabelText('Account holder'), { target: { value: 'ARB Supplies Pvt Ltd' } });
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '1234 5678 9012' } });
    fireEvent.change(screen.getByLabelText('IFSC'), { target: { value: 'hdfc0001234' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/payment-requests/supplier');
    const form = init.body as FormData;
    expect(form.get('orderId')).toBe('o1');
    expect(JSON.parse(String(form.get('itemIds')))).toEqual(['i1']);
    expect(JSON.parse(String(form.get('payee')))).toMatchObject({ method: 'bank', accountNumber: '123456789012', ifsc: 'HDFC0001234' });
  });
});

describe('detail', () => {
  it('shows only the allowed actions, and records a payment with its reference', async () => {
    get.mockResolvedValue({ request: base });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ request: { ...base, status: 'paid', statusLabel: 'Paid', can: { ...base.can, pay: false, hold: false }, payment: { method: 'razorpay', reference: 'pout_1', paidAt: '2026-10-15T06:00:00Z', paidByName: 'Anu' } } }) });
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    const panel = await screen.findByRole('complementary', { name: 'Payment request' });
    await within(panel).findByText('PR-0007');
    expect(within(panel).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(panel).getByRole('link', { name: /Request slip/ })).toHaveAttribute('href', '/api/v1/payment-requests/r1/slip');
    expect(within(panel).getByRole('link', { name: /Bill/ })).toHaveAttribute('href', '/api/v1/payment-requests/r1/files/f1');

    fireEvent.click(within(panel).getByRole('button', { name: 'Record payment' }));
    const mark = within(panel).getByRole('button', { name: /Mark as paid/ });
    expect(mark).toBeDisabled(); // no reference yet
    fireEvent.change(within(panel).getByLabelText('Payment reference'), { target: { value: 'pout_1' } });
    fireEvent.click(mark);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/payment-requests/r1/pay', expect.anything()));
    expect((fetchMock.mock.calls[0][1].body as FormData).get('reference')).toBe('pout_1');
    expect(await within(panel).findByRole('link', { name: /Payment receipt/ })).toBeInTheDocument();
  });

  it('declining asks for a reason first', async () => {
    get.mockResolvedValue({ request: { ...base, status: 'submitted', can: { approve: true, decline: true, pay: false, hold: false, cancel: false } } });
    post.mockResolvedValue({ request: { ...base, status: 'declined', statusLabel: 'Declined', can: { approve: false, decline: false, pay: false, hold: false, cancel: false } } });
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    const panel = await screen.findByRole('complementary', { name: 'Payment request' });
    await within(panel).findByText('PR-0007');
    fireEvent.click(within(panel).getByRole('button', { name: 'Decline' }));
    fireEvent.change(within(panel).getByLabelText(/Why is it declined/), { target: { value: 'Duplicate bill' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/payment-requests/r1/decline', { note: 'Duplicate bill' }));
  });
});

describe('order panel', () => {
  const order = {
    id: 'o1', orderNumber: '#AB12', canShip: true, source: 'website', soldBy: 'Website',
    customer: { name: 'Ravi', email: '', phone: '' },
    lines: [
      { itemId: 'i1', name: 'Lift kit', variantLabel: null, stage: 'to_ship' },
      { itemId: 'i2', name: 'Mat', variantLabel: null, stage: 'to_ship' },
      { itemId: 'i3', name: 'Cover', variantLabel: null, stage: 'stock_check' },
    ],
  } as never;

  it('lists requests and offers a new one only for payable items not already covered', async () => {
    get.mockResolvedValue({ requests: [{ id: 'r9', number: 'PR-0009', status: 'submitted', statusLabel: 'Waiting for admin approval', amount: 38000, itemIds: ['i1'], itemNames: ['Lift kit'], payee: 'ARB', paidAt: null, createdAt: '' }] });
    wrap(<OrderSupplierPayments order={order} />);
    expect(await screen.findByText('PR-0009')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Request supplier payment/ }));
    expect(screen.getByLabelText('Mat')).toBeInTheDocument();
    expect(screen.queryByLabelText('Lift kit')).toBeNull(); // in flight already
    expect(screen.queryByLabelText('Cover')).toBeNull(); // still at stock check
  });
});
