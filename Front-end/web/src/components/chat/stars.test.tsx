/**
 * Starred messages on screen: starring from a message's ⋮ menu, the star mark,
 * the Starred list, and keeping a star when a live update replaces a message
 * (broadcasts never carry `starred`, which is private per person).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { InfiniteData } from '@tanstack/react-query';
import type { ChatChannel, ChatMessage, ChatPerson, ChatSearchHit, MessagePage } from '@/hooks/queries/useTeamChat';

const mutate = jest.fn();
let starredPages: { messages: ChatSearchHit[]; nextBefore: string | null }[] = [];
jest.mock('@/hooks/queries/useTeamChat', () => ({
  ...jest.requireActual('@/hooks/queries/useTeamChat'),
  useStarMessage: () => ({ mutate }),
  useStarred: () => ({
    data: { pages: starredPages, pageParams: [''] }, isLoading: false, isError: false, refetch: jest.fn(),
    hasNextPage: false, fetchNextPage: jest.fn(), isFetchingNextPage: false,
  }),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import MessageItem from './MessageItem';
import StarredPanel from './StarredPanel';
import { upsertMessage, upsertReply } from '@/hooks/queries/useTeamChat';

const anu: ChatPerson = { id: 'anu', name: 'Anu', role: 'staff', team: 'accounts', teamLabel: 'Accounts', isHead: true };
const base = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', channelId: 'c', seq: 3, kind: 'user', text: 'Supplier quote', deleted: false,
  sender: anu, clientId: null, attachments: [], mentions: [], mentionTeams: [], refs: [],
  createdAt: new Date().toISOString(), editableUntil: null, reactions: [], ...over,
});
const draw = (m: ChatMessage, onStar = jest.fn()) => {
  render(<MessageItem message={m} meId="me" meName="Sam" peopleById={new Map()} orderHref={(id) => `/o/${id}`} onRetry={() => {}} onStar={onStar} />);
  return onStar;
};

beforeEach(() => { mutate.mockClear(); starredPages = []; });

describe('starring from a message', () => {
  it('Star in the ⋮ menu stars it', () => {
    const onStar = draw(base({ starred: false }));
    expect(screen.queryByLabelText('Starred')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Star' }));
    expect(onStar).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }), true);
  });

  it('a starred message shows the star and offers Remove star', () => {
    const onStar = draw(base({ starred: true }));
    expect(screen.getByLabelText('Starred')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove star' }));
    expect(onStar).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }), false);
  });
});

describe('a live update keeps my star', () => {
  it('in the timeline', () => {
    const data: InfiniteData<MessagePage, number> = { pages: [{ messages: [base({ starred: true })], nextBefore: null }], pageParams: [0] };
    const next = upsertMessage(data, base({ text: 'Supplier quote (edited)' }));
    expect(next!.pages[0].messages[0]).toMatchObject({ text: 'Supplier quote (edited)', starred: true });
  });

  it('in a thread', () => {
    const next = upsertReply({ root: base({ id: 'r' }), replies: [base({ starred: true })], nextAfter: null }, base({ text: 'changed' }));
    expect(next!.replies[0]).toMatchObject({ text: 'changed', starred: true });
  });

  it('but my own fresh answer wins', () => {
    const data: InfiniteData<MessagePage, number> = { pages: [{ messages: [base({ starred: true })], nextBefore: null }], pageParams: [0] };
    expect(upsertMessage(data, base({ starred: false }))!.pages[0].messages[0].starred).toBe(false);
  });
});

describe('the Starred list', () => {
  const channels = [{ id: 'c', kind: 'space', name: 'procurement', audience: 'team' } as ChatChannel];

  it('says how to star when empty', () => {
    render(<StarredPanel channels={channels} onPick={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByText('Nothing starred yet')).toBeInTheDocument();
  });

  it('lists starred messages with their conversation; opening one goes there', () => {
    starredPages = [{ messages: [{ ...base({ starred: true }), channel: 'c', channelName: 'procurement', channelKind: 'space' }], nextBefore: null }];
    const onPick = jest.fn();
    render(<StarredPanel channels={channels} onPick={onPick} onClose={jest.fn()} />);
    expect(screen.getByText('procurement')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Supplier quote'));
    expect(onPick).toHaveBeenCalledWith('c');
  });

  it('Remove star takes it off', () => {
    starredPages = [{ messages: [{ ...base({ starred: true }), channel: 'c', channelName: 'procurement', channelKind: 'space' }], nextBefore: null }];
    render(<StarredPanel channels={channels} onPick={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove star' }));
    expect(mutate).toHaveBeenCalledWith({ id: 'm1', on: false });
  });

  it('closes on Escape', () => {
    const onClose = jest.fn();
    render(<StarredPanel channels={channels} onPick={jest.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
