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

it('the message says to pay by bank only above ₹50,000', () => {
  const d: PayDetails = { method: 'upi_qr', bank: null, upiId: '', hasQr: true, note: '', setBy: '', setAt: null };
  const o = (total: number) => ({ orderNumber: '#A', totalAmount: total, customer: { name: 'Ravi K' } });
  expect(payDetailsMessage(o(50001), d, rupees)).toContain(QR_LIMIT_NOTE);
  expect(payDetailsMessage(o(50000), d, rupees)).not.toContain(QR_LIMIT_NOTE);
});
