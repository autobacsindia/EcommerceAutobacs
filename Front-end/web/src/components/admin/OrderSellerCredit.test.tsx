/**
 * "Sold by" on the order page: hidden unless the server says it is a paid website
 * order; a change needs proof in the popup, and sends the new seller AND the one the screen showed (so the server
 * can refuse a stale overwrite); a refusal is shown and the box reloads.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrderSellerCredit, { type CreditedOrder } from './OrderSellerCredit';

const get = jest.fn();
const postForm = jest.fn();
jest.mock('@/lib/postForm', () => ({ postForm: (...a: unknown[]) => postForm(...a) }));
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a) },
}));

const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <OrderSellerCredit orderId="o1" />
  </QueryClientProvider>,
);

const sellers = [{ id: 's1', name: 'Sam', isHead: false }, { id: 'h1', name: 'Hari', isHead: true }];
const routeGets = (order: CreditedOrder | null) => get.mockImplementation((url: string) =>
  Promise.resolve(url.endsWith('/sellers') ? { sellers } : { order }));

beforeEach(() => { get.mockReset(); postForm.mockReset(); });

it('shows nothing for an order that is not a paid website order', async () => {
  routeGets(null);
  const { container } = wrap();
  await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/attribution/orders/o1'));
  expect(container).toBeEmptyDOMElement();
});

const LONG_NOTE = 'Closed by Sam on a call on 5 Nov';
const submit = () => fireEvent.click(screen.getByRole('button', { name: /Submit change/ }));
const sent = () => Object.fromEntries((postForm.mock.calls[0][1] as FormData).entries());

it('choosing a salesman asks for proof, sends what the screen showed, and shows the change with its files', async () => {
  routeGets({ id: 'o1', seller: null, history: [] });
  postForm.mockImplementation(async () => {
    routeGets({ id: 'o1', seller: { id: 's1', name: 'Sam' }, history: [{ at: '2026-10-21T05:00:00Z', by: 'Mira', from: null, to: 'Sam', note: LONG_NOTE, proofRequired: true, files: [{ id: 'f1', name: 'chat.png' }] }] });
    return {};
  });
  wrap();
  expect(await screen.findByText('Website (no salesman)', { selector: 'strong' })).toBeInTheDocument();
  await screen.findByRole('option', { name: 'Hari (GTM head)' });

  fireEvent.change(screen.getByLabelText('Credit to'), { target: { value: 's1' } });
  fireEvent.change(screen.getByLabelText('Note'), { target: { value: LONG_NOTE } });
  submit();

  await waitFor(() => expect(postForm).toHaveBeenCalled());
  expect(sent()).toMatchObject({ salesUserId: 's1', expectedSalesUserId: '', note: LONG_NOTE });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(await screen.findByText('Sam', { selector: 'strong' })).toBeInTheDocument();
  expect(screen.getByText(/Mira: Website → Sam/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'chat.png' })).toHaveAttribute('href', '/api/v1/staff/attribution/orders/o1/proof/f1');
});

it('cancel leaves the old salesman in place', async () => {
  routeGets({ id: 'o1', seller: { id: 'old', name: 'Vik' }, history: [] });
  wrap();
  expect(await screen.findByRole('option', { name: 'Vik (no longer selling)' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Credit to'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByLabelText('Credit to')).toHaveValue('old');
  expect(postForm).not.toHaveBeenCalled();
});

it('older changes say they were made before proof was required', async () => {
  routeGets({ id: 'o1', seller: null, history: [{ at: '2026-10-21T05:00:00Z', by: 'Mira', from: null, to: 'Sam', note: '', proofRequired: false, files: [] }] });
  wrap();
  expect(await screen.findByText(/before proof was required/)).toBeInTheDocument();
});

it('shows the conflict and reloads what is there now', async () => {
  routeGets({ id: 'o1', seller: null, history: [] });
  postForm.mockRejectedValue(Object.assign(new Error('x'), { status: 409, rawData: { message: 'Someone else just changed this order. Refresh and try again.' } }));
  wrap();
  await screen.findByRole('option', { name: 'Sam' });
  const loads = get.mock.calls.filter(([u]) => u === '/staff/attribution/orders/o1').length;
  fireEvent.change(screen.getByLabelText('Credit to'), { target: { value: 's1' } });
  fireEvent.change(screen.getByLabelText('Note'), { target: { value: LONG_NOTE } });
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Someone else just changed this order');
  await waitFor(() => expect(get.mock.calls.filter(([u]) => u === '/staff/attribution/orders/o1').length).toBeGreaterThan(loads));
});
