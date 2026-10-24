/**
 * Phase 5 chat rules on screen: no delete on someone else's message, quoting a message, and
 * team @mentions that reach the team (including GTM, written "@gtm" but sent as
 * the stored 'sales' key — a mismatch that used to drop every GTM mention).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import MessageItem from './MessageItem';
import Composer, { mentionableTeams } from './Composer';
import type { ChatChannel, ChatMessage, ChatPerson } from '@/hooks/queries/useTeamChat';
import { STAFF_TEAMS } from '@/lib/staffTeams';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
jest.mock('@/hooks/queries/useTeamChat', () => ({ useRecentOrders: () => ({ data: [], isLoading: false }) }));

const anu: ChatPerson = { id: 'anu', name: 'Anu', role: 'staff', team: 'accounts', teamLabel: 'Accounts', isHead: true };
const msg: ChatMessage = {
  id: 'm1', channelId: 'c', seq: 3, kind: 'user', text: 'Payment for #A12 approved', deleted: false,
  sender: anu, clientId: null, attachments: [], mentions: [], mentionTeams: [], refs: [],
  createdAt: '2026-10-16T05:00:00Z',
};

const item = (m: ChatMessage, extra: Partial<React.ComponentProps<typeof MessageItem>> = {}) =>
  render(
    <MessageItem message={m} meId="me" meName="Sam" peopleById={new Map()} orderHref={(id) => `/o/${id}`} onRetry={() => {}} {...extra} />,
  );

const channel = (over: Partial<ChatChannel>): ChatChannel => ({
  id: 'c', kind: 'space', key: null, name: 'x', description: '', audience: 'all', team: null, system: true,
  partner: null, memberCount: null, lastMessageSeq: 0, lastMessageAt: null, lastReadSeq: 0, unread: 0, ...over,
});

describe('messages', () => {
  // Edit and delete are your-own-message-within-30-minutes only (chatEditDelete.test.tsx).
  it('have no delete button on someone else\'s message', () => {
    item(msg, { onOpenThread: () => {}, onQuote: () => {} });
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
  });

  it('show the team badge, and Quote in reply hands the message to the composer', () => {
    const onQuote = jest.fn();
    item(msg, { onQuote });
    expect(screen.getByText('Accounts · Head')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quote in reply' }));
    expect(onQuote).toHaveBeenCalledWith(msg);
  });

  it('show what they quote, and clicking the quote jumps to the original', () => {
    const onJumpTo = jest.fn();
    item({ ...msg, id: 'm2', text: 'Thanks!', quote: { id: 'm1', seq: 3, by: 'Anu', preview: 'Payment for #A12 approved' } }, { onJumpTo });
    fireEvent.click(screen.getByRole('button', { name: /Quoted message from Anu/ }));
    expect(onJumpTo).toHaveBeenCalledWith('m1');
  });
});

describe('which teams can be @mentioned', () => {
  it('any team in #company and team spaces; only the two teams between teams; none in DMs or custom spaces', () => {
    // Every team — derived, because this read `5` and broke the day a sixth
    // team was added. The rule is "all of them here", not "five of them".
    expect(mentionableTeams(channel({ audience: 'all' }))).toEqual([...STAFF_TEAMS]);
    expect(mentionableTeams(channel({ audience: 'teams', teams: ['accounts', 'sales'] }))).toEqual(['accounts', 'sales']);
    expect(mentionableTeams(channel({ kind: 'dm', audience: 'members' }))).toEqual([]);
    expect(mentionableTeams(channel({ audience: 'members' }))).toEqual([]);
  });
});

describe('composer', () => {
  const type = (value: string) => fireEvent.change(screen.getByRole('textbox'), { target: { value } });

  it('sends a @gtm mention as the sales team (regression: it used to be dropped)', () => {
    const onSend = jest.fn();
    render(<Composer channelName="#company" people={[]} teams={['sales', 'accounts']} onSend={onSend} />);
    type('@gt');
    fireEvent.click(screen.getByRole('button', { name: /@gtm/ }));
    type('@gtm please call the customer');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ mentionTeams: ['sales'] }));
  });

  it('shows the quote, sends its id, then clears it', () => {
    const onSend = jest.fn();
    const onClearQuote = jest.fn();
    render(<Composer channelName="#company" people={[]} teams={[]} onSend={onSend} quote={msg} onClearQuote={onClearQuote} />);
    expect(screen.getByText('Quoting Anu')).toBeInTheDocument();
    type('Thanks!');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ text: 'Thanks!', quoteId: 'm1' }));
    expect(onClearQuote).toHaveBeenCalled();
  });
});
