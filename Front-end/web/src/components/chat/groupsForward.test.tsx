/**
 * Group conversations, @all and Forward, on screen.
 *
 * The API enforces every rule (who may @all in #company, who can be in a
 * group, where a message may be forwarded). The screen's part: offer them
 * only where they make sense, send what the person meant, and show a forward
 * as a forward — without ever saying where it came from.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChatChannel, ChatMessage, ChatPerson } from '@/hooks/queries/useTeamChat';

const forwardMutate = jest.fn();
const openMutate = jest.fn();
let channels: ChatChannel[] = [];
const people: ChatPerson[] = [
  { id: 'me', name: 'Sam', role: 'staff', team: 'sales', teamLabel: 'GTM', isHead: false },
  { id: 'anu', name: 'Anu', role: 'staff', team: 'accounts', teamLabel: 'Accounts', isHead: true },
  { id: 'ravi', name: 'Ravi', role: 'staff', team: 'operations', teamLabel: 'Operations', isHead: false },
];
jest.mock('@/hooks/queries/useTeamChat', () => ({
  ...jest.requireActual('@/hooks/queries/useTeamChat'),
  useRecentOrders: () => ({ data: [], isLoading: false }),
  useChatChannels: () => ({ data: channels }),
  useChatPeople: () => ({ data: people }),
  useForwardMessage: () => ({ mutateAsync: forwardMutate, isPending: false, isError: false }),
  useOpenDm: () => ({ mutateAsync: openMutate, isPending: false, isError: false }),
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }), usePathname: () => '/team/chat', useSearchParams: () => new URLSearchParams() }));
jest.mock('@/hooks/useSSE', () => ({ useSSE: () => {} }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

import Composer from './Composer';
import MessageItem from './MessageItem';
import ForwardDialog from './ForwardDialog';
import { NewMessageDialog } from './TeamChat';

const anu = people[1];
const base = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', channelId: 'c', seq: 3, kind: 'user', text: 'Customer wants Friday', deleted: false,
  sender: anu, clientId: null, attachments: [], mentions: [], mentionTeams: [], refs: [],
  createdAt: '2026-10-27T05:00:00Z', ...over,
});
const space = (over: Partial<ChatChannel>): ChatChannel => ({
  id: 'x', kind: 'space', key: null, name: 'x', description: '', audience: 'members', team: null, system: false,
  partner: null, memberCount: null, lastMessageSeq: 0, lastMessageAt: null, lastReadSeq: 0, unread: 0, ...over,
});

beforeEach(() => { forwardMutate.mockReset(); openMutate.mockReset(); channels = []; });

describe('@all in the message box', () => {
  const type = (value: string) => fireEvent.change(screen.getByRole('textbox'), { target: { value } });

  it('is offered where allowed, and sends mentionAll', () => {
    const onSend = jest.fn();
    render(<Composer channelName="#team" people={[]} teams={[]} onSend={onSend} canMentionAll />);
    type('@al');
    fireEvent.click(screen.getByRole('button', { name: /@all/ }));
    type('@all meeting at 4');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ mentionAll: true }));
  });

  it('is not offered, and not sent, where it is not allowed', () => {
    const onSend = jest.fn();
    render(<Composer channelName="#company" people={[]} teams={[]} onSend={onSend} />);
    type('@al');
    expect(screen.queryByRole('button', { name: /@all/ })).not.toBeInTheDocument();
    type('@all hello');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend.mock.calls[0][0].mentionAll).toBeUndefined();
  });

  it('"@allison" is not @all', () => {
    const onSend = jest.fn();
    render(<Composer channelName="#team" people={[]} teams={[]} onSend={onSend} canMentionAll />);
    type('cc @allison');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend.mock.calls[0][0].mentionAll).toBeUndefined();
  });
});

describe('a message', () => {
  const item = (m: ChatMessage, extra = {}) => render(
    <MessageItem message={m} meId="me" meName="Sam" peopleById={new Map(people.map((p) => [p.id, p]))}
      orderHref={(id) => `/o/${id}`} onRetry={() => {}} {...extra} />,
  );

  it('that @all-s is highlighted for everyone but its author', () => {
    const { container, unmount } = item(base({ text: '@all please check', mentionAll: true }));
    expect(container.querySelector('.ring-amber-200')).not.toBeNull();
    unmount();
    const mine = item(base({ text: '@all please check', mentionAll: true, sender: people[0] }));
    expect(mine.container.querySelector('.ring-amber-200')).toBeNull();
  });

  it('highlights "@all" as a word only — not the start of "@allison"', () => {
    item(base({ text: 'cc @allison and @all', mentionAll: true }));
    const marks = Array.from(document.querySelectorAll('span.font-semibold')).map((e) => e.textContent);
    expect(marks).toContain('@all');
    expect(marks).not.toContain('@allison');
  });

  it('that was forwarded says from whom — and nothing about where', () => {
    item(base({ forwarded: { by: 'Sana', at: '2026-10-20T05:00:00Z' } }));
    expect(screen.getByText(/Forwarded · originally from/)).toHaveTextContent('Sana');
  });

  it('can be forwarded from the ⋮ menu', () => {
    const onForward = jest.fn();
    item(base(), { onForward });
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Forward' }));
    expect(onForward).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
  });
});

describe('the Forward dialog', () => {
  it('lists my conversations and forwards into the one picked', async () => {
    channels = [space({ id: 'g', name: 'winch-project' }), space({ id: 'd', kind: 'dm', name: 'Ravi' })];
    forwardMutate.mockResolvedValue({ message: base() });
    const onDone = jest.fn();
    render(<ForwardDialog message={base()} onClose={jest.fn()} onDone={onDone} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a conversation' }), { target: { value: 'rav' } });
    expect(screen.queryByText('#winch-project')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Ravi'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: 'd' })));
    expect(forwardMutate).toHaveBeenCalledWith({ id: 'm1', channelId: 'd', clientId: expect.any(String) });
  });

  it('a second try sends the same clientId — one forward, not two', async () => {
    channels = [space({ id: 'g', name: 'winch-project' })];
    forwardMutate.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ message: base() });
    render(<ForwardDialog message={base()} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.click(screen.getByText('#winch-project'));
    await waitFor(() => expect(forwardMutate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('#winch-project'));
    await waitFor(() => expect(forwardMutate).toHaveBeenCalledTimes(2));
    expect(forwardMutate.mock.calls[0][0].clientId).toBe(forwardMutate.mock.calls[1][0].clientId);
  });
});

describe('New chat', () => {
  it('one person opens a direct message; several open a group', async () => {
    openMutate.mockResolvedValue({ channel: { id: 'new' } });
    const onOpened = jest.fn();
    render(<NewMessageDialog meId="me" onClose={jest.fn()} onOpened={onOpened} />);
    expect(screen.queryByRole('button', { name: /Sam/ })).not.toBeInTheDocument(); // not myself
    fireEvent.click(screen.getByRole('button', { name: /Anu/ }));
    expect(screen.getByRole('button', { name: 'Start chat' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Ravi/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start group (3)' }));
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith('new'));
    expect(openMutate).toHaveBeenCalledWith(['anu', 'ravi']);
  });

  it('nothing picked: nothing to start', () => {
    render(<NewMessageDialog meId="me" onClose={jest.fn()} onOpened={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Start chat' })).toBeDisabled();
  });
});
