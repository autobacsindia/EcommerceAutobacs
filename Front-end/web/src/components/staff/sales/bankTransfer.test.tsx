/**
 * Bank-transfer screens. Recording a transfer never marks anything paid here: the
 * salesman sends it to accounts, and only accounts / the admin confirm it. While a
 * transfer waits, the order offers no new payment link and no cancel.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SalesOrderPayment from './SalesOrderPayment';
import BankTransfersList, { type BankTransfer } from '@/components/payments/BankTransfersList';

const get = jest.fn();
const post = jest.fn();
const postForm = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
jest.mock('@/components/payments/api', () => ({
  ...jest.requireActual('@/components/payments/api'),
  postForm: (...a: unknown[]) => postForm(...a),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => <canvas /> }));

const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const ORDER = (extra: object = {}) => ({
  order: {
    id: 'o1', orderNumber: '#AB12CD34', createdAt: '', status: 'awaiting_payment', paymentStatus: 'pending', totalAmount: 52000,
    items: [], customer: { name: 'Salman Khan', email: '', phone: '9820917286' }, shippingAddress: null, salesPerson: 'Asha',
    linkState: null, paymentLinkUrl: null, paymentLinkExpiresAt: null, razorpayPaymentId: null, paymentMethod: null,
    paymentFlow: 'parts', payment: { parts: [], amountPaid: 0, amountRequested: 0, amountToRequest: 52000 },
    bankTransferPending: false, offlinePayment: null,
    ...extra,
  },
});

const TRANSFER = (extra: Partial<BankTransfer> = {}): BankTransfer => ({
  id: 't1', orderId: 'o1', orderNumber: '#AB12CD34', customer: { name: 'Salman Khan', city: 'Kochi, KL' }, salesPerson: 'Asha',
  amount: 52000, reference: 'UTR123456789', paidOn: '2026-10-20T00:00:00.000Z', note: '', status: 'pending',
  statusLabel: 'Waiting for accounts to check the bank', recordedBy: 'Asha', recordedAt: '2026-10-20T10:00:00.000Z',
  reviewedBy: '', reviewedAt: null, reviewNote: '', files: [{ id: 'f1', name: 'shot.jpg', contentType: 'image/jpeg', bytes: 1000 }],
  can: { confirm: true, reject: true },
  ...extra,
});

const shot = (name = 'shot.jpg') => new File(['x'], name, { type: 'image/jpeg' });
const receiptPdf = (name = 'gpay-receipt.pdf', type = 'application/pdf') => new File(['%PDF-1.4'], name, { type });

beforeEach(() => {
  get.mockReset(); post.mockReset(); postForm.mockReset();
  window.confirm = jest.fn(() => true);
});

describe('recording a bank transfer (salesman)', () => {
  it('sends the full order total, the UTR, the date and the screenshots as one form', async () => {
    get.mockResolvedValue(ORDER());
    postForm.mockResolvedValue({ transfer: {} });
    wrap(<SalesOrderPayment id="o1" />);

    fireEvent.click(await screen.findByRole('button', { name: /Customer already paid — attach receipt/ }));
    fireEvent.change(screen.getByLabelText(/UTR \/ bank or UPI reference/), { target: { value: ' UTR123456789 ' } });
    fireEvent.change(screen.getByLabelText('Date paid'), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText('Attach receipt (PDF or photo)'), { target: { files: [shot('a.jpg'), shot('b.jpg')] } });
    fireEvent.click(screen.getByRole('button', { name: /Send to accounts/ }));

    await waitFor(() => expect(postForm).toHaveBeenCalledTimes(1));
    const [endpoint, form] = postForm.mock.calls[0] as [string, FormData];
    expect(endpoint).toBe('/staff/sales/orders/o1/bank-transfer');
    expect(form.get('amount')).toBe('52000');
    expect(form.get('reference')).toBe('UTR123456789');
    expect(form.get('paidOn')).toBe('2026-10-20');
    expect(form.getAll('proof')).toHaveLength(2);
  });

  /*
    Production, 2026-10-30: a GTM lead holding a customer's PDF receipt went to
    "How will the customer pay?" (it is first on the page) and tried the GPay QR
    box seven times. That box now has a way here, and this form says "receipt".
  */
  it('"How will the customer pay?" offers "Customer already paid"; a PDF receipt and a screenshot go together', async () => {
    get.mockResolvedValue(ORDER());
    postForm.mockResolvedValue({ transfer: {} });
    wrap(<SalesOrderPayment id="o1" />);

    fireEvent.click(await screen.findByRole('button', { name: /Customer already paid — attach receipt/ }));
    const form = screen.getByRole('form', { name: 'Record a bank transfer' });
    expect(within(form).getByText(/Customer already paid — ₹52,000/)).toBeInTheDocument();
    expect(screen.getByLabelText(/UTR \/ bank or UPI reference/)).toHaveFocus();
    // The choices stay where they were; the form opens below them, in view.
    expect(screen.queryByText('How will the customer pay?')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/UTR \/ bank or UPI reference/), { target: { value: '430912345678' } });
    fireEvent.change(screen.getByLabelText('Attach receipt (PDF or photo)'), { target: { files: [receiptPdf(), shot('gpay.jpg'), receiptPdf('bank.pdf', 'application/x-pdf')] } });
    expect(within(form).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['gpay-receipt.pdf', 'gpay.jpg', 'bank.pdf']);
    fireEvent.click(screen.getByRole('button', { name: /Send to accounts/ }));

    await waitFor(() => expect(postForm).toHaveBeenCalledTimes(1));
    const [endpoint, body] = postForm.mock.calls[0] as [string, FormData];
    expect(endpoint).toBe('/staff/sales/orders/o1/bank-transfer');
    expect((body.getAll('proof') as File[]).map((f) => f.name)).toEqual(['gpay-receipt.pdf', 'gpay.jpg', 'bank.pdf']);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Record a payment of ₹52,000'));
  });

  it('one "Customer already paid" at a time: up top while asking how to pay, below once details are shared', async () => {
    get.mockResolvedValue(ORDER());
    const { unmount } = wrap(<SalesOrderPayment id="o1" />);
    await screen.findByText('How will the customer pay?');
    expect(screen.getAllByRole('button', { name: /Customer already paid/ })).toHaveLength(1);
    unmount();

    get.mockResolvedValue(ORDER({ payDetails: { method: 'other', bank: null, upiId: '', hasQr: false, note: 'Cash at the Kochi office', setBy: 'Asha', setAt: '' } }));
    wrap(<SalesOrderPayment id="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Customer already paid (bank transfer / GPay / UPI)' }));
    expect(screen.getByRole('form', { name: 'Record a bank transfer' })).toBeInTheDocument();
  });

  it('a file the form does not take is refused before anything is sent', async () => {
    get.mockResolvedValue(ORDER());
    wrap(<SalesOrderPayment id="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Customer already paid — attach receipt/ }));
    fireEvent.change(screen.getByLabelText('Attach receipt (PDF or photo)'), { target: { files: [new File(['x'], 'receipt.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('"receipt.docx" can\'t be attached here — only a photo (JPG, PNG, WebP) or a PDF.');
    expect(postForm).not.toHaveBeenCalled();
  });

  it('will not send without a screenshot', async () => {
    get.mockResolvedValue(ORDER());
    wrap(<SalesOrderPayment id="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Customer already paid — attach receipt/ }));
    fireEvent.change(screen.getByLabelText(/UTR \/ bank or UPI reference/), { target: { value: 'UTR123456789' } });
    fireEvent.click(screen.getByRole('button', { name: /Send to accounts/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add the payment screenshot');
    expect(postForm).not.toHaveBeenCalled();
  });

  it('shows the server\'s reason when it refuses', async () => {
    get.mockResolvedValue(ORDER());
    postForm.mockRejectedValue(Object.assign(new Error('x'), { rawData: { message: 'This UTR is already recorded on order #ZZ.' } }));
    wrap(<SalesOrderPayment id="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Customer already paid — attach receipt/ }));
    fireEvent.change(screen.getByLabelText(/UTR \/ bank or UPI reference/), { target: { value: 'UTR123456789' } });
    fireEvent.change(screen.getByLabelText('Attach receipt (PDF or photo)'), { target: { files: [shot()] } });
    fireEvent.click(screen.getByRole('button', { name: /Send to accounts/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already recorded on order #ZZ');
  });

  it('while accounts checks: no new link, no bank-transfer form, no cancel', async () => {
    get.mockResolvedValue(ORDER({ bankTransferPending: true }));
    wrap(<SalesOrderPayment id="o1" />);
    expect(await screen.findByText(/Bank transfer recorded — waiting for accounts/)).toBeInTheDocument();
    // Where to see what was sent: the receipts open from Bank transfers.
    expect(screen.getByRole('link', { name: /See it and its receipt in Bank transfers/ })).toHaveAttribute('href', '/team/bank-transfers');
    expect(screen.queryByRole('button', { name: /Customer already paid/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create payment link/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Customer already paid/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel order/ })).not.toBeInTheDocument();
  });

  it('a confirmed transfer says how it was paid', async () => {
    get.mockResolvedValue(ORDER({
      status: 'processing', paymentStatus: 'paid',
      offlinePayment: { method: 'bank_transfer', reference: 'UTR123456789', confirmedBy: 'Priya' },
    }));
    wrap(<SalesOrderPayment id="o1" />);
    expect(await screen.findByText(/Paid by bank transfer \(UTR UTR123456789\), confirmed by Priya/)).toBeInTheDocument();
  });
});

describe('checking bank transfers (accounts / admin)', () => {
  it('confirms only after "is it in the bank?" is answered yes', async () => {
    get.mockResolvedValue({ transfers: [TRANSFER()], nextCursor: null });
    post.mockResolvedValue({ transfer: TRANSFER({ status: 'confirmed' }) });
    wrap(<BankTransfersList />);

    const confirmBtn = await screen.findByRole('button', { name: /Money is in the bank — confirm/ });
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    fireEvent.click(confirmBtn);
    expect(post).not.toHaveBeenCalled();

    fireEvent.click(confirmBtn);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/bank-transfers/t1/confirm', {}));
    expect(get).toHaveBeenCalledWith('/staff/bank-transfers?status=pending');
  });

  it('a rejection needs a reason', async () => {
    get.mockResolvedValue({ transfers: [TRANSFER()], nextCursor: null });
    post.mockResolvedValue({ transfer: TRANSFER({ status: 'rejected' }) });
    wrap(<BankTransfersList />);

    fireEvent.click(await screen.findByRole('button', { name: /Not received — reject/ }));
    const send = screen.getByRole('button', { name: /Reject transfer/ });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Why\?/), { target: { value: 'No credit with this UTR' } });
    fireEvent.click(send);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/bank-transfers/t1/reject', { note: 'No credit with this UTR' }));
  });

  it('a viewer who may not confirm (GTM) sees the transfer and its screenshot, without the buttons', async () => {
    get.mockResolvedValue({ transfers: [TRANSFER({ can: { confirm: false, reject: false } })], nextCursor: null });
    wrap(<BankTransfersList />);
    const card = (await screen.findByText(/UTR123456789/)).closest('li') as HTMLElement;
    expect(within(card).getByRole('link', { name: /Screenshot/ })).toHaveAttribute('href', '/api/v1/staff/bank-transfers/t1/files/f1');
    expect(within(card).queryByRole('button', { name: /confirm/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /reject/ })).not.toBeInTheDocument();
  });

  it('switching tabs asks the server for that status', async () => {
    get.mockResolvedValue({ transfers: [], nextCursor: null });
    wrap(<BankTransfersList />);
    expect(await screen.findByText(/Nothing to check/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Confirmed' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/bank-transfers?status=confirmed'));
  });
});

describe('taking back a transfer recorded by mistake', () => {
  it('Withdraw asks first, then tells the server', async () => {
    get.mockResolvedValue({ transfers: [TRANSFER({ can: { confirm: false, reject: false, edit: true, withdraw: true } })], nextCursor: null });
    post.mockResolvedValue({ transfer: TRANSFER({ status: 'withdrawn' }) });
    wrap(<BankTransfersList />);
    const btn = await screen.findByRole('button', { name: /Withdraw/ });
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    fireEvent.click(btn);
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(btn);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/bank-transfers/t1/withdraw', {}));
  });
});
