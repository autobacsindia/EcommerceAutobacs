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
import EditPaymentRequest from './EditPaymentRequest';
import type { ExpenseOptions, PaymentRequest } from './api';

const get = jest.fn();
const post = jest.fn();
const put = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a) },
}));

const INR_ONLY = [{ code: 'INR', label: 'Indian rupee (₹)' }];
const OPS: ExpenseOptions = {
  team: 'operations', baseCurrency: 'INR', currencies: INR_ONLY,
  categories: [
    { value: 'fuel', label: 'Fuel', noteRequired: false }, { value: 'food', label: 'Food', noteRequired: false },
    { value: 'travel', label: 'Travel', noteRequired: false }, { value: 'other', label: 'Others', noteRequired: true },
  ],
};
const PROCUREMENT: ExpenseOptions = {
  team: 'procurement', baseCurrency: 'INR',
  currencies: [...INR_ONLY, { code: 'THB', label: 'Thai baht' }, { code: 'USD', label: 'US dollar' }],
  categories: [
    { value: 'import_purchase', label: 'Import purchase', noteRequired: false },
    { value: 'forwarder_cha', label: 'Freight forwarder / CHA (customs agent)', noteRequired: false },
    { value: 'other', label: 'Others', noteRequired: true },
  ],
};
/** The server's options for whoever is signed in. */
const serveOptions = (options: ExpenseOptions) => get.mockImplementation(async (url: string) => {
  if (url.startsWith('/payment-requests/expense-options')) return { options };
  throw new Error(`unexpected GET ${url}`);
});
const optionsLoaded = () => screen.findByRole('combobox', { name: 'What for' });
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
  get.mockReset(); post.mockReset(); put.mockReset();
  serveOptions(OPS);
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ request: { ...base, status: 'submitted' } }) });
  global.fetch = fetchMock as unknown as typeof fetch;
});

const shot = (name: string, type = 'image/jpeg', size = 10) => new File([new Uint8Array(size)], name, { type });

