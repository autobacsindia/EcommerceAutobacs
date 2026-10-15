import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TeamActivityPage from './page';
import { duration } from '@/lib/teamActivity';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a) } }));

const waiting = {
  truncated: false,
  teams: [{ team: 'procurement', waiting: 1, overdue: 1 }, { team: 'sales', waiting: 1, overdue: 0 }],
  rows: [
    { orderId: 'o1', orderNumber: '#AAA111', customer: 'Ravi', totalAmount: 7000, source: 'website', seller: null,
      stage: 'stock_check', stageLabel: 'Needs stock check', team: 'procurement', waitingFor: 'Procurement team',
      since: '2026-10-13T00:00:00Z', waitingHours: 30, limitHours: 24, overdue: true },
    { orderId: 'o2', orderNumber: '#BBB222', customer: 'Meera', totalAmount: 5000, source: 'sales', seller: 'Sam',
      stage: 'customer_decision', stageLabel: 'Out of stock — ask customer', team: 'sales', waitingFor: 'Sam',
      since: '2026-10-14T00:00:00Z', waitingHours: 5, limitHours: 48, overdue: false },
  ],
};
const timeline = {
  orderId: 'o1', orderNumber: '#AAA111', customer: 'Ravi', seller: null, status: 'processing', totalAmount: 7000,
  waitingNow: [],
  steps: [
    { at: '2026-10-13T00:00:00Z', action: 'entered', label: 'Paid — entered the workflow', by: null, byTeam: null, item: null, note: null, waited: null },
    { at: '2026-10-14T06:00:00Z', action: 'stock_out_of_stock', label: 'Marked out of stock', by: 'Priya', byTeam: 'procurement', item: 'Seat cover', note: null,
      waited: { ms: 30 * 3600000, stage: 'stock_check', stageLabel: 'Needs stock check', team: 'procurement', late: true, limitHours: 24 } },
  ],
};

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TeamActivityPage />
  </QueryClientProvider>,
);

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((url: string) => Promise.resolve(url.includes('/orders/') ? timeline : waiting));
});

it('shows what is waiting, overdue first, and who it is on', async () => {
  renderPage();
  const first = (await screen.findByText('#AAA111')).closest('tr')!;
  expect(within(first).getByText('Procurement team')).toBeInTheDocument();
  expect(within(first).getByText('30 h')).toBeInTheDocument();
  expect(first.className).toMatch(/red/);
  expect(within(screen.getByText('#BBB222').closest('tr')!).getByText('Sam')).toBeInTheDocument();
  expect(screen.getByText(/1 overdue/)).toBeInTheDocument();
});

it('opens an order timeline with who acted and the late wait', async () => {
  renderPage();
  const row = (await screen.findByText('#AAA111')).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Timeline' }));
  const panel = await screen.findByRole('complementary', { name: 'Order timeline' });
  expect(await within(panel).findByText(/by Priya \(Procurement\)/)).toBeInTheDocument();
  expect(within(panel).getByText(/Waited 30 h at “Needs stock check” on Procurement — late \(limit 24 h\)/)).toBeInTheDocument();
});

it('formats waits for people', () => {
  expect(duration(35 * 60000)).toBe('35 min');
  expect(duration(7 * 3600000)).toBe('7 h');
  expect(duration(76 * 3600000)).toBe('3 d 4 h');
});
