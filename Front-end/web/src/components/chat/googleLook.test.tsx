/**
 * The Google Chat-style look: your own messages are light-blue cards on the
 * right (no avatar), a follow-on message shows its time when you point at it,
 * files are cards with a coloured type tag, and on wide screens a "Home" column
 * lists every conversation newest first with an Unread switch. The conversation
 * can be expanded over the lists.
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
  default: ({ channel, expanded, onToggleExpand }: { channel: ChatChannel; expanded?: boolean; onToggleExpand?: () => void }) => (
    <section aria-label={`Conversation ${channel.name}`}>
      <button type="button" onClick={onToggleExpand} aria-pressed={expanded}>Expand</button>
    </section>
  ),
}));

const channels = [
  { id: 'c1', kind: 'space', key: 'company', name: 'company', audience: 'all', unread: 0, lastMessageAt: '2026-11-02T04:00:00Z', partner: null },
  { id: 'c2', kind: 'space', key: 'team:sales', name: 'gtm', audience: 'team', unread: 2, lastMessageAt: '2026-11-02T06:00:00Z', partner: null, description: 'GTM team' },
  { id: 'c3', kind: 'dm', key: 'dm:a:b', name: 'Priya', audience: 'members', unread: 0, lastMessageAt: '2026-11-02T05:00:00Z', partner: { id: 'u2', name: 'Priya', teamLabel: 'Procurement' } },
] as unknown as ChatChannel[];
jest.mock('@/hooks/queries/useTeamChat', () => ({
  useCanChat: () => true,
  useChatChannels: () => ({ data: channels, isLoading: false, isError: false, refetch: jest.fn() }),
  useChatMe: () => ({ data: { userId: 'me', canCreateSpace: false } }),
  useChatPeople: () => ({ data: [] }),
  usePresence: () => new Set<string>(),
  countedUnread: (c: ChatChannel) => ({ chat: c.unread, updates: 0 }),
  notifyOf: () => 'all',
  liveStatus: () => null,
  useOpenDm: () => ({ mutate: jest.fn(), isPending: false }),
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
  it('wide screens (1280+) get a Home column: every conversation, newest first', () => {
    setWidth(1440);
    query = 'c=c1';
    render(<TeamChat />);
    const home = screen.getByRole('region', { name: /Home/ });
    const names = within(home).getAllByRole('button').map((b) => b.textContent);
    expect(names[0]).toMatch(/gtm/);
    expect(names[1]).toMatch(/Priya/);
    expect(names[2]).toMatch(/company/);
    // The open conversation is highlighted.
    expect(within(home).getByRole('button', { name: /company/ })).toHaveAttribute('aria-current', 'true');
  });

  it('below 1280 there is no Home column (the left list has every conversation)', () => {
    setWidth(1100);
    query = 'c=c1';
    render(<TeamChat />);
    expect(screen.queryByRole('region', { name: /Home/ })).toBeNull();
  });

  it('the Unread switch keeps only conversations with something unread (and the open one)', () => {
    setWidth(1440);
    query = 'c=c1';
    render(<TeamChat />);
    const home = screen.getByRole('region', { name: /Home/ });
    const unread = within(home).getByRole('switch', { name: /Unread/ });
    expect(unread).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(unread);
    expect(unread).toHaveAttribute('aria-checked', 'true');
    expect(within(home).queryByRole('button', { name: /Priya/ })).toBeNull();
    expect(within(home).getByRole('button', { name: /gtm/ })).toBeInTheDocument();
    expect(within(home).getByRole('button', { name: /company/ })).toBeInTheDocument();
  });

  it('Expand hides the lists on a computer; pressing it again brings them back', () => {
    setWidth(1440);
    query = 'c=c1';
    render(<TeamChat />);
    const list = screen.getByRole('complementary', { name: 'Chat channels' });
    expect(list.className).toContain('lg:flex');
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(list.className).not.toContain('lg:flex');
    expect(screen.getByRole('region', { name: /Home/ }).className).not.toContain('xl:flex');
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(list.className).toContain('lg:flex');
  });

  it('has a "New chat" button and a "Search chat" field, as in Google Chat', () => {
    render(<TeamChat />);
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search all messages' })).toHaveTextContent('Search chat');
  });
});
