/** The Admin's order summary: shows the server's numbers, in plain words, and survives a failed read. */
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrderOverview, { type Overview } from './OrderOverview';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a) } }));

const MONEY = { orderTotal: 29000, gatewayOffer: 0, extrasPaid: 5000, extrasWaiting: 0, extrasRefundDue: 0, totalWithExtras: 34000, received: 34000, refunded: 0, refundInProgress: 0, toCollect: 0, supplierPaid: 22000, supplierWaiting: 0, supplierNotPriced: 0, expenses: 0, leftAfterSupplier: 12000 };
const OVERVIEW = (over: Partial<Overview> = {}): Overview => ({
  customer: { name: 'Test Buyer', accountDeleted: false }, money: MONEY, payments: [], supplierPayments: [], returns: [],
  linked: { source: 'offline', invoiceNo: null, seller: '', quotation: null, lead: null, couponCode: '', couponDiscount: 0, karmaDiscount: 0, affiliate: '', onHold: false },
  timeline: [{ at: '2026-11-01T10:00:00.000Z', kind: 'order', what: 'Order placed', who: 'Asha', note: '' }], ...over,
});
const show = () => render(<QueryClientProvider client={new QueryClient()}><OrderOverview orderId="o1" /></QueryClientProvider>);
beforeEach(() => get.mockReset());

it('shows the server sums and asks for this order', async () => {
  get.mockResolvedValue({ overview: OVERVIEW() });
  show();
  expect((await screen.findByText('Total with extras')).parentElement).toHaveTextContent('₹34,000');
  expect(screen.getByText('Left after supplier').parentElement).toHaveTextContent('₹12,000');
  expect(get).toHaveBeenCalledWith('/orders/o1/overview');
});

it('names the person on each event', async () => {
  get.mockResolvedValue({ overview: OVERVIEW() });
  show();
  expect(await screen.findByText('Order placed')).toBeInTheDocument();
  expect(screen.getByText(/· Asha/)).toBeInTheDocument();
});

it('shows newest events first, twelve at a time', async () => {
  const timeline = Array.from({ length: 15 }, (_, i) => ({ at: `2026-11-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`, kind: 'order', what: `Event ${i + 1}`, who: '', note: '' }));
  get.mockResolvedValue({ overview: OVERVIEW({ timeline }) });
  show();
  const list = await screen.findAllByRole('listitem');
  expect(list[0]).toHaveTextContent('Event 15');
  expect(screen.queryByText('Event 1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show all 15' }));
  expect(screen.getByText('Event 1')).toBeInTheDocument();
});

it('says so when the customer account is gone', async () => {
  get.mockResolvedValue({ overview: OVERVIEW({ customer: { name: 'A', accountDeleted: true } }) });
  show();
  expect(await screen.findByText(/no longer has an account/)).toBeInTheDocument();
});

it('a failed read says so and does not crash the page', async () => {
  get.mockRejectedValue(new Error('down'));
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load');
});
