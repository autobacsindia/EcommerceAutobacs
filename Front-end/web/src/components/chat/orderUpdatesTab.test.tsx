/**
 * "Order updates" tab: automatic (system) messages live in their own tab, people's
 * messages stay in Chat. One timeline underneath; a tab with too few messages in
 * the loaded pages loads older pages by itself. DMs have no updates tab.
 *
 * Chat and Order updates are read separately: each tab marks only itself read,
 * shows its own unread count, and a conversation opens on Order updates when
 * that is all that is waiting (or when the link says so). Order updates run
 * newest first, with "Unread" on what arrived since the last visit.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Conversation from './Conversation';
import type { ChatChannel, ChatMessage } from '@/hooks/queries/useTeamChat';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const fetchNextPage = jest.fn();
const markRead = jest.fn();
const markUnread = jest.fn();
let pages: { messages: ChatMessage[]; nextBefore: number | null }[] = [];
let hasNextPage = false;
jest.mock('@/hooks/queries/useTeamChat', () => ({
  unreadChatOf: (c: { unreadChat?: number; unread: number }) => c.unreadChat ?? c.unread,
  unreadUpdatesOf: (c: { unreadUpdates?: number }) => c.unreadUpdates ?? 0,
  readUpdatesSeqOf: (c: { lastReadUpdatesSeq?: number; lastReadSeq: number }) => c.lastReadUpdatesSeq ?? c.lastReadSeq,
  upsertMessage: (d: unknown) => d,
  useChannelFiles: () => ({ data: undefined, isLoading: false, isError: false }),
  useChatMessages: () => ({
    data: { pages, pageParams: [0] }, fetchNextPage, hasNextPage, isFetchingNextPage: false, isLoading: false, isError: false, refetch: jest.fn(),
  }),
  useMarkRead: () => ({ mutate: (...a: unknown[]) => markRead(...a) }),
  useSendMessage: () => ({ mutate: jest.fn(), mutateAsync: jest.fn() }),
  useEditMessage: () => ({ mutateAsync: jest.fn() }),
  useDeleteMessage: () => ({ mutateAsync: jest.fn() }),
  useReactToMessage: () => ({ mutate: jest.fn() }),
  useMarkUnread: () => ({ mutate: (...a: unknown[]) => markUnread(...a) }),
  useSetNotify: () => ({ mutate: jest.fn(), isError: false }),
  notifyOf: (c: { notify?: string }) => c.notify ?? 'all',
  useRecentOrders: () => ({ data: [], isLoading: false }),
}));

const msg = (seq: number, kind: 'user' | 'system', text: string): ChatMessage => ({
  id: `m${seq}`, channelId: 'c', seq, kind, text, deleted: false,
  sender: kind === 'user' ? { id: 'u1', name: 'Anu', role: 'staff', team: 'accounts', teamLabel: 'Accounts', isHead: false } : null,
  clientId: null, attachments: [], mentions: [], mentionTeams: [], refs: [], createdAt: `2026-10-26T05:0${seq}:00Z`,
} as unknown as ChatMessage);

const channel = (over: Partial<ChatChannel> = {}): ChatChannel => ({
  id: 'c', kind: 'space', key: 'team:accounts', name: 'Accounts', description: '', audience: 'team', team: 'accounts', system: true,
  partner: null, memberCount: null, lastMessageSeq: 3, lastMessageAt: null, lastReadSeq: 3, unread: 0, ...over,
} as ChatChannel);

const show = (ch: ChatChannel, initialTab?: 'messages' | 'updates') => render(
  <QueryClientProvider client={new QueryClient()}>
    <Conversation channel={ch} meId="me" meName="Me" isAdmin={false} people={[]} orderHref={(id) => `/o/${id}`} onBack={() => {}} initialTab={initialTab} />
  </QueryClientProvider>,
);
const selectedTab = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;

beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });
beforeEach(() => {
  fetchNextPage.mockReset();
  markRead.mockReset();
  markUnread.mockReset();
  hasNextPage = false;
  pages = [{ messages: [msg(1, 'user', 'Morning all'), msg(2, 'system', '🧾 New expense PR-0022'), msg(3, 'user', 'Approved it')], nextBefore: null }];
});

it('Chat shows people; Order updates shows the automatic messages, without a message box', () => {
  show(channel());
  expect(screen.getByText('Morning all')).toBeInTheDocument();
  expect(screen.queryByText(/New expense PR-0022/)).toBeNull();
  expect(screen.getByRole('textbox')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'Order updates' }));
  expect(screen.getByText(/New expense PR-0022/)).toBeInTheDocument();
  expect(screen.queryByText('Morning all')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('a direct message has no Order updates tab', () => {
  show(channel({ kind: 'dm', key: null, audience: 'members', team: null }));
  expect(screen.queryByRole('tab', { name: 'Order updates' })).toBeNull();
  expect(screen.getByRole('tab', { name: 'Files' })).toBeInTheDocument();
});

it('loads older pages by itself when a tab has too few messages to scroll', () => {
  hasNextPage = true;
  show(channel());
  expect(fetchNextPage).toHaveBeenCalled();
});

it('Order updates run newest first', () => {
  pages = [{ messages: [msg(1, 'system', 'Order #A1 paid'), msg(2, 'user', 'ok'), msg(5, 'system', 'Order #A5 paid')], nextBefore: null }];
  show(channel({ lastMessageSeq: 5, lastReadSeq: 5, lastReadUpdatesSeq: 5 }), 'updates');
  const a5 = screen.getByText(/Order #A5 paid/);
  const a1 = screen.getByText(/Order #A1 paid/);
  expect(a5.compareDocumentPosition(a1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('"Unread" marks what arrived since the last visit; opening the tab reads only Order updates', () => {
  pages = [{ messages: [msg(1, 'system', 'Order #A1 paid'), msg(2, 'user', 'ok'), msg(5, 'system', 'Order #A5 paid')], nextBefore: null }];
  show(channel({ lastMessageSeq: 5, lastReadSeq: 2, lastReadUpdatesSeq: 1, unreadChat: 0, unreadUpdates: 1, unread: 1 }), 'updates');
  expect(screen.getAllByText('Unread')).toHaveLength(1);
  expect(screen.getByText('Unread').parentElement).toHaveTextContent(/Order #A5 paid/);
  expect(markRead).toHaveBeenCalledWith({ channelId: 'c', seq: 5, part: 'updates' });
  expect(markRead).not.toHaveBeenCalledWith(expect.objectContaining({ part: 'chat' }));
});

it('reading Chat marks only Chat read, up to the newest person\'s message', () => {
  pages = [{ messages: [msg(1, 'user', 'hi'), msg(2, 'user', 'there'), msg(3, 'system', 'Order #A3 paid')], nextBefore: null }];
  show(channel({ lastMessageSeq: 3, lastReadSeq: 0, lastReadUpdatesSeq: 0, unreadChat: 2, unreadUpdates: 1, unread: 3 }));
  expect(selectedTab()).toMatch(/^Chat/);
  expect(markRead).toHaveBeenCalledWith({ channelId: 'c', seq: 2, part: 'chat' });
  expect(markRead).not.toHaveBeenCalledWith(expect.objectContaining({ part: 'updates' }));
});

it('opens on Order updates when only order updates are waiting, on Chat otherwise', () => {
  const { unmount } = show(channel({ unreadChat: 0, unreadUpdates: 2, unread: 2 }));
  expect(selectedTab()).toMatch(/^Order updates/);
  unmount();
  show(channel({ unreadChat: 1, unreadUpdates: 2, unread: 3 }));
  expect(selectedTab()).toMatch(/^Chat/);
});

it('a link for an order update (?t=updates) opens Order updates; each tab shows its own count', () => {
  show(channel({ unreadChat: 3, unreadUpdates: 7, unread: 10 }), 'updates');
  expect(selectedTab()).toMatch(/^Order updates/);
  expect(screen.getByRole('tab', { name: /^Chat/ })).toHaveTextContent('3');
  expect(screen.getByRole('tab', { name: /^Order updates/ })).toHaveTextContent('7');
});

it('a direct message ignores ?t=updates', () => {
  show(channel({ kind: 'dm', key: null, audience: 'members', team: null }), 'updates');
  expect(selectedTab()).toMatch(/^Chat/);
});

it('"Mark as unread" stops the open conversation from marking itself read again', () => {
  const client = new QueryClient();
  const view = (ch: ChatChannel) => (
    <QueryClientProvider client={client}>
      <Conversation channel={ch} meId="me" meName="Me" isAdmin={false} people={[]} orderHref={(id) => `/o/${id}`} onBack={() => {}} />
    </QueryClientProvider>
  );
  const { rerender } = render(view(channel({ lastReadSeq: 3 })));
  markRead.mockReset();

  const row = document.getElementById('chat-msg-m3')!;
  fireEvent.click(row.querySelector('[aria-label="More actions"]')!);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Mark as unread' }));
  expect(markUnread).toHaveBeenCalledWith('m3', expect.anything());
  expect(screen.getByRole('status')).toHaveTextContent('Marked as unread');

  // The server moved the read position back; the conversation is still on screen.
  rerender(view(channel({ lastReadSeq: 2, unreadChat: 1, unread: 1 })));
  expect(markRead).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
  expect(markRead).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'c', seq: 3, part: 'chat' }));
});
