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
jest.mock('@/components/ui/RichTextBox', () => require('@/test-utils/richTextBoxMock'));
// Slip reading has its own tests (slipReader.test.tsx); here it is off, so the forms behave as before.
jest.mock('./slipReaderStatus', () => ({ slipReaderEnabled: () => Promise.resolve(false), resetSlipReaderForTests: () => {} }));
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

/** The edit form posts multipart: what it sent, as an object (payee parsed). */
const sentEdit = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  const body: Record<string, unknown> = {};
  (init.body as FormData).forEach((v, k) => { body[k] = k === 'payee' ? JSON.parse(String(v)) : v; });
  return { url, method: init.method, body };
};
const giveReason = () => fireEvent.change(screen.getByLabelText('Why are you changing it?'), { target: { value: 'Wrong amount' } });

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

  it('a held payment: no "Record payment", shows who held it, and can be released', async () => {
    window.confirm = jest.fn(() => true);
    const hold = { note: 'Funds arrive Friday', byName: 'Meera', role: 'staff', at: '2026-11-19T06:00:00Z' };
    get.mockResolvedValue({ request: { ...base, status: 'on_hold', statusLabel: 'On hold', decisionNote: hold.note, hold,
      can: { approve: false, decline: true, pay: false, hold: false, release: true, cancel: false } } });
    post.mockResolvedValue({ request: { ...base, status: 'approved', statusLabel: 'Approved', hold: null } });
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    const panel = await screen.findByRole('complementary', { name: 'Payment request' });
    await within(panel).findByText('PR-0007');
    expect(within(panel).queryByRole('button', { name: /Record payment/ })).not.toBeInTheDocument();
    expect(within(panel).getByText(/by Meera \(Accounts\) on/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Release hold' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Release the hold on PR-0007?'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/payment-requests/r1/release', { note: '' }));
  });
});

