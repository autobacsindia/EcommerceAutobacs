/**
 * One-to-one calls in the chat UI: the call buttons in a DM header, the line a
 * call leaves in the chat, and its "Call back".
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ChatMessage, ChatPerson } from '@/hooks/queries/useTeamChat';
import type { CallApi } from './CallProvider';

let calls: Partial<CallApi> | null = null;
jest.mock('./CallProvider', () => ({ __esModule: true, useCalls: () => calls, default: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import DmCallButtons from './DmCallButtons';
import MessageItem from '@/components/chat/MessageItem';

const start = jest.fn();
const ready = (over: Partial<CallApi> = {}) => { calls = { ready: true, busy: false, start, ...over }; };
beforeEach(() => { start.mockReset(); calls = null; });

const mira: ChatPerson = { id: 'mira', name: 'Mira', role: 'staff', team: 'marketing', teamLabel: 'Marketing', isHead: false };
const line = (call: NonNullable<ChatMessage['call']>, sender: ChatPerson = mira): ChatMessage => ({
  id: 'm1', channelId: 'dm1', seq: 4, kind: 'call', text: 'Missed video call', deleted: false, sender, clientId: 'call:x',
  attachments: [], mentions: [], mentionTeams: [], refs: [], createdAt: '2026-11-14T05:00:00Z', call,
});
const item = (m: ChatMessage) => render(<MessageItem message={m} meId="me" meName="Sam" peopleById={new Map()} orderHref={(id) => `/o/${id}`} onRetry={() => {}} />);

describe('DM call buttons', () => {
  it('voice and video buttons start the right kind of call', () => {
    ready();
    render(<DmCallButtons channelId="dm1" name="Mira" />);
    fireEvent.click(screen.getByRole('button', { name: 'Voice call Mira' }));
    fireEvent.click(screen.getByRole('button', { name: 'Video call Mira' }));
    expect(start).toHaveBeenNthCalledWith(1, 'dm1', 'audio');
    expect(start).toHaveBeenNthCalledWith(2, 'dm1', 'video');
  });

  it('are disabled while already in a call', () => {
    ready({ busy: true });
    render(<DmCallButtons channelId="dm1" name="Mira" />);
    expect(screen.getByRole('button', { name: 'Video call Mira' })).toBeDisabled();
  });

  it('show nothing outside the panel (no call provider) or before we know who I am', () => {
    const { container, rerender } = render(<DmCallButtons channelId="dm1" name="Mira" />);
    expect(container).toBeEmptyDOMElement();
    calls = { ready: false };
    rerender(<DmCallButtons channelId="dm1" name="Mira" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('call lines in the chat', () => {
  it('a missed call from them is red, with Call back', () => {
    ready();
    item(line({ callId: 'c1', media: 'video', outcome: 'missed', durationSec: 0 }));
    expect(screen.getByText('Missed video call')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Call back' }));
    expect(start).toHaveBeenCalledWith('dm1', 'video');
  });

  it('a call I made that went unanswered reads "no answer"', () => {
    ready();
    item(line({ callId: 'c1', media: 'audio', outcome: 'cancelled', durationSec: 0 }, { ...mira, id: 'me', name: 'Sam' }));
    expect(screen.getByText('Voice call · no answer')).toBeInTheDocument();
  });

  it('a finished call shows how long it lasted', () => {
    ready();
    item(line({ callId: 'c1', media: 'video', outcome: 'completed', durationSec: 247 }));
    expect(screen.getByText('Video call')).toBeInTheDocument();
    expect(screen.getByText('· 4:07')).toBeInTheDocument();
  });

  it('no Call back while busy, nor outside the panel', () => {
    ready({ busy: true });
    item(line({ callId: 'c1', media: 'video', outcome: 'missed', durationSec: 0 }));
    expect(screen.queryByRole('button', { name: 'Call back' })).toBeNull();
  });
});
