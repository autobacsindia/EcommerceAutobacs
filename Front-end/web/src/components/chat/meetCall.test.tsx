/**
 * The Google Meet "📞 Call" button and the "Join call" card.
 * Calls happen in Meet; chat only carries a link — and only ever a real
 * meet.google.com meeting link (the API refuses anything else too).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChatChannel, ChatMessage, ChatPerson } from '@/hooks/queries/useTeamChat';

const saveMeet = jest.fn();
jest.mock('@/hooks/queries/useTeamChat', () => ({
  ...jest.requireActual('@/hooks/queries/useTeamChat'),
  useSetMeet: () => ({ mutateAsync: saveMeet, isPending: false, isError: false }),
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import CallButton, { NEW_MEET } from './CallButton';
import MessageItem from './MessageItem';

const MEET = 'https://meet.google.com/abc-defg-hij';
const channel = (over: Partial<ChatChannel> = {}): ChatChannel => ({
  id: 'c', kind: 'space', key: 'team:sales', name: 'sales', description: '', audience: 'team', team: 'sales', system: true,
  partner: null, memberCount: null, lastMessageSeq: 0, lastMessageAt: null, lastReadSeq: 0, unread: 0, ...over,
});

let opened: string[] = [];
beforeEach(() => {
  saveMeet.mockReset().mockResolvedValue({});
  opened = [];
  window.open = jest.fn((url?: string | URL) => { opened.push(String(url)); return null; }) as unknown as typeof window.open;
});

describe('📞 Call', () => {
  it('with a saved link: opens it and posts it in one tap', () => {
    const onShare = jest.fn();
    render(<CallButton channel={channel({ meetUrl: MEET })} onShare={onShare} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start a call (Google Meet)' }));
    expect(opened).toEqual([MEET]);
    expect(onShare).toHaveBeenCalledWith(`📞 Started a call — join here: ${MEET}`);
  });

  it('without one: start a new Meet, paste its link, share it — and keep it where allowed', async () => {
    const onShare = jest.fn();
    render(<CallButton channel={channel({ canSetMeet: true })} onShare={onShare} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start a call (Google Meet)' }));
    fireEvent.click(screen.getByRole('button', { name: 'New Google Meet' }));
    expect(opened).toEqual([NEW_MEET]);

    const share = screen.getByRole('button', { name: 'Share in chat' });
    expect(share).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Meet link' }), { target: { value: 'https://zoom.us/j/1' } });
    expect(screen.getByRole('alert')).toHaveTextContent('isn’t a Google Meet link');
    expect(share).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Meet link' }), { target: { value: ` ${MEET} ` } });
    fireEvent.click(share);
    await waitFor(() => expect(onShare).toHaveBeenCalledWith(`📞 Started a call — join here: ${MEET}`));
    expect(saveMeet).toHaveBeenCalledWith({ channelId: 'c', url: MEET });
  });

  it('someone who cannot set the link can still share one, without saving it', async () => {
    const onShare = jest.fn();
    render(<CallButton channel={channel({ canSetMeet: false })} onShare={onShare} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start a call (Google Meet)' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Meet link' }), { target: { value: MEET } });
    fireEvent.click(screen.getByRole('button', { name: 'Share in chat' }));
    await waitFor(() => expect(onShare).toHaveBeenCalled());
    expect(saveMeet).not.toHaveBeenCalled();
  });

  it('whoever may, can remove a saved link', async () => {
    render(<CallButton channel={channel({ meetUrl: MEET, canSetMeet: true })} onShare={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Call link settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove saved link' }));
    await waitFor(() => expect(saveMeet).toHaveBeenCalledWith({ channelId: 'c', url: null }));
  });
});

describe('a message with a Meet link', () => {
  const anu: ChatPerson = { id: 'anu', name: 'Anu', role: 'staff', team: 'accounts', teamLabel: 'Accounts', isHead: true };
  const msg = (text: string): ChatMessage => ({
    id: 'm1', channelId: 'c', seq: 3, kind: 'user', text, deleted: false, sender: anu, clientId: null,
    attachments: [], mentions: [], mentionTeams: [], refs: [], createdAt: '2026-10-28T05:00:00Z',
  });
  const item = (m: ChatMessage) => render(<MessageItem message={m} meId="me" meName="Sam" peopleById={new Map()} orderHref={(id) => `/o/${id}`} onRetry={() => {}} />);

  it('shows a Join call card', () => {
    item(msg(`📞 Started a call — join here: ${MEET}`));
    const card = screen.getByText('Google Meet call').closest('a')!;
    expect(card).toHaveAttribute('href', MEET);
    expect(card).toHaveTextContent('Tap to join');
  });

  it('a look-alike address gets no card', () => {
    item(msg('join https://meet.google.com.evil.example/abc-defg-hij'));
    expect(screen.queryByText('Google Meet call')).not.toBeInTheDocument();
  });
});
