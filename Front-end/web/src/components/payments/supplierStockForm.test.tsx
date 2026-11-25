/**
 * "Pay a supplier" — a supplier payment not for one order (stock, or one bill for
 * several orders), and the steer from a Product / Import purchase expense to it.
 * Owner, 2026-11-24: PR-0144/0145/0146 were raised as expenses with the supplier
 * typed as text, so they never showed under the supplier.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentRequestForm from './PaymentRequestForm';
import type { ExpenseOptions } from './api';
import type { Supplier } from './suppliers';

const get = jest.fn();
jest.mock('@/components/ui/RichTextBox', () => require('@/test-utils/richTextBoxMock'));
jest.mock('./slipReaderStatus', () => ({ slipReaderEnabled: () => Promise.resolve(false), resetSlipReaderForTests: () => {} }));
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: jest.fn(), put: jest.fn() },
}));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({ 'Content-Type': 'application/json', 'X-XSRF-TOKEN': 't' }) },
}));

const PROCUREMENT: ExpenseOptions = {
  team: 'procurement', baseCurrency: 'INR', currencies: [{ code: 'INR', label: 'Indian rupee (₹)' }],
  categories: [
    { value: 'reimbursement', label: 'Reimbursement', noteRequired: false },
    { value: 'product_purchase', label: 'Product purchase', noteRequired: false },
    { value: 'import_purchase', label: 'Import purchase', noteRequired: false },
    { value: 'dispatch', label: 'Dispatch (courier / shipping)', noteRequired: false },
    { value: 'other', label: 'Others', noteRequired: true },
  ],
};
const RK: Supplier = {
  id: 's9', name: 'RK New Popular', contactPerson: '', phone: '', email: '', gstin: '', address: '', notes: '',
  payment: { method: 'bank', upiId: '', accountName: 'RK New Popular', accountNumber: '', accountMasked: 'XXXXXXXX9012', ifsc: 'HDFC0001234', swift: '', bankName: 'HDFC' },
  active: true, bankChangedAt: null, bankChangedBy: '', updatedAt: '', can: { edit: true },
};

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

let fetchMock: jest.Mock;
beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/payment-requests/expense-options')) return { options: PROCUREMENT };
    if (url.startsWith('/suppliers')) return { suppliers: [RK], nextAfter: null };
    throw new Error(`unexpected GET ${url}`);
  });
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ request: { id: 'r1', number: 'PR-0150' } }) });
  global.fetch = fetchMock as unknown as typeof fetch;
});
const sent = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, form: init.body as FormData };
};
const pickRk = async () => {
  fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'rk' } });
  fireEvent.click(await screen.findByRole('option', { name: /RK New Popular/ }));
};

describe('Pay a supplier (not for one order)', () => {
  it('sends the picked supplier by id, with no order, items or category', async () => {
    const onDone = jest.fn();
    wrap(<PaymentRequestForm stock onDone={onDone} />);
    expect(screen.getByRole('heading', { name: 'Pay a supplier' })).toBeInTheDocument();
    expect(screen.queryByLabelText('What for')).toBeNull();
    await pickRk();
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '12000' } });
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: '20 floor mats' } });
    fireEvent.change(screen.getByLabelText('Other ID (optional)'), { target: { value: 'INV-4471' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const { url, form } = sent();
    expect(url).toBe('/api/v1/payment-requests/supplier');
    expect(form.get('supplierId')).toBe('s9');
    expect(form.get('amount')).toBe('12000');
    expect(form.get('reference')).toBe('INV-4471');
    expect(String(form.get('clientId'))).toMatch(/.{8,}/);
    for (const k of ['orderId', 'itemIds', 'category', 'payee', 'creditToUse']) expect(form.get(k)).toBeNull();
  });

  it('a supplier typed by hand needs "Save as a new supplier" — nothing is sent until then', async () => {
    wrap(<PaymentRequestForm stock onDone={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'New Shop Traders' } });
    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: 'newshop@okaxis' } });
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Seat covers' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Pick the supplier from the list/);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Save as a new supplier for next time'));
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const { form } = sent();
    expect(form.get('saveSupplier')).toBe('true');
    expect(JSON.parse(String(form.get('payee')))).toMatchObject({ name: 'New Shop Traders', method: 'upi', upiId: 'newshop@okaxis' });
  });

  it('says what was bought — required', async () => {
    wrap(<PaymentRequestForm stock onDone={jest.fn()} />);
    await pickRk();
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '12000' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Say what was bought/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts with what an expense form carried over', async () => {
    wrap(<PaymentRequestForm stock initial={{ amount: '8000', description: 'Wiper blades', reference: 'BILL-77' }} onDone={jest.fn()} />);
    expect(screen.getByLabelText('Amount (₹)')).toHaveValue('8000');
    expect(screen.getByLabelText('Details')).toHaveValue('Wiper blades');
    expect(screen.getByLabelText('Other ID (optional)')).toHaveValue('BILL-77');
  });
});

describe('an expense for goods steers to a supplier payment', () => {
  const choose = async (value: string) => {
    fireEvent.change(await screen.findByRole('combobox', { name: 'What for' }), { target: { value } });
  };

  it('Product purchase and Import purchase offer the switch, carrying the amount, details and ID', async () => {
    const onSwitch = jest.fn();
    wrap(<PaymentRequestForm onSwitchToSupplier={onSwitch} onDone={jest.fn()} />);
    await choose('product_purchase');
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '12000' } });
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: '20 floor mats' } });
    fireEvent.change(screen.getByLabelText('Other ID (optional)'), { target: { value: 'INV-4471' } });
    expect(screen.getByRole('note')).toHaveTextContent(/Paying a supplier for these goods\?/);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to supplier payment' }));
    expect(onSwitch).toHaveBeenCalledWith({ amount: '12000', description: '20 floor mats', reference: 'INV-4471' });
    await choose('import_purchase');
    expect(screen.getByRole('button', { name: 'Switch to supplier payment' })).toBeInTheDocument();
  });

  it('other options do not show it, and it can still be sent as an expense', async () => {
    wrap(<PaymentRequestForm onSwitchToSupplier={jest.fn()} onDone={jest.fn()} />);
    await choose('dispatch');
    expect(screen.queryByRole('button', { name: 'Switch to supplier payment' })).toBeNull();
  });

  it('teams that do not pay suppliers never see it', async () => {
    wrap(<PaymentRequestForm onDone={jest.fn()} />);
    await choose('product_purchase');
    expect(screen.queryByRole('button', { name: 'Switch to supplier payment' })).toBeNull();
  });
});
