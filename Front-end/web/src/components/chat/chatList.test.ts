/**
 * The chat list's order and numbers (chatList.ts): newest first, never-used
 * chats folded, and one count — messages from people — everywhere.
 */
import { firstToOpen, homeList, listWhen, totalPeopleUnread } from './chatList';
import type { ChatChannel } from '@/hooks/queries/useTeamChat';

jest.mock('@/hooks/queries/useTeamChat', () => ({
  countedUnread: (c: ChatChannel) => (c.notify === 'off'
    ? { chat: 0, updates: 0 }
    : { chat: c.unreadChat ?? 0, updates: c.unreadUpdates ?? 0 }),
}));

const ch = (id: string, over: Partial<ChatChannel> = {}) =>
  ({ id, name: id, kind: 'space', unread: 0, unreadChat: 0, unreadUpdates: 0, lastMessageSeq: 1, lastMessageAt: null, ...over }) as ChatChannel;
const at = (h: number) => `2026-11-03T${String(h).padStart(2, '0')}:00:00Z`;
const ids = (list: ChatChannel[]) => list.map((c) => c.id);

const channels = [
  ch('old', { lastMessageAt: at(1) }),
  ch('bot', { lastMessageAt: at(5), unreadUpdates: 40 }),
  ch('priya', { kind: 'dm', lastMessageAt: at(3), unreadChat: 2 }),
  ch('muted', { lastMessageAt: at(4), unreadChat: 9, notify: 'off' } as Partial<ChatChannel>),
  ch('never', { lastMessageSeq: 0 }),
  ch('alsoNever', { lastMessageSeq: 0 }),
];

describe('homeList', () => {
  it('newest first, never-used chats folded and sorted by name', () => {
    const { active, empty } = homeList(channels);
    expect(ids(active)).toEqual(['bot', 'muted', 'priya', 'old']);
    expect(ids(empty)).toEqual(['alsoNever', 'never']);
  });

  it('keeps the open conversation in the list even if nothing was ever written there', () => {
    expect(ids(homeList(channels, { selectedId: 'never' }).active)).toContain('never');
    expect(ids(homeList(channels, { selectedId: 'never' }).empty)).toEqual(['alsoNever']);
  });

  it('"Unread" keeps chats where people wrote, not order updates or muted chats', () => {
    expect(ids(homeList(channels, { unreadOnly: true }).active)).toEqual(['priya']);
    expect(ids(homeList(channels, { unreadOnly: true, selectedId: 'old' }).active)).toEqual(['priya', 'old']);
  });

  it('folds nothing before anyone has written anywhere — the list is never empty', () => {
    const fresh = [ch('a', { lastMessageSeq: 0 }), ch('b', { lastMessageSeq: 0 })];
    expect(homeList(fresh)).toEqual({ active: fresh, empty: [] });
  });
});

describe('the one number', () => {
  it('counts messages from people only: not 40 order updates, not a muted chat', () => {
    expect(totalPeopleUnread(channels)).toBe(2);
  });

  it('opens the newest chat where a person is waiting, else the newest chat', () => {
    expect(firstToOpen(channels)?.id).toBe('priya');
    expect(firstToOpen(channels.filter((c) => c.id !== 'priya'))?.id).toBe('bot');
    expect(firstToOpen([])).toBeNull();
  });
});

describe('listWhen', () => {
  const now = new Date('2026-11-03T12:00:00');
  it('time today, "Yesterday", then the date', () => {
    expect(listWhen('2026-11-03T09:30:00', now)).toMatch(/9:30/);
    expect(listWhen('2026-11-02T23:00:00', now)).toBe('Yesterday');
    expect(listWhen('2026-10-28T09:00:00', now)).toBe('28 Oct');
  });
});
