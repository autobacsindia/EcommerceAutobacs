/**
 * Admin shell: the menu groups open on the page you are on, the header counters
 * still drill into Orders, and chat / bell stay one click away.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import AdminLayoutClient from './AdminLayoutClient';

let pathname = '/admin/orders/abc123';
jest.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));
jest.mock('@/hooks/queries/useAdminStats', () => ({
  useAdminStats: () => ({
    isError: false,
    stats: {
      pendingOrders: 37, totalRevenue: 428950,
      revenuePeriod: { label: 'FY 2026-27', startDate: '2026-04-01' },
      filters: { pendingOrders: ['processing', 'shipped'], totalRevenue: ['processing', 'shipped', 'delivered'] },
    },
  }),
}));
jest.mock('@/hooks/queries/useTeamChat', () => ({ useChatUnreadTotal: () => 2 }));
jest.mock('@/components/notifications/NotificationBell', () => ({ __esModule: true, default: () => <button type="button">Notifications</button> }));
jest.mock('@/components/notifications/PushPrompt', () => ({ __esModule: true, default: () => null }));

const shell = () => render(<AdminLayoutClient userName="Autobacs India"><p>page</p></AdminLayoutClient>);

it('lights the parent menu item on a detail page and titles the page with it', () => {
  shell();
  expect(screen.getByRole('link', { name: /^Orders$/ })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument();
  // The group holding the current page is open; the others are folded.
  expect(screen.getByRole('button', { name: 'Orders' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'Catalog' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('link', { name: /^Brands$/ })).toBeNull();
});

it('Dashboard, chat and tasks are always in the menu; a folded group opens on click', () => {
  shell();
  expect(screen.getByRole('link', { name: /^Dashboard$/ })).toHaveAttribute('href', '/admin');
  expect(screen.getByRole('link', { name: /^Tasks$/ })).toHaveAttribute('href', '/admin/tasks');
  fireEvent.click(screen.getByRole('button', { name: 'Catalog' }));
  expect(screen.getByRole('link', { name: /^Brands$/ })).toHaveAttribute('href', '/admin/brands');
});

it('the header counters still open the orders behind them', () => {
  shell();
  expect(screen.getByRole('link', { name: /Pending orders/ })).toHaveAttribute('href', '/admin/orders?status=processing%2Cshipped');
  expect(screen.getByRole('link', { name: /Revenue \(FY 2026-27\)/ })).toHaveAttribute(
    'href', '/admin/orders?status=processing%2Cshipped%2Cdelivered&startDate=2026-04-01',
  );
  const site = screen.getByRole('link', { name: /View website/ });
  expect(site).toHaveAttribute('href', '/');
  // A new tab: the admin keeps their place in the panel.
  expect(site).toHaveAttribute('target', '_blank');
  expect(site).toHaveAttribute('rel', expect.stringContaining('noopener'));
  expect(screen.getByRole('link', { name: /^Chat/ })).toHaveAttribute('href', '/admin/chat');
  expect(screen.getAllByLabelText('2 unread').length).toBeGreaterThan(0);
});
