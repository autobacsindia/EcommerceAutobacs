/**
 * The Google Chat-style look: your own messages are light-blue cards on the
 * right (no avatar), others' words sit in a light grey bubble, a follow-on
 * message shows its time when you point at it, and files are cards with a
 * coloured type tag. One list on the left, as Google Chat's Home: newest
 * first, each row with its newest message, never-used chats folded, with
 * Unread / Mentions / Threads / Starred buttons; automatic order updates are
 * shown quietly and never counted with people's messages. The conversation can
 * be expanded over the list.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import MessageItem, { fileBadge } from './MessageItem';
import TeamChat from './TeamChat';
import type { ChatChannel, ChatMessage, ChatPerson } from '@/hooks/queries/useTeamChat';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const replace = jest.fn();
let query = '';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/team/chat',
  useSearchParams: () => new URLSearchParams(query),
}));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn(), setQueryData: jest.fn() }) }));
jest.mock('@/hooks/useSSE', () => ({ useSSE: () => undefined }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', name: 'Sana', role: 'staff' } }) }));
jest.mock('./Conversation', () => ({
  __esModule: true,
  default: ({ channel, expanded, onToggleExpand, openThread }: { channel: ChatChannel; expanded?: boolean; onToggleExpand?: () => void; openThread?: { id: string } | null }) => (
    <section aria-label={`Conversation ${channel.name}`} data-thread={openThread?.id ?? ''}>
      <button type="button" onClick={onToggleExpand} aria-pressed={expanded}>Expand</button>
    </section>
  ),
}));

const channels = [
  { id: 'c1', kind: 'space', key: 'company', name: 'company', audience: 'all', unread: 0, lastMessageAt: '2026-11-02T04:00:00Z', partner: null },
  { id: 'c2', kind: 'space', key: 'team:sales', name: 'gtm', audience: 'team', unread: 2, lastMessageAt: '2026-11-02T06:00:00Z', partner: null, description: 'GTM team' },
  { id: 'c3', kind: 'dm', key: 'dm:a:b', name: 'Priya', audience: 'members', unread: 0, lastMessageAt: '2026-11-02T05:00:00Z', partner: { id: 'u2', name: 'Priya', teamLabel: 'Procurement' } },
  // Only automatic order updates are new here, nothing from people.
  { id: 'c4', kind: 'space', key: 'team:procurement', name: 'procurement', audience: 'team', unread: 3, unreadChat: 0, unreadUpdates: 3, lastMessageAt: '2026-11-02T03:00:00Z', partner: null },
  // A team-to-team chat nobody has written in yet.
  { id: 'c5', kind: 'space', key: 'pair:procurement:sales', name: 'GTM & Procurement', audience: 'teams', unread: 0, lastMessageSeq: 0, lastMessageAt: null, partner: null },
] as unknown as ChatChannel[];
jest.mock('@/hooks/queries/useTeamChat', () => ({
  useCanChat: () => true,
  useChatChannels: () => ({ data: channels, isLoading: false, isError: false, refetch: jest.fn() }),
  useChatMe: () => ({ data: { userId: 'me', canCreateSpace: false } }),
  useChatPeople: () => ({ data: [] }),
  usePresence: () => new Set<string>(),
  countedUnread: (c: ChatChannel) => ({ chat: c.unreadChat ?? c.unread, updates: c.unreadUpdates ?? 0 }),
  notifyOf: () => 'all',
  liveStatus: () => null,
  useOpenDm: () => ({ mutate: jest.fn(), isPending: false }),
  useMyThreads: () => ({ data: { pages: [], pageParams: [''] }, isLoading: false, isError: false, refetch: jest.fn(), hasNextPage: false, fetchNextPage: jest.fn(), isFetchingNextPage: false }),
  useMentions: () => ({ data: { pages: [], pageParams: [''] }, isLoading: false, isError: false, refetch: jest.fn(), hasNextPage: false, fetchNextPage: jest.fn(), isFetchingNextPage: false }),
}));

/** A screen this wide (min-width media queries answered from it). */
function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  window.matchMedia = jest.fn().mockImplementation((q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    return {
      matches: min ? w >= Number(min[1]) : false, media: q, onchange: null,
      addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
    };
  });
}

