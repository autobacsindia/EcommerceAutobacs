/**
 * The Mentions list: messages that @mention me, my team or @all. Picking one
 * opens its conversation — and its thread when it was a reply.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ChatChannel, ChatPerson, ChatSearchHit } from '@/hooks/queries/useTeamChat';

let pages: { messages: ChatSearchHit[]; nextBefore: string | null }[] = [];
const fetchNextPage = jest.fn();
let state = { isLoading: false, isError: false };
jest.mock('@/hooks/queries/useTeamChat', () => ({
  ...jest.requireActual('@/hooks/queries/useTeamChat'),
  useMentions: () => ({
    data: { pages, pageParams: [''] }, ...state, refetch: jest.fn(),
    hasNextPage: pages.at(-1)?.nextBefore != null, fetchNextPage, isFetchingNextPage: false,
  }),
}));

import MentionsPanel from './MentionsPanel';

const ravi: ChatPerson = { id: 'ravi', name: 'Ravi', role: 'staff', team: 'sales', teamLabel: 'Sales', isHead: false };
const hit = (over: Partial<ChatSearchHit> = {}): ChatSearchHit => ({
  id: 'm1', channelId: 'c1', seq: 3, kind: 'user', text: '@Sana please check invoice 88', deleted: false,
  sender: ravi, clientId: null, attachments: [], mentions: ['me'], mentionTeams: [], refs: [],
  createdAt: new Date().toISOString(), channel: 'c1', channelName: 'company', channelKind: 'space', ...over,
} as ChatSearchHit);
const channels = [{ id: 'c1', kind: 'space', name: 'company', audience: 'all' }] as unknown as ChatChannel[];

beforeEach(() => { pages = []; state = { isLoading: false, isError: false }; fetchNextPage.mockClear(); });

describe('Mentions list', () => {
  it('shows who mentioned me, where, and the words', () => {
    pages = [{ messages: [hit()], nextBefore: null }];
    render(<MentionsPanel channels={channels} onPick={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Mentions' })).toBeInTheDocument();
    expect(screen.getByText('@Sana please check invoice 88')).toBeInTheDocument();
    expect(screen.getByText('Ravi')).toBeInTheDocument();
    expect(screen.getByText('company')).toBeInTheDocument();
  });

  it('picking a plain message opens its conversation', () => {
    pages = [{ messages: [hit()], nextBefore: null }];
    const onPick = jest.fn();
    render(<MentionsPanel channels={channels} onPick={onPick} onClose={jest.fn()} />);
    fireEvent.click(screen.getByText('@Sana please check invoice 88'));
    expect(onPick).toHaveBeenCalledWith('c1', null);
  });

  it('picking a thread reply opens its thread too, and says it is in a thread', () => {
    pages = [{ messages: [hit({ id: 'm2', threadRoot: 'root1', text: '@sales approved' })], nextBefore: null }];
    const onPick = jest.fn();
    render(<MentionsPanel channels={channels} onPick={onPick} onClose={jest.fn()} />);
    expect(screen.getByText('· in a thread')).toBeInTheDocument();
    fireEvent.click(screen.getByText('@sales approved'));
    expect(onPick).toHaveBeenCalledWith('c1', 'root1');
  });

  it('pages older mentions on request', () => {
    pages = [{ messages: [hit()], nextBefore: 'm1' }];
    render(<MentionsPanel channels={channels} onPick={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it('empty: says how mentions work', () => {
    render(<MentionsPanel channels={channels} onPick={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByText('No mentions yet')).toBeInTheDocument();
  });

  it('an error offers Try again', () => {
    state = { isLoading: false, isError: true };
    render(<MentionsPanel channels={channels} onPick={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('Escape closes it', () => {
    const onClose = jest.fn();
    render(<MentionsPanel channels={channels} onPick={jest.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
