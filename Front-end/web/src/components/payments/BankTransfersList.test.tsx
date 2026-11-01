/**
 * The Bank transfers list's search / filter / sort bar: what it asks the server
 * for, that it lives in the page address (Back, refresh and a shared link keep
 * it), the count-and-total line, and that a GTM lead is offered no "Salesman".
 * Confirming / rejecting is in components/staff/sales/bankTransfer.test.tsx.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BankTransfersList, { type BankTransfer } from './BankTransfersList';
import { addressBar } from '@/test-utils/addressBarMock';

jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);
const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: jest.fn(), put: jest.fn() } }));

const TRANSFER = (over: Partial<BankTransfer> = {}): BankTransfer => ({
  id: 't1', orderId: 'o1', orderNumber: '#AB12CD34', customer: { name: 'Salman Khan', city: 'Kochi' }, salesPerson: 'Asha',
  amount: 52000, reference: 'UTR123456789', paidOn: '2026-10-20T00:00:00.000Z', note: '', status: 'pending',
  statusLabel: 'Waiting for accounts to check the bank', recordedBy: 'Asha', recordedAt: '2026-10-20T10:00:00.000Z',
  reviewedBy: '', reviewedAt: null, reviewNote: '', files: [], can: { confirm: false, reject: false },
  ...over,
});
const SELLERS = { sellers: [{ id: 'u1', name: 'Asha' }, { id: 'u2', name: 'Vikram' }] };

/** Answer the list and the "Salesman" choices. */
function serve({ sellers = SELLERS, page = { transfers: [TRANSFER()], nextCursor: null, sort: 'newest', summary: { count: 1, total: 52000, capped: false } } }: {
  sellers?: typeof SELLERS; page?: object;
} = {}) {
  get.mockImplementation((url: string) => Promise.resolve(url === '/staff/bank-transfers/filter-options' ? sellers : page));
}
const listCalls = () => get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/staff/bank-transfers?'));
const lastList = () => new URLSearchParams(listCalls()[listCalls().length - 1].split('?')[1]);

const renderList = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BankTransfersList /></QueryClientProvider>,
);

beforeEach(() => {
  addressBar.reset('/team/bank-transfers');
  get.mockReset();
  serve();
});

it('opens on "To check" and shows how many and their total', async () => {
  renderList();
  expect(await screen.findByRole('status')).toHaveTextContent('1 bank transfer found · total ₹52,000');
  expect(Object.fromEntries(lastList())).toEqual({ status: 'pending' });
  expect(screen.getByRole('tab', { name: 'To check' })).toHaveAttribute('aria-selected', 'true');
});

it('search waits for a pause, then asks the server and writes the address', async () => {
  renderList();
  await screen.findByRole('status');
  fireEvent.change(screen.getByLabelText('Search bank transfers'), { target: { value: ' UTR998 ' } });
  expect(addressBar.replace).not.toHaveBeenCalled();
  await waitFor(() => expect(addressBar.replace).toHaveBeenLastCalledWith('/team/bank-transfers?q=UTR998', { scroll: false }));
  await waitFor(() => expect(lastList().get('q')).toBe('UTR998'));
});

it('a shared link opens with its tab, sort and filters', async () => {
  addressBar.search = 'status=confirmed&sort=amount_desc&seller=u2&dateOf=recorded&from=2026-10-01&to=2026-10-31&min=1000&q=kochi';
  renderList();
  await waitFor(() => expect(Object.fromEntries(lastList())).toEqual({
    status: 'confirmed', sort: 'amount_desc', seller: 'u2', dateOf: 'recorded', from: '2026-10-01', to: '2026-10-31', min: '1000', q: 'kochi',
  }));
  expect(screen.getByRole('tab', { name: 'Confirmed' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('Sort')).toHaveValue('amount_desc');
  expect(await screen.findByLabelText('Salesman')).toHaveValue('u2');
  expect(screen.getByLabelText('Search bank transfers')).toHaveValue('kochi');
});

it('an old link with a tab or sort that does not exist falls back to the defaults', async () => {
  addressBar.search = 'status=lost&sort=random';
  renderList();
  await waitFor(() => expect(Object.fromEntries(lastList())).toEqual({ status: 'pending' }));
});

it('each filter asks the server; "paid on" is the default date and is not sent', async () => {
  renderList();
  fireEvent.change(await screen.findByLabelText('Salesman'), { target: { value: 'u1' } });
  await waitFor(() => expect(lastList().get('seller')).toBe('u1'));
  fireEvent.change(screen.getByLabelText('Dates: from'), { target: { value: '2026-10-01' } });
  await waitFor(() => expect(lastList().get('from')).toBe('2026-10-01'));
  expect(lastList().get('dateOf')).toBeNull();
  fireEvent.change(screen.getByLabelText('Which date'), { target: { value: 'recorded' } });
  await waitFor(() => expect(lastList().get('dateOf')).toBe('recorded'));
  const min = screen.getByLabelText('Amount: from');
  fireEvent.change(min, { target: { value: '₹5,000' } });
  fireEvent.blur(min);
  await waitFor(() => expect(lastList().get('min')).toBe('5000'));
  fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'paid_recent' } });
  await waitFor(() => expect(lastList().get('sort')).toBe('paid_recent'));
  fireEvent.click(screen.getByRole('tab', { name: 'Withdrawn' }));
  await waitFor(() => expect(lastList().get('status')).toBe('withdrawn'));
  expect(lastList().get('seller')).toBe('u1'); // the filters stay on across tabs
});

it('Clear all drops the filters but keeps the tab and sort', async () => {
  addressBar.search = 'status=rejected&sort=amount_asc&q=kochi&seller=u1&min=100';
  renderList();
  fireEvent.click(await screen.findByRole('button', { name: /Clear all/ }));
  expect(addressBar.replace).toHaveBeenLastCalledWith('/team/bank-transfers?status=rejected&sort=amount_asc', { scroll: false });
  await waitFor(() => expect(Object.fromEntries(lastList())).toEqual({ status: 'rejected', sort: 'amount_asc' }));
});

it('a GTM lead (the server sends no salesmen) gets no "Salesman" filter', async () => {
  serve({ sellers: { sellers: [] } });
  renderList();
  await screen.findByRole('status');
  expect(screen.queryByLabelText('Salesman')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Search bank transfers')).toBeInTheDocument();
});

it('a huge match says "1,000+" and asks for narrower filters instead of a wrong total', async () => {
  serve({ page: { transfers: [TRANSFER()], nextCursor: 'c1', sort: 'newest', summary: { count: 1000, total: null, capped: true } } });
  renderList();
  expect(await screen.findByRole('status')).toHaveTextContent('1,000+ bank transfers found — narrow the dates or filters to see the total');
});

it('no match says so, and offers to clear', async () => {
  addressBar.search = 'q=nobody';
  serve({ page: { transfers: [], nextCursor: null, sort: 'newest', summary: { count: 0, total: 0, capped: false } } });
  renderList();
  expect(await screen.findByText(/No bank transfers match/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Clear all/ })).toBeInTheDocument();
});

it('Show more asks for the next page with the same filters', async () => {
  addressBar.search = 'q=kochi&sort=amount_desc';
  serve({ page: { transfers: [TRANSFER()], nextCursor: 'NEXT', sort: 'amount_desc', summary: { count: 30, total: 1, capped: false } } });
  renderList();
  fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
  await waitFor(() => expect(Object.fromEntries(lastList())).toEqual({ status: 'pending', sort: 'amount_desc', q: 'kochi', cursor: 'NEXT' }));
});
