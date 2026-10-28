/**
 * Supplier screens: a saved supplier is sent by id (never its bank details);
 * typed details can be saved as a supplier; editing where a supplier is paid
 * asks first; the admin ticks some of a supplier's payments and records one
 * transfer for exactly their total.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentRequestForm from './PaymentRequestForm';
import { SupplierSuggestions } from './SupplierPicker';
import SupplierDirectory from './SupplierDirectory';
import SupplierPayQueue from './SupplierPayQueue';
import EditPaymentRequest from './EditPaymentRequest';
import { sumRupees, type Supplier } from './suppliers';
import type { PaymentRequest } from './api';

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

const ARB: Supplier = {
  id: 's1', name: 'ARB Supplies', contactPerson: 'Joseph', phone: '9800000001', email: '', gstin: '', address: '', notes: '',
  payment: { method: 'bank', upiId: '', accountName: 'ARB Pvt Ltd', accountNumber: '', accountMasked: 'XXXXXXXX9012', ifsc: 'HDFC0001234', bankName: 'HDFC' },
  active: true, bankChangedAt: null, bankChangedBy: '', updatedAt: '', can: { edit: true },
};
const SUPPLIER_CTX = { orderId: 'o1', orderNumber: '#AB12', customer: 'Ravi', closedBy: 'Website', lines: [{ itemId: 'i1', name: 'Lift kit' }] };

const request = (id: string, amount: number): PaymentRequest => ({
  id, number: `PR-${id}`, kind: 'supplier', status: 'approved', statusLabel: 'Approved', team: 'procurement', teamLabel: 'Procurement',
  requestedBy: 'Priya', amount, category: 'supplier', description: '', payee: { name: 'ARB Supplies', method: 'bank' },
  order: { id: 'o1', number: '#AB12' }, itemNames: ['Lift kit'], customer: { name: 'Ravi', phone: '', city: '' }, closedBy: '',
  files: [], payment: null, decisionNote: '', history: [], createdAt: '2026-10-20T05:00:00Z',
  can: { approve: false, decline: false, pay: true, hold: true, cancel: false },
});

let fetchMock: jest.Mock;
beforeEach(() => {
  get.mockReset(); post.mockReset(); put.mockReset();
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ request: request('1', 1) }) });
  global.fetch = fetchMock as unknown as typeof fetch;
  window.confirm = jest.fn(() => true);
});

describe('raising a supplier payment', () => {
  it('a picked supplier is sent by id — no bank details leave the browser', async () => {
    get.mockResolvedValue({ suppliers: [ARB], nextAfter: null });
    wrap(<PaymentRequestForm supplier={SUPPLIER_CTX} onDone={jest.fn()} />);
    // Typing in the name box IS the search: saved suppliers appear right under it.
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'ar' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/suppliers?status=active&q=ar'));
    fireEvent.click(await screen.findByRole('option', { name: /ARB Supplies/ }));
    expect(screen.queryByLabelText('Account number')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('supplierId')).toBe('s1');
    expect(form.get('payee')).toBeNull();
    expect(form.get('saveSupplier')).toBeNull();
  });

  it('typed details can be saved as a new supplier', async () => {
    get.mockResolvedValue({ suppliers: [], nextAfter: null });
    wrap(<PaymentRequestForm supplier={SUPPLIER_CTX} onDone={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Tyre World' } });
    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: 'tyre@okaxis' } });
    fireEvent.click(screen.getByLabelText(/Save as a new supplier/));
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('saveSupplier')).toBe('true');
    expect(JSON.parse(form.get('payee') as string)).toMatchObject({ name: 'Tyre World', method: 'upi', upiId: 'tyre@okaxis' });
  });
});

describe('supplier suggestions (also on "Ordered from supplier")', () => {
  it('nothing until a name is typed; picking fills it; an exact single match hides the list', async () => {
    get.mockResolvedValue({ suppliers: [ARB], nextAfter: null });
    const onPick = jest.fn();
    const { rerender } = wrap(<SupplierSuggestions query="" onPick={onPick} />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(<QueryClientProvider client={qc}><SupplierSuggestions query="arb" onPick={onPick} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('option', { name: /ARB Supplies/ }));
    expect(onPick).toHaveBeenCalledWith(ARB);
    rerender(<QueryClientProvider client={qc}><SupplierSuggestions query="ARB Supplies" onPick={onPick} /></QueryClientProvider>);
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });
});

describe('the directory', () => {
  it('changing where a supplier is paid asks for confirmation first', async () => {
    get.mockResolvedValue({ suppliers: [{ ...ARB, payment: { ...ARB.payment, accountNumber: '123456789012' } }], nextAfter: null });
    put.mockResolvedValue({ supplier: ARB });
    wrap(<SupplierDirectory canEdit />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '555566667777' } });
    expect(screen.getByRole('status')).toHaveTextContent(/changing where this supplier is paid/);
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: /Save supplier/ }));
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Save supplier/ }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/suppliers/s1', expect.objectContaining({ payment: expect.objectContaining({ accountNumber: '555566667777' }) })));
  });

  it('a viewer who may not edit sees no edit buttons', async () => {
    get.mockResolvedValue({ suppliers: [{ ...ARB, can: { edit: false } }], nextAfter: null });
    wrap(<SupplierDirectory canEdit={false} />);
    expect(await screen.findByText(/A\/c XXXXXXXX9012/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add supplier/ })).not.toBeInTheDocument();
  });
});

describe('the admin pays by supplier', () => {
  it('one row per supplier with its total; ticking 2 of 3 pays exactly their total', async () => {
    get.mockImplementation((url: string) => Promise.resolve(url.endsWith('/to-pay/suppliers')
      ? { groups: [{ id: 'g1', name: 'ARB Supplies', method: 'bank', destination: 'HDFC XXXXXXXX9012', count: 3, total: 3800.5, onHold: 0, bankNotice: false, oldestAt: '' }], truncated: false }
      : { group: { id: 'g1', name: 'ARB Supplies', destination: 'HDFC XXXXXXXX9012', total: 3800.5, requests: [request('a', 1000), request('b', 2500.5), request('c', 300)] } }));
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ count: 2, total: 3500.5 }) });
    wrap(<SupplierPayQueue canPay />);

    fireEvent.click(await screen.findByRole('button', { name: /ARB Supplies/ }));
    fireEvent.click(await screen.findByLabelText('Pay PR-a'));
    fireEvent.click(screen.getByLabelText('Pay PR-b'));
    expect(screen.getByRole('button', { name: /Record payment of ₹3,500.50/ })).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/Reference/), { target: { value: 'UTR998877' } });
    fireEvent.click(screen.getByRole('button', { name: /Record payment/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/payment-requests/pay-batch');
    const form = init.body as FormData;
    expect(JSON.parse(form.get('ids') as string)).toEqual(['a', 'b']);
    expect(form.get('expectedTotal')).toBe('3500.5');
    expect(form.get('reference')).toBe('UTR998877');
    // When the money moved: an exact instant, defaulting to now.
    const at = new Date(form.get('transactionAt') as string).getTime();
    expect(Math.abs(Date.now() - at)).toBeLessThan(2 * 60 * 1000);
  });

  it('shows the server\'s reason when the batch is refused', async () => {
    get.mockImplementation((url: string) => Promise.resolve(url.endsWith('/to-pay/suppliers')
      ? { groups: [{ id: 'g1', name: 'ARB Supplies', method: 'bank', destination: 'x', count: 1, total: 1000, onHold: 0, bankNotice: true, oldestAt: '' }], truncated: false }
      : { group: { id: 'g1', name: 'ARB Supplies', destination: 'x', total: 1000, requests: [request('a', 1000)] } }));
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'The total is now ₹1,500, not ₹1,000 — refresh and check before paying.' }) });
    wrap(<SupplierPayQueue canPay />);
    expect(await screen.findByText(/Bank details changed recently/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ARB Supplies/ }));
    fireEvent.click(await screen.findByLabelText('Tick all'));
    fireEvent.change(screen.getByLabelText(/Reference/), { target: { value: 'UTR1234' } });
    fireEvent.click(screen.getByRole('button', { name: /Record payment/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The total is now');
  });

  it('adds money in paise, so the total matches the server exactly', () => {
    expect(sumRupees([0.1, 0.2])).toBe(0.3);
    expect(sumRupees([1000, 2500.5])).toBe(3500.5);
  });
});

describe('editing a payment request', () => {
  it('sends only what the API needs: amount, details and the typed payee', async () => {
    put.mockResolvedValue({ request: request('r1', 1200) });
    const onDone = jest.fn();
    wrap(<EditPaymentRequest r={{ ...request('r1', 1000), status: 'submitted', payee: { name: 'Kumar', method: 'upi', upiId: '' } }} onDone={onDone} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '1200' } });
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Invoice 77' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/payment-requests/r1', {
      amount: '1200', description: 'Invoice 77', payee: { name: 'Kumar', method: 'upi', upiId: '', phone: '' },
    }));
    expect(onDone).toHaveBeenCalled();
  });

  it('picking a saved supplier sends its id, not typed details', async () => {
    get.mockResolvedValue({ suppliers: [ARB], nextAfter: null });
    put.mockResolvedValue({ request: request('r1', 1000) });
    wrap(<EditPaymentRequest r={{ ...request('r1', 1000), status: 'approved', payee: { name: 'ar', method: 'upi', upiId: 'x@okaxis' } }} onDone={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText(/sends it back to accounts/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('option', { name: /ARB Supplies/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/payment-requests/r1', { amount: '1000', description: '', supplierId: 's1' }));
  });
});

describe('"Same supplier as before"', () => {
  it('refills the saved supplier used on the previous product', async () => {
    get.mockImplementation((url: string) => Promise.resolve(
      url === '/payment-requests/r9' ? { request: { ...request('r9', 500), supplier: { id: 's1' } } }
        : url === '/suppliers/s1' ? { supplier: ARB } : { suppliers: [], nextAfter: null },
    ));
    wrap(<PaymentRequestForm supplier={SUPPLIER_CTX} sameAs={{ id: 'r9', name: 'ARB Supplies' }} onDone={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Same supplier as before/ }));
    expect(await screen.findByText(/HDFC · ARB Pvt Ltd/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Supplier')).not.toBeInTheDocument();
  });
});

describe('admin corrects a paid payment', () => {
  it('sends method, reference, screenshots to remove and new ones — never the amount', async () => {
    const { default: EditPaidPayment } = await import('./EditPaidPayment');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ request: request('r1', 1000) }) });
    const paid = {
      ...request('r1', 1000), status: 'paid' as const,
      payment: { method: 'upi', reference: 'WRONG123', paidAt: '2026-10-26T05:00:00Z', paidByName: 'Owner' },
      files: [{ id: 'f9', kind: 'proof' as const, name: 'wrong.jpg', contentType: 'image/jpeg', bytes: 10 }],
    };
    const onDone = jest.fn();
    wrap(<EditPaidPayment r={paid} onDone={onDone} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: 'bank' } });
    fireEvent.change(screen.getByLabelText('Reference / UTR'), { target: { value: 'UTR777888' } });
    fireEvent.click(screen.getByLabelText('Remove wrong.jpg'));
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/payment-requests/r1/payment');
    expect(init.method).toBe('PUT');
    const form = init.body as FormData;
    expect(form.get('method')).toBe('bank');
    expect(form.get('reference')).toBe('UTR777888');
    expect(JSON.parse(form.get('removeFileIds') as string)).toEqual(['f9']);
    expect(form.get('amount')).toBeNull();
    // Prefilled from the recorded payment; sent back as an exact instant.
    expect(Number.isNaN(new Date(form.get('transactionAt') as string).getTime())).toBe(false);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});

describe('transaction date & time helpers', () => {
  it('round-trip a date through the datetime-local box to the minute', async () => {
    const { toLocalInput, fromLocalInput } = await import('./api');
    const d = new Date(2026, 9, 27, 14, 35, 59);
    expect(toLocalInput(d)).toBe('2026-10-27T14:35');
    expect(new Date(fromLocalInput('2026-10-27T14:35')).getTime()).toBe(new Date(2026, 9, 27, 14, 35).getTime());
    expect(fromLocalInput('')).toBe('');
  });
});
