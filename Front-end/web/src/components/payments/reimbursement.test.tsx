/**
 * Reimbursements in the expense form, the edit form, the detail and the report.
 *
 * What must hold (the server re-checks every one; these keep the form honest):
 *   - Fuel shows km × rate as a preview and sends KM ONLY — never an amount
 *   - Food / Transportation / Others send the typed amount; Others needs details;
 *     above ₹200 a bill is asked for before sending
 *   - the task picked is sent; the last UPI is pre-filled
 *   - editing a Fuel claim sends km, never an amount
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentRequestForm from './PaymentRequestForm';
import EditPaymentRequest from './EditPaymentRequest';
import PaymentRequestDetail from './PaymentRequestDetail';
import ReimbursementReport from './ReimbursementReport';
import type { ExpenseOptions, PaymentRequest, ReimbursementReport as Report } from './api';
import { fuelPreview } from './api';

const get = jest.fn();
const post = jest.fn();
const put = jest.fn();
jest.mock('@/components/ui/RichTextBox', () => require('@/test-utils/richTextBoxMock'));
jest.mock('./slipReaderStatus', () => ({ slipReaderEnabled: () => Promise.resolve(false), resetSlipReaderForTests: () => {} }));
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a) },
}));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({ 'Content-Type': 'application/json', 'X-XSRF-TOKEN': 't' }) },
}));

const OPS: ExpenseOptions = {
  team: 'operations', baseCurrency: 'INR',
  currencies: [{ code: 'INR', label: 'Indian rupee (₹)' }, { code: 'USD', label: 'US dollar' }],
  categories: [{ value: 'reimbursement', label: 'Reimbursement', noteRequired: false }, { value: 'other', label: 'Others', noteRequired: true }],
  reimbursement: {
    types: [{ value: 'fuel', label: 'Fuel' }, { value: 'food', label: 'Food' }, { value: 'transport', label: 'Transportation' }, { value: 'other', label: 'Others' }],
    fuelRatePerKm: 15, maxKm: 1000, billRequiredAbove: 200, maxAgeDays: 365,
    lastPayee: { name: 'Omar', method: 'upi', upiId: 'omar@okaxis' },
  },
};
const TASKS = { tasks: [{ id: 't1', code: 'T-42', title: 'Pick up Hilux bumper' }], nextCursor: null };

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const base: PaymentRequest = {
  id: 'r1', number: 'PR-0101', kind: 'expense', status: 'submitted', statusLabel: 'Waiting for accounts',
  team: 'operations', teamLabel: 'Operations', requestedBy: 'Omar', amount: 630, category: 'reimbursement',
  categoryLabel: 'Reimbursement – Fuel (42 km × ₹15)', description: '',
  reimbursement: { type: 'fuel', on: '2026-11-20', km: 42, ratePerKm: 15, from: 'Peenya', to: 'Whitefield' },
  task: { id: 't1', code: 'T-42', title: 'Pick up Hilux bumper' },
  payee: { name: 'Omar', method: 'upi', upiId: 'omar@okaxis' }, order: null, itemNames: [], customer: null, closedBy: '',
  files: [], payment: null, decisionNote: '', createdAt: '2026-11-20T05:00:00Z', history: [],
  can: { approve: false, decline: false, pay: false, hold: false, cancel: true, edit: true },
};

let fetchMock: jest.Mock;
beforeEach(() => {
  get.mockReset(); post.mockReset(); put.mockReset();
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/payment-requests/expense-options')) return { options: OPS };
    if (url.startsWith('/staff/tasks?')) return TASKS;
    if (url.startsWith('/payment-requests/r1')) return { request: base };
    throw new Error(`unexpected GET ${url}`);
  });
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ request: base }) });
  global.fetch = fetchMock as unknown as typeof fetch;
});
const sent = () => fetchMock.mock.calls[0][1].body as FormData;

describe('raising a reimbursement', () => {
  it('Fuel: shows 42 km × ₹15 = ₹630 and sends km only, with the task and the pre-filled UPI', async () => {
    wrap(<PaymentRequestForm onDone={() => {}} />);
    await screen.findByRole('radiogroup', { name: 'Kind of reimbursement' });
    // No currency picker, no amount box: the amount is worked out.
    expect(screen.queryByLabelText('Currency')).toBeNull();
    expect(screen.queryByLabelText('Amount (₹)')).toBeNull();
    await waitFor(() => expect(screen.getByLabelText('UPI ID')).toHaveValue('omar@okaxis'));

    fireEvent.change(screen.getByLabelText('Kilometres driven'), { target: { value: '42' } });
    expect(screen.getByTestId('fuel-amount')).toHaveTextContent('42 km × ₹15 = ₹630');
    fireEvent.click(await screen.findByRole('button', { name: /T-42/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = sent();
    expect(body.get('category')).toBe('reimbursement');
    expect(body.get('amount')).toBeNull();
    expect(JSON.parse(String(body.get('reimbursement')))).toMatchObject({ type: 'fuel', km: '42', from: '', to: '' });
    expect(body.get('task')).toBe('t1');
    expect(body.get('currency')).toBe('INR');
  });

  it('Fuel: no km, or too many, is stopped before sending', async () => {
    wrap(<PaymentRequestForm onDone={() => {}} />);
    await screen.findByLabelText('Kilometres driven');
    fireEvent.change(screen.getByLabelText('Kilometres driven'), { target: { value: '1200' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Expense request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/more than 1,000 km/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Others: a typed amount, and details are required', async () => {
    wrap(<PaymentRequestForm onDone={() => {}} />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Others' }));
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '90' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Expense request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/details/i);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Printer ink' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sent().get('amount')).toBe('90');
    expect(JSON.parse(String(sent().get('reimbursement')))).toMatchObject({ type: 'other' });
  });

  it('Food above ₹200 asks for the bill', async () => {
    wrap(<PaymentRequestForm onDone={() => {}} />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Food' }));
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '450' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Expense request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/bill/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the preview rounds to the paisa as the server does', () => {
    expect(fuelPreview(12.5, 15)).toBe(187.5);
    expect(fuelPreview(33.33, 15.5)).toBe(516.62);
    expect(fuelPreview(0, 15)).toBe(0);
  });
});

describe('editing and reading a reimbursement', () => {
  it('editing Fuel sends the new km at the claim’s own rate, never an amount', async () => {
    // Today's rate is ₹16; this claim was raised at ₹15 and keeps it.
    get.mockImplementation(async () => ({ options: { ...OPS, reimbursement: { ...OPS.reimbursement!, fuelRatePerKm: 16 } } }));
    wrap(<EditPaymentRequest r={base} onDone={() => {}} onCancel={() => {}} />);
    const km = await screen.findByLabelText('Kilometres driven');
    expect(km).toHaveValue('42');
    fireEvent.change(km, { target: { value: '50' } });
    expect(screen.getByTestId('fuel-amount')).toHaveTextContent('50 km × ₹15 = ₹750');
    expect(screen.queryByLabelText('Amount (₹)')).toBeNull();
    fireEvent.change(screen.getByLabelText('Why are you changing it?'), { target: { value: 'Return trip too' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    // Saved as the edit form sends it: a multipart PUT (it may carry new bills).
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
    const body = sent();
    expect(body.get('amount')).toBeNull();
    expect(body.get('currency')).toBeNull();
    expect(body.get('reason')).toBe('Return trip too');
    expect(JSON.parse(String(body.get('reimbursement')))).toMatchObject({ type: 'fuel', km: '50' });
  });

  it('the detail shows the km × rate, the day spent and the task', async () => {
    wrap(<PaymentRequestDetail id="r1" onClose={() => {}} />);
    expect(await screen.findByText('42 km × ₹15 per km = ₹630')).toBeInTheDocument();
    expect(screen.getByText(/Peenya → Whitefield/)).toBeInTheDocument();
    expect(screen.getByText('T-42 Pick up Hilux bumper')).toBeInTheDocument();
  });
});

describe('the monthly report', () => {
  const report: Report = {
    month: '2026-11',
    total: { count: 3, amount: 930, paid: 630, waiting: 300, km: 52 },
    people: [{ id: 'u1', name: 'Arun', team: 'procurement', teamLabel: 'Procurement', count: 2, amount: 780, paid: 630, waiting: 150, km: 42, byType: { fuel: 630, food: 150, transport: 0, other: 0 } }],
    tasks: [{ id: 't1', code: 'T-42', title: 'Pick up Hilux bumper', count: 2, amount: 780, paid: 630, waiting: 150, km: 42 }],
    capped: false,
  };
  it('shows per person and per task; the admin can change the rate', async () => {
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/payment-requests/reimbursements/report')) return { report };
      if (url === '/payment-requests/reimbursements/settings') return { settings: { fuelRatePerKm: 15, updatedAt: null, updatedByName: '' } };
      throw new Error(url);
    });
    put.mockResolvedValue({ settings: { fuelRatePerKm: 16, updatedAt: null, updatedByName: 'Owner' } });
    wrap(<ReimbursementReport canSetRate />);
    expect(await screen.findByText('Arun')).toBeInTheDocument();
    expect(screen.getByText('Pick up Hilux bumper')).toBeInTheDocument();
    expect(await screen.findByTestId('fuel-rate')).toHaveTextContent('₹15 per km');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('₹ per km'), { target: { value: '16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/payment-requests/reimbursements/settings', { fuelRatePerKm: 16 }));
  });
  it('accounts sees the report without the rate box', async () => {
    get.mockImplementation(async () => ({ report }));
    wrap(<ReimbursementReport canSetRate={false} />);
    expect(await screen.findByText('Arun')).toBeInTheDocument();
    expect(screen.queryByText('Fuel rate')).toBeNull();
  });
});
