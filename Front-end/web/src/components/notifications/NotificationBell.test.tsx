/**
 * The header bell.
 *
 * The counting is the easy half. What these pin is the behaviour that is easy
 * to get subtly wrong and nobody notices until people complain:
 *
 *   - it chimes when work ARRIVES, never on mount and never when work clears.
 *     A chime on mount means a chime on every page navigation, which is how a
 *     notification sound gets switched off for good on day one.
 *   - mute is obeyed and remembered.
 *   - the badge shows chat and approvals TOGETHER, because the whole point is
 *     one thing to glance at instead of several.
 */
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import NotificationBell from './NotificationBell';

const chime = jest.fn();
const workAlert = jest.fn();
const armed = jest.fn();
let mutedValue = false;

jest.mock('@/lib/notificationChime', () => ({
  chime: () => chime(),
  alert: () => workAlert(),
  arm: () => armed(),
  muted: () => mutedValue,
  setMuted: (v: boolean) => { mutedValue = v; },
}));

let waiting: { items: { key: string; label: string; count: number; href: string }[]; total: number };
let chatUnread: number;

jest.mock('@/hooks/queries/useNotifications', () => ({
  useWaitingWork: () => ({ data: waiting }),
}));
jest.mock('@/hooks/queries/useTeamChat', () => ({
  useChatUnreadTotal: () => chatUnread,
}));

beforeEach(() => {
  chime.mockClear();
  workAlert.mockClear();
  armed.mockClear();
  mutedValue = false;
  chatUnread = 0;
  waiting = { items: [], total: 0 };
});

describe('NotificationBell', () => {
  it('says nothing is waiting, and shows no badge', async () => {
    render(<NotificationBell chatHref="/team/chat" />);
    fireEvent.click(screen.getByRole('button', { name: /nothing waiting/i }));
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
  });

  it('adds chat and approvals into one number', () => {
    chatUnread = 2;
    waiting = { items: [{ key: 'payments_to_approve', label: 'Payments to approve', count: 3, href: '/team/payments' }], total: 3 };
    render(<NotificationBell chatHref="/team/chat" />);
    expect(screen.getByRole('button', { name: /5 waiting/i })).toBeInTheDocument();
  });

  it('does NOT chime on first render — that would fire on every page change', () => {
    waiting = { items: [], total: 4 };
    render(<NotificationBell chatHref="/team/chat" />);
    expect(chime).not.toHaveBeenCalled();
  });

  it('new WORK plays the work alert (not the chat chime); work finishing is silent', () => {
    waiting = { items: [], total: 1 };
    const { rerender } = render(<NotificationBell chatHref="/team/chat" />);
    expect(workAlert).not.toHaveBeenCalled();

    waiting = { items: [], total: 3 };
    rerender(<NotificationBell chatHref="/team/chat" />);
    expect(workAlert).toHaveBeenCalledTimes(1);
    expect(chime).not.toHaveBeenCalled();

    // Work being finished is not an event worth a noise.
    waiting = { items: [], total: 0 };
    rerender(<NotificationBell chatHref="/team/chat" />);
    expect(workAlert).toHaveBeenCalledTimes(1);
  });

  it('a new CHAT message plays the chat chime; both at once plays the work alert only', () => {
    waiting = { items: [], total: 0 };
    chatUnread = 0;
    const { rerender } = render(<NotificationBell chatHref="/team/chat" />);
    chatUnread = 2;
    rerender(<NotificationBell chatHref="/team/chat" />);
    expect(chime).toHaveBeenCalledTimes(1);
    expect(workAlert).not.toHaveBeenCalled();

    chatUnread = 3;
    waiting = { items: [], total: 1 };
    rerender(<NotificationBell chatHref="/team/chat" />);
    expect(workAlert).toHaveBeenCalledTimes(1);
    expect(chime).toHaveBeenCalledTimes(1);
  });

  it('opens on the side with room: right in the team sidebar, left in the admin header, full width on phones', () => {
    waiting = { items: [], total: 0 };
    const { unmount } = render(<NotificationBell chatHref="/team/chat" tone="dark" />);
    fireEvent.click(screen.getByRole('button', { name: /waiting|notifications/i }));
    const panel = screen.getByRole('menu');
    expect(panel.className).toMatch(/\bleft-0\b/);
    expect(panel.className).toMatch(/max-sm:fixed/);
    unmount();
    render(<NotificationBell chatHref="/admin/chat" />);
    fireEvent.click(screen.getByRole('button', { name: /waiting|notifications/i }));
    expect(screen.getByRole('menu').className).toMatch(/\bright-0\b/);
  });

  it('arms the audio on the first click anywhere, not just on the bell', () => {
    render(<NotificationBell chatHref="/team/chat" />);
    expect(armed).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(armed).toHaveBeenCalled();
  });

  it('remembers the sound being switched off', async () => {
    render(<NotificationBell chatHref="/team/chat" />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    fireEvent.click(await screen.findByRole('button', { name: /turn the notification sound off/i }));
    expect(mutedValue).toBe(true);
    await waitFor(() => expect(screen.getByRole('button', { name: /turn the notification sound on/i })).toBeInTheDocument());
  });

  it('lists each queue with a link to the page that holds it', async () => {
    chatUnread = 1;
    waiting = {
      items: [{ key: 'payments_to_approve', label: 'Payments to approve', count: 2, href: '/team/payments' }],
      total: 2,
    };
    render(<NotificationBell chatHref="/team/chat" />);
    fireEvent.click(screen.getByRole('button', { name: /3 waiting/i }));

    expect(await screen.findByRole('menuitem', { name: /unread messages/i })).toHaveAttribute('href', '/team/chat');
    expect(screen.getByRole('menuitem', { name: /payments to approve/i })).toHaveAttribute('href', '/team/payments');
  });

  it('closes on Escape', async () => {
    render(<NotificationBell chatHref="/team/chat" />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
