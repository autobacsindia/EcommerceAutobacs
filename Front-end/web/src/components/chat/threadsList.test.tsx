/**
 * The Threads list: threads I started or replied to. Unread ones are bold with
 * "N new"; picking one opens its conversation with the thread open.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ChatChannel, ChatMessage, ChatPerson, MyThread } from '@/hooks/queries/useTeamChat';

let pages: { threads: MyThread[]; nextBefore: string | null }[] = [];
const fetchNextPage = jest.fn();
jest.mock('@/hooks/queries/useTeamChat', () => ({
  ...jest.requireActual('@/hooks/queries/useTeamChat'),
  useMyThreads: () => ({
    data: { pages, pageParams: [''] }, isLoading: false, isError: false, refetch: jest.fn(),
    hasNextPage: pages.at(-1)?.nextBefore != null, fetchNextPage, isFetchingNextPage: false,
  }),
}));

import ThreadsListPanel from './ThreadsListPanel';

const sam: ChatPerson = { id: 'sam', name: 'Sam', role: 'staff', team: 'sales', teamLabel: 'Sales', isHead: false };
const root = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'r1', channelId: 'c1', seq: 3, kind: 'user', text: 'Winch return?', deleted: false,
  sender: sam, clientId: null, attachments: [], mentions: [], mentionTeams: [], refs: [],
  createdAt: new Date().toISOString(), replyCount: 2,
  lastReply: { at: new Date().toISOString(), by: 'Anu', preview: 'Approved', mentions: [] }, ...over,
} as ChatMessage);
const row = (over: Partial<MyThread> = {}): MyThread => ({
  root: root(), channel: 'c1', channelName: 'company', channelKind: 'space', lastActivityAt: new Date().toISOString(), unread: 0, ...over,
});
const channels = [{ id: 'c1', kind: 'space', name: 'company', audience: 'all' }] as unknown as ChatChannel[];

beforeEach(() => { pages = []; fetchNextPage.mockClear(); });

describe('Threads list', () => {
  it('an unread thread is bold and says how many are new', () => {
    pages = [{ threads: [row({ unread: 2 })], nextBefore: null }];
    render(<ThreadsListPanel channels={channels} onPick={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByText('Winch return?')).toHaveClass('font-bold');
    expect(screen.getByText('2 new')).toBeInTheDocument();
    expect(screen.getByText('2 replies')).toBeInTheDocument();
    expect(screen.getByText('· last from Anu')).toBeInTheDocument();
  });

  it('a read thread is not bold and has no badge', () => {
    pages = [{ threads: [row()], nextBefore: null }];
    render(<ThreadsListPanel channels={channels} onPick={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByText('Winch return?')).not.toHaveClass('font-bold');
    expect(screen.queryByText(/new$/)).not.toBeInTheDocument();
  });

  it('picking one opens its conversation and thread', () => {
    pages = [{ threads: [row()], nextBefore: null }];
    const onPick = jest.fn();
    render(<ThreadsListPanel channels={channels} onPick={onPick} onClose={jest.fn()} />);
    fireEvent.click(screen.getByText('Winch return?'));
    expect(onPick).toHaveBeenCalledWith('c1', 'r1');
  });

  it('a deleted root shows "Message deleted", never its words', () => {
    pages = [{ threads: [row({ root: root({ deleted: true, text: '' }) })], nextBefore: null }];
    render(<ThreadsListPanel channels={channels} onPick={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByText('Message deleted')).toBeInTheDocument();
  });

  it('pages older threads, and explains an empty list', () => {
    pages = [{ threads: [row()], nextBefore: 'x' }];
    const { unmount } = render(<ThreadsListPanel channels={channels} onPick={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(fetchNextPage).toHaveBeenCalled();
    unmount();
    pages = [];
    render(<ThreadsListPanel channels={channels} onPick={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByText('No threads yet')).toBeInTheDocument();
  });
});
