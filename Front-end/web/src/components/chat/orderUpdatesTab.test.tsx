/**
 * "Order updates" tab: automatic (system) messages live in their own tab, people's
 * messages stay in Chat. One timeline underneath; a tab with too few messages in
 * the loaded pages loads older pages by itself. DMs have no updates tab.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Conversation from './Conversation';
import type { ChatChannel, ChatMessage } from '@/hooks/queries/useTeamChat';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const fetchNextPage = jest.fn();
let pages: { messages: ChatMessage[]; nextBefore: number | null }[] = [];
let hasNextPage = false;
jest.mock('@/hooks/queries/useTeamChat', () => ({
  upsertMessage: (d: unknown) => d,
  useChannelFiles: () => ({ data: undefined, isLoading: false, isError: false }),
  useChatMessages: () => ({
    data: { pages, pageParams: [0] }, fetchNextPage, hasNextPage, isFetchingNextPage: false, isLoading: false, isError: false, refetch: jest.fn(),
  }),
  useMarkRead: () => ({ mutate: jest.fn() }),
  useSendMessage: () => ({ mutate: jest.fn(), mutateAsync: jest.fn() }),
  useEditMessage: () => ({ mutateAsync: jest.fn() }),
  useDeleteMessage: () => ({ mutateAsync: jest.fn() }),
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

const show = (ch: ChatChannel) => render(
  <QueryClientProvider client={new QueryClient()}>
    <Conversation channel={ch} meId="me" meName="Me" isAdmin={false} people={[]} orderHref={(id) => `/o/${id}`} onBack={() => {}} />
  </QueryClientProvider>,
);

beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });
beforeEach(() => {
  fetchNextPage.mockReset();
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
