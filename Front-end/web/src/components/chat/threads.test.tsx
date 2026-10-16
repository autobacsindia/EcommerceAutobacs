/**
 * Thread affordances on a message: the summary under a message that has
 * replies, the Reply action, and that a mention inside a thread is not hidden.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import MessageItem from './MessageItem';
import type { ChatMessage } from '@/hooks/queries/useTeamChat';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const base: ChatMessage = {
  id: 'root', channelId: 'c', seq: 1, activitySeq: 7, kind: 'system', text: '🟠 Out of stock on #A1', deleted: false,
  sender: null, clientId: null, attachments: [], mentions: [], mentionTeams: [], refs: [],
  createdAt: '2026-10-14T05:00:00Z',
};

const renderItem = (m: ChatMessage, onOpenThread?: (m: ChatMessage) => void) =>
  render(
    <MessageItem
      message={m}
      meId="me"
      meName="Sam"
      peopleById={new Map()}
      orderHref={(id) => `/team/orders/${id}`}
      onRetry={() => {}}
      onOpenThread={onOpenThread}
    />,
  );

describe('threads on a message', () => {
  it('shows how many replies and the newest one, and opens the thread', () => {
    const open = jest.fn();
    renderItem({
      ...base,
      replyCount: 2,
      lastReply: { at: '2026-10-14T09:00:00Z', by: 'Roavion updates', preview: '🟡 ordered from ARB', mentions: [] },
    }, open);
    const summary = screen.getByRole('button', { name: /Open thread, 2 replies/ });
    expect(summary).toHaveTextContent('Roavion updates: 🟡 ordered from ARB');
    fireEvent.click(summary);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 'root' }));
  });

  it('highlights the summary when the newest reply mentions me', () => {
    renderItem({ ...base, replyCount: 1, lastReply: { at: base.createdAt, by: 'Roavion updates', preview: '@Sam', mentions: ['me'] } }, () => {});
    expect(screen.getByRole('button', { name: /Open thread/ }).className).toMatch(/amber/);
  });

  it('offers "Reply in thread" on a message with no replies yet', () => {
    const open = jest.fn();
    renderItem(base, open);
    expect(screen.queryByRole('button', { name: /Open thread/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reply in thread' }));
    expect(open).toHaveBeenCalled();
  });

  it('inside a thread (no onOpenThread) there is no reply action and no summary', () => {
    renderItem({ ...base, replyCount: 3, lastReply: { at: base.createdAt, by: 'x', preview: 'y', mentions: [] } });
    expect(screen.queryByRole('button', { name: 'Reply in thread' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open thread/ })).toBeNull();
  });
});
