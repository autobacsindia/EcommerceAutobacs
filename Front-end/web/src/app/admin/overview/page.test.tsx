import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CompanyOverviewPage from './page';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a) } }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, ...p }: { children: React.ReactNode; href: string }) => <a href={href} {...p}>{children}</a> }));

const now = '2026-10-15T08:00:00Z';
const overview = {
  generatedAt: now,
  today: { paidOrders: 3, paidValue: 52000, gtmOrders: 1, websiteOrders: 2, newConsultations: 2, openSupportTickets: 4, salesLinksWaiting: 1 },
  money: {
    awaitingApproval: { n: 2, amount: 1750 },
    withAccounts: { n: 1, amount: 38000, onHold: 1 },
    paidThisMonth: { n: 1, amount: 4000, byTeam: [{ team: 'procurement', label: 'Procurement', n: 1, amount: 4000 }] },
    itemRefundsToPay: 1,
  },
  teams: [
    { team: 'sales', label: 'GTM', members: 3, online: 1, waiting: 2, overdue: 0, actionsThisWeek: 9 },
    { team: 'procurement', label: 'Procurement', members: 1, online: 0, waiting: 3, overdue: 1, actionsThisWeek: 4 },
  ],
  people: [{ id: 'u1', name: 'Priya', teamLabel: 'Procurement', role: 'Member', online: true, actionsThisWeek: 4, lastAction: '2026-10-15T07:30:00Z' }],
  overdue: [{ orderId: 'o1', orderNumber: '#AAA111', customer: 'Ravi', stageLabel: 'Needs stock check', waitingFor: 'Procurement team', waitingHours: 30 }],
  feed: [{ at: '2026-10-15T07:30:00Z', who: 'Priya', team: 'Procurement', text: 'Marked an item in stock', area: 'Procurement', link: '/admin/orders/o1' }],
};

it('shows today, money waiting, teams, overdue work, people and the activity feed', async () => {
  get.mockResolvedValue(overview);
  render(<QueryClientProvider client={new QueryClient()}><CompanyOverviewPage /></QueryClientProvider>);
  expect(await screen.findByText('Waiting for your approval')).toBeInTheDocument();
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
