/**
 * Quotation-first GTM screens: accepting a quotation creates the order and moves
 * on to payment; payment can be requested in parts that must add up exactly.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import QuotationDetail from './QuotationDetail';
import SalesOrderPayment, { evenSplit } from './SalesOrderPayment';

const get = jest.fn();
const post = jest.fn();
const push = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => <canvas /> }));

const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const QUOTE = {
  id: 'q1', number: 'QT-7F3A91C2', version: 1, status: 'open', customer: { name: 'Salman Khan', email: '', phone: '9820917286' },
  shippingAddress: { addressLine1: 'Suman Heights', city: 'Navi Mumbai', state: 'MH', postalCode: '400706' },
  items: [{ product: null, variantId: null, variantLabel: null, custom: true, name: 'Hilux build', image: '', quantity: 1, price: 3159448, listPrice: null }],
  totalAmount: 3159448, notes: '', validUntil: '2026-10-24T10:00:00Z', salesPerson: 'Asha', orderId: null,
  createdAt: '2026-10-17T10:00:00Z', updatedAt: '2026-10-17T10:00:00Z', revisions: [],
};

const ORDER = (payment: object) => ({
  order: {
    id: 'o1', orderNumber: '#AB12CD34', createdAt: '', status: 'awaiting_payment', paymentStatus: 'pending', totalAmount: 3159448,
    items: [], customer: { name: 'Salman Khan', email: '', phone: '9820917286' }, shippingAddress: null, salesPerson: 'Asha',
    linkState: null, paymentLinkUrl: null, paymentLinkExpiresAt: null, razorpayPaymentId: null, paymentMethod: null,
    paymentFlow: 'parts', payment,
  },
});

beforeEach(() => {
  get.mockReset(); post.mockReset(); push.mockReset();
  window.confirm = jest.fn(() => true);
});

it('splits evenly in whole rupees, the last part taking the rest', () => {
  expect(evenSplit(3159448, 4)).toEqual([789862, 789862, 789862, 789862]);
  expect(evenSplit(10000, 3)).toEqual([3333, 3333, 3334]);
  expect(evenSplit(500, 1)).toEqual([500]);
});

it('accepting a quotation creates the order and opens its payment page', async () => {
  get.mockResolvedValue({ quotation: QUOTE });
  post.mockResolvedValue({ orderId: 'o1' });
  wrap(<QuotationDetail id="q1" />);
  fireEvent.click(await screen.findByRole('button', { name: /Client accepted — create order/ }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/sales/quotations/q1/accept', {}));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/team/sales/orders/o1'));
});

it('requests payment in parts only when they add up to the total', async () => {
  get.mockResolvedValue(ORDER({ parts: [], amountPaid: 0, amountRequested: 0, amountToRequest: 3159448 }));
  post.mockResolvedValue({ payment: {} });
  wrap(<SalesOrderPayment id="o1" />);

  fireEvent.click(await screen.findByRole('button', { name: '4 parts' }));
  expect(screen.getByText(/Adds up to/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Amount for part 4'), { target: { value: '100' } });
  expect(screen.getByText(/still to assign/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Create 4 payment links/ })).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Amount for part 4'), { target: { value: '789862' } });
  fireEvent.click(screen.getByRole('button', { name: /Create 4 payment links/ }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/sales/orders/o1/payment-parts', { amounts: [789862, 789862, 789862, 789862] }));
});

it('shows each part with its status, and how much is in', async () => {
  get.mockResolvedValue(ORDER({
    parts: [
      { id: 'p1', n: 1, amount: 1000000, status: 'paid', url: null, expiresAt: '2026-10-19T10:00:00Z', paidAt: '2026-10-17T12:00:00Z' },
      { id: 'p2', n: 2, amount: 2159448, status: 'pending', url: 'https://rzp.io/i/x', expiresAt: '2026-10-19T10:00:00Z', paidAt: null },
    ],
    amountPaid: 1000000, amountRequested: 3159448, amountToRequest: 0,
  }));
  wrap(<SalesOrderPayment id="o1" />);
  expect(await screen.findByText('Paid')).toBeInTheDocument();
  expect(screen.getByText('Waiting for payment')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Payment request PDF/ })).toHaveAttribute('href', '/api/v1/staff/sales/orders/o1/payment-request');
  // Nothing left to request; a part is paid so the order can't be cancelled here.
  expect(screen.queryByText(/Request payment —/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
});