describe('card and optional pay details', () => {
  const sentPayee = () => JSON.parse(String((fetchMock.mock.calls[0][1].body as FormData).get('payee')));

  it('pays by card: sends type, network, last 4, name and which card', async () => {
    const onDone = jest.fn();
    wrap(<PaymentRequestForm onDone={onDone} />);
    await optionsLoaded();
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '6900' } });
    fireEvent.change(screen.getByLabelText('Pay to'), { target: { value: 'Claude' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Card' }));
    expect(screen.queryByLabelText('UPI ID')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Card type'), { target: { value: 'credit' } });
    fireEvent.change(screen.getByLabelText('Card network'), { target: { value: 'visa' } });
    fireEvent.change(screen.getByLabelText('Card last 4 digits'), { target: { value: '4821' } });
    fireEvent.change(screen.getByLabelText('Name on card'), { target: { value: 'Sachin' } });
    fireEvent.change(screen.getByLabelText('Which company card'), { target: { value: 'HDFC corporate card' } });
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Claude subscription' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentPayee()).toEqual({ name: 'Claude', method: 'card', cardType: 'credit', cardNetwork: 'visa', cardLast4: '4821', cardName: 'Sachin', cardLabel: 'HDFC corporate card' });
  });

  it('a pasted full card number is refused on the spot and never kept', async () => {
    wrap(<PaymentRequestForm onDone={() => {}} />);
    await optionsLoaded();
    fireEvent.click(screen.getByRole('radio', { name: 'Card' }));
    const last4 = screen.getByLabelText('Card last 4 digits');
    fireEvent.change(last4, { target: { value: '4111 1111 1111 1111' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/Only the last 4 digits/);
    expect(last4).toHaveValue('');
    fireEvent.change(last4, { target: { value: '48' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/all 4/);
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('goes through with no pay details at all', async () => {
    const onDone = jest.fn();
    wrap(<PaymentRequestForm onDone={onDone} />);
    await optionsLoaded();
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '840' } });
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Airport pickup' } });
    // Un-choose UPI: nothing about how to pay.
    fireEvent.click(screen.getByRole('radio', { name: 'UPI' }));
    expect(screen.getByLabelText('Pay to')).not.toBeRequired();
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentPayee()).toEqual({ name: '', method: '' });
  });

  it('bank details may be blank, but a typed IFSC is still checked', async () => {
    const onDone = jest.fn();
    wrap(<PaymentRequestForm onDone={onDone} />);
    await optionsLoaded();
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '840' } });
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Airport pickup' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Bank transfer' }));
    expect(screen.getByLabelText('Account number')).not.toBeRequired();
    expect(screen.getByLabelText('IFSC')).not.toBeRequired();
    fireEvent.change(screen.getByLabelText('IFSC'), { target: { value: 'HDFC123' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/IFSC/);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('IFSC'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentPayee()).toMatchObject({ method: 'bank', accountNumber: '', ifsc: '', swift: '' });
  });

  it('the detail shows the card, and the admin can record it as paid by card', async () => {
    get.mockResolvedValue({ request: { ...base, payee: { name: 'Claude', method: 'card', cardType: 'credit', cardNetwork: 'visa', cardLast4: '4821', cardName: 'Sachin', cardLabel: 'HDFC corporate card' } } });
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    expect(await screen.findByText('Card · Visa credit ••••4821 · HDFC corporate card')).toBeInTheDocument();
    expect(screen.getByText('Sachin')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: 'card' } });
    fireEvent.click(screen.getByRole('button', { name: /Mark as paid/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/payment-requests/r1/pay', expect.anything()));
    expect((fetchMock.mock.calls[0][1].body as FormData).get('method')).toBe('card');
  });

  it('the detail says when pay details are not given yet', async () => {
    get.mockResolvedValue({ request: { ...base, payee: { name: '', method: '' } } });
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    expect(await screen.findByText(/Not given yet/)).toBeInTheDocument();
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
    expect(screen.getByText('Optional')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('What for'), { target: { value: 'other' } });
    expect(screen.getByText('Required')).toBeInTheDocument();
    // Empty formatting is not details: the form says so and sends nothing.
    fireEvent.change(detailsBox(), { target: { value: '<p><strong> </strong></p>' } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Pay to'), { target: { value: 'Shop' } });
    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: 'shop@okaxis' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Add details/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(detailsBox()).toHaveAttribute('placeholder', expect.stringMatching(/^Say what it was for/));
  });

  it('procurement: a baht bill sends only the bill — no rate, no rupee figure', async () => {
    serveOptions(PROCUREMENT);
    const onDone = jest.fn();
    wrap(<PaymentRequestForm onDone={onDone} />);
    await optionsLoaded();
    expect(options()).toContain('Freight forwarder / CHA (customs agent)');
    expect(options()).not.toContain('Fuel');
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'THB' } });
    expect(screen.queryByLabelText('Amount (₹)')).toBeNull();
    expect(screen.queryByLabelText(/Rate/)).toBeNull();
    expect(screen.getByText(/the admin records it when paying/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Bill amount (THB)'), { target: { value: '22950' } });
    fireEvent.change(screen.getByLabelText('Pay to'), { target: { value: 'Siam Parts' } });
    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: 'forex@okhdfc' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('category')).toBe('import_purchase');
    expect(form.get('currency')).toBe('THB');
    expect(form.get('foreignAmount')).toBe('22950');
    expect(form.get('fxRate')).toBeNull();
    expect(form.get('amount')).toBeNull();
  });

  it('a foreign bill by bank transfer starts on SWIFT and sends it instead of an IFSC', async () => {
    serveOptions(PROCUREMENT);
    const onDone = jest.fn();
    wrap(<PaymentRequestForm onDone={onDone} />);
    await optionsLoaded();
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'THB' } });
    fireEvent.change(screen.getByLabelText('Bill amount (THB)'), { target: { value: '22950' } });
    fireEvent.change(screen.getByLabelText('Pay to'), { target: { value: 'Open N' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Bank transfer' }));
    expect(screen.getByRole('radio', { name: 'SWIFT (foreign bank)' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByLabelText('Account holder'), { target: { value: 'Nikom Amranan' } });
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '8582102601' } });
    // A wrong shape is caught here, with an example, before anything is sent.
    fireEvent.change(screen.getByLabelText('SWIFT code'), { target: { value: 'KASITH' } });
    expect(screen.getByText(/8 or 11 letters and digits, like KASITHBK/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/SWIFT code/);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('SWIFT code'), { target: { value: 'kasithbk' } });
    fireEvent.change(screen.getByLabelText('Bank name'), { target: { value: 'KASIKORNBANK' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const payee = JSON.parse((fetchMock.mock.calls[0][1].body as FormData).get('payee') as string);
    expect(payee).toMatchObject({ method: 'bank', swift: 'KASITHBK', ifsc: '', accountNumber: '8582102601', bankName: 'KASIKORNBANK' });
  });

  it('a rupee bill by bank transfer starts on IFSC, and can be switched to SWIFT', async () => {
    const onDone = jest.fn();
    wrap(<PaymentRequestForm onDone={onDone} />);
    await optionsLoaded();
    fireEvent.click(screen.getByRole('radio', { name: 'Bank transfer' }));
    expect(screen.getByRole('radio', { name: 'IFSC (Indian bank)' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByLabelText('IFSC'), { target: { value: 'HDFC1234' } });
    expect(screen.getByText(/11 characters, like HDFC0001234/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'SWIFT (foreign bank)' }));
    expect(screen.getByLabelText('SWIFT code')).toHaveValue('');
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
    // The options fail once (the form's task picker reads its own list: left alone).
    let failed = false;
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/payment-requests/expense-options')) {
        if (!failed) { failed = true; throw Object.assign(new Error('down'), { rawData: { message: 'Server unavailable' } }); }
        return { options: OPS };
      }
      throw new Error(`unexpected GET ${url}`);
    });
    wrap(<PaymentRequestForm onDone={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
    expect(screen.queryByRole('combobox', { name: 'What for' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await optionsLoaded()).toBeInTheDocument();
  });

  it('an old expense keeps its old option when edited, marked as such', async () => {
    serveOptions(PROCUREMENT);
    const old: PaymentRequest = { ...base, status: 'submitted', team: 'procurement', category: 'fuel', categoryLabel: 'Fuel', currency: 'INR' };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ request: old }) });
    const onDone = jest.fn();
    wrap(<EditPaymentRequest r={old} onDone={onDone} onCancel={() => {}} />);
    expect(await screen.findByRole('option', { name: 'Fuel (old option)' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/payment-requests/expense-options?team=procurement');
    expect(screen.getByLabelText('What for')).toHaveValue('fuel');
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '900' } });
    giveReason();
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const sent = sentEdit();
    expect(sent).toMatchObject({ url: '/api/v1/payment-requests/r1', method: 'PUT' });
    expect(sent.body).toMatchObject({ category: 'fuel', currency: 'INR', amount: '900', reason: 'Wrong amount', rev: '0' });
    expect(put).not.toHaveBeenCalled();
  });

  it('editing a baht bill changes the bill, never a rate or rupees', async () => {
    serveOptions(PROCUREMENT);
    const thb: PaymentRequest = {
      ...base, status: 'submitted', team: 'procurement', category: 'import_purchase', categoryLabel: 'Import purchase',
      amount: 0, currency: 'THB', foreignAmount: 22950, fxRate: null, rupeesPending: true,
    };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ request: thb }) });
    const onDone = jest.fn();
    wrap(<EditPaymentRequest r={thb} onDone={onDone} onCancel={() => {}} />);
    await screen.findByRole('option', { name: 'Import purchase' });
    expect(screen.queryByLabelText('Amount (₹)')).toBeNull();
    expect(screen.queryByLabelText(/Rate/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Bill amount (THB)'), { target: { value: '23000' } });
    giveReason();
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const { body } = sentEdit();
    expect(body).toMatchObject({ currency: 'THB', foreignAmount: '23000' });
    expect(body).not.toHaveProperty('amount');
    expect(body).not.toHaveProperty('fxRate');
  });

  it('editing a foreign-bank payee keeps it on SWIFT', async () => {
    const swiftPayee: PaymentRequest = {
      ...base, status: 'submitted',
      payee: { name: 'Open N', method: 'bank', accountName: 'Nikom Amranan', accountNumber: '8582102601', swift: 'KASITHBK', ifsc: '', bankName: 'KASIKORNBANK' },
    };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ request: swiftPayee }) });
    const onDone = jest.fn();
    wrap(<EditPaymentRequest r={swiftPayee} onDone={onDone} onCancel={() => {}} />);
    expect(screen.getByLabelText('SWIFT code')).toHaveValue('KASITHBK');
    giveReason();
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentEdit().body.payee).toMatchObject({ swift: 'KASITHBK', ifsc: '' });
  });

  it('accounts sees "Edited after submit" with the reason and old → new, and Approve sends the version on screen', async () => {
    const edited = {
      ...base, status: 'submitted', statusLabel: 'Waiting for accounts', rev: 3, editedAt: '2026-11-21T09:00:00Z',
      edits: [{ at: '2026-11-21T09:00:00Z', byName: 'Omar', role: 'operations', reason: 'Bill was ₹1,100', fromStatus: 'on_hold',
        changes: [{ field: 'Amount', from: '₹1,250', to: '₹1,100' }] }],
      can: { ...base.can, approve: true, pay: false, hold: false },
    };
    get.mockResolvedValue({ request: edited });
    post.mockResolvedValue({ request: { ...edited, status: 'approved' } });
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    const history = await screen.findByRole('region', { name: 'Edit history' });
    expect(within(history).getByText('Edited 1 time after submit')).toBeInTheDocument();
    fireEvent.click(within(history).getByRole('button', { name: 'Show changes' }));
    expect(within(history).getByText(/Bill was ₹1,100/)).toBeInTheDocument();
    expect(within(history).getByText(/was on hold, sent back to accounts/)).toBeInTheDocument();
    expect(within(history).getByText('₹1,250')).toHaveClass('line-through');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/payment-requests/r1/approve', { note: '', rev: 3 }));
  });

  it('a declined request offers "Edit & send again"', async () => {
    get.mockResolvedValue({ request: { ...base, status: 'declined', statusLabel: 'Declined', decisionNote: 'Wrong amount', can: { ...base.can, pay: false, hold: false, edit: true } } });
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: /Edit & send again/ })).toBeInTheDocument();
  });

  it('the detail shows the readable name and the bill beside the rupees', async () => {
    get.mockResolvedValue({ request: { ...base, team: 'procurement', category: 'import_purchase', categoryLabel: 'Import purchase', amount: 24500, currency: 'THB', foreignAmount: 10000, fxRate: 2.45 } });
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    const panel = await screen.findByRole('complementary', { name: 'Payment request' });
    expect(await within(panel).findByText(/Import purchase expense/)).toBeInTheDocument();
    expect(within(panel).getByText('₹24,500')).toBeInTheDocument();
    expect(within(panel).getByText('Bill: THB 10,000 @ ₹2.45')).toBeInTheDocument();
  });

  it('a baht bill not yet paid shows the bill, and paying it asks for the rupees the bank debited', async () => {
    const thb = {
      ...base, team: 'procurement', category: 'import_purchase', categoryLabel: 'Import purchase', amount: 0, currency: 'THB',
      foreignAmount: 22950, fxRate: null, rupeesPending: true,
      payee: { name: 'Open N', method: 'bank' as const, accountName: 'Nikom Amranan', accountNumber: '8582102601', swift: 'KASITHBK', ifsc: '', bankName: 'KASIKORNBANK' },
    };
    get.mockResolvedValue({ request: thb });
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    const panel = await screen.findByRole('complementary', { name: 'Payment request' });
    expect(await within(panel).findByText('THB 22,950')).toBeInTheDocument();
    expect(within(panel).queryByText('₹0')).toBeNull();
    expect(within(panel).getByText(/Bank · Nikom Amranan, A\/c 8582102601, SWIFT KASITHBK \(KASIKORNBANK\)/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Record payment' }));
    const debit = within(panel).getByLabelText('Rupees debited');
    expect(debit).toBeRequired();
    fireEvent.change(debit, { target: { value: '56227' } });
    fireEvent.click(within(panel).getByRole('button', { name: /Mark as paid/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/payment-requests/r1/pay');
    expect(form.get('rupees')).toBe('56227');
  });

  describe('paid from a foreign-currency account', () => {
    const thb = {
      ...base, team: 'procurement', category: 'import_purchase', categoryLabel: 'Import purchase', amount: 0, currency: 'THB',
      foreignAmount: 10000, fxRate: null, rupeesPending: true,
      payee: { name: 'Robust Shocks Thailand', method: 'bank' as const, accountName: 'Robust', accountNumber: '1234567890', swift: 'KASITHBK', ifsc: '', bankName: 'KASIKORNBANK' },
    };

    it('choosing the THB account asks for the baht sent (not rupees) and sends it', async () => {
      get.mockResolvedValue({ request: thb });
      wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
      const panel = await screen.findByRole('complementary', { name: 'Payment request' });
      fireEvent.click(await within(panel).findByRole('button', { name: 'Record payment' }));
      // The rupee account is the default: as before.
      expect(within(panel).getByLabelText('Rupees debited')).toBeRequired();
      fireEvent.click(within(panel).getByLabelText(/THB account/));
      expect(within(panel).queryByLabelText('Rupees debited')).toBeNull();
      const sent = within(panel).getByLabelText('Amount sent in THB');
      expect(sent).toBeRequired();
      fireEvent.change(sent, { target: { value: '10,000' } });
      fireEvent.change(within(panel).getByLabelText('Account paid from'), { target: { value: "HR's Thailand account" } });
      fireEvent.click(within(panel).getByRole('button', { name: /Mark as paid/ }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const form = fetchMock.mock.calls[0][1].body as FormData;
      expect(form.get('paidFrom')).toBe('foreign');
      expect(form.get('sentAmount')).toBe('10000');
      expect(form.get('accountLabel')).toBe("HR's Thailand account");
      expect(form.get('rupees')).toBeNull();
      expect(form.get('transactionAt')).toBeTruthy();
    });

    it('a paid one shows the baht and the account — never ₹0', async () => {
      get.mockResolvedValue({ request: {
        ...thb, status: 'paid', statusLabel: 'Paid', rupeesPending: false,
        paidFrom: { currency: 'THB', amount: 10000, label: "HR's Thailand account" },
        payment: { method: 'bank', reference: 'UTR9', paidAt: '2026-11-10T05:00:00Z', transactionAt: '2026-11-10T04:00:00Z', paidByName: 'Admin' },
        can: { ...base.can, pay: false, editPayment: true },
      } });
      wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
      const panel = await screen.findByRole('complementary', { name: 'Payment request' });
      expect(await within(panel).findByText('THB 10,000')).toBeInTheDocument();
      expect(within(panel).queryByText('₹0')).toBeNull();
      expect(within(panel).getByText(/Paid from HR's Thailand account — no rupees debited/)).toBeInTheDocument();
      expect(within(panel).getByText(/HR's Thailand account · THB 10,000 sent/)).toBeInTheDocument();
    });
  });

  it('a rupee request pays as before — no rupees box', async () => {
    get.mockResolvedValue({ request: base });
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    const panel = await screen.findByRole('complementary', { name: 'Payment request' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Record payment' }));
    expect(within(panel).queryByLabelText('Rupees debited')).toBeNull();
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

describe('minimum margin (owner, 2026-11-26)', () => {
  const fillSupplier = () => {
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '75000' } });
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'ARB Supplies' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Bank transfer' }));
    fireEvent.change(screen.getByLabelText('Account holder'), { target: { value: 'ARB Supplies Pvt Ltd' } });
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '123456789012' } });
    fireEvent.change(screen.getByLabelText('IFSC'), { target: { value: 'HDFC0001234' } });
  };

  it('procurement: the server says below margin → the numbers and a reason box; sending again carries the reason', async () => {
    const onDone = jest.fn();
    const below = 'Margin is 25% — below the 30% minimum. The customer paid ₹1,00,000 for this; supplier cost is ₹75,000.';
    fetchMock
      .mockResolvedValueOnce({ ok: false, json: async () => ({ success: false, code: 'MARGIN_BELOW', message: below }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ request: { ...base, status: 'submitted' } }) });
    wrap(<PaymentRequestForm onDone={onDone} supplier={{ orderId: 'o1', orderNumber: '#AB12', customer: 'Ravi', closedBy: 'Website', lines: [{ itemId: 'i1', name: 'Roof tent' }] }} />);
    fillSupplier();
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    const box = await screen.findByRole('alert', { name: 'Below minimum margin' });
    expect(box).toHaveTextContent(below);
    expect(onDone).not.toHaveBeenCalled();
    expect((fetchMock.mock.calls[0][1].body as FormData).get('marginReason')).toBeNull();

    fireEvent.change(screen.getByLabelText('Why should we buy at this price?'), { target: { value: 'Only supplier with stock' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to accounts with reason' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((fetchMock.mock.calls[1][1].body as FormData).get('marginReason')).toBe('Only supplier with stock');
  });

  it('accounts: a below-margin payment shows the reason, and Approve needs "I accept the lower margin"', async () => {
    const r: PaymentRequest = {
      ...base, kind: 'supplier', status: 'submitted', statusLabel: 'Waiting for accounts',
      can: { approve: true, decline: true, pay: false, hold: false, cancel: false }, rev: 2,
      margin: { sale: 100000, cost: 75000, pct: 25, minPct: 30, below: true, reason: 'Only supplier with stock', acceptedByName: '', acceptedAt: null },
    };
    get.mockResolvedValue({ request: r });
    post.mockResolvedValue({ request: { ...r, status: 'approved', statusLabel: 'Approved', can: { ...r.can, approve: false } } });
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    const panel = await screen.findByRole('complementary', { name: 'Payment request' });
    expect(await within(panel).findByLabelText('Below minimum margin')).toHaveTextContent('Only supplier with stock');
    const approve = within(panel).getByRole('button', { name: 'Approve' });
    expect(approve).toBeDisabled();
    fireEvent.click(within(panel).getByLabelText(/I accept the lower margin/));
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/payment-requests/r1/approve', { note: '', rev: 2, acceptBelowMargin: true }));
  });
});
