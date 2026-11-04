/**
 * Order lists show the PAID date (the date of the sale, and what the list sorts by)
 * and a pin on every row: pinned orders come first (the server puts them there),
 * look different, and the pin toggles through the API. Pins are personal, so the
 * button only ever changes the signed-in person's own list.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SalesOrdersList from './sales/SalesOrdersList';
import WorkQueueList from './work/WorkQueueList';
import PinButton from './PinButton';
import { addressBar } from '@/test-utils/addressBarMock';

const get = jest.fn();
const post = jest.fn();
const del = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), delete: (...a: unknown[]) => del(...a) },
}));
jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);
jest.mock('./work/WorkOrderPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => <canvas /> }));

const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const salesRow = (id: string, extra: object = {}) => ({
  id, orderNumber: `#${id.toUpperCase()}`, createdAt: '2026-10-28T05:00:00.000Z', paidAt: null,
  status: 'awaiting_payment', paymentStatus: 'pending', totalAmount: 1000, items: [],
  customer: { name: `Customer ${id}`, email: '', phone: '' }, shippingAddress: null, salesPerson: null,
  linkState: 'active', paymentLinkUrl: null, paymentLinkExpiresAt: null, razorpayPaymentId: null, paymentMethod: null,
  bankTransferPending: false, offlinePayment: null, hold: null, ...extra,
});

beforeEach(() => {
  get.mockReset(); post.mockReset(); del.mockReset();
  post.mockResolvedValue({ pinned: true, pins: [] });
  del.mockResolvedValue({ pinned: false, pins: [] });
});

describe('GTM / Accounts list rows', () => {
  beforeEach(() => addressBar.reset('/team/orders'));

  it('a paid row shows its paid date; an unpaid row says when it was created', async () => {
    get.mockImplementation((url: string) => Promise.resolve(url.includes('filter-options') ? { sellers: [] } : {
      orders: [
        // 3 Nov, 4:25 pm India time — created a week earlier.
        salesRow('paid1', { paidAt: '2026-11-03T10:55:00.000Z', paymentStatus: 'paid', status: 'processing' }),
        salesRow('unpaid1'),
      ],
      nextCursor: null,
    }));
    wrap(<SalesOrdersList mode="paid" />);
    expect(await screen.findByText(/Paid 3 Nov 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Created 28 Oct 2026/)).toBeInTheDocument();
  });

  it('a pinned row is marked and offers Unpin; unpinned rows offer Pin; the button calls the API', async () => {
    get.mockImplementation((url: string) => Promise.resolve(url.includes('filter-options') ? { sellers: [] } : {
      orders: [salesRow('pinned1', { pinned: true }), salesRow('plain1')],
      nextCursor: null,
    }));
    wrap(<SalesOrdersList mode="sales" />);
    const unpin = await screen.findByRole('button', { name: 'Unpin this order' });
    expect(unpin).toHaveAttribute('aria-pressed', 'true');
    const pin = screen.getByRole('button', { name: 'Pin this order to the top of my list' });
    fireEvent.click(pin);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/orders/plain1/pin', {}));
    fireEvent.click(unpin);
    await waitFor(() => expect(del).toHaveBeenCalledWith('/staff/orders/pinned1/pin'));
  });

  it('pinning does not open the row', async () => {
    get.mockImplementation((url: string) => Promise.resolve(url.includes('filter-options') ? { sellers: [] } : {
      orders: [salesRow('plain1')], nextCursor: null,
    }));
    wrap(<SalesOrdersList mode="sales" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pin this order to the top of my list' }));
    const row = screen.getByText(/Customer plain1/).closest('li') as HTMLElement;
    expect(within(row).getByRole('button', { expanded: false })).toBeInTheDocument();
  });
});

describe('work queue rows', () => {
  beforeEach(() => addressBar.reset('/team/procurement'));

  it('show the paid date and a pin', async () => {
    get.mockResolvedValue({
      orders: [{
        id: 'w1', orderNumber: '#W1', createdAt: '2026-10-28T05:00:00.000Z', paidAt: '2026-11-03T10:55:00.000Z',
        enteredAt: '2026-11-03T11:00:00.000Z', status: 'processing', paymentStatus: 'paid', totalAmount: 1000,
        source: 'sales', soldBy: 'Asha', customer: { name: 'C', email: '', phone: '' }, city: '', summary: null,
        summaryStage: null, needs: ['procurement'], eta: null, lines: [], pinned: true,
      }],
      nextCursor: null,
    });
    wrap(<WorkQueueList queue="procurement" />);
    expect(await screen.findByText(/Paid 3 Nov 2026/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unpin this order' })).toBeInTheDocument();
  });
});

describe('PinButton', () => {
  it('says why a sixth pin is refused', async () => {
    post.mockRejectedValue(new Error('You can pin up to 5 orders. Unpin one first.'));
    const alert = jest.spyOn(window, 'alert').mockImplementation(() => {});
    wrap(<PinButton orderId="o6" pinned={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pin this order to the top of my list' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('You can pin up to 5 orders. Unpin one first.'));
    alert.mockRestore();
  });
});
