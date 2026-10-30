/**
 * How a GTM customer pays: bank / GPay QR / other details or a Razorpay link —
 * chosen on the order; the details go out as multipart to the server, which
 * checks them; above ₹50,000 a QR tells the customer to pay by bank transfer;
 * "Payment first" creates and accepts the quotation, then opens the details.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SalesOrderPayment from './SalesOrderPayment';
import { payDetailsMessage, QR_LIMIT_NOTE, rupees, type PayDetails } from './types';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({ 'Content-Type': 'application/json', 'X-XSRF-TOKEN': 't' }) },
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => <canvas /> }));

const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const ORDER = (extra: object = {}) => ({
  order: {
    id: 'o1', orderNumber: '#AB12CD34', createdAt: '', status: 'awaiting_payment', paymentStatus: 'pending', totalAmount: 62000,
    items: [], customer: { name: 'Salman Khan', email: '', phone: '9820917286' }, shippingAddress: null, salesPerson: 'Asha',
    linkState: null, paymentLinkUrl: null, paymentLinkExpiresAt: null, razorpayPaymentId: null, paymentMethod: null,
    paymentFlow: 'parts', payment: { parts: [], amountPaid: 0, amountRequested: 0, amountToRequest: 62000 },
    bankTransferPending: false, offlinePayment: null, payDetails: null, ...extra,
  },
});
const BANK = { accountName: 'Autobacs India Pvt Ltd', accountNumber: '50200012345678', ifsc: 'HDFC0001234', bankName: 'HDFC' };

let fetchMock: jest.Mock;
beforeEach(() => {
  get.mockReset(); post.mockReset();
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ order: {} }) });
  global.fetch = fetchMock as unknown as typeof fetch;
});

it('asks how the customer pays; no Razorpay link is created unless chosen', async () => {
  get.mockResolvedValue(ORDER());
  wrap(<SalesOrderPayment id="o1" />);
  expect(await screen.findByText('How will the customer pay?')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Create payment link/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Razorpay payment link/ }));
  expect(await screen.findByRole('button', { name: /Create payment link/ })).toBeInTheDocument();
});

it('bank transfer details go to the server as one form', async () => {
  get.mockResolvedValue(ORDER());
  wrap(<SalesOrderPayment id="o1" />);
  fireEvent.click(await screen.findByRole('button', { name: /Bank transfer \/ GPay QR \/ other/ }));
  fireEvent.change(screen.getByLabelText('Account holder'), { target: { value: BANK.accountName } });
  fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '5020 0012 345678' } });
  fireEvent.change(screen.getByLabelText('IFSC'), { target: { value: 'hdfc0001234' } });
  fireEvent.click(screen.getByRole('button', { name: /Save payment details/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/v1/staff/sales/orders/o1/pay-details');
  const form = init.body as FormData;
  expect(form.get('method')).toBe('bank');
  expect(JSON.parse(form.get('bank') as string)).toMatchObject({ accountNumber: '50200012345678', ifsc: 'HDFC0001234' });
});

it('GPay QR above ₹50,000: warns, and refuses to save without a QR image', async () => {
  get.mockResolvedValue(ORDER());
  wrap(<SalesOrderPayment id="o1" startWithDetails />);
  fireEvent.click(await screen.findByRole('radio', { name: 'GPay / UPI QR' }));
  expect(screen.getByRole('status')).toHaveTextContent(QR_LIMIT_NOTE);
  fireEvent.click(screen.getByRole('button', { name: /Save payment details/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Attach the GPay / UPI QR image');
  expect(fetchMock).not.toHaveBeenCalled();
});

/*
  Production, 2026-10-30: seven failed saves of this form from a Windows PC, each
  carrying a PDF in the QR box (Windows' file window offers "All files"). The QR
  box is for OUR QR picture; a customer's receipt goes under "Customer already paid".
*/
it('a PDF in the GPay QR box: refused on the spot, with a way to the receipt form', async () => {
  get.mockResolvedValue(ORDER());
  wrap(<SalesOrderPayment id="o1" startWithDetails />);
  fireEvent.click(await screen.findByRole('radio', { name: 'GPay / UPI QR' }));
  fireEvent.change(screen.getByLabelText('Attach the GPay / UPI QR'), { target: { files: [new File(['%PDF'], 'gpay receipt.pdf', { type: 'application/pdf' })] } });
  expect(screen.getByRole('alert')).toHaveTextContent('"gpay receipt.pdf" is a PDF. This box is only for a picture of our GPay / UPI QR');
  expect(screen.getByRole('alert')).toHaveTextContent('Record it under "Customer already paid" — PDFs and screenshots both work there.');
  expect(fetchMock).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: /Customer already paid — attach receipt/ }));
  expect(screen.queryByRole('form', { name: 'Payment details' })).not.toBeInTheDocument();
  expect(screen.getByRole('form', { name: 'Record a bank transfer' })).toBeInTheDocument();
  expect(screen.getByLabelText('Attach receipt (PDF or photo)')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,application/pdf');
});

