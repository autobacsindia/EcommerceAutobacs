/**
 * The Past members screens.
 *   - the list links to each profile; admins get a team picker, staff do not
 *   - an empty team says so; a failed load offers Try again
 *   - a GTM profile shows sales and its orders; other teams have no sales section
 *   - the order list is not even fetched for non-GTM profiles
 *   - no recorded resignation, no tasks, no training: each section says so
 *   - a hidden or unknown profile shows a plain "not found"
 *   - team notes: writers get the box, readers do not; edit sends the rev; delete confirms
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PastMembersHome from './PastMembersHome';
import PastMemberProfileView from './PastMemberProfile';
import { timeOnTeam, type PastMemberNote, type PastMemberProfile } from './types';

const get = jest.fn();
const post = jest.fn();
const patch = jest.fn();
const del = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), delete: (...a: unknown[]) => del(...a) } }));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/components/ui/RichTextBox', () => ({ __esModule: true, default: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) => <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} /> }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));
jest.mock('@/components/ui/RichText', () => ({ __esModule: true, default: ({ value }: { value: string }) => <div>{value}</div> }));

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const person = (over: Partial<PastMemberProfile> = {}): PastMemberProfile => ({
  id: 'U1', name: 'Nevin', team: 'sales', teamLabel: 'GTM', roleLabel: 'GTM lead', joinedOn: '2026-01-01', lastDay: '2026-10-31', daysOnTeam: 303,
  takenOverBy: 'Meena', tasksDone: 1, training: [], lessons: [], handover: null,
  sales: { orders: { paid: 2, paidValue: 1500.5, notPaid: 1, returned: 1, cancelled: 0 }, quotations: { sent: 3, accepted: 2 }, leads: { total: 4, won: 2, lost: 1 } },
  ...over,
});
let notesReply: { notes: PastMemberNote[]; canWrite: boolean; nextCursor: string | null } = { notes: [], canWrite: false, nextCursor: null };
const serve = (p: PastMemberProfile | Error) => get.mockImplementation((u: string) => {
  if (u.includes('/notes')) return Promise.resolve(notesReply);
  if (u.includes('/orders')) return Promise.resolve({ orders: [{ id: 'O1', number: '#ABC12345', createdAt: '2026-10-01T06:00:00Z', totalAmount: 1000, status: 'delivered', paymentStatus: 'paid' }], nextCursor: null });
  if (u.includes('/tasks')) return Promise.resolve({ tasks: [{ id: 'T1', number: 7, title: 'Call Ravi', completedAt: '2026-09-01T06:00:00Z' }], nextCursor: null });
  return p instanceof Error ? Promise.reject(p) : Promise.resolve({ member: p });
});

beforeEach(() => { get.mockReset(); post.mockReset(); patch.mockReset(); del.mockReset(); notesReply = { notes: [], canWrite: false, nextCursor: null }; });

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

describe('team notes', () => {
  const note = (over: Partial<PastMemberNote> = {}): PastMemberNote => ({
    id: 'N1', body: 'Call Ravi first', authorName: 'Head', createdAt: '2026-11-01T06:00:00Z', editedAt: null, rev: 2, can: { edit: false, delete: false }, ...over,
  });

  test('readers see notes with author, but no box and no buttons', async () => {
    notesReply = { notes: [note()], canWrite: false, nextCursor: null };
    serve(person({ sales: null }));
    wrap(<PastMemberProfileView id="U1" base="/team/past-members" />);
    expect(await screen.findByText('Call Ravi first')).toBeInTheDocument();
    expect(screen.getByText(/Head, 1 Nov 2026/)).toBeInTheDocument();
    expect(screen.queryByLabelText('New note')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  test('the head adds a note', async () => {
    notesReply = { notes: [], canWrite: true, nextCursor: null };
    serve(person({ sales: null }));
    post.mockResolvedValue({ note: note() });
    wrap(<PastMemberProfileView id="U1" base="/team/past-members" />);
    fireEvent.change(await screen.findByLabelText('New note'), { target: { value: 'Ravi likes calls' } });
    fireEvent.click(screen.getByText('Add note'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/past-members/U1/notes', { body: 'Ravi likes calls' }));
  });

  test('the author edits with the rev, and deletes only after confirming', async () => {
    notesReply = { notes: [note({ can: { edit: true, delete: true } })], canWrite: true, nextCursor: null };
    serve(person({ sales: null }));
    patch.mockResolvedValue({ note: note({ body: 'New', rev: 3 }) });
    wrap(<PastMemberProfileView id="U1" base="/team/past-members" />);
    fireEvent.click(await screen.findByText('Edit'));
    fireEvent.change(screen.getByLabelText('Edit note'), { target: { value: 'New' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/past-members/U1/notes/N1', { body: 'New', rev: 2 }));
    const confirm = jest.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    del.mockResolvedValue({ deleted: true });
    fireEvent.click(await screen.findByText('Delete'));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/staff/past-members/U1/notes/N1'));
    confirm.mockRestore();
  });

  test('an admin sees Delete on someone else’s note, but not Edit', async () => {
    notesReply = { notes: [note({ can: { edit: false, delete: true } })], canWrite: true, nextCursor: null };
    serve(person({ sales: null }));
    wrap(<PastMemberProfileView id="U1" base="/admin/past-members" />);
    expect(await screen.findByText('Delete')).toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });

  test('no notes yet', async () => {
    serve(person({ sales: null }));
    wrap(<PastMemberProfileView id="U1" base="/team/past-members" />);
    expect(await screen.findByText('No notes yet.')).toBeInTheDocument();
  });
});