describe('raising', () => {
  const fillExpense = async () => {
    await optionsLoaded();
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '840' } });
    fireEvent.change(screen.getByLabelText('Pay to'), { target: { value: 'Kerala Taxi' } });
    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: 'taxi@okicici' } });
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Airport pickup' } });
  };
  const bills = () => screen.getByLabelText(/Attach bills \/ invoices/);

  it('sends several bills, adding across picks, minus any removed', async () => {
    const onDone = jest.fn();
    wrap(<PaymentRequestForm onDone={onDone} />);
    await fillExpense();
    fireEvent.change(bills(), { target: { files: [shot('one.jpg'), shot('two.pdf', 'application/pdf')] } });
    fireEvent.change(bills(), { target: { files: [shot('three.jpg')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove two.pdf' }));
    fireEvent.change(screen.getByLabelText('Attach their payment QR'), { target: { files: [shot('qr.png', 'image/png')] } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.getAll('bill').map((f) => (f as File).name)).toEqual(['one.jpg', 'three.jpg']);
    expect(form.getAll('qr').map((f) => (f as File).name)).toEqual(['qr.png']);
  });

  it('takes up to twenty bills (photos or PDFs) and refuses a file over 10 MB, saying why', async () => {
    wrap(<PaymentRequestForm onDone={() => {}} />);
    await optionsLoaded();
    fireEvent.change(bills(), { target: { files: Array.from({ length: 19 }, (_, i) => shot(`b${i}.${i % 2 ? 'pdf' : 'jpg'}`, i % 2 ? 'application/pdf' : 'image/jpeg')) } });
    fireEvent.change(bills(), { target: { files: [shot('b19.jpg'), shot('b20.jpg')] } });
    expect(screen.getByRole('alert')).toHaveTextContent('up to 20 files');
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(19);
    fireEvent.change(bills(), { target: { files: [shot('huge.pdf', 'application/pdf', 10 * 1024 * 1024 + 1)] } });
    expect(screen.getByRole('alert')).toHaveTextContent('"huge.pdf" is too large (10 MB maximum)');
    fireEvent.change(bills(), { target: { files: [shot('b19.jpg')] } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByLabelText(/Attach bills/)).toBeNull(); // full
  });

  it('a screenshot pasted in the form is sent as a bill', async () => {
    const onDone = jest.fn();
    wrap(<PaymentRequestForm onDone={onDone} />);
    await fillExpense();
    const shotPng = shot('image.png', 'image/png');
    fireEvent.paste(screen.getByLabelText('Details'), { clipboardData: { files: [shotPng], items: [], types: ['Files'] } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.getAll('bill').map((f) => (f as File).name)).toEqual([expect.stringMatching(/^screenshot-.*\.png$/)]);
    expect(form.getAll('qr')).toEqual([]);
  });

  it('sends an expense as multipart with the payee as JSON', async () => {
    const onDone = jest.fn();
    wrap(<PaymentRequestForm onDone={onDone} />);
    await optionsLoaded();
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
    expect(mark).toBeEnabled(); // the reference is optional
    fireEvent.change(within(panel).getByLabelText('Payment reference'), { target: { value: 'pout_1' } });
    fireEvent.click(mark);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/payment-requests/r1/pay', expect.anything()));
    expect((fetchMock.mock.calls[0][1].body as FormData).get('reference')).toBe('pout_1');
    expect(await within(panel).findByRole('link', { name: /Payment receipt/ })).toBeInTheDocument();
  });

  it('sends every payment screenshot attached — several picks, photos and PDFs', async () => {
    get.mockResolvedValue({ request: base });
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    const panel = await screen.findByRole('complementary', { name: 'Payment request' });
    await within(panel).findByText('PR-0007');
    fireEvent.click(within(panel).getByRole('button', { name: 'Record payment' }));
    const pick = () => within(panel).getByLabelText(/Attach payment screenshots/);
    fireEvent.change(pick(), { target: { files: [shot('a.jpg'), shot('b.pdf', 'application/pdf')] } });
    fireEvent.change(pick(), { target: { files: Array.from({ length: 18 }, (_, i) => shot(`c${i}.jpg`)) } });
    // Full at twenty: the picker hides rather than letting a twenty-first through.
    expect(within(panel).queryByLabelText(/Attach payment screenshots/)).toBeNull();
    fireEvent.change(within(panel).getByLabelText('Payment reference'), { target: { value: 'UTR12345' } });
    fireEvent.click(within(panel).getByRole('button', { name: /Mark as paid/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const sent = (fetchMock.mock.calls[0][1].body as FormData).getAll('proof').map((f) => (f as File).name);
    expect(sent).toHaveLength(20);
    expect(sent.slice(0, 3)).toEqual(['a.jpg', 'b.pdf', 'c0.jpg']);
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

describe('each team’s own options', () => {
  const options = () => screen.getAllByRole('option').map((o) => o.textContent);
  const detailsBox = () => screen.getByLabelText('Details');

  it('offers only what the server lists for the team, in rupees, with no currency picker', async () => {
    wrap(<PaymentRequestForm onDone={() => {}} />);
    await optionsLoaded();
    expect(get).toHaveBeenCalledWith('/payment-requests/expense-options');
    expect(options()).toEqual(['Fuel', 'Food', 'Travel', 'Others']);
    expect(screen.queryByLabelText('Currency')).toBeNull();
    expect(screen.getByLabelText('Amount (₹)')).toBeInTheDocument();
  });

  it('details are optional on a plain option and required on "Others"', async () => {
    wrap(<PaymentRequestForm onDone={() => {}} />);
    await optionsLoaded();
    expect(detailsBox()).not.toBeRequired();
    expect(screen.getByText('Optional')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('What for'), { target: { value: 'other' } });
    expect(detailsBox()).toBeRequired();
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(detailsBox()).toHaveAttribute('placeholder', expect.stringMatching(/^Say what it was for/));
  });

  it('procurement: a baht bill sends the bill and the rate — never a rupee figure — and previews the rupees', async () => {
    serveOptions(PROCUREMENT);
    const onDone = jest.fn();
    wrap(<PaymentRequestForm onDone={onDone} />);
    await optionsLoaded();
    expect(options()).toContain('Freight forwarder / CHA (customs agent)');
    expect(options()).not.toContain('Fuel');
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'THB' } });
    expect(screen.queryByLabelText('Amount (₹)')).toBeNull();
    fireEvent.change(screen.getByLabelText('Bill amount (THB)'), { target: { value: '10000' } });
    fireEvent.change(screen.getByLabelText('Rate (₹ for 1 THB)'), { target: { value: '2.45' } });
    expect(screen.getByText('₹24,500')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Pay to'), { target: { value: 'Siam Parts' } });
    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: 'forex@okhdfc' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('category')).toBe('import_purchase');
    expect(form.get('currency')).toBe('THB');
    expect(form.get('foreignAmount')).toBe('10000');
    expect(form.get('fxRate')).toBe('2.45');
    expect(form.get('amount')).toBeNull();
  });

  it('shows the server’s refusal as it is', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'Add details — say what this “Others” expense was for.' }) });
    wrap(<PaymentRequestForm onDone={() => {}} />);
    await optionsLoaded();
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Pay to'), { target: { value: 'Shop' } });
    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: 'shop@okaxis' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add details — say what this “Others” expense was for.');
  });

  it('if the options cannot load, says so and offers to try again — it does not guess a list', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('down'), { rawData: { message: 'Server unavailable' } }));
    wrap(<PaymentRequestForm onDone={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
    expect(screen.queryByRole('combobox', { name: 'What for' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await optionsLoaded()).toBeInTheDocument();
  });

  it('an old expense keeps its old option when edited, marked as such', async () => {
    serveOptions(PROCUREMENT);
    const old: PaymentRequest = { ...base, status: 'submitted', team: 'procurement', category: 'fuel', categoryLabel: 'Fuel', currency: 'INR' };
    put.mockResolvedValue({ request: old });
    const onDone = jest.fn();
    wrap(<EditPaymentRequest r={old} onDone={onDone} onCancel={() => {}} />);
    expect(await screen.findByRole('option', { name: 'Fuel (old option)' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/payment-requests/expense-options?team=procurement');
    expect(screen.getByLabelText('What for')).toHaveValue('fuel');
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '900' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(put).toHaveBeenCalledWith('/payment-requests/r1', expect.objectContaining({ category: 'fuel', currency: 'INR', amount: '900' }));
  });

  it('editing a baht bill changes the bill or the rate, not the rupees', async () => {
    serveOptions(PROCUREMENT);
    const thb: PaymentRequest = {
      ...base, status: 'submitted', team: 'procurement', category: 'import_purchase', categoryLabel: 'Import purchase',
      amount: 24500, currency: 'THB', foreignAmount: 10000, fxRate: 2.45,
    };
    put.mockResolvedValue({ request: thb });
    const onDone = jest.fn();
    wrap(<EditPaymentRequest r={thb} onDone={onDone} onCancel={() => {}} />);
    await screen.findByRole('option', { name: 'Import purchase' });
    expect(screen.queryByLabelText('Amount (₹)')).toBeNull();
    fireEvent.change(screen.getByLabelText('Rate (₹ for 1 THB)'), { target: { value: '2.5' } });
    expect(screen.getByText('₹25,000')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const body = put.mock.calls[0][1];
    expect(body).toMatchObject({ currency: 'THB', foreignAmount: '10000', fxRate: '2.5' });
    expect(body).not.toHaveProperty('amount');
  });

  it('the detail shows the readable name and the bill beside the rupees', async () => {
    get.mockResolvedValue({ request: { ...base, team: 'procurement', category: 'import_purchase', categoryLabel: 'Import purchase', amount: 24500, currency: 'THB', foreignAmount: 10000, fxRate: 2.45 } });
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    const panel = await screen.findByRole('complementary', { name: 'Payment request' });
    expect(await within(panel).findByText(/Import purchase expense/)).toBeInTheDocument();
    expect(within(panel).getByText('₹24,500')).toBeInTheDocument();
    expect(within(panel).getByText('Bill: THB 10,000 @ ₹2.45')).toBeInTheDocument();
  });
});

describe('a product line', () => {
  const order = {
    id: 'o1', orderNumber: '#AB12', canShip: true, source: 'website', soldBy: 'Website',
    customer: { name: 'Ravi', email: '', phone: '' }, lines: [],
  } as never;
  const line = (itemId: string, name: string, stage: string, actions: string[] = []) => ({ itemId, name, variantLabel: null, stage, actions }) as never;
  const requests = [{ id: 'r9', number: 'PR-0009', status: 'submitted' as const, statusLabel: 'Waiting for accounts', amount: 38000, itemIds: ['i1'], itemNames: ['Lift kit'], payee: 'ARB', paidAt: null, createdAt: '2026-10-20T05:00:00Z' }];

  it('shows the payment already raised for it, and no second button', () => {
    wrap(<OrderSupplierPayments order={order} line={line('i1', 'Lift kit', 'to_ship')} requests={requests} />);
    expect(screen.getByText('PR-0009')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request supplier payment/ })).toBeNull();
  });

  it('offers "Request supplier payment" for this product only, with "Same supplier as before"', () => {
    wrap(<OrderSupplierPayments order={order} line={line('i2', 'Mat', 'to_ship')} requests={requests} />);
    fireEvent.click(screen.getByRole('button', { name: /Request supplier payment/ }));
    expect(screen.getByLabelText('Mat')).toBeChecked();
    expect(screen.queryByLabelText('Lift kit')).toBeNull();
    expect(screen.getByRole('button', { name: /Same supplier as before \(ARB\)/ })).toBeInTheDocument();
  });

  it('a product at its stock check can be paid for (that records "ordered"), unless the server says no', () => {
    const { unmount } = wrap(<OrderSupplierPayments order={order} line={line('i3', 'Cover', 'stock_check', ['in_stock', 'ordered'])} requests={[]} />);
    expect(screen.getByRole('button', { name: /Request supplier payment/ })).toBeInTheDocument();
    unmount();
    wrap(<OrderSupplierPayments order={order} line={line('i3', 'Cover', 'stock_check', [])} requests={[]} />);
    expect(screen.queryByRole('button', { name: /Request supplier payment/ })).toBeNull();
  });
});
