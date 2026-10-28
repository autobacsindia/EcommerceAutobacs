/**
 * Online dots and status, on screen. "Online" means "has team chat open" —
 * the dot says no more than that. A status clears itself at its "until", and
 * a page left open past that time must stop showing it too (liveStatus).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChatPerson } from '@/hooks/queries/useTeamChat';

const setStatus = jest.fn();
const people: ChatPerson[] = [
  { id: 'me', name: 'Sam', role: 'staff', team: 'sales', teamLabel: 'GTM', isHead: false },
  { id: 'anu', name: 'Anu', role: 'staff', team: 'accounts', teamLabel: 'Accounts', isHead: true, status: { text: '🌴 On leave', until: null } },
  { id: 'ravi', name: 'Ravi', role: 'staff', team: 'operations', teamLabel: 'Operations', isHead: false, status: null },
];
jest.mock('@/hooks/queries/useTeamChat', () => ({
  ...jest.requireActual('@/hooks/queries/useTeamChat'),
  useSetStatus: () => ({ mutateAsync: setStatus, isPending: false, isError: false }),
  usePresence: () => new Set(['ravi']),
  useChatPeople: () => ({ data: people }),
  useOpenDm: () => ({ mutateAsync: jest.fn(), isPending: false, isError: false }),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }), usePathname: () => '/team/chat', useSearchParams: () => new URLSearchParams() }));
jest.mock('@/hooks/useSSE', () => ({ useSSE: () => {} }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

import StatusDialog, { clearAt } from './StatusDialog';
import { NewMessageDialog } from './TeamChat';
import { Avatar } from './chatUi';
import { liveStatus } from '@/hooks/queries/useTeamChat';

beforeEach(() => setStatus.mockReset().mockResolvedValue({ status: null }));

describe('clearAt — when a status clears itself', () => {
  const now = new Date(2026, 9, 27, 10, 30); // Tuesday 27 Oct, 10:30 local

  it('after a set time, at the end of today, or at the end of the week', () => {
    expect(clearAt('never', now)).toBeNull();
    expect(new Date(clearAt('1h', now)!).getTime() - now.getTime()).toBe(3_600_000);
    expect(new Date(clearAt('today', now)!)).toEqual(new Date(2026, 9, 27, 23, 59));
    expect(new Date(clearAt('week', now)!)).toEqual(new Date(2026, 10, 1, 23, 59)); // Sunday 1 Nov
  });

  it('"end of this week" on a Sunday is that same night', () => {
    const sunday = new Date(2026, 10, 1, 9, 0);
    expect(new Date(clearAt('week', sunday)!)).toEqual(new Date(2026, 10, 1, 23, 59));
  });
});

describe('liveStatus', () => {
  it('drops a status whose time has passed', () => {
    expect(liveStatus({ text: 'Meeting', until: new Date(Date.now() - 1000).toISOString() })).toBeNull();
    expect(liveStatus({ text: 'Meeting', until: new Date(Date.now() + 60_000).toISOString() })?.text).toBe('Meeting');
    expect(liveStatus({ text: 'Leave', until: null })?.text).toBe('Leave');
    expect(liveStatus(null)).toBeNull();
  });
});

describe('the status dialog', () => {
  it('a preset fills the box; Save sends it with when to clear', async () => {
    const onClose = jest.fn();
    render(<StatusDialog current={null} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '🌴 On leave' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'never' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(setStatus).toHaveBeenCalledWith({ text: '🌴 On leave', until: null });
  });

  it('defaults to clearing at the end of today', async () => {
    render(<StatusDialog current={null} onClose={jest.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Status' }), { target: { value: 'At the warehouse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setStatus).toHaveBeenCalled());
    const until = new Date(setStatus.mock.calls[0][0].until);
    expect([until.getHours(), until.getMinutes()]).toEqual([23, 59]);
  });

  it('an existing status can be cleared', async () => {
    const onClose = jest.fn();
    render(<StatusDialog current={{ text: 'In a meeting', until: null }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear status' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(setStatus).toHaveBeenCalledWith(null);
  });

  it('nothing written: nothing to save', () => {
    render(<StatusDialog current={null} onClose={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('green dots and status lines', () => {
  it('an avatar shows the dot only when told the person is online', () => {
    const { rerender } = render(<Avatar person={people[1]} />);
    expect(screen.queryByRole('img', { name: 'Online' })).not.toBeInTheDocument();
    rerender(<Avatar person={people[1]} online />);
    expect(screen.getByRole('img', { name: 'Online' })).toBeInTheDocument();
  });

  it('the people picker shows who is online and their status', () => {
    render(<NewMessageDialog meId="me" onClose={jest.fn()} onOpened={jest.fn()} />);
    const anu = screen.getByRole('button', { name: /Anu/ });
    const ravi = screen.getByRole('button', { name: /Ravi/ });
    expect(anu).toHaveTextContent('On leave');
    expect(anu.querySelector('[aria-label="Online"]')).toBeNull();
    expect(ravi.querySelector('[aria-label="Online"]')).not.toBeNull();
  });
});
