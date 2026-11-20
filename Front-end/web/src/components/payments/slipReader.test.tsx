/**
 * Reading a payment slip as it is attached (shown on the GTM "Customer already
 * paid" form; every slip form uses the same hook and status block).
 *
 * What must hold:
 *   - the boxes fill in from the slip, labelled "read from slip — check", and stay editable
 *   - a UTR the salesman already typed is never overwritten
 *   - amount mismatch and duplicate UTR are shown as warnings (nothing is blocked)
 *   - if reading fails, or is switched off, the form works exactly as before
 *   - the save carries the server's token (never a client claim of "read from slip")
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BankTransferForm from '@/components/staff/sales/BankTransferForm';
import { resetSlipReaderForTests } from './slipReader';
import type { SalesOrder } from '@/components/staff/sales/types';

jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({ 'Content-Type': 'application/json' }) },
}));

const order = { id: 'o1', orderNumber: '#AB12', totalAmount: 52000 } as unknown as SalesOrder;
const pad = (n: number) => String(n).padStart(2, '0');
const d = new Date();
const TODAY = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const y = new Date(Date.now() - 86400000);
const YESTERDAY = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;

const READ = {
  status: 'read',
  token: 'signed-token',
  warnings: [],
  fields: {
    reference: '431122334455', referenceLabel: 'UTR', otherReferences: [], amount: 52000, date: YESTERDAY, time: '14:05',
    transactionAt: '', paymentStatus: 'success', payerName: 'Ravi Kumar', payeeName: 'Autobacs India', payeeAccount: '', appOrBank: 'Google Pay',
  },
};

type Answer = { status?: number; body: unknown };
let answers: { enabled: boolean; read: Answer };
let sent: { url: string; body: FormData | null }[];
const json = ({ status = 200, body }: Answer) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

beforeEach(() => {
  resetSlipReaderForTests();
  sent = [];
  answers = { enabled: true, read: { body: READ } };
  global.fetch = jest.fn((url: string, init?: RequestInit) => {
    sent.push({ url, body: (init?.body as FormData) ?? null });
    if (url.endsWith('/slip-reader/status')) return json({ body: { success: true, enabled: answers.enabled } });
    if (url.endsWith('/slip-reader/read')) return json(answers.read);
    return json({ status: 201, body: { success: true } });
  }) as unknown as typeof fetch;
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => jest.restoreAllMocks());

const slip = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3])], 'gpay.pdf', { type: 'application/pdf' });
const utrBox = () => screen.getByPlaceholderText("From the customer's receipt") as HTMLInputElement;
const dateBox = () => screen.getByDisplayValue(/\d{4}-\d{2}-\d{2}/) as HTMLInputElement;

async function attach() {
  const input = screen.getByLabelText(/Attach receipt/i);
  await act(async () => { fireEvent.change(input, { target: { files: [slip()] } }); });
}
const renderForm = () => render(<BankTransferForm order={order} onDone={jest.fn()} open />);

it('fills the UTR and date from the slip, labelled to be checked, and sends the token with the save', async () => {
  renderForm();
  await attach();
  await screen.findByText(/Read from slip — please check/);
  expect(utrBox().value).toBe('431122334455');
  expect(dateBox().value).toBe(YESTERDAY);
  expect(screen.getAllByText('read from slip — check')).toHaveLength(2);
  expect(screen.getByText(/Ravi Kumar → Autobacs India · Google Pay/)).toBeInTheDocument();
  const read = sent.find((s) => s.url.endsWith('/slip-reader/read'))!;
  expect(read.body!.get('expectedAmount')).toBe('52000');

  // Still editable: a changed box is labelled as changed.
  fireEvent.change(utrBox(), { target: { value: '431122334499' } });
  expect(screen.getByText('changed from slip')).toBeInTheDocument();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Send to accounts/ })); });
  const save = sent.find((s) => s.url.includes('/bank-transfer'))!;
  expect(save.body!.get('slipRead')).toBe('signed-token');
  expect(save.body!.get('reference')).toBe('431122334499');
});

it('never overwrites a UTR the salesman already typed', async () => {
  renderForm();
  fireEvent.change(utrBox(), { target: { value: 'TYPEDREF12345' } });
  await attach();
  await screen.findByText(/Read from slip — please check/);
  expect(utrBox().value).toBe('TYPEDREF12345');
});

it('shows the amount and duplicate-UTR warnings without blocking the save', async () => {
  answers.read = { body: { ...READ, warnings: [
    { code: 'amount_mismatch', message: 'The slip shows ₹50,000, but this payment is ₹52,000.' },
    { code: 'duplicate_reference', message: 'This UTR / reference is already used on payment PR-0091.' },
  ] } };
  renderForm();
  await attach();
  expect(await screen.findByText(/slip shows ₹50,000/)).toBeInTheDocument();
  expect(screen.getByText(/already used on payment PR-0091/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Send to accounts/ })).toBeEnabled();
});

it('when reading fails, says so and the form works as before (no token sent)', async () => {
  answers.read = { status: 500, body: { message: 'Server error' } };
  renderForm();
  await attach();
  await waitFor(() => expect(screen.queryByText(/Reading the slip/)).not.toBeInTheDocument());
  expect(screen.queryByText(/Read from slip/)).not.toBeInTheDocument();
  expect(utrBox().value).toBe('');
  expect(dateBox().value).toBe(TODAY);
  fireEvent.change(utrBox(), { target: { value: 'HDFCR520241021' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Send to accounts/ })); });
  const save = sent.find((s) => s.url.includes('/bank-transfer'))!;
  expect(save.body!.get('slipRead')).toBeNull();
});

it('when reading is switched off, the slip is never sent to be read', async () => {
  answers.enabled = false;
  renderForm();
  await attach();
  await waitFor(() => expect(sent.some((s) => s.url.endsWith('/slip-reader/status'))).toBe(true));
  expect(sent.some((s) => s.url.endsWith('/slip-reader/read'))).toBe(false);
  expect(screen.queryByText(/slip/i, { selector: '[role=status]' })).not.toBeInTheDocument();
});
