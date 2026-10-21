/**
 * "Sold by" on the order page: hidden unless the server says it is a paid website
 * order; saving sends the new seller AND the one the screen showed (so the server
 * can refuse a stale overwrite); a refusal is shown and the box reloads.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrderSellerCredit, { type CreditedOrder } from './OrderSellerCredit';

const get = jest.fn();
const put = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) },
}));

const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <OrderSellerCredit orderId="o1" />
  </QueryClientProvider>,
);

const sellers = [{ id: 's1', name: 'Sam', isHead: false }, { id: 'h1', name: 'Hari', isHead: true }];
const routeGets = (order: CreditedOrder | null) => get.mockImplementation((url: string) =>
  Promise.resolve(url.endsWith('/sellers') ? { sellers } : { order }));

beforeEach(() => { get.mockReset(); put.mockReset(); });

it('shows nothing for an order that is not a paid website order', async () => {
  routeGets(null);
  const { container } = wrap();
  await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/attribution/orders/o1'));
  expect(container).toBeEmptyDOMElement();
});

it('credits the order, sending what the screen showed, and shows the change', async () => {
  routeGets({ id: 'o1', seller: null, history: [] });
  put.mockResolvedValue({ order: { id: 'o1', seller: { id: 's1', name: 'Sam' }, history: [{ at: '2026-10-21T05:00:00Z', by: 'Mira', from: null, to: 'Sam', note: 'On a call' }] } });
  wrap();
  expect(await screen.findByText('Website (no salesman)', { selector: 'strong' })).toBeInTheDocument();
  await screen.findByRole('option', { name: 'Hari (GTM head)' });
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull(); // nothing changed yet

  fireEvent.change(screen.getByLabelText('Credit to'), { target: { value: 's1' } });
  fireEvent.change(screen.getByLabelText('Note'), { target: { value: ' On a call ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(put).toHaveBeenCalledWith('/staff/attribution/orders/o1', { salesUserId: 's1', expectedSalesUserId: null, note: 'On a call' }));
  expect(await screen.findByText('Sam', { selector: 'strong' })).toBeInTheDocument();
  expect(screen.getByText(/Mira: Website → Sam · On a call/)).toBeInTheDocument();
});

it('can remove a credit, and keeps a seller who has since left in the list', async () => {
  routeGets({ id: 'o1', seller: { id: 'old', name: 'Vik' }, history: [] });
  put.mockResolvedValue({ order: { id: 'o1', seller: null, history: [] } });
  wrap();
  expect(await screen.findByRole('option', { name: 'Vik (no longer selling)' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Credit to'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(put).toHaveBeenCalledWith('/staff/attribution/orders/o1', { salesUserId: null, expectedSalesUserId: 'old' }));
});

it('shows the server refusal and reloads what is there now', async () => {
  routeGets({ id: 'o1', seller: null, history: [] });
  put.mockRejectedValue(new Error('Someone else just changed this order. Refresh and try again.'));
  wrap();
  await screen.findByRole('option', { name: 'Sam' });
  const loads = get.mock.calls.filter(([u]) => u === '/staff/attribution/orders/o1').length;
  fireEvent.change(screen.getByLabelText('Credit to'), { target: { value: 's1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Someone else just changed this order');
  await waitFor(() => expect(get.mock.calls.filter(([u]) => u === '/staff/attribution/orders/o1').length).toBeGreaterThan(loads));
});
