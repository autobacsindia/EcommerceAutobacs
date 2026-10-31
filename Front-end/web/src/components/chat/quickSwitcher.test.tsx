/**
 * "Jump to…" (Ctrl/⌘+K): type a few letters, press Enter. Unread conversations
 * come first, a name that starts with what was typed beats one that only
 * contains it, and people with no conversation yet are offered as new chats.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import QuickSwitcher, { channelTitle } from './QuickSwitcher';
import type { ChatChannel, ChatPerson } from '@/hooks/queries/useTeamChat';

const person = (id: string, name: string, over: Partial<ChatPerson> = {}): ChatPerson => ({
  id, name, role: 'staff', team: 'sales', teamLabel: 'Sales', isHead: false, ...over,
});

const channel = (id: string, name: string, over: Partial<ChatChannel> = {}): ChatChannel => ({
  id, kind: 'space', key: null, name, description: '', audience: 'all', team: null, system: false,
  partner: null, memberCount: null, lastMessageSeq: 1, lastMessageAt: '2026-10-30T05:00:00Z',
  lastReadSeq: 1, unread: 0, unreadChat: 0, unreadUpdates: 0, ...over,
});

const arjun = person('u2', 'Arjun Mehta', { team: 'procurement', teamLabel: 'Procurement' });
const channels = [
  channel('c1', 'company', { lastMessageAt: '2026-10-31T05:00:00Z' }),
  channel('c2', 'gtm', { unread: 2, unreadChat: 2, lastMessageAt: '2026-10-29T05:00:00Z' }),
  channel('c3', 'sales-gtm', { lastMessageAt: '2026-10-28T05:00:00Z' }),
  channel('d1', 'Arjun Mehta', { kind: 'dm', partner: arjun }),
];
const people = [person('me', 'Priya Nair'), arjun, person('u3', 'Kavya Rao'), person('u4', 'Rohan Das')];

function open() {
  const onPickChannel = jest.fn();
  const onPickPerson = jest.fn();
  const onClose = jest.fn();
  render(<QuickSwitcher channels={channels} people={people} meId="me" onPickChannel={onPickChannel} onPickPerson={onPickPerson} onClose={onClose} />);
  const box = screen.getByRole('combobox', { name: 'Jump to a space, team or person' });
  // The conversation's name line, without the avatar, the description or the unread badge.
  const names = () => within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.querySelector('span.block')?.textContent ?? '');
  return { box, names, onPickChannel, onPickPerson, onClose };
}

describe('Jump to a conversation', () => {
  it('starts in the box, with unread first and then the most recent', () => {
    const { box, names } = open();
    expect(box).toHaveFocus();
    expect(names().slice(0, 2)).toEqual(['#gtm', '#company']);
  });

  it('a name that starts with what was typed beats one that only contains it', () => {
    const { box, names } = open();
    fireEvent.change(box, { target: { value: 'gtm' } });
    expect(names()).toEqual(['#gtm', '#sales-gtm']);
  });

  it('arrow keys move, Enter opens the highlighted conversation', () => {
    const { box, onPickChannel } = open();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onPickChannel).toHaveBeenCalledWith('c1');
  });

  it('offers a new chat with people you have not talked to — never yourself, never someone you already have a chat with', () => {
    const { box, names, onPickPerson } = open();
    fireEvent.change(box, { target: { value: 'a' } });
    const list = screen.getByRole('listbox');
    expect(within(list).getByText('Start a chat with')).toBeInTheDocument();
    expect(names()).toContain('Kavya Rao');
    expect(names()).not.toContain('Priya Nair');
    // Arjun appears once: as the existing conversation, not again as a new chat.
    expect(names().filter((n) => n === 'Arjun Mehta')).toHaveLength(1);
    fireEvent.click(within(list).getByRole('option', { name: /Kavya Rao/ }));
    expect(onPickPerson).toHaveBeenCalledWith('u3');
  });

  it('says so when nothing matches; Escape closes', () => {
    const { box, onClose } = open();
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.getByText(/No space, team or person called “zzz”/)).toBeInTheDocument();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('writes spaces with a #, and people and team pairs by name', () => {
    expect(channelTitle(channels[0])).toBe('#company');
    expect(channelTitle(channels[3])).toBe('Arjun Mehta');
    expect(channelTitle(channel('t1', 'Procurement', { audience: 'teams' }))).toBe('Procurement');
  });
});
