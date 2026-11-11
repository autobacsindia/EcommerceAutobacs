import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CompanyOverviewPage from './page';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a) } }));
const replace = jest.fn();
let search = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/overview',
  useSearchParams: () => search,
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, ...p }: { children: React.ReactNode; href: string }) => <a href={href} {...p}>{children}</a> }));

const now = '2026-10-15T08:00:00Z';
const overview = {
  generatedAt: now,
  day: { date: '2026-10-15', isToday: true, monthFrom: '2026-10-01', weekFrom: '2026-10-08T08:00:00Z' },
  today: { paidOrders: 3, paidValue: 52000, gtmOrders: 1, websiteOrders: 2, newConsultations: 2, consultationsReceived: 1, openSupportTickets: 4, salesLinksWaiting: 1 },
  money: {
    awaitingApproval: { n: 2, amount: 1750 },
    toPay: { n: 1, amount: 38000, onHold: 1 },
    paidThisMonth: { n: 1, amount: 4000, byTeam: [{ team: 'procurement', label: 'Procurement', n: 1, amount: 4000 }] },
    itemRefundsToPay: 1,
  },
  teams: [
    { team: 'sales', label: 'GTM', members: 3, online: 1, waiting: 2, overdue: 0, actionsThisWeek: 9, actionsOnDay: 2 },
    { team: 'procurement', label: 'Procurement', members: 1, online: 0, waiting: 3, overdue: 1, actionsThisWeek: 4, actionsOnDay: 1 },
  ],
  people: [{ id: 'u1', name: 'Priya', teamLabel: 'Procurement', role: 'Member', online: true, actionsThisWeek: 4, actionsOnDay: 1, lastAction: '2026-10-15T07:30:00Z' }],
  overdue: [{ orderId: 'o1', orderNumber: '#AAA111', customer: 'Ravi', stageLabel: 'Needs stock check', waitingFor: 'Procurement team', waitingHours: 30 }],
  feed: [{ at: '2026-10-15T07:30:00Z', who: 'Priya', team: 'Procurement', text: 'Marked an item in stock', area: 'Procurement', link: '/admin/orders/o1' }],
};

// The page's "today" comes from the device clock: pin it to the fixture's day.
beforeEach(() => {
  jest.useFakeTimers({ now: new Date(now), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'nextTick', 'queueMicrotask'] });
  search = new URLSearchParams();
  get.mockReset();
  replace.mockReset();
});
afterEach(() => jest.useRealTimers());

const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CompanyOverviewPage /></QueryClientProvider>);

it('shows today, money waiting, teams, overdue work, people and the activity feed', async () => {
  get.mockResolvedValue(overview);
  renderPage();
  expect(await screen.findByText('Waiting for accounts to approve')).toBeInTheDocument();
  // The admin's own queue is the approved money, not the undecided money.
  expect(screen.getByText('Approved — for you to pay')).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/admin/overview');
  expect(screen.getByText('₹52,000 · 1 GTM, 2 website')).toBeInTheDocument();
  expect(screen.getByText('₹38,000 · 1 on hold')).toBeInTheDocument();
  expect(screen.getByText('Item refunds to pay').closest('a')).toHaveAttribute('href', '/admin/refunds');

  const teams = screen.getByRole('region', { name: 'Teams' });
  expect(within(teams).getByText('GTM')).toBeInTheDocument();
  expect(within(teams).getByText(/1 overdue/)).toBeInTheDocument();

  const overdue = screen.getByRole('region', { name: /Overdue now/ });
  expect(within(overdue).getByRole('link', { name: '#AAA111' })).toHaveAttribute('href', '/admin/orders/o1');
  expect(within(overdue).getByText('Procurement team')).toBeInTheDocument();

  const feed = screen.getByRole('region', { name: 'What everyone has been doing' });
  expect(within(feed).getByRole('link', { name: 'Marked an item in stock' })).toHaveAttribute('href', '/admin/orders/o1');
  expect(within(screen.getByRole('region', { name: 'People' })).getByText('30 min ago', { exact: false })).toBeInTheDocument();
});

it('opens on today: Next and Today are off, the date can\'t go past today', async () => {
  get.mockResolvedValue(overview);
  renderPage();
  await screen.findByText('Waiting for accounts to approve');
  expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
  const input = screen.getByLabelText('Day');
  expect(input).toHaveValue('2026-10-15');
  expect(input).toHaveAttribute('max', '2026-10-15');
  expect(screen.queryByText(/Now — not for this date/)).not.toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Teams' })).getByText('2 today · 9 actions this week')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
  expect(replace).toHaveBeenCalledWith('/admin/overview?date=2026-10-14', { scroll: false });
  // A future date typed in is ignored on the page (the server refuses it as well).
  fireEvent.change(input, { target: { value: '2026-10-16' } });
  expect(replace).toHaveBeenCalledTimes(1);
});

it('shows a past day from the address, with live-only cards tagged "Now"', async () => {
  search = new URLSearchParams('date=2026-10-05');
  get.mockResolvedValue({
    ...overview,
    day: { date: '2026-10-05', isToday: false, monthFrom: '2026-10-01', weekFrom: '2026-09-28T18:30:00Z' },
    teams: overview.teams.map((t) => ({ ...t, online: null })),
    people: overview.people.map((p) => ({ ...p, online: null })),
    overdue: [],
  });
  renderPage();
  expect(await screen.findByText('Consultations received')).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/admin/overview?date=2026-10-05');
  expect(screen.queryByText('New consultations')).not.toBeInTheDocument();
  expect(screen.getByText('Paid 1–5 Oct')).toBeInTheDocument();
  // Queues and waiting work have no history: each is tagged (5 tiles + 2 team cards + the note).
  expect(screen.getAllByText('Now — not for this date')).toHaveLength(8);
  const teams = screen.getByRole('region', { name: 'Teams' });
  expect(within(teams).queryByText(/online/)).not.toBeInTheDocument();
  expect(within(teams).getByText('2 actions that day · 9 in the 7 days to 5 Oct')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: /Overdue now/ })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'What everyone did on 5 Oct' })).toBeInTheDocument();
  expect(screen.queryByLabelText('online')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Today' }));
  expect(replace).toHaveBeenCalledWith('/admin/overview', { scroll: false });
  fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
  expect(replace).toHaveBeenCalledWith('/admin/overview?date=2026-10-06', { scroll: false });
});

it('says so when the server refuses the date, and offers today', async () => {
  search = new URLSearchParams('date=2026-12-01');
  get.mockRejectedValue(Object.assign(new Error('That date is in the future.'), { status: 400 }));
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn\'t load the overview for 2026-12-01: That date is in the future. Go to today');
  fireEvent.click(screen.getByRole('button', { name: 'Go to today' }));
  expect(replace).toHaveBeenCalledWith('/admin/overview', { scroll: false });
});