it('a QR picture is still taken; another refusal does not offer the receipt form', async () => {
  get.mockResolvedValue(ORDER({ totalAmount: 30000 }));
  wrap(<SalesOrderPayment id="o1" startWithDetails />);
  fireEvent.click(await screen.findByRole('radio', { name: 'GPay / UPI QR' }));
  fireEvent.change(screen.getByLabelText('Attach the GPay / UPI QR'), { target: { files: [new File(['%PDF'], 'r.pdf', { type: 'application/pdf' })] } });
  expect(screen.getByRole('button', { name: /Customer already paid — attach receipt/ })).toBeInTheDocument();
  // Too big is a different problem: no receipt hint.
  fireEvent.change(screen.getByLabelText('Attach the GPay / UPI QR'), { target: { files: [new File([new Uint8Array(11 * 1024 * 1024)], 'qr.png', { type: 'image/png' })] } });
  expect(screen.getByRole('alert')).toHaveTextContent('"qr.png" is too large');
  expect(screen.queryByRole('button', { name: /Customer already paid — attach receipt/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Attach the GPay / UPI QR'), { target: { files: [new File(['png'], 'our-qr.png', { type: 'image/png' })] } });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Save payment details/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(((fetchMock.mock.calls[0][1] as RequestInit).body as FormData).get('qr')).toMatchObject({ name: 'our-qr.png' });
});

it('saved details: ready to share as PDF and WhatsApp; not changeable once paid', async () => {
  const details: PayDetails = { method: 'upi_qr', bank: BANK, upiId: 'autobacs@okhdfcbank', hasQr: true, note: '', setBy: 'Asha', setAt: '' };
  get.mockResolvedValue(ORDER({ payDetails: details }));
  const { unmount } = wrap(<SalesOrderPayment id="o1" />);
  expect(await screen.findByRole('link', { name: /Payment request PDF/ })).toHaveAttribute('href', expect.stringContaining('/payment-request'));
  const wa = screen.getByRole('link', { name: /Share on WhatsApp/ }).getAttribute('href') as string;
  expect(decodeURIComponent(wa)).toContain(QR_LIMIT_NOTE);
  expect(decodeURIComponent(wa)).toContain('50200012345678');
  expect(screen.getByRole('button', { name: /Change/ })).toBeInTheDocument();
  unmount();
  get.mockResolvedValue(ORDER({ payDetails: details, status: 'processing', paymentStatus: 'paid' }));
  wrap(<SalesOrderPayment id="o1" />);
  expect(await screen.findByText(/shared with the customer/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Change/ })).not.toBeInTheDocument();
});

it('a cancelled order (e.g. replaced by an edited quotation) offers nothing to share', async () => {
  const details: PayDetails = { method: 'other', bank: null, upiId: '', hasQr: false, note: 'Cash at the store', setBy: 'Asha', setAt: '' };
  get.mockResolvedValue(ORDER({
    payDetails: details, status: 'cancelled', subtotal: 24000, totalAmount: 23400,
    discount: { percent: 2.5, amount: 600, reason: 'Diwali offer', byName: 'Asha', at: null },
  }));
  wrap(<SalesOrderPayment id="o1" />);
  expect(await screen.findByText('This order was cancelled.')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Share on WhatsApp/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Payment request PDF/ })).not.toBeInTheDocument();
  // The discount is still on record, with who gave it.
  expect(screen.getByText('Discount 2.5%')).toBeInTheDocument();
  expect(screen.getByText('Reason: Diwali offer')).toBeInTheDocument();
});

it('the message says to pay by bank only above ₹50,000', () => {
  const d: PayDetails = { method: 'upi_qr', bank: null, upiId: '', hasQr: true, note: '', setBy: '', setAt: null };
  const o = (total: number) => ({ orderNumber: '#A', totalAmount: total, customer: { name: 'Ravi K' } });
  expect(payDetailsMessage(o(50001), d, rupees)).toContain(QR_LIMIT_NOTE);
  expect(payDetailsMessage(o(50000), d, rupees)).not.toContain(QR_LIMIT_NOTE);
});
