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
 *   - the chat sound rings once per message (not once per tab or per message in
 *     a burst), never for automatic order updates unless chosen, never for the
 *     conversation on screen, and not on top of a pop-up (lib/chatSound.ts).
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
let updatesUnread: number;
// Each change of the counts is a NEW message, a little later than the last.
let clock = Date.parse('2026-10-29T10:00:00Z');
let lastAt = clock;
let seenCounts = '';
const channel = () => {
  const counts = `${chatUnread}/${updatesUnread}`;
  if (counts !== seenCounts) { seenCounts = counts; clock += 1000; lastAt = clock; }
  return [{ id: 'ch42', kind: 'space', name: 'procurement', unread: chatUnread, unreadChat: chatUnread, unreadUpdates: updatesUnread, lastMessageAt: new Date(lastAt).toISOString() }];
};
let pushOn = false;

jest.mock('@/hooks/queries/useNotifications', () => ({
  useWaitingWork: () => ({ data: waiting }),
}));
jest.mock('@/hooks/queries/useTeamChat', () => ({
  useChatUnreadSplit: () => ({ chat: chatUnread, updates: updatesUnread, updatesChannelId: updatesUnread ? 'ch42' : null }),
  useChatChannels: () => ({ data: channel() }),
  countedUnread: (c: { unreadChat: number; unreadUpdates: number }) => ({ chat: c.unreadChat, updates: c.unreadUpdates }),
}));
jest.mock('@/lib/push', () => ({ ...jest.requireActual('@/lib/push'), pushIsOn: () => pushOn }));

beforeEach(() => {
  chime.mockClear();
  workAlert.mockClear();
  armed.mockClear();
  mutedValue = false;
  chatUnread = 0;
  updatesUnread = 0;
  waiting = { items: [], total: 0 };
  pushOn = false;
  seenCounts = '';
  localStorage.clear();
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

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

  it('new WORK plays the work alert (not the chat chime); work finishing is silent', async () => {
    waiting = { items: [], total: 1 };
    const { rerender } = render(<NotificationBell chatHref="/team/chat" />);
    expect(workAlert).not.toHaveBeenCalled();

    waiting = { items: [], total: 3 };
    rerender(<NotificationBell chatHref="/team/chat" />);
    await settle();
    expect(workAlert).toHaveBeenCalledTimes(1);
    expect(chime).not.toHaveBeenCalled();

    // Work being finished is not an event worth a noise.
    waiting = { items: [], total: 0 };
    rerender(<NotificationBell chatHref="/team/chat" />);
    await settle();
    expect(workAlert).toHaveBeenCalledTimes(1);
  });

  it('a new CHAT message plays the chat chime; both at once plays the work alert only', async () => {
    const { rerender } = render(<NotificationBell chatHref="/team/chat" />);
    chatUnread = 2;
    rerender(<NotificationBell chatHref="/team/chat" />);
    await settle();
    expect(chime).toHaveBeenCalledTimes(1);
    expect(workAlert).not.toHaveBeenCalled();

    localStorage.removeItem('roavion-chime-last'); // past the cool-down
    chatUnread = 3;
    waiting = { items: [], total: 1 };
    rerender(<NotificationBell chatHref="/team/chat" />);
    await settle();
    expect(workAlert).toHaveBeenCalledTimes(1);
    expect(chime).toHaveBeenCalledTimes(1);
  });

  it('a burst of messages rings once (cool-down), not once per message', async () => {
    const { rerender } = render(<NotificationBell chatHref="/team/chat" />);
    for (let n = 1; n <= 5; n += 1) {
      chatUnread = n;
      rerender(<NotificationBell chatHref="/team/chat" />);
      await settle();
    }
    expect(chime).toHaveBeenCalledTimes(1);
  });

  it('several open tabs ring once for the same message', async () => {
    const one = render(<NotificationBell chatHref="/team/chat" />);
    const two = render(<NotificationBell chatHref="/admin/chat" />);
    chatUnread = 1;
    one.rerender(<NotificationBell chatHref="/team/chat" />);
    two.rerender(<NotificationBell chatHref="/admin/chat" />);
    await settle();
    expect(chime).toHaveBeenCalledTimes(1);
  });

  it('automatic order updates are silent unless their sound is switched on', async () => {
    const { rerender } = render(<NotificationBell chatHref="/team/chat" />);
    updatesUnread = 1;
    rerender(<NotificationBell chatHref="/team/chat" />);
    await settle();
    expect(chime).not.toHaveBeenCalled();
    // …but they still count on the badge.
    expect(screen.getByRole('button', { name: /1 waiting/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /automatic order updates/i }));
    expect(localStorage.getItem('roavion-notify-updates-sound')).toBe('1');
    updatesUnread = 2;
    rerender(<NotificationBell chatHref="/team/chat" />);
    await settle();
    expect(chime).toHaveBeenCalledTimes(1);
  });

  it('no sound for the conversation open on screen', async () => {
    const { setOpenConversation } = jest.requireActual('@/lib/chatSound');
    setOpenConversation('ch42');
    try {
      const { rerender } = render(<NotificationBell chatHref="/team/chat" />);
      chatUnread = 1;
      rerender(<NotificationBell chatHref="/team/chat" />);
      await settle();
      expect(chime).not.toHaveBeenCalled();
    } finally {
      setOpenConversation(null);
    }
  });

  it('in a background tab with pop-ups on, the pop-up is the sound — no second chime', async () => {
    pushOn = true;
    const visibility = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      const { rerender } = render(<NotificationBell chatHref="/team/chat" />);
      chatUnread = 1;
      rerender(<NotificationBell chatHref="/team/chat" />);
      await settle();
      expect(chime).not.toHaveBeenCalled();
      // Pop-ups off: the page's chime is the only signal, so it still rings.
      pushOn = false;
      localStorage.clear();
      chatUnread = 2;
      rerender(<NotificationBell chatHref="/team/chat" />);
      await settle();
      expect(chime).toHaveBeenCalledTimes(1);
    } finally {
      visibility.mockRestore();
    }
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

  it('order updates are their own row, opening that space\'s Order updates tab; messages open Chat', async () => {
    chatUnread = 1;
    updatesUnread = 4;
    render(<NotificationBell chatHref="/admin/chat" />);
    fireEvent.click(screen.getByRole('button', { name: /5 waiting/i }));

    expect(await screen.findByRole('menuitem', { name: /unread messages/i })).toHaveAttribute('href', '/admin/chat');
    const updates = screen.getByRole('menuitem', { name: /unread order updates/i });
    expect(updates).toHaveAttribute('href', '/admin/chat?c=ch42&t=updates');
    expect(updates).toHaveTextContent('4');
  });

  it('only order updates waiting → no "Unread messages" row', async () => {
    updatesUnread = 2;
    render(<NotificationBell chatHref="/team/chat" />);
    fireEvent.click(screen.getByRole('button', { name: /2 waiting/i }));
    expect(await screen.findByRole('menuitem', { name: /unread order updates/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /unread messages/i })).toBeNull();
  });

  it('closes on Escape', async () => {
    render(<NotificationBell chatHref="/team/chat" />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
