/**
 * Pinned messages on screen: Pin / Unpin from a message's ⋮ menu, the
 * "Pinned" mark, and the strip under the conversation header.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ChatMessage, ChatPerson } from '@/hooks/queries/useTeamChat';

let pins: ChatMessage[] = [];
const unpin = jest.fn();
jest.mock('@/hooks/queries/useTeamChat', () => ({
  ...jest.requireActual('@/hooks/queries/useTeamChat'),
  usePins: () => ({ data: pins }),
  usePinMessage: () => ({ mutate: unpin }),
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import MessageItem from './MessageItem';
import PinnedStrip from './PinnedStrip';

const anu: ChatPerson = { id: 'anu', name: 'Anu', role: 'staff', team: 'accounts', teamLabel: 'Accounts', isHead: true };
const base = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', channelId: 'c', seq: 3, kind: 'user', text: 'Supplier bank details', deleted: false,
  sender: anu, clientId: null, attachments: [], mentions: [], mentionTeams: [], refs: [],
  createdAt: '2026-10-27T05:00:00Z', ...over,
});
const item = (m: ChatMessage, onPin = jest.fn()) => {
  render(<MessageItem message={m} meId="me" meName="Sam" peopleById={new Map()} orderHref={(id) => `/o/${id}`} onRetry={() => {}} onPin={onPin} />);
  return onPin;
};

beforeEach(() => { pins = []; unpin.mockClear(); });

describe('pinning from a message', () => {
  it('Pin to the top', () => {
    const onPin = item(base());
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin to the top' }));
    expect(onPin).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }), true);
  });

  it('a pinned message says so, and offers Unpin', () => {
    const onPin = item(base({ pinned: { by: 'Pavan', at: '2026-10-27T06:00:00Z' } }));
    expect(screen.getByTitle('Pinned by Pavan')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin' }));
    expect(onPin).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }), false);
  });
});

describe('the Pinned strip', () => {
  it('shows nothing when nothing is pinned', () => {
    const { container } = render(<PinnedStrip channelId="c" onJump={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the newest pin and the count; opens to all, jumps, unpins', () => {
    pins = [
      base({ id: 'p2', text: 'Delivery address changed', pinned: { by: 'Ravi', at: '2026-10-27T07:00:00Z' } }),
      base({ id: 'p1', text: 'Supplier bank details', threadRoot: 'root1', pinned: { by: 'Pavan', at: '2026-10-27T06:00:00Z' } }),
    ];
    const onJump = jest.fn();
    render(<PinnedStrip channelId="c" onJump={onJump} />);
    expect(screen.getByText('2 pinned')).toBeInTheDocument();
    expect(screen.getByText(/Delivery address changed/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('list', { name: 'Pinned messages' })).toBeInTheDocument();
    expect(screen.getByText(/pinned by Pavan/)).toBeInTheDocument();

    // A pinned thread reply jumps to its thread's message in the conversation.
    fireEvent.click(screen.getByText('Supplier bank details'));
    expect(onJump).toHaveBeenCalledWith('root1');

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Unpin' })[0]);
    expect(unpin).toHaveBeenCalledWith({ id: 'p2', on: false });
  });
});
