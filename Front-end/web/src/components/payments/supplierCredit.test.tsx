/**
 * Supplier credit screens (SupplierCredit.tsx, the credit box on the payment form).
 * Every number is the server's — the screens only show it and send what was typed.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentRequestForm from './PaymentRequestForm';
import SupplierCreditTab, { SupplierCreditPanel, SupplierRefundLine } from './SupplierCredit';
import type { CreditEntry } from './credit';
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

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const ARB: Supplier = {
  id: 's1', name: 'ARB Supplies', contactPerson: '', phone: '', email: '', gstin: '', address: '', notes: '',
  payment: { method: 'bank', upiId: '', accountName: 'ARB Pvt Ltd', accountNumber: '', accountMasked: 'XXXX9012', ifsc: 'HDFC0001234', swift: '', bankName: 'HDFC' },
  active: true, bankChangedAt: null, bankChangedBy: '', updatedAt: '', can: { edit: true },
  credit: [{ currency: 'INR', owed: 15000, owedText: '₹15,000', pending: 0, pendingText: '' }],
};
const entry = (over: Partial<CreditEntry> = {}): CreditEntry => ({
  id: 'e1', kind: 'repaid', kindLabel: 'Supplier paid back', status: 'pending', statusLabel: 'Waiting for accounts',
  supplier: { id: 's1', name: 'ARB Supplies' }, currency: 'INR', amount: 15000, signedAmount: -15000, amountText: '₹15,000',
  order: null, paymentRequest: null, date: '2026-11-06', reference: 'UTR-BACK-1', note: '', createdByName: 'Priya',
  createdAt: '2026-11-06T05:00:00Z', decidedByName: '', decidedAt: null, decisionNote: '', history: [],
  can: { approve: true, decline: true, cancel: false }, ...over,
});

let fetchMock: jest.Mock;
beforeEach(() => {
  get.mockReset(); post.mockReset();
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ request: { id: 'r1', number: 'PR-1' } }) });
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('using supplier credit on a payment', () => {
  it('offers the picked supplier\'s credit, shows bill − credit = transfer, and sends the credit (not a total)', async () => {
    get.mockResolvedValue({ suppliers: [ARB], nextAfter: null });
    wrap(<PaymentRequestForm supplier={{ orderId: 'o1', orderNumber: '#AB12', customer: 'Ravi', closedBy: 'Website', lines: [{ itemId: 'i1', name: 'Lift kit' }] }} onDone={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'ar' } });
    fireEvent.click(await screen.findByRole('option', { name: /ARB Supplies/ }));
    const box = screen.getByLabelText('Supplier credit');
    expect(box).toHaveTextContent('ARB Supplies owes us ₹15,000');
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '40000' } });
    fireEvent.change(within(box).getByLabelText(/Credit to use/), { target: { value: '15000' } });
    expect(box).toHaveTextContent('Bill ₹40,000 − credit ₹15,000 = transfer ₹25,000');
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('amount')).toBe('40000');
    expect(form.get('creditToUse')).toBe('15000');
    expect(form.get('supplierId')).toBe('s1');
  });

  it('no credit box when the supplier owes nothing in this currency', async () => {
    get.mockResolvedValue({ suppliers: [{ ...ARB, credit: [] }], nextAfter: null });
    wrap(<PaymentRequestForm supplier={{ orderId: 'o1', orderNumber: '#AB12', customer: 'Ravi', closedBy: 'Website', lines: [{ itemId: 'i1', name: 'Lift kit' }] }} onDone={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'ar' } });
    fireEvent.click(await screen.findByRole('option', { name: /ARB Supplies/ }));
    expect(screen.queryByLabelText('Supplier credit')).toBeNull();
  });
});

describe('"Supplier must refund"', () => {
  it('raises a claim for what was paid (or less) and sends it to accounts', async () => {
    post.mockResolvedValue({ entry: entry({ kind: 'refund_due' }) });
    wrap(<SupplierRefundLine requestId="r9" refund={{ claim: null, canClaim: true, savedSupplier: true }} currency="INR" bill={30000} />);
    fireEvent.click(screen.getByRole('button', { name: 'Supplier must refund' }));
    const form = screen.getByRole('form', { name: 'Supplier must refund' });
    expect(within(form).getByLabelText('Refund amount (INR)')).toHaveValue(30000);
    fireEvent.change(within(form).getByLabelText('Refund amount (INR)'), { target: { value: '25000' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send to accounts' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/suppliers/credit/claims', { paymentRequestId: 'r9', amount: 25000, note: '' }));
  });
  it('shows where a claim stands, and why one cannot be raised', () => {
    const { rerender } = wrap(<SupplierRefundLine requestId="r9" refund={{ claim: { id: 'e', status: 'pending', amount: 30000, currency: 'INR' }, canClaim: false, savedSupplier: true }} currency="INR" bill={30000} />);
    expect(screen.getByRole('status')).toHaveTextContent('Supplier must refund ₹30,000 · waiting for accounts');
    rerender(<QueryClientProvider client={new QueryClient()}><SupplierRefundLine requestId="r9" refund={{ claim: null, canClaim: true, savedSupplier: false }} currency="INR" bill={30000} /></QueryClientProvider>);
    expect(screen.getByText(/Save this supplier in the directory/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supplier must refund' })).toBeNull();
  });
});

describe('the supplier\'s credit and the accounts tab', () => {
  it('shows what the supplier owes and its history; a repayment is sent with a one-time form key', async () => {
    get.mockResolvedValue({
      supplier: { id: 's1', name: 'ARB Supplies' },
      balances: [{ currency: 'INR', owed: 30000, owedText: '₹30,000', pending: -15000, pendingText: '₹15,000' }],
      entries: [entry(), entry({ id: 'e0', kind: 'refund_due', kindLabel: 'Refund due', status: 'approved', statusLabel: 'Approved', signedAmount: 30000, amount: 30000, amountText: '₹30,000', can: { approve: false, decline: false, cancel: false } })],
      nextAfter: null, can: { propose: true, writeOff: false },
    });
    post.mockResolvedValue({ entry: entry() });
    wrap(<SupplierCreditPanel supplierId="s1" />);
    const panel = await screen.findByRole('region', { name: 'Supplier credit — ARB Supplies' });
    expect(panel).toHaveTextContent('Owes us ₹30,000');
    expect(panel).toHaveTextContent('−₹15,000 waiting for accounts');
    expect(within(panel).getByLabelText('Refund due ₹30,000')).toHaveTextContent('+₹30,000');
    expect(within(panel).queryByRole('button', { name: 'Write off' })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Record a repayment' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '15000' } });
    fireEvent.change(screen.getByLabelText('UTR / reference'), { target: { value: 'UTR-BACK-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to accounts' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/suppliers/s1/credit/repayments');
    expect(body).toMatchObject({ currency: 'INR', amount: 15000, reference: 'UTR-BACK-1' });
    expect(body.formKey).toMatch(/^[A-Za-z0-9_-]{8,}$/);
  });

  it('accounts approves what is waiting; sees who owes us; downloads the CSV', async () => {
    get.mockImplementation((url: string) => Promise.resolve(url.includes('owing')
      ? { suppliers: [{ supplier: { id: 's1', name: 'ARB Supplies' }, currency: 'INR', owed: 30000, owedText: '₹30,000', pending: -15000, pendingText: '₹15,000' }], capped: false }
      : { entries: [entry()], nextAfter: null }));
    post.mockResolvedValue({ entry: entry({ status: 'approved' }) });
    wrap(<SupplierCreditTab />);
    const queue = screen.getByRole('region', { name: 'Waiting for accounts' });
    fireEvent.click(await within(queue).findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/suppliers/credit/e1/approve', { note: '' }));
    const owing = screen.getByRole('region', { name: 'Suppliers who owe us' });
    expect(await within(owing).findByText('₹30,000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Download CSV/ }).getAttribute('href')).toMatch(/^\/api\/v1\/suppliers\/credit\/report\.csv\?from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}$/);
  });
});
