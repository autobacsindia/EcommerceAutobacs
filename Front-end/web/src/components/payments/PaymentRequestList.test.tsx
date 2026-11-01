/**
 * The Payments list's search / filter / sort bar: what it asks the server for,
 * that it lives in the page address (so Back, refresh and a shared link keep
 * it), the count-and-total line, and what a team (not accounts) is offered.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentRequestList from './PaymentRequestList';
import type { PaymentRequest } from './api';
import { addressBar } from '@/test-utils/addressBarMock';

jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: jest.fn() } }));

const row = (over: Partial<PaymentRequest> = {}): PaymentRequest => ({
  id: 'r1', number: 'PR-0007', kind: 'expense', status: 'submitted', statusLabel: 'Waiting for accounts',
  team: 'operations', teamLabel: 'Operations', requestedBy: 'Omar', amount: 1250, category: 'fuel', description: 'Diesel',
  payee: { name: 'Fuel Station', method: 'upi', upiId: 'fuel@okaxis' }, order: null, itemNames: [], customer: null, closedBy: '',
  files: [], payment: null, decisionNote: '', createdAt: '2026-10-15T05:00:00Z', history: [],
  can: { approve: false, decline: false, pay: false, hold: false, cancel: false },
  ...over,
});

const ACCOUNTS_TABS = [
  { value: 'to_approve', label: 'To approve' }, { value: 'on_hold', label: 'On hold' },
  { value: 'paid', label: 'Paid' }, { value: 'all', label: 'All' },
];
const TEAMS = [{ value: 'marketing', label: 'Marketing' }, { value: 'operations', label: 'Operations' }];

/** The query string of the last list request. */
const lastList = () => {
  const urls = get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/payment-requests?'));
  return new URLSearchParams(urls[urls.length - 1].split('?')[1]);
};
const listCalls = () => get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/payment-requests?'));

function renderList(props: Partial<React.ComponentProps<typeof PaymentRequestList>> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PaymentRequestList filters={ACCOUNTS_TABS} initial="to_approve" teams={TEAMS} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  addressBar.reset('/team/payments');
  get.mockReset();
  get.mockImplementation((url: string) => {
    if (url === '/payment-requests/filter-options') {
      return Promise.resolve({
        categories: [{ value: 'meta_ads', label: 'Meta ads' }, { value: 'fuel', label: 'Fuel' }],
        people: [{ id: 'u1', name: 'Ravi', team: 'marketing' }, { id: 'u2', name: 'Boss', team: 'admin' }],
      });
    }
    return Promise.resolve({ requests: [row()], nextCursor: null, sort: 'newest', summary: { count: 1, total: 1250, capped: false } });
  });
});

it('opens on its own tab, with nothing else asked for, and shows the count and total', async () => {
  renderList();
  expect(await screen.findByText(/PR-0007/)).toBeInTheDocument();
  expect(Object.fromEntries(lastList())).toEqual({ status: 'to_approve' });
  expect(screen.getByRole('status')).toHaveTextContent('1 payment found · total ₹1,250');
});

it('search waits for a pause, then goes into the address and to the server', async () => {
  jest.useFakeTimers();
  try {
    renderList();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search payments' }), { target: { value: 'utr998' } });
    expect(addressBar.replace).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(400); });
    expect(addressBar.replace).toHaveBeenLastCalledWith('/team/payments?q=utr998', { scroll: false });
  } finally { jest.useRealTimers(); }
  await waitFor(() => expect(lastList().get('q')).toBe('utr998'));
});

it('a shared link opens with its filters, and "Recently paid" is offered on the paid list', async () => {
  addressBar.search = 'status=paid&method=bank&from=2026-10-01&to=2026-10-31&dateOf=paid&min=1000&sort=paid_recent&team=marketing';
  renderList();
  await screen.findByText(/PR-0007/);
  expect(Object.fromEntries(lastList())).toEqual({
    status: 'paid', method: 'bank', from: '2026-10-01', to: '2026-10-31', dateOf: 'paid', min: '1000', sort: 'paid_recent', team: 'marketing',
  });
  expect(screen.getByRole('button', { name: 'Paid' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('paid_recent');
  expect(screen.getByRole('combobox', { name: 'Paid by' })).toHaveValue('bank');
  expect(screen.getByLabelText('Dates: from')).toHaveValue('2026-10-01');
});

it('"Recently paid" from an old link is not sent for a list that is not paid', async () => {
  addressBar.search = 'status=to_approve&sort=paid_recent';
  renderList();
  await screen.findByText(/PR-0007/);
  expect(lastList().get('sort')).toBeNull();
  expect(screen.queryByRole('option', { name: 'Recently paid' })).toBeNull();
});

it('a status the page does not offer falls back to its own start', async () => {
  addressBar.search = 'status=cancelled';
  renderList();
  await screen.findByText(/PR-0007/);
  expect(lastList().get('status')).toBe('to_approve');
});

it('each filter goes to the server; the date range says which date', async () => {
  renderList();
  await screen.findByText(/PR-0007/);
  fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'supplier' } });
  await waitFor(() => expect(lastList().get('kind')).toBe('supplier'));
  // A supplier payment has no expense category.
  expect(screen.queryByRole('combobox', { name: 'Expense for' })).toBeNull();

  fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'expense' } });
  await screen.findByRole('option', { name: 'Meta ads' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Expense for' }), { target: { value: 'meta_ads' } });
  await waitFor(() => expect(lastList().get('category')).toBe('meta_ads'));

  fireEvent.change(screen.getByRole('combobox', { name: 'Team' }), { target: { value: 'marketing' } });
  await waitFor(() => expect(lastList().get('team')).toBe('marketing'));

  await screen.findByRole('option', { name: 'Ravi (Marketing)' });
  expect(screen.getByRole('option', { name: 'Boss (admin)' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Raised by' }), { target: { value: 'u1' } });
  await waitFor(() => expect(lastList().get('by')).toBe('u1'));

  fireEvent.change(screen.getByLabelText('Dates: from'), { target: { value: '2026-10-01' } });
  await waitFor(() => expect(lastList().get('from')).toBe('2026-10-01'));
  expect(lastList().get('dateOf')).toBe('raised');

  const min = screen.getByRole('textbox', { name: 'Amount: from' });
  fireEvent.change(min, { target: { value: '₹1,500abc' } });
  expect(min).toHaveValue('1500');
  fireEvent.blur(min);
  await waitFor(() => expect(lastList().get('min')).toBe('1500'));

  fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'amount_desc' } });
  await waitFor(() => expect(lastList().get('sort')).toBe('amount_desc'));
});

