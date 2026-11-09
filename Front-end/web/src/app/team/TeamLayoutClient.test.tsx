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
  useChatChannels: () => ({ data: [] }),
  countedUnread: () => ({ chat: 0, updates: 0 }),
}));
// The header now carries the notification bell. This file is about the NAV, so
// the bell's own data is stubbed — its behaviour is covered in
// components/notifications/NotificationBell.test.tsx.
jest.mock('@/hooks/queries/useNotifications', () => ({ useWaitingWork: () => ({ data: { items: [], total: 0 } }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));

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
  expect(screen.getByRole('link', { name: /Coupons/ })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: /Campaigns/ })).not.toHaveAttribute('aria-current');
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

it('every team gets a "View website" link that opens the store in a new tab', () => {
  for (const team of ['sales', 'procurement', 'accounts', 'operations', 'marketing']) {
    const { unmount } = render(
      <TeamLayoutClient userName="Kim" team={team} teamLabel={team} isHead={false}>
        <p>panel content</p>
      </TeamLayoutClient>,
    );
    const site = screen.getByRole('link', { name: /View website/ });
    expect(site).toHaveAttribute('href', '/');
    expect(site).toHaveAttribute('target', '_blank');
    expect(site).toHaveAttribute('rel', expect.stringContaining('noopener'));
    unmount();
  }
});

it('every team gets the Help page in its menu', () => {
  for (const team of ['sales', 'procurement', 'accounts', 'operations', 'marketing']) {
    const { unmount } = render(
      <TeamLayoutClient userName="Kim" team={team} teamLabel={team} isHead={false}>
        <p>panel content</p>
      </TeamLayoutClient>,
    );
    expect(screen.getByRole('link', { name: /^Help$/ })).toHaveAttribute('href', '/team/help');
    unmount();
  }
});

it('every team page gets the hover menu (icon strip), not just Tasks', () => {
  localStorage.clear();
  for (const path of ['/team', '/team/chat', '/team/tasks/abc']) {
    pathname = path;
    const { unmount } = shell(false);
    expect(document.getElementById('panel-menu')).toHaveAttribute('data-rail', 'rail');
    expect(screen.getByRole('main').className).toContain(path.startsWith('/team/tasks') ? 'md:p-5' : 'lg:p-8');
    unmount();
  }
  pathname = '/team';
});

/* ── Refunds: one Accounts menu item, two tabs (owner-approved 2026-11-05) ─── */

const menuLabels = (team: string, isHead = false, canSell = false) => {
  const { unmount } = render(
    <TeamLayoutClient userName="Kim" team={team} teamLabel={team} isHead={isHead} canSell={canSell}>
      <p>panel content</p>
    </TeamLayoutClient>,
  );
  const links = Array.from(document.querySelectorAll('#panel-menu a'))
    .map((a) => ({ href: a.getAttribute('href'), label: a.textContent?.trim() }))
    // The panel title and Dashboard both point at /team; profile carries the name.
    .filter((l) => !['/team', '/team/profile', '/team/password'].includes(l.href || ''));
  unmount();
  return links;
};

it('accounts gets one "Refunds" item plus "Returns", and no "Return refunds" or "Refund approvals"', () => {
  pathname = '/team';
  const links = menuLabels('accounts');
  expect(links).toContainEqual({ href: '/team/refunds', label: 'Refunds' });
  expect(links).toContainEqual({ href: '/team/returns', label: 'Returns' });
  expect(links.map((l) => l.href)).not.toContain('/team/return-refunds');
  expect(links.map((l) => l.label)).not.toEqual(expect.arrayContaining(['Return refunds']));
  expect(links.map((l) => l.label)).not.toEqual(expect.arrayContaining(['Refund approvals']));
  expect(links.filter((l) => l.href === '/team/refunds')).toHaveLength(1);
});

it('the other teams\' menus are exactly as before the Refunds change', () => {
  pathname = '/team';
  const labels = (team: string, isHead = false, canSell = false) => menuLabels(team, isHead, canSell).map((l) => l.label);
  expect(labels('sales', false, true)).toEqual(['Team chat', 'Tasks', 'Lessons', 'Training', 'Leads', 'New quotation', 'Payment first', 'Quotations', 'My orders', 'Customer decisions', 'Returns', 'Bank transfers', 'Past sales', 'Payments', 'My team', 'Help']);
  expect(labels('sales', true, true)).toEqual(['Team chat', 'Tasks', 'Lessons', 'Training', 'Leads', 'New quotation', 'Payment first', 'Quotations', 'Team orders', 'Customer decisions', 'Order processing', 'Delivered', 'Returns', 'Bank transfers', 'Past sales', 'Payments', 'My team', 'Help']);
  expect(labels('sales', false, false)).toEqual(['Team chat', 'Tasks', 'Lessons', 'Training', 'Leads', 'Payments', 'My team', 'Help']);
  expect(labels('procurement')).toEqual(['Team chat', 'Tasks', 'Lessons', 'Training', 'Orders', 'Delivered', 'Returns', 'Payments', 'Suppliers', 'My team', 'Help']);
  expect(labels('operations')).toEqual(['Team chat', 'Tasks', 'Lessons', 'Training', 'Deliveries', 'Order processing', 'Delivered', 'Returns', 'Payments', 'My team', 'Help']);
  expect(labels('marketing')).toEqual(['Team chat', 'Tasks', 'Lessons', 'Training', 'Products', 'Brands', 'Categories', 'Vehicles', 'Orders', 'Blog & media', 'Page SEO', 'Coupons', 'Campaigns', 'Spin to win', 'Promo banners', 'Festival theme', 'Leads', 'Consultations', 'Payments', 'My team', 'Help']);
});
