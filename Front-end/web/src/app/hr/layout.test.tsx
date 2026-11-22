/**
 * The /hr layout's role gate, against the session the backend returned. The
 * HR API enforces the same rule; this pins what each person is SHOWN.
 */
import { render, screen } from '@testing-library/react';
import type { MeResponse } from '@/app/team/staffSession';

const fetchMe = jest.fn<Promise<MeResponse | null>, []>();
jest.mock('@/app/team/staffSession', () => ({ fetchMe: () => fetchMe() }));
const redirect = jest.fn((to: string) => { throw new Error(`REDIRECT ${to}`); });
jest.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));
jest.mock('@/components/hr/HrLayoutClient', () => ({
  __esModule: true,
  default: ({ children, isAdmin }: { children: React.ReactNode; isAdmin: boolean }) => (
    <div data-testid="hr-shell" data-admin={String(isAdmin)}>{children}</div>
  ),
}));

import HrLayout from './layout';

const page = <p>panel page</p>;
const renderLayout = async () => render(await HrLayout({ children: page }));

beforeEach(() => { fetchMe.mockReset(); redirect.mockClear(); });

it('sends a signed-out visitor to login and back to /hr', async () => {
  fetchMe.mockResolvedValue(null);
  await expect(HrLayout({ children: page })).rejects.toThrow('REDIRECT /login?redirect=/hr');
});

it('treats a failed session check as signed out', async () => {
  fetchMe.mockResolvedValue({ success: false });
  await expect(HrLayout({ children: page })).rejects.toThrow('REDIRECT /login');
});

it('shows HR-team staff the panel', async () => {
  fetchMe.mockResolvedValue({ success: true, user: { id: 'u1', name: 'HR Person', role: 'staff', staff: { team: 'hr', teamLabel: 'HR', isHead: false } } });
  await renderLayout();
  expect(screen.getByTestId('hr-shell')).toHaveAttribute('data-admin', 'false');
  expect(screen.getByText('panel page')).toBeTruthy();
});

it('shows admin the panel', async () => {
  fetchMe.mockResolvedValue({ success: true, user: { id: 'a1', name: 'Admin', role: 'admin', staff: null } });
  await renderLayout();
  expect(screen.getByTestId('hr-shell')).toHaveAttribute('data-admin', 'true');
});

it('shows another team a friendly page and none of the panel', async () => {
  fetchMe.mockResolvedValue({ success: true, user: { id: 'u2', name: 'Seller', role: 'staff', staff: { team: 'sales', teamLabel: 'GTM', isHead: true } } });
  await renderLayout();
  expect(screen.queryByTestId('hr-shell')).toBeNull();
  expect(screen.queryByText('panel page')).toBeNull();
  expect(screen.getByRole('heading', { name: /for the HR team/i })).toBeTruthy();
  expect(redirect).not.toHaveBeenCalled();
});