it('Clear all drops the filters but keeps the tab and the sort', async () => {
  addressBar.search = 'status=paid&q=bosch&kind=supplier&min=100&sort=amount_asc';
  renderList();
  await screen.findByText(/PR-0007/);
  fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));
  expect(addressBar.replace).toHaveBeenLastCalledWith('/team/payments?status=paid&sort=amount_asc', { scroll: false });
  await waitFor(() => expect(Object.fromEntries(lastList())).toEqual({ status: 'paid', sort: 'amount_asc' }));
  expect(screen.queryByRole('button', { name: /Clear all/ })).toBeNull();
});

it('a team (not accounts) gets no team or "raised by" filter', async () => {
  renderList({ teams: undefined, initial: 'open', filters: [{ value: 'open', label: 'In progress' }, { value: 'paid', label: 'Paid' }] });
  await screen.findByText(/PR-0007/);
  expect(screen.queryByRole('combobox', { name: 'Team' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Raised by' })).toBeNull();
  // "Paid by" belongs to the paid / all lists.
  expect(screen.queryByRole('combobox', { name: 'Paid by' })).toBeNull();
});

it('over the cap: "1,000+" and no total', async () => {
  get.mockImplementation((url: string) => (url === '/payment-requests/filter-options'
    ? Promise.resolve({ categories: [], people: [] })
    : Promise.resolve({ requests: [row()], nextCursor: null, summary: { count: 1000, total: null, capped: true } })));
  renderList();
  expect(await screen.findByRole('status')).toHaveTextContent('1,000+ payments found — narrow the dates or filters to see the total');
});

it('no match with filters on says so', async () => {
  addressBar.search = 'q=nobody';
  get.mockImplementation((url: string) => (url === '/payment-requests/filter-options'
    ? Promise.resolve({ categories: [], people: [] })
    : Promise.resolve({ requests: [], nextCursor: null, summary: { count: 0, total: 0, capped: false } })));
  renderList();
  expect(await screen.findByText(/No payments match/)).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('0 payments found');
});

it('Show more asks for the next page with the same filters', async () => {
  addressBar.search = 'status=paid&sort=amount_desc';
  get.mockImplementation((url: string) => {
    if (url === '/payment-requests/filter-options') return Promise.resolve({ categories: [], people: [] });
    return url.includes('cursor=')
      ? Promise.resolve({ requests: [row({ id: 'r2', number: 'PR-0002' })], nextCursor: null })
      : Promise.resolve({ requests: [row()], nextCursor: 'abc', summary: { count: 2, total: 2500, capped: false } });
  });
  renderList();
  fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
  expect(await screen.findByText(/PR-0002/)).toBeInTheDocument();
  expect(Object.fromEntries(lastList())).toEqual({ status: 'paid', sort: 'amount_desc', cursor: 'abc' });
  expect(listCalls()).toHaveLength(2);
  // The first page's count stays.
  expect(screen.getByRole('status')).toHaveTextContent('2 payments found · total ₹2,500');
});

it('two changes before the address catches up keep both (regression: the first was lost)', async () => {
  addressBar.search = 'status=paid';
  renderList();
  await screen.findByText(/PR-0007/);
  addressBar.defer = true;
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'amount_desc' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Paid by' }), { target: { value: 'bank' } });
  expect(addressBar.replace).toHaveBeenLastCalledWith('/team/payments?status=paid&sort=amount_desc&method=bank', { scroll: false });
  await waitFor(() => expect(Object.fromEntries(lastList())).toEqual({ status: 'paid', sort: 'amount_desc', method: 'bank' }));
});
