/**
 * Regression: the sidebar's "waiting" badge and the Leave requests page both read
 * the leave inbox. They once shared a cache key, so the page's infinite query
 * found the badge's plain page in the cache (or the other way round) and the
 * /hr/leave screen crashed. Both now render together.
 */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HrLayoutClient, { HR_NAV } from './HrLayoutClient';
import LeaveInbox from './LeaveInbox';

const leaveInbox = jest.fn();
jest.mock('@/lib/hr/api', () => ({ hrApi: { leaveInbox: (...a: unknown[]) => leaveInbox(...a), decideLeave: jest.fn() } }));
let mockPath = '/hr/leave';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ logout: jest.fn(), user: { name: 'HR Person' } }) }));
jest.mock('@/components/panel/ViewWebsiteLink', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/panel/PanelShell', () => ({
  __esModule: true,
  default: ({ sections, children }: { sections: { items: { href: string; label: string; count?: number; active: boolean }[] }[]; children: React.ReactNode }) => (
    <div>
      <nav>{sections[0].items.map((i) => <a key={i.href} href={i.href} aria-current={i.active ? 'page' : undefined}>{i.label}{i.count ? ` (${i.count})` : ''}</a>)}</nav>
      {children}
    </div>
  ),
}));

const req = {
  id: 'L1', employee: 'E1', employeeName: 'Test Person', leaveType: 'T', leaveTypeName: 'Casual', from: '2026-12-04', to: '2026-12-04',
  firstHalfOnly: false, secondHalfOnly: false, halfDays: 2, paid: true, reason: 'x', status: 'pending_hr', decisions: [], rev: 1, createdAt: '',
};

it('renders the leave page inside the panel with the waiting badge, without crashing', async () => {
  leaveInbox.mockResolvedValue({ items: [req], nextCursor: null });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <HrLayoutClient userName="HR" isAdmin={false}><LeaveInbox /></HrLayoutClient>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Test Person')).toBeTruthy();
  expect(await screen.findByRole('link', { name: 'Leave requests (1)' })).toHaveAttribute('aria-current', 'page');
});

it('lists the HR screens', () => {
  expect(HR_NAV.map((n) => n.href)).toEqual([
    '/hr', '/hr/employees', '/hr/leave', '/hr/overtime', '/hr/late-early', '/hr/payroll', '/hr/rules', '/hr/settings', '/hr/careers',
  ]);
});

it('marks Careers active on the applications sub-page', async () => {
  leaveInbox.mockResolvedValue({ items: [], nextCursor: null });
  mockPath = '/hr/careers/applications';
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <HrLayoutClient userName="HR" isAdmin={false}><p>child</p></HrLayoutClient>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('link', { name: 'Careers' })).toHaveAttribute('aria-current', 'page');
});
