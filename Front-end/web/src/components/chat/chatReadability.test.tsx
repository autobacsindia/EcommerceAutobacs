/**
 * Easier to follow: day lines are pills (pinned to the top in the list), and a
 * change of speaker gets more room than a follow-on from the same person.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import MessageItem, { DaySeparator, startsNewDay } from './MessageItem';
import type { ChatMessage, ChatPerson } from '@/hooks/queries/useTeamChat';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const priya: ChatPerson = { id: 'u2', name: 'Priya', role: 'staff', team: 'procurement', teamLabel: 'Procurement', isHead: true };
const ravi: ChatPerson = { id: 'u3', name: 'Ravi', role: 'staff', team: 'sales', teamLabel: 'GTM', isHead: false };
const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', channelId: 'c1', seq: 1, kind: 'user', text: 'Payment proof', deleted: false,
  sender: priya, clientId: null, attachments: [], mentions: [], mentionTeams: [], refs: [],
  createdAt: '2026-11-02T05:00:00Z', ...over,
} as ChatMessage);
const photo = (n: number) => ({ url: `https://files.test/p${n}.png`, kind: 'image' as const, name: `shot ${n}.png`, mime: 'image/png', size: 2048 });
const show = (m: ChatMessage, previous?: ChatMessage, extra: { showDay?: boolean } = {}) => render(
  <MessageItem message={m} previous={previous} meId="me" meName="Sana" peopleById={new Map()} orderHref={(id) => `/o/${id}`} onRetry={() => {}} {...extra} />,
);

describe('readability', () => {
  it('the first message of a day gets a day pill', () => {
    show(msg());
    expect(screen.getByRole('separator', { name: /2 Nov/ })).toBeInTheDocument();
  });

  it('no day pill from the message when the list draws it', () => {
    show(msg(), undefined, { showDay: false });
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('a new day is counted by activity, and the pinned pill can stick', () => {
    const a = msg({ createdAt: '2026-11-01T05:00:00Z' });
    const b = msg({ id: 'm2', createdAt: '2026-11-02T05:00:00Z' });
    expect(startsNewDay(a)).toBe(true);
    expect(startsNewDay(b, a)).toBe(true);
    expect(startsNewDay(b, b)).toBe(false);
    render(<DaySeparator m={b} sticky />);
    expect(screen.getByRole('separator').className).toContain('sticky');
  });

  it('a change of speaker gets more room than a follow-on from the same person', () => {
    const first = msg();
    const { container, unmount } = show(msg({ id: 'm2', createdAt: '2026-11-02T05:01:00Z' }), first);
    expect(container.querySelector('.group')!.className).toContain('py-0.5');
    unmount();
    const other = show(msg({ id: 'm3', sender: ravi, createdAt: '2026-11-02T05:02:00Z' }), first);
    expect(other.container.querySelector('.group')!.className).toContain('mt-3');
    expect(screen.getByText('Ravi').className).toContain('text-sm');
  });
});
