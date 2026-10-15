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
jest.mock('@/hooks/queries/useTeamChat', () => ({ useChatUnreadTotal: () => 0 }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

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
  expect(screen.getByRole('link', { name: /New order/ })).toBeInTheDocument();
  expect(screen.getByText('GTM lead')).toBeInTheDocument();
  unmount();
  shell(false, { canSell: false, roleLabel: 'GTM executive' });
  expect(screen.queryByRole('link', { name: /New order/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /Customer decisions/ })).toBeNull();
  expect(screen.getByRole('link', { name: /Team chat/ })).toBeInTheDocument();
  expect(screen.getByText('GTM executive')).toBeInTheDocument();
});
