/**
 * Per-conversation notifications ("All messages", "Only @mentions", "Off").
 *
 * The server decides who gets a pop-up or an email. The screen's part: the
 * menu sets the person's own choice, and a quietened conversation stops
 * counting toward the nav badge, the bell and the chime (countedUnread).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ChatChannel } from '@/hooks/queries/useTeamChat';

const mutate = jest.fn();
jest.mock('@/hooks/queries/useTeamChat', () => ({
  ...jest.requireActual('@/hooks/queries/useTeamChat'),
  useSetNotify: () => ({ mutate, isError: false }),
}));

import NotifyMenu from './NotifyMenu';
import { countedUnread } from '@/hooks/queries/useTeamChat';

const channel = (over: Partial<ChatChannel> = {}): ChatChannel => ({
  id: 'c1', kind: 'space', key: 'team:sales', name: 'Sales', description: '', audience: 'team', team: 'sales',
  system: true, partner: null, memberCount: null, lastMessageSeq: 9, lastMessageAt: null, lastReadSeq: 2,
  unreadChat: 4, unreadUpdates: 3, unread: 7, ...over,
});

beforeEach(() => mutate.mockClear());

describe('countedUnread — what a conversation adds to badges and the chime', () => {
  it('"All" (or an older server that sends no setting) counts everything, per tab', () => {
    expect(countedUnread(channel())).toEqual({ chat: 4, updates: 3 });
    expect(countedUnread(channel({ notify: 'all' }))).toEqual({ chat: 4, updates: 3 });
  });

  it('"Only @mentions" counts only what @mentions me', () => {
    expect(countedUnread(channel({ notify: 'mentions', unreadMentions: 2 }))).toEqual({ chat: 2, updates: 0 });
    expect(countedUnread(channel({ notify: 'mentions' }))).toEqual({ chat: 0, updates: 0 });
  });

  it('"Off" counts nothing', () => {
    expect(countedUnread(channel({ notify: 'off', unreadMentions: 5 }))).toEqual({ chat: 0, updates: 0 });
  });
});

describe('the Notifications menu', () => {
  it('says the current setting and lists the three choices', () => {
    render(<NotifyMenu channel={channel({ notify: 'mentions' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications: Only @mentions' }));
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('All messages'), expect.stringContaining('Only @mentions'), expect.stringContaining('Off'),
    ]);
    expect(screen.getByRole('menuitemradio', { name: /Only @mentions/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('saves a new choice for this conversation and closes', () => {
    render(<NotifyMenu channel={channel()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications: All messages' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Off/ }));
    expect(mutate).toHaveBeenCalledWith({ channelId: 'c1', notify: 'off' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('choosing the current setting again sends nothing', () => {
    render(<NotifyMenu channel={channel({ notify: 'off' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications: Off' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Off/ }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    render(<NotifyMenu channel={channel()} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
