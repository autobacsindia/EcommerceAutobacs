/**
 * Ship before payment on screen: the button appears only when the server says the
 * admin may use it, the reason is required, the list shows the server's own sum,
 * and the screens never call an order paid.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrderPayLater from './OrderPayLater';
import PayLaterList from './PayLaterList';
import PayLaterBadge from './PayLaterBadge';
import type { PayLaterRow, PayLaterState } from './api';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

const STATE = (over: Partial<PayLaterState> = {}): PayLaterState => ({
  label: 'Shipped – payment due', due: true, approvedAt: '2026-11-20T10:00:00.000Z', approvedBy: 'Admin', reason: 'Regular dealer',
  dispatchedAt: '2026-11-21T10:00:00.000Z', dueAt: '2026-11-24T10:00:00.000Z', overdueDays: 0, linkSentAt: '2026-11-21T10:00:00.000Z',
  payUrl: 'https://rzp.io/i/x', payUrlExpiresAt: '2026-11-28T10:00:00.000Z', linkBlocked: null, reminders: 0, ...over,
});
const ROW = (over: Partial<PayLaterRow> = {}): PayLaterRow => ({
  id: 'o1', orderNumber: '#AB12', status: 'shipped', paymentStatus: 'pending', amount: 8000, paidAt: null,
  customer: { name: 'Ravi', phone: '98200', city: 'Pune' }, salesPerson: 'Asha', bankTransferPending: false, payLater: STATE(), ...over,
});
const show = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => { get.mockReset(); post.mockReset(); });

describe('OrderPayLater', () => {
  it('admin can turn it on with a reason; sends only the reason', async () => {
    get.mockResolvedValue({ canApprove: true, perOrderLimit: 25000, dueDays: 3, owed: 10000, limit: 100000 });
    post.mockResolvedValue({ order: ROW() });
    show(<OrderPayLater orderId="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Ship before payment/ }));
    const yes = screen.getByRole('button', { name: /Yes, ship before payment/ });
    expect(yes).toBeDisabled();
    expect(screen.getByText(/without payment/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Why can this customer/), { target: { value: 'Regular dealer' } });
    fireEvent.click(yes);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/orders/o1/pay-later', { reason: 'Regular dealer' }));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('shows the server error, keeps the form', async () => {
    get.mockResolvedValue({ canApprove: true, perOrderLimit: 25000, dueDays: 3 });
    post.mockRejectedValue({ response: { data: { message: 'Customers already owe ₹95,000' } } });
    show(<OrderPayLater orderId="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Ship before payment/ }));
    fireEvent.change(screen.getByLabelText(/Why can this customer/), { target: { value: 'Regular dealer' } });
    fireEvent.click(screen.getByRole('button', { name: /Yes, ship before payment/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('says why not, and offers no button', async () => {
    get.mockResolvedValue({ canApprove: false, why: 'Over the ₹25,000 limit for one order.', perOrderLimit: 25000, dueDays: 3 });
    show(<OrderPayLater orderId="o1" />);
    expect(await screen.findByText(/Over the ₹25,000 limit/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing on a paid order', async () => {
    get.mockResolvedValue({ canApprove: false, why: null, perOrderLimit: 25000, dueDays: 3 });
    const { container } = show(<OrderPayLater orderId="o1" />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });

  it('once on: shows the state, never "paid"', async () => {
    get.mockResolvedValue({ canApprove: false, approved: ROW(), perOrderLimit: 25000, dueDays: 3 });
    show(<OrderPayLater orderId="o1" />);
    expect(await screen.findByText('Shipped – payment due')).toBeInTheDocument();
    expect(screen.getByText(/Regular dealer/)).toBeInTheDocument();
    expect(screen.queryByText(/^Paid/)).toBeNull();
  });
});

describe('PayLaterList', () => {
  it('shows the server totals and each order', async () => {
    get.mockResolvedValue({ orders: [ROW(), ROW({ id: 'o2', orderNumber: '#CD34', payLater: STATE({ label: 'Shipped – payment overdue', overdueDays: 2 }) })],
      nextCursor: null, summary: { owed: 16000, count: 2, overdue: 1, limit: 100000, perOrderLimit: 25000, dueDays: 3 } });
    show(<PayLaterList />);
    expect(await screen.findByText('₹16,000')).toBeInTheDocument();
    expect(screen.getByText('Shipped – payment overdue')).toBeInTheDocument();
    expect(screen.getByText(/2 days late/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/staff/pay-later?view=due');
  });

  it('switches to the paid tab', async () => {
    get.mockResolvedValue({ orders: [], nextCursor: null });
    show(<PayLaterList />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Paid after dispatch' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/pay-later?view=paid'));
  });
});

describe('PayLaterBadge', () => {
  it('warns when no link went out', () => {
    render(<PayLaterBadge state={STATE({ linkBlocked: 'part_cancelled', payUrl: null })} detail />);
    expect(screen.getByRole('alert')).toHaveTextContent(/cancelled/);
  });
  it('nothing for an ordinary order', () => {
    const { container } = render(<PayLaterBadge state={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
