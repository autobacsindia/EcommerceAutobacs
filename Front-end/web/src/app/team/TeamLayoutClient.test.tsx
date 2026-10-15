/**
 * A company account with a password someone else chose sees nothing but the
 * change-password page — no team navigation, no data — until it is changed.
 */
import { render, screen } from '@testing-library/react';
import TeamLayoutClient from './TeamLayoutClient';

const replace = jest.fn();
let pathname = '/team';
jest.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ replace, push: jest.fn() }) }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ logout: jest.fn() }) }));
jest.mock('@/hooks/queries/useTeamChat', () => ({ useChatUnreadTotal: () => 0 }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const shell = (mustChangePassword: boolean) => render(
  <TeamLayoutClient userName="Sam" team="sales" teamLabel="Sales" isHead={false} mustChangePassword={mustChangePassword}>
    <p>panel content</p>
  </TeamLayoutClient>,
);

beforeEach(() => replace.mockReset());

it('sends a must-change account to the password page and shows no panel', () => {
  pathname = '/team/orders';
  shell(true);
  expect(replace).toHaveBeenCalledWith('/team/password');
  expect(screen.queryByText('panel content')).toBeNull();
  expect(screen.queryByRole('link', { name: /Chat/ })).toBeNull();
});

it('on the password page, shows only that page', () => {
  pathname = '/team/password';
  shell(true);
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByText('panel content')).toBeInTheDocument();
});

it('an ordinary session gets the normal panel and a change-password link', () => {
  pathname = '/team';
  shell(false);
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByText('panel content')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Change password/ })).toHaveAttribute('href', '/team/password');
});
