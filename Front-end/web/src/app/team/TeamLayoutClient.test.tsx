/**
 * The team panel shell: company accounts (password managed by the admin) get no
 * "Change password" link; staff on their own email do. No one is ever locked
 * out of the panel to change a password.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import TeamLayoutClient, { TEAM_MORE_HREFS } from './TeamLayoutClient';

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

it('every team gets the Help page in its menu, under "More"', () => {
  for (const team of ['sales', 'procurement', 'accounts', 'operations', 'marketing']) {
    const { unmount } = render(
      <TeamLayoutClient userName="Kim" team={team} teamLabel={team} isHead={false}>
        <p>panel content</p>
      </TeamLayoutClient>,
    );
    expect(screen.queryByRole('link', { name: /^Help$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
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

const linksIn = (root: ParentNode) => Array.from(root.querySelectorAll('a'))
  .map((a) => ({ href: a.getAttribute('href'), label: a.textContent?.trim() }))
  // The panel title and Dashboard both point at /team; profile carries the name.
  .filter((l) => !['/team', '/team/profile', '/team/password'].includes(l.href || ''));

/** The menu as it first shows (`visible`) and what opening "More" reveals (`more`). */
const menuParts = (team: string, isHead = false, canSell = false) => {
  const { unmount } = render(
    <TeamLayoutClient userName="Kim" team={team} teamLabel={team} isHead={isHead} canSell={canSell}>
      <p>panel content</p>
    </TeamLayoutClient>,
  );
  const visible = linksIn(document.getElementById('panel-menu')!);
  const button = screen.getByRole('button', { name: 'More' });
  fireEvent.click(button);
  const more = linksIn(document.getElementById(button.getAttribute('aria-controls')!)!);
  unmount();
  return { visible, more };
};
const menuLabels = (team: string, isHead = false, canSell = false) => {
  const { visible, more } = menuParts(team, isHead, canSell);
  return [...visible, ...more];
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

it('the other teams\' menus are exactly as before the Refunds change, with the less-used pages under "More"', () => {
  pathname = '/team';
  const MORE = ['Lessons', 'Training', 'Handover', 'Past members', 'My team', 'Help'];
  const parts = (team: string, isHead = false, canSell = false) => {
    const { visible, more } = menuParts(team, isHead, canSell);
    // Same "More" for every team, in the same order.
    expect(more.map((l) => l.label)).toEqual(MORE);
    return visible.map((l) => l.label);
  };
  expect(parts('sales', false, true)).toEqual(['Team chat', 'Tasks', 'Website leads', 'Meta leads', 'New quotation', 'Payment first', 'Quotations', 'My orders', 'Customer decisions', 'Returns', 'Bank transfers', 'Extra charges', 'Past sales', 'Payments']);
  expect(parts('sales', true, true)).toEqual(['Team chat', 'Tasks', 'Website leads', 'Meta leads', 'New quotation', 'Payment first', 'Quotations', 'Team orders', 'Customer decisions', 'Order processing', 'Delivered', 'Returns', 'Bank transfers', 'Extra charges', 'Past sales', 'Payments']);
  expect(parts('sales', false, false)).toEqual(['Team chat', 'Tasks', 'Website leads', 'Meta leads', 'Payments']);
  expect(parts('procurement')).toEqual(['Team chat', 'Tasks', 'Orders', 'Delivered', 'Returns', 'Payments', 'Suppliers']);
  expect(parts('operations')).toEqual(['Team chat', 'Tasks', 'Deliveries', 'Order processing', 'Delivered', 'Returns', 'Payments']);
  expect(parts('developer')).toEqual(['Team chat', 'Tasks', 'Payments']);
  expect(parts('marketing')).toEqual(['Team chat', 'Tasks', 'Products', 'Brands', 'Categories', 'Vehicles', 'Orders', 'Blog & media', 'Page SEO', 'Coupons', 'Campaigns', 'Spin to win', 'Promo banners', 'Festival theme', 'Leads', 'Consultations', 'Payments']);
});

/* ── "More": the less-used pages, folded (owner-approved 2026-11-11) ─────── */

it('moving pages under "More" loses none: every team keeps every link it had', () => {
  pathname = '/team';
  for (const team of ['sales', 'procurement', 'accounts', 'operations', 'marketing', 'developer']) {
    const { visible, more } = menuParts(team, true, true);
    const hrefs = [...visible, ...more].map((l) => l.href);
    for (const href of TEAM_MORE_HREFS) expect(hrefs).toContain(href);
    // Nothing shows twice.
    expect(new Set(hrefs).size).toBe(hrefs.length);
  }
});

it('on a page that lives under "More", it opens by itself and marks that page', () => {
  pathname = '/team/training';
  render(
    <TeamLayoutClient userName="Dev" team="developer" teamLabel="Developer" isHead={false}>
      <p>panel content</p>
    </TeamLayoutClient>,
  );
  expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('link', { name: /^Training$/ })).toHaveAttribute('aria-current', 'page');
  // The top bar still names the page.
  expect(screen.getByRole('heading', { name: 'Training' })).toBeInTheDocument();
  pathname = '/team';
});
