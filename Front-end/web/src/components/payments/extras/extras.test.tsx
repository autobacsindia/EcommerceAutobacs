/**
 * Extra charges on screen: the buttons come from what the server says this person
 * may do, the screen shows the server's totals, and a double submit sends one key.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrderExtraCharges from './OrderExtraCharges';
import ExtraChargesList from './ExtraChargesList';
import CustomerExtraCharges from '@/components/orders/CustomerExtraCharges';
import type { ExtraCharge, OrderExtras } from './api';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: jest.fn() } }));

const NONE = { edit: false, cancel: false, decide: false, sendLink: false, recordBank: false, refund: false };
const EXTRA = (over: Partial<ExtraCharge> = {}): ExtraCharge => ({
  id: 'x1', orderId: 'o1', orderNumber: '#AB12', customer: { name: 'Test Buyer', city: 'Kochi' }, salesPerson: 'Asha', sequence: 1,
  amount: 5000, reason: 'Larger screen fitting', status: 'awaiting_accounts', statusLabel: 'Waiting for Accounts', requestedBy: 'Asha',
  requestedAt: '2026-11-01T10:00:00.000Z', decidedBy: '', decidedAt: null, decisionNote: '', paidVia: null, paidAt: null, receiptNo: null,
  payUrl: null, payBy: null, bankTransferPending: false, refund: null, can: NONE, ...over,
});
const TOTALS = { original: 29000, extrasPaid: 0, extrasRefunded: 0, extrasRefundDue: 0, extrasWaiting: 5000, finalAmount: 29000 };
const serve = (over: Partial<OrderExtras> = {}) => get.mockResolvedValue({ extras: [EXTRA()], totals: TOTALS, canAdd: false, ...over });
const show = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => { get.mockReset(); post.mockReset(); });

describe('OrderExtraCharges', () => {
  it('shows the server totals and the not-paid warning', async () => {
    serve();
    show(<OrderExtraCharges orderId="o1" />);
    expect(await screen.findByText(/not paid yet/)).toHaveTextContent('₹5,000');
    expect(screen.getByText(/Original/)).toHaveTextContent('₹29,000');
  });

  it('offers no action the server did not allow', async () => {
    serve();
    show(<OrderExtraCharges orderId="o1" />);
    await screen.findByText('Larger screen fitting');
    for (const name of [/Approve/, 'Reject', /Razorpay/, 'Edit', 'Cancel', /Add extra charge/]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('shows nothing when there is nothing to show or do', async () => {
    serve({ extras: [], canAdd: false });
    const { container } = show(<OrderExtraCharges orderId="o1" />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });

  it('sends only amount, reason, the tick and one key, and needs the tick', async () => {
    serve({ extras: [], totals: { ...TOTALS, extrasWaiting: 0 }, canAdd: true });
    post.mockResolvedValue({ extra: {} });
    show(<OrderExtraCharges orderId="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Add extra charge/ }));
    fireEvent.change(screen.getByLabelText(/Extra amount/), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Larger screen fitting' } });
    const save = screen.getByRole('button', { name: 'Send to Accounts' });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(save);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/staff/orders/o1/extra-charges');
    expect(Object.keys(body).sort()).toEqual(['amount', 'clientKey', 'customerConfirmed', 'reason']);
    expect(body.clientKey).toBeTruthy();
  });

  it('needs a note to reject, and approves with one click', async () => {
    serve({ extras: [EXTRA({ can: { ...NONE, decide: true } })] });
    post.mockResolvedValue({ extra: {} });
    show(<OrderExtraCharges orderId="o1" />);
    expect(await screen.findByRole('button', { name: 'Reject' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Note for GTM'), { target: { value: 'Not agreed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/extra-charges/x1/reject', { note: 'Not agreed' }));
  });

  it('shows the server message when an action fails', async () => {
    serve({ extras: [EXTRA({ can: { ...NONE, decide: true } })] });
    post.mockRejectedValue({ rawData: { message: 'This extra charge has already been decided.' } });
    show(<OrderExtraCharges orderId="o1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Approve/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already been decided');
  });
});

describe('ExtraChargesList', () => {
  it('asks the server for the chosen tab and the next page by cursor', async () => {
    get.mockResolvedValueOnce({ extras: [EXTRA()], nextCursor: 'c 1' }).mockResolvedValueOnce({ extras: [EXTRA({ id: 'x2', sequence: 2 })], nextCursor: null });
    show(<ExtraChargesList />);
    expect(await screen.findByText(/Extra 1/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/staff/extra-charges?tab=awaiting_accounts');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText(/Extra 2/)).toBeInTheDocument();
    expect(get).toHaveBeenLastCalledWith('/staff/extra-charges?tab=awaiting_accounts&cursor=c%201');
  });
});

describe('CustomerExtraCharges', () => {
  const row = { id: 'x1', sequence: 1, amount: 5000, reason: 'Larger screen fitting', statusLabel: 'Waiting for your payment', payUrl: 'https://rzp.io/x', hasReceipt: false };

  it('renders nothing for an order with no extras', () => {
    const { container } = render(<CustomerExtraCharges orderId="o1" extras={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the reason and a pay link while waiting', () => {
    render(<CustomerExtraCharges orderId="o1" extras={[row]} totals={{ extrasPaid: 0, finalAmount: 29000 }} />);
    expect(screen.getByText('Larger screen fitting')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pay now' })).toHaveAttribute('href', 'https://rzp.io/x');
    expect(screen.queryByText('Total with extras')).toBeNull();
  });

  it('shows the server total and the receipt once paid', () => {
    render(<CustomerExtraCharges orderId="o1" extras={[{ ...row, statusLabel: 'Paid', payUrl: null, hasReceipt: true }]} totals={{ extrasPaid: 5000, finalAmount: 34000 }} />);
    expect(screen.getByRole('link', { name: 'Download receipt' })).toHaveAttribute('href', '/api/v1/orders/o1/extra-charges/x1/receipt');
    expect(screen.getByText('Total with extras').parentElement).toHaveTextContent('34,000');
  });
});
