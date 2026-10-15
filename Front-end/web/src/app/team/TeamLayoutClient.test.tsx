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

const shell = (canChangePassword: boolean) => render(
  <TeamLayoutClient userName="Sam" team="sales" teamLabel="Sales" isHead={false} canChangePassword={canChangePassword}>
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