const me: ChatPerson = { id: 'me', name: 'Sana', role: 'staff', team: 'sales', teamLabel: 'GTM', isHead: false };
const priya: ChatPerson = { id: 'u2', name: 'Priya', role: 'staff', team: 'procurement', teamLabel: 'Procurement', isHead: true };
const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', channelId: 'c1', seq: 1, kind: 'user', text: 'Invoice attached', deleted: false,
  sender: priya, clientId: null, attachments: [], mentions: [], mentionTeams: [], refs: [],
  createdAt: '2026-11-02T05:00:00Z', ...over,
} as ChatMessage);
const show = (m: ChatMessage, previous?: ChatMessage) => render(
  <MessageItem message={m} previous={previous} meId="me" meName="Sana" peopleById={new Map()} orderHref={(id) => `/o/${id}`} onRetry={() => {}} />,
);

afterEach(() => { query = ''; replace.mockReset(); setWidth(1024); });

describe('messages', () => {
  it('your own message is a light-blue card on the right, with no avatar; screen readers still hear "You"', () => {
    const { container } = show(msg({ sender: me, text: 'Card was declined' }));
    const card = screen.getByText('Card was declined').closest('.gc-mine');
    expect(card).not.toBeNull();
    expect(card!.parentElement).toHaveClass('items-end');
    expect(screen.getByText('You')).toHaveClass('sr-only');
    expect(container.querySelector('[aria-hidden="true"].rounded-full.font-bold')).toBeNull();
  });

  it('someone else’s message keeps their avatar and name, and no card', () => {
    show(msg());
    expect(screen.getByText('Priya')).not.toHaveClass('sr-only');
    expect(screen.getByText('P')).toBeInTheDocument();
    expect(screen.getByText('Invoice attached').closest('.gc-mine')).toBeNull();
  });

  it('an automatic update is never drawn as your card', () => {
    show(msg({ kind: 'system', sender: null }));
    expect(screen.getByText('Invoice attached').closest('.gc-mine')).toBeNull();
  });

  it('a follow-on message shows its time when you point at it, and every message has its full date as a tooltip', () => {
    const first = msg({ id: 'a' });
    const second = msg({ id: 'b', text: 'Second line', createdAt: '2026-11-02T05:01:00Z' });
    show(second, first);
    const body = screen.getByText('Second line').closest('[title]')!;
    expect(body.getAttribute('title')).toMatch(/2 Nov/);
    // The hover time sits in the avatar's place, hidden until hover / focus.
    const hoverTime = body.closest('.group')!.querySelector('span.opacity-0');
    expect(hoverTime).toHaveClass('group-hover:opacity-100');
    expect(hoverTime!.textContent).toMatch(/\d/);
  });
});

describe('file cards', () => {
  it('a PDF is a card with a red PDF tag, its name and size, and opens the file', () => {
    show(msg({ attachments: [{ url: '/api/v1/chat/channels/c1/files/x.pdf', name: 'Invoice-46FSFAAH-0008.pdf', mime: 'application/pdf', size: 52_000, kind: 'file' }] } as Partial<ChatMessage>));
    const card = screen.getByTestId('file-card');
    expect(card).toHaveAttribute('href', '/api/v1/chat/channels/c1/files/x.pdf');
    expect(within(card).getByText('PDF')).toHaveClass('bg-[#d93025]');
    expect(within(card).getByText('Invoice-46FSFAAH-0008.pdf')).toBeInTheDocument();
    expect(within(card).getByText('51 KB')).toBeInTheDocument();
  });

  it.each([
    ['application/pdf', 'a.pdf', 'PDF'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'stock.xlsx', 'XLS'],
    ['text/csv', 'orders.csv', 'CSV'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'letter.docx', 'DOC'],
    ['text/plain', 'notes.txt', 'TXT'],
    ['application/octet-stream', 'noextension', 'FILE'],
  ])('%s → %s tag', (mime, name, label) => {
    expect(fileBadge(mime, name).label).toBe(label);
  });
});

