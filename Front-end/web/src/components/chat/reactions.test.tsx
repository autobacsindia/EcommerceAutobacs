/**
 * Emoji reactions, on screen and in the cache.
 *
 * The server owns the truth (POST /chat/messages/:id/reactions sends the state
 * it wants, so a retried tap cannot undo itself). The screen draws what it is
 * given, offers reacting only on a live message, and its optimistic update
 * follows the same rule as the server.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import MessageItem, { reactorNames } from './MessageItem';
import { withReaction } from '@/hooks/queries/useTeamChat';
import type { ChatMessage, ChatPerson } from '@/hooks/queries/useTeamChat';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const me: ChatPerson = { id: 'me', name: 'Sam', role: 'staff', team: 'sales', teamLabel: 'GTM', isHead: false };
const anu: ChatPerson = { id: 'anu', name: 'Anu', role: 'staff', team: 'accounts', teamLabel: 'Accounts', isHead: true };
const ravi: ChatPerson = { id: 'ravi', name: 'Ravi', role: 'staff', team: 'operations', teamLabel: 'Operations', isHead: false };
const people = new Map([me, anu, ravi].map((p) => [p.id, p]));

const base = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', channelId: 'c', seq: 3, kind: 'user', text: 'Stock arrived', deleted: false,
  sender: anu, clientId: null, attachments: [], mentions: [], mentionTeams: [], refs: [],
  createdAt: new Date().toISOString(), editableUntil: null, reactions: [], ...over,
});

const draw = (m: ChatMessage, onReact: jest.Mock | undefined = jest.fn()) => {
  render(
    <MessageItem
      message={m} meId="me" meName="Sam" peopleById={people} orderHref={(id) => `/o/${id}`} onRetry={() => {}}
      onReact={onReact}
    />,
  );
  return onReact;
};

describe('reaction chips', () => {
  it('show each emoji with its count, and mark the ones you put on', () => {
    draw(base({
      reactions: [
        { emoji: '👍', count: 2, userIds: ['anu', 'me'] },
        { emoji: '🎉', count: 1, userIds: ['ravi'] },
      ],
    }));
    const thumbs = screen.getByRole('button', { name: /^👍 2/ });
    expect(thumbs).toHaveAttribute('aria-pressed', 'true');
    expect(thumbs).toHaveAttribute('title', 'Anu and you reacted with 👍');
    expect(screen.getByRole('button', { name: /^🎉 1/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('tapping your own takes it off; tapping someone else’s adds yours', () => {
    const onReact = draw(base({
      reactions: [
        { emoji: '👍', count: 2, userIds: ['anu', 'me'] },
        { emoji: '🎉', count: 1, userIds: ['ravi'] },
      ],
    }));
    fireEvent.click(screen.getByRole('button', { name: /^👍 2/ }));
    expect(onReact).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'm1' }), '👍', false);
    fireEvent.click(screen.getByRole('button', { name: /^🎉 1/ }));
    expect(onReact).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'm1' }), '🎉', true);
  });

  it('a message with no reactions shows no chips', () => {
    draw(base());
    expect(screen.queryByRole('button', { name: /reacted|Remove your reaction|Add yours/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a reaction' })).not.toBeInTheDocument();
  });
});

describe('the emoji picker', () => {
  it('opens from the action bar and adds the picked emoji', () => {
    const onReact = draw(base());
    fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }));
    const picker = screen.getByRole('dialog', { name: 'Choose an emoji' });
    fireEvent.click(within(picker).getAllByRole('button', { name: '🙏' })[0]);
    expect(onReact).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }), '🙏', true);
    expect(screen.queryByRole('dialog', { name: 'Choose an emoji' })).not.toBeInTheDocument();
  });

  it('picking one you already put on leaves it on (never toggles off)', () => {
    const onReact = draw(base({ reactions: [{ emoji: '👍', count: 1, userIds: ['me'] }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }));
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: '👍' })[0]);
    expect(onReact).not.toHaveBeenCalled();
  });

  it('closes on Escape without reacting', () => {
    const onReact = draw(base());
    fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onReact).not.toHaveBeenCalled();
  });
});

describe('when reacting is not offered', () => {
  it.each([
    ['a deleted message', base({ deleted: true, text: '' })],
    ['a message still sending', base({ pending: true })],
    ['a message that failed to send', base({ failed: true })],
  ])('%s', (_label, m) => {
    draw(m);
    expect(screen.queryByRole('button', { name: 'Add reaction' })).not.toBeInTheDocument();
  });

  it('a deleted message shows no chips, even if it had some', () => {
    draw(base({ deleted: true, text: '', reactions: [{ emoji: '👍', count: 1, userIds: ['anu'] }] }));
    expect(screen.queryByRole('button', { name: /^👍/ })).not.toBeInTheDocument();
  });
});

describe('withReaction (the optimistic update)', () => {
  const start = [{ emoji: '👍', count: 1, userIds: ['anu'] }];

  it('adds a new emoji at the end, or joins an existing one', () => {
    expect(withReaction(start, '🎉', 'me', true)).toEqual([...start, { emoji: '🎉', count: 1, userIds: ['me'] }]);
    expect(withReaction(start, '👍', 'me', true)).toEqual([{ emoji: '👍', count: 2, userIds: ['anu', 'me'] }]);
  });

  it('adding twice or removing what is not there changes nothing — like the server', () => {
    const once = withReaction(start, '👍', 'me', true);
    expect(withReaction(once, '👍', 'me', true)).toBe(once);
    expect(withReaction(start, '👍', 'me', false)).toBe(start);
    expect(withReaction(undefined, '👍', 'me', false)).toEqual([]);
  });

  it('removes only yours, and the emoji once nobody is left', () => {
    const both = withReaction(start, '👍', 'me', true);
    expect(withReaction(both, '👍', 'me', false)).toEqual(start);
    expect(withReaction(start, '👍', 'anu', false)).toEqual([]);
  });
});

describe('reactorNames', () => {
  it('lists people, with you last, and survives someone who left', () => {
    expect(reactorNames(['me'], 'me', people)).toBe('you');
    expect(reactorNames(['anu', 'me', 'ravi'], 'me', people)).toBe('Anu, Ravi and you');
    expect(reactorNames(['gone'], 'me', people)).toBe('Former member');
  });
});
