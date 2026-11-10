/**
 * The Past members screens.
 *   - the list links to each profile; admins get a team picker, staff do not
 *   - an empty team says so; a failed load offers Try again
 *   - a GTM profile shows sales and its orders; other teams have no sales section
 *   - the order list is not even fetched for non-GTM profiles
 *   - no recorded resignation, no tasks, no training: each section says so
 *   - a hidden or unknown profile shows a plain "not found"
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PastMembersHome from './PastMembersHome';
import PastMemberProfileView from './PastMemberProfile';
import { timeOnTeam, type PastMemberProfile } from './types';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a) } }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));
jest.mock('@/components/ui/RichText', () => ({ __esModule: true, default: ({ value }: { value: string }) => <div>{value}</div> }));

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const person = (over: Partial<PastMemberProfile> = {}): PastMemberProfile => ({
  id: 'U1', name: 'Nevin', team: 'sales', teamLabel: 'GTM', roleLabel: 'GTM lead', joinedOn: '2026-01-01', lastDay: '2026-10-31', daysOnTeam: 303,
  takenOverBy: 'Meena', tasksDone: 1, training: [], lessons: [], handover: null,
  sales: { orders: { paid: 2, paidValue: 1500.5, notPaid: 1, returned: 1, cancelled: 0 }, quotations: { sent: 3, accepted: 2 }, leads: { total: 4, won: 2, lost: 1 } },
  ...over,
});
const serve = (p: PastMemberProfile | Error) => get.mockImplementation((u: string) => {
  if (u.includes('/orders')) return Promise.resolve({ orders: [{ id: 'O1', number: '#ABC12345', createdAt: '2026-10-01T06:00:00Z', totalAmount: 1000, status: 'delivered', paymentStatus: 'paid' }], nextCursor: null });
  if (u.includes('/tasks')) return Promise.resolve({ tasks: [{ id: 'T1', number: 7, title: 'Call Ravi', completedAt: '2026-09-01T06:00:00Z' }], nextCursor: null });
  return p instanceof Error ? Promise.reject(p) : Promise.resolve({ member: p });
});

beforeEach(() => { get.mockReset(); });

describe('list', () => {
  test('links to each profile, with no team picker for staff', async () => {
    get.mockResolvedValue({ members: [person()], nextCursor: null });
    wrap(<PastMembersHome base="/team/past-members" />);
    expect((await screen.findByText('Nevin')).closest('a')).toHaveAttribute('href', '/team/past-members/U1');
    expect(screen.queryByLabelText('Team')).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/staff/past-members');
  });

  test('admins pick a team, and the choice is sent', async () => {
    get.mockResolvedValue({ members: [], nextCursor: null });
    wrap(<PastMembersHome base="/admin/past-members" pickTeam />);
    expect(await screen.findByText('Nobody has left any team yet.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'procurement' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/past-members?team=procurement'));
  });

  test('more pages load with the cursor', async () => {
    get.mockResolvedValueOnce({ members: [person()], nextCursor: 'abc' }).mockResolvedValueOnce({ members: [person({ id: 'U2', name: 'Arun' })], nextCursor: null });
    wrap(<PastMembersHome base="/team/past-members" />);
    fireEvent.click(await screen.findByText('Show more'));
    expect(await screen.findByText('Arun')).toBeInTheDocument();
    expect(get).toHaveBeenLastCalledWith('/staff/past-members?cursor=abc');
  });

  test('a failed load offers Try again', async () => {
    get.mockRejectedValue(new Error('net'));
    wrap(<PastMembersHome base="/team/past-members" />);
    expect(await screen.findByText('Try again')).toBeInTheDocument();
  });
});

describe('profile', () => {
  test('GTM: summary, sales numbers and the order list', async () => {
    serve(person());
    wrap(<PastMemberProfileView id="U1" base="/team/past-members" />);
    expect(await screen.findByRole('heading', { name: 'Nevin' })).toBeInTheDocument();
    expect(screen.getByText('Meena')).toBeInTheDocument();
    expect(screen.getByText('₹1,501')).toBeInTheDocument();
    expect(await screen.findByText('#ABC12345')).toBeInTheDocument();
    expect(await screen.findByText('Call Ravi')).toBeInTheDocument();
    expect(screen.getByText('No resignation was recorded for this person.')).toBeInTheDocument();
  });

  test('another team: no sales section, and orders are never asked for', async () => {
    serve(person({ team: 'procurement', teamLabel: 'Procurement', roleLabel: 'Member', sales: null, tasksDone: 0 }));
    wrap(<PastMemberProfileView id="U1" base="/team/past-members" />);
    expect(await screen.findByText('No finished tasks.')).toBeInTheDocument();
    expect(screen.queryByText('Sales')).not.toBeInTheDocument();
    expect(get.mock.calls.some(([u]) => String(u).includes('/orders') || String(u).includes('/tasks'))).toBe(false);
    expect(screen.getByText('No training was assigned.')).toBeInTheDocument();
  });

  test('handover note, passed-on work and lessons link to the right panel', async () => {
    serve(person({
      sales: null,
      lessons: [{ id: 'L1', title: 'Closing a B2B order', audience: 'sales', createdAt: '' }],
      handover: { note: 'Ravi likes calls', noteByName: 'Nevin', noteAt: null, takenOverBy: 'Meena', moved: [{ kind: 'lead', label: 'Lead d', toName: 'Meena', at: '' }] },
    }));
    wrap(<PastMemberProfileView id="U1" base="/admin/past-members" />);
    expect(await screen.findByText('Ravi likes calls')).toBeInTheDocument();
    expect(screen.getByText('Lead: Lead d')).toBeInTheDocument();
    expect(screen.getByText('Closing a B2B order').closest('a')).toHaveAttribute('href', '/admin/lessons/L1');
  });

  test('a hidden or unknown person shows not found', async () => {
    serve(new Error('404'));
    wrap(<PastMemberProfileView id="U9" base="/team/past-members" />);
    expect(await screen.findByText('This person could not be found, or is not on your team.')).toBeInTheDocument();
  });
});

test('time on the team reads naturally', () => {
  expect(timeOnTeam(null)).toBe('Not known');
  expect(timeOnTeam(1)).toBe('1 day');
  expect(timeOnTeam(12)).toBe('12 days');
  expect(timeOnTeam(95)).toBe('3 months');
  expect(timeOnTeam(400)).toBe('1 year 1 month');
});
