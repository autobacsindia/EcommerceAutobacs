/**
 * The team panel shell: company accounts (password managed by the admin) get no
 * "Change password" link; staff on their own email do. No one is ever locked
 * out of the panel to change a password.
 */
import { render, screen } from '@testing-library/react';
import TeamLayoutClient from './TeamLayoutClient';

let pathname = '/team';
jest.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ logout: jest.fn() }) }));
jest.mock('@/hooks/queries/useTeamChat', () => ({
  useChatUnreadTotal: () => 0,
  useChatUnreadSplit: () => ({ chat: 0, updates: 0, updatesChannelId: null }),
}));
// The header now carries the notification bell. This file is about the NAV, so
// the bell's own data is stubbed — its behaviour is covered in
// components/notifications/NotificationBell.test.tsx.
jest.mock('@/hooks/queries/useNotifications', () => ({ useWaitingWork: () => ({ data: { items: [], total: 0 } }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));

const shell = (canChangePassword: boolean, extra: { canSell?: boolean; roleLabel?: string } = { canSell: true }) => render(
  <TeamLayoutClient userName="Sam" team="sales" teamLabel="GTM" isHead={false} canChangePassword={canChangePassword} {...extra}>
    <p>panel content</p>
  </TeamLayoutClient>,
);

it('a company account goes straight to the panel, with no change-password link', () => {
  shell(false);
  expect(screen.getByText('panel content')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Change password/ })).toBeNull();
});

it('staff on their own email get the change-password link', () => {
  shell(true);
  expect(screen.getByText('panel content')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Change password/ })).toHaveAttribute('href', '/team/password');
});

it('a GTM lead gets the selling tools; an executive or customer support does not', () => {
  const { unmount } = shell(false, { canSell: true, roleLabel: 'GTM lead' });
  expect(screen.getByRole('link', { name: /New quotation/ })).toBeInTheDocument();
  expect(screen.getByText('GTM lead')).toBeInTheDocument();
  unmount();
  shell(false, { canSell: false, roleLabel: 'GTM executive' });
  expect(screen.queryByRole('link', { name: /New quotation/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /Customer decisions/ })).toBeNull();
  expect(screen.getByRole('link', { name: /Team chat/ })).toBeInTheDocument();
  expect(screen.getByText('GTM executive')).toBeInTheDocument();
});

it('marketing gets its panel screens, highlighted on their detail pages too', () => {
  pathname = '/team/marketing/coupons/edit/abc';
  render(
    <TeamLayoutClient userName="Mia" team="marketing" teamLabel="Marketing" isHead={false}>
      <p>panel content</p>
    </TeamLayoutClient>,
  );
  for (const [name, href] of [
    [/Blog & media/, '/team/marketing/blog'],
    [/Page SEO/, '/team/marketing/seo'],
    [/Coupons/, '/team/marketing/coupons'],
    [/Campaigns/, '/team/marketing/campaigns'],
    [/Spin to win/, '/team/marketing/spin'],
    [/Promo banners/, '/team/marketing/promo-banners'],
    [/Leads/, '/team/marketing/leads'],
    [/Consultations/, '/team/marketing/consultation'],
    [/^Products$/, '/team/marketing/products'],
    [/Brands/, '/team/marketing/brands'],
    [/Categories/, '/team/marketing/categories'],
    [/Vehicles/, '/team/marketing/vehicles'],
    [/^Orders$/, '/team/marketing/orders'],
    [/Payments/, '/team/payments'],
  ] as const) {
    expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
  }
  expect(screen.getByRole('link', { name: /Coupons/ }).className).toContain('bg-blue-600');
  expect(screen.getByRole('link', { name: /Campaigns/ }).className).not.toContain('bg-blue-600');
  // Selling and stock tools stay with their teams.
  expect(screen.queryByRole('link', { name: /New quotation/ })).toBeNull();
  pathname = '/team';
});

it('other teams do not get the marketing screens', () => {
  render(
    <TeamLayoutClient userName="Op" team="operations" teamLabel="Operations" isHead={false}>
      <p>panel content</p>
    </TeamLayoutClient>,
  );
  expect(screen.queryByRole('link', { name: /Coupons/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /Page SEO/ })).toBeNull();
});