describe('the chat screen', () => {
  const list = () => screen.getByRole('complementary', { name: 'Chat channels' });

  const rowNames = () => within(screen.getByRole('list', { name: 'Chats, newest first' }))
    .getAllByRole('button').map((b) => b.querySelector('.truncate')?.textContent);

  it('is one list, newest first, as Google Chat\'s Home — no sections, no "Between teams"', () => {
    setWidth(1440);
    query = 'c=c1';
    render(<TeamChat />);
    expect(screen.queryByRole('region', { name: /Home/ })).toBeNull();
    expect(screen.queryByText('Between teams')).toBeNull();
    expect(rowNames()).toEqual(['gtm', 'Priya', 'company', 'procurement']);
    // The open conversation is highlighted; a space's name drops the "#" (its round icon shows it).
    expect(within(list()).getByRole('button', { name: /^company/ })).toHaveAttribute('aria-current', 'true');
  });

  it('chats nobody has written in yet are folded at the bottom until asked for', () => {
    setWidth(1440);
    query = 'c=c1';
    render(<TeamChat />);
    expect(rowNames()).not.toContain('GTM & Procurement');
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 chat with no messages yet' }));
    expect(rowNames().at(-1)).toBe('GTM & Procurement');
    expect(within(list()).getByRole('button', { name: /^GTM & Procurement/ })).toHaveTextContent('No messages yet');
  });

  it('every row shows its newest message under the name', () => {
    setWidth(1440);
    (channels[1] as ChatChannel).lastPreview = { by: 'Ravi', mine: false, text: 'Order *4521* shipped', deleted: false };
    (channels[2] as ChatChannel).lastPreview = { by: 'Sana', mine: true, text: 'See you at 3', deleted: false };
    try {
      render(<TeamChat />);
      expect(within(list()).getByRole('button', { name: /^gtm/ })).toHaveTextContent('Ravi: Order 4521 shipped');
      expect(within(list()).getByRole('button', { name: /^Priya/ })).toHaveTextContent('You: See you at 3');
    } finally {
      delete (channels[1] as ChatChannel).lastPreview;
      delete (channels[2] as ChatChannel).lastPreview;
    }
  });

  it('people’s unread messages are bold with a blue number; automatic updates only say "3 order updates", in grey', () => {
    setWidth(1440);
    render(<TeamChat />);
    const gtm = within(list()).getByRole('button', { name: /^gtm/ });
    expect(gtm.querySelector('.truncate')).toHaveClass('font-bold');
    expect(within(gtm).getByLabelText('2 unread')).toHaveClass('bg-blue-700');
    const procurement = within(list()).getByRole('button', { name: /^procurement/ });
    expect(procurement.querySelector('.truncate')).not.toHaveClass('font-bold');
    expect(procurement).toHaveTextContent('3 order updates');
    expect(within(procurement).queryByLabelText(/unread/)).toBeNull();
  });

  it('with no chat named, a computer opens the newest chat where a person is waiting', () => {
    setWidth(1440);
    render(<TeamChat />);
    expect(replace).toHaveBeenCalledWith('/team/chat?c=c2', { scroll: false });
  });

  it('a pop-up for a thread reply opens that thread', () => {
    setWidth(1440);
    query = 'c=c2&th=root9';
    render(<TeamChat />);
    expect(screen.getByRole('region', { name: 'Conversation gtm' })).toHaveAttribute('data-thread', 'root9');
  });

  it('the Unread button counts and keeps only chats where people wrote (and the open one)', () => {
    setWidth(1440);
    query = 'c=c1';
    render(<TeamChat />);
    const unread = screen.getByRole('switch', { name: /Unread/ });
    // 2 from people in gtm; procurement's 3 order updates are not counted.
    expect(unread).toHaveTextContent('Unread · 2');
    expect(unread).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(unread);
    expect(unread).toHaveAttribute('aria-checked', 'true');
    expect(rowNames()).toEqual(['gtm', 'company']);
  });

  it('Expand hides the list on a computer; pressing it again brings it back', () => {
    setWidth(1440);
    query = 'c=c1';
    render(<TeamChat />);
    expect(list().className).toContain('lg:flex');
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(list().className).not.toContain('lg:flex');
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(list().className).toContain('lg:flex');
  });

  it('has a "New chat" button and a "Search messages" field, and no unexplained "Jump" button', () => {
    render(<TeamChat />);
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search all messages' })).toHaveTextContent('Search messages');
    expect(screen.queryByRole('button', { name: /Jump/ })).toBeNull();
  });
});

describe('left list shortcuts', () => {
  it('a Mentions button opens the Mentions list', () => {
    setWidth(1440);
    render(<TeamChat />);
    fireEvent.click(screen.getByRole('button', { name: 'Mentions' }));
    expect(screen.getByRole('dialog', { name: 'Mentions' })).toBeInTheDocument();
  });

  it('a Threads button opens the Threads list', () => {
    setWidth(1440);
    render(<TeamChat />);
    fireEvent.click(screen.getByRole('button', { name: 'Threads' }));
    expect(screen.getByRole('dialog', { name: 'Threads' })).toBeInTheDocument();
  });
});
