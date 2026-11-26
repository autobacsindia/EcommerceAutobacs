/**
 * "We owe suppliers" tab: what we owe each supplier, overdue alerts, adding a bill
 * (saved supplier only), and "Pay" — an ordinary supplier payment for all or part
 * of the bill. Every number is the server's; the tab only shows it.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SupplierBillsTab from './SupplierBills';
import type { SupplierBill } from './supplierBillsApi';
import type { Supplier } from './suppliers';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: jest.fn() },
}));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({ 'Content-Type': 'application/json', 'X-XSRF-TOKEN': 't' }) },
}));

const RK: Supplier = {
  id: 's9', name: 'RK New Popular', contactPerson: '', phone: '', email: '', gstin: '', address: '', notes: '',
  payment: { method: 'bank', upiId: '', accountName: 'RK New Popular', accountNumber: '', accountMasked: 'XXXXXXXX9012', ifsc: 'HDFC0001234', swift: '', bankName: 'HDFC' },
  active: true, bankChangedAt: null, bankChangedBy: '', updatedAt: '', can: { edit: true },
};
const bill = (over: Partial<SupplierBill> = {}): SupplierBill => ({
  id: 'b1', number: 'SB-0001', supplier: { id: 's9', name: 'RK New Popular' }, billNumber: 'INV-4471', billDate: '2026-11-20',
  dueDate: '2026-11-20', dueInDays: -5, amount: 26000, amountKnown: true, paid: 10000, waiting: 0, owed: 16000, leftToAsk: 16000, currency: 'INR',
  state: 'part_paid', stateLabel: 'Part paid', overdue: true, description: '40 floor mats', order: null, files: [], payments: [],
  createdByName: 'Priya', createdAt: '', rev: 0, can: { pay: true, edit: true, cancel: false }, ...over,
});

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

let fetchMock: jest.Mock;
let bills: SupplierBill[];
beforeEach(() => {
  bills = [bill(), bill({ id: 'b2', number: 'SB-0002', billNumber: 'A2', dueInDays: 3, dueDate: '2026-11-28', overdue: false, paid: 0, owed: 7000, amount: 7000, leftToAsk: 7000, state: 'unpaid', stateLabel: 'Not paid', can: { pay: true, edit: true, cancel: true } })];
  get.mockReset();
  post.mockReset();
  get.mockImplementation(async (url: string) => {
    if (url === '/supplier-bills/by-supplier') {
      return { suppliers: [{ id: 's9', name: 'RK New Popular', bills: 2, owed: 23000, noAmountBills: 0, overdueBills: 1, overdue: 16000, nextDue: '2026-11-20' }], total: { owed: 23000, overdue: 16000 } };
    }
    if (url.startsWith('/supplier-bills')) return { bills, nextCursor: null, summary: { count: bills.length, capped: false, owed: 23000 } };
    if (url.startsWith('/suppliers')) return { suppliers: [RK], nextAfter: null };
    throw new Error(`unexpected GET ${url}`);
  });
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ request: { id: 'r1', number: 'PR-0160' }, bill: bill({ id: 'b3', number: 'SB-0003' }) }) });
  global.fetch = fetchMock as unknown as typeof fetch;
});
const sent = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, method: init.method, form: init.body as FormData };
};

describe('We owe suppliers', () => {
  it('shows what we owe, per supplier, with the overdue amount flagged', async () => {
    wrap(<SupplierBillsTab canAdd />);
    const summary = await screen.findByRole('region', { name: 'What we owe' });
    expect(within(summary).getByRole('heading')).toHaveTextContent('We owe ₹23,000');
    expect(within(summary).getAllByText('₹16,000 overdue')).toHaveLength(2);
    const row = await screen.findByRole('listitem', { name: 'Bill INV-4471 from RK New Popular' });
    expect(within(row).getByText('5 days overdue')).toBeInTheDocument();
    expect(within(row).getByText('Part paid')).toBeInTheDocument();
    expect(row).toHaveTextContent('₹16,000 owed of ₹26,000');
    expect(within(screen.getByRole('listitem', { name: 'Bill A2 from RK New Popular' })).getByText('Due in 3 days')).toBeInTheDocument();
  });

  it('filters: overdue, and one supplier by clicking it', async () => {
    wrap(<SupplierBillsTab canAdd />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Overdue' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/supplier-bills?due=overdue'));
    fireEvent.click(screen.getByRole('button', { name: /RK New Popular · 2 bills/ }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/supplier-bills?due=overdue&supplier=s9'));
    fireEvent.click(screen.getByRole('tab', { name: 'Paid' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/supplier-bills?show=paid&supplier=s9'));
  });

  it('Pay sends a supplier payment for the bill — the amount left by default, never more', async () => {
    wrap(<SupplierBillsTab canAdd />);
    const row = await screen.findByRole('listitem', { name: 'Bill INV-4471 from RK New Popular' });
    fireEvent.click(within(row).getByRole('button', { name: 'Pay' }));
    const form = within(row).getByRole('form', { name: 'Pay this bill' });
    const amount = within(form).getByLabelText('Amount to pay now (₹)');
    expect(amount).toHaveValue('16000');
    fireEvent.change(amount, { target: { value: '16000.5' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send for approval' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Only ₹16,000 is left to pay');
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(amount, { target: { value: '6000' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send for approval' }));
    expect(await screen.findByRole('status')).toHaveTextContent('PR-0160 sent to accounts for approval.');
    const { url, form: body } = sent();
    expect(url).toBe('/api/v1/payment-requests/supplier');
    expect(body.get('supplierBillId')).toBe('b1');
    expect(body.get('amount')).toBe('6000');
    expect(String(body.get('clientId'))).toMatch(/.{8,}/);
    for (const k of ['supplierId', 'payee', 'orderId', 'currency']) expect(body.get(k)).toBeNull();
  });

  it('Pay with the supplier\'s credit: ₹16,000 left, ₹1,00,000 credit → nothing to pay, ₹84,000 left; sends only the tick', async () => {
    const base = get.getMockImplementation()!;
    get.mockImplementation(async (url: string) => (url === '/suppliers/s9'
      ? { supplier: { ...RK, credit: [{ currency: 'INR', owed: 100000, owedText: '₹1,00,000', pending: 0, pendingText: '' }] } }
      : base(url)));
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ request: { id: 'r1', number: 'PR-0161', status: 'paid' } }) });
    wrap(<SupplierBillsTab canAdd />);
    const row = await screen.findByRole('listitem', { name: 'Bill INV-4471 from RK New Popular' });
    fireEvent.click(within(row).getByRole('button', { name: 'Pay' }));
    const form = within(row).getByRole('form', { name: 'Pay this bill' });
    const box = await within(form).findByLabelText('Supplier credit');
    expect(box).toHaveTextContent('RK New Popular owes us ₹1,00,000');
    fireEvent.click(within(box).getByRole('checkbox', { name: /Use supplier credit/ }));
    expect(box).toHaveTextContent('₹16,000 − credit ₹16,000 = nothing to pay');
    expect(box).toHaveTextContent('Credit left for next time: ₹84,000');
    fireEvent.click(within(form).getByRole('button', { name: 'Send for approval' }));
    expect(await screen.findByRole('status')).toHaveTextContent('PR-0161 is paid fully from supplier credit');
    const { form: body } = sent();
    expect(body.get('useCredit')).toBe('true');
    expect(body.get('amount')).toBe('16000');
    expect(body.get('creditToUse')).toBeNull();
  });

  it('a supplier with no credit shows no credit box on Pay', async () => {
    wrap(<SupplierBillsTab canAdd />);
    const row = await screen.findByRole('listitem', { name: 'Bill INV-4471 from RK New Popular' });
    fireEvent.click(within(row).getByRole('button', { name: 'Pay' }));
    const form = within(row).getByRole('form', { name: 'Pay this bill' });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/suppliers/s9'));
    expect(within(form).queryByLabelText('Supplier credit')).toBeNull();
  });

  it('only shows the actions the server allows', async () => {
    bills = [bill({ state: 'paid', stateLabel: 'Paid', owed: 0, leftToAsk: 0, overdue: false, can: { pay: false, edit: true, cancel: false } })];
    wrap(<SupplierBillsTab canAdd={false} />);
    const row = await screen.findByRole('listitem', { name: 'Bill INV-4471 from RK New Popular' });
    expect(within(row).queryByRole('button', { name: 'Pay' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Cancel bill' })).toBeNull();
    expect(within(row).queryByText(/overdue/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Add a bill/ })).toBeNull();
  });

  it('adding a bill needs a supplier picked from the list, then sends it with a one-time key', async () => {
    wrap(<SupplierBillsTab canAdd />);
    fireEvent.click(await screen.findByRole('button', { name: /Add a bill/ }));
    const form = screen.getByRole('form', { name: 'Add a bill' });
    fireEvent.change(within(form).getByLabelText('Bill number (optional)'), { target: { value: 'INV-9001' } });
    fireEvent.change(within(form).getByLabelText('Bill amount (₹, optional)'), { target: { value: '12000' } });
    fireEvent.change(within(form).getByLabelText('Pay by (due date, optional)'), { target: { value: '2026-12-10' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add bill' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(/Pick the supplier from the list/);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText('Supplier'), { target: { value: 'rk' } });
    fireEvent.click(await within(form).findByRole('option', { name: /RK New Popular/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Add bill' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/SB-0003 added/);
    const { url, form: body } = sent();
    expect(url).toBe('/api/v1/supplier-bills');
    expect(body.get('supplierId')).toBe('s9');
    expect(body.get('billNumber')).toBe('INV-9001');
    expect(body.get('dueDate')).toBe('2026-12-10');
    expect(body.get('amount')).toBe('12000');
    expect(String(body.get('clientId'))).toMatch(/.{8,}/);
  });

  it('a bill can be added with no bill number (it may come later), and shows as such', async () => {
    wrap(<SupplierBillsTab canAdd />);
    fireEvent.click(await screen.findByRole('button', { name: /Add a bill/ }));
    const form = screen.getByRole('form', { name: 'Add a bill' });
    fireEvent.change(within(form).getByLabelText('Supplier'), { target: { value: 'rk' } });
    fireEvent.click(await within(form).findByRole('option', { name: /RK New Popular/ }));
    fireEvent.change(within(form).getByLabelText('Bill amount (₹, optional)'), { target: { value: '12000' } });
    fireEvent.change(within(form).getByLabelText('Pay by (due date, optional)'), { target: { value: '2026-12-10' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add bill' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/SB-0003 added/);
    expect(screen.queryByText(/Type the supplier's bill number/)).toBeNull();
    expect(sent().form.get('billNumber')).toBe('');
  });

  it('a bill with no number is listed by its SB number', async () => {
    bills = [bill({ billNumber: '' })];
    wrap(<SupplierBillsTab canAdd />);
    const row = await screen.findByRole('listitem', { name: 'Bill SB-0001 from RK New Popular' });
    expect(within(row).getByText(/no bill number yet/)).toBeInTheDocument();
  });

  it('a bill can be added with just the supplier: amount and due date may come later', async () => {
    wrap(<SupplierBillsTab canAdd />);
    fireEvent.click(await screen.findByRole('button', { name: /Add a bill/ }));
    const form = screen.getByRole('form', { name: 'Add a bill' });
    fireEvent.change(within(form).getByLabelText('Supplier'), { target: { value: 'rk' } });
    fireEvent.click(await within(form).findByRole('option', { name: /RK New Popular/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Add bill' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/SB-0003 added/);
    const body = sent().form;
    expect([body.get('amount'), body.get('dueDate'), body.get('billNumber')]).toEqual(['', '', '']);
  });

  it('a typed amount must still be a real one', async () => {
    wrap(<SupplierBillsTab canAdd />);
    fireEvent.click(await screen.findByRole('button', { name: /Add a bill/ }));
    const form = screen.getByRole('form', { name: 'Add a bill' });
    fireEvent.change(within(form).getByLabelText('Supplier'), { target: { value: 'rk' } });
    fireEvent.click(await within(form).findByRole('option', { name: /RK New Popular/ }));
    fireEvent.change(within(form).getByLabelText('Bill amount (₹, optional)'), { target: { value: 'abc' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add bill' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(/Type the bill amount in rupees/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a bill with no amount or due date says so; Pay asks for the amount first, then shows the payment', async () => {
    const unknown = bill({ amount: null, amountKnown: false, owed: null, leftToAsk: null, paid: 0, dueDate: '', dueInDays: null, overdue: false, state: 'unpaid', stateLabel: 'Not paid', rev: 2 });
    bills = [unknown];
    wrap(<SupplierBillsTab canAdd />);
    const row = await screen.findByRole('listitem', { name: 'Bill INV-4471 from RK New Popular' });
    expect(row).toHaveTextContent('Amount not known yet');
    expect(row).toHaveTextContent('No due date');
    expect(within(row).queryByText(/overdue|Due in/)).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Pay' }));
    expect(within(row).queryByRole('form', { name: 'Pay this bill' })).toBeNull();
    const step = within(row).getByRole('form', { name: 'Add the bill amount' });
    fireEvent.click(within(step).getByRole('button', { name: 'Save amount' }));
    expect(await within(step).findByRole('alert')).toHaveTextContent(/Type the bill amount/);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ bill: { ...unknown, amount: 9000, amountKnown: true, owed: 9000, leftToAsk: 9000, rev: 3 } }) });
    fireEvent.change(within(step).getByLabelText('Bill amount (₹)'), { target: { value: '9000' } });
    fireEvent.click(within(step).getByRole('button', { name: 'Save amount' }));
    const pay = await within(row).findByRole('form', { name: 'Pay this bill' });
    expect(within(pay).getByLabelText('Amount to pay now (₹)')).toHaveValue('9000');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect([url, init.method]).toEqual(['/api/v1/supplier-bills/b1', 'PUT']);
    const body = init.body as FormData;
    expect([body.get('amount'), body.get('rev')]).toEqual(['9000', '2']);
    expect(body.get('dueDate')).toBeNull();
  });

  it('cancelling a bill asks why', async () => {
    post.mockResolvedValue({ bill: bill({ id: 'b2', state: 'cancelled' }) });
    wrap(<SupplierBillsTab canAdd />);
    const row = await screen.findByRole('listitem', { name: 'Bill A2 from RK New Popular' });
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel bill' }));
    const form = within(row).getByRole('form', { name: 'Cancel this bill' });
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel bill' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Say why');
    fireEvent.change(within(form).getByLabelText(/Why cancel it/), { target: { value: 'added twice' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel bill' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/supplier-bills/b2/cancel', { reason: 'added twice' }));
  });
});
