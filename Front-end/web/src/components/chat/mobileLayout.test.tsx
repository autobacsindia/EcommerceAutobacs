/**
 * Chat on phones and tablets: one pane at a time below 1024 px (start on the
 * list, a conversation replaces it, side by side from 1024 up), a message's
 * action bar opened by a tap on a touch screen — only the message tapped, never
 * every message at once — and the chat box sized to the visible screen.
 */
import { useRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MessageItem from './MessageItem';
import TeamChat from './TeamChat';
import { useFitToViewport } from './useFitToViewport';
import type { ChatChannel, ChatMessage } from '@/hooks/queries/useTeamChat';

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
  default: ({ channel, onBack }: { channel: ChatChannel; onBack: () => void }) => (
    <section aria-label={`Conversation ${channel.name}`}><button type="button" onClick={onBack}>Back to channels</button></section>
  ),
}));

const channels = [
  { id: 'c1', kind: 'space', key: 'company', name: 'company', audience: 'all', unread: 0, lastMessageAt: null, partner: null },
  { id: 'c2', kind: 'space', key: 'team:sales', name: 'gtm', audience: 'team', unread: 0, lastMessageAt: null, partner: null },
] as unknown as ChatChannel[];
jest.mock('@/hooks/queries/useTeamChat', () => ({
  useCanChat: () => true,
  useChatChannels: () => ({ data: channels, isLoading: false, isError: false, refetch: jest.fn() }),
  useChatMe: () => ({ data: { userId: 'me', canCreateSpace: false } }),
  useChatPeople: () => ({ data: [] }),
  usePresence: () => new Set<string>(),
  countedUnread: () => ({ chat: 0, updates: 0 }),
  notifyOf: () => 'all',
  liveStatus: () => null,
}));

/** Pretend to be a phone (coarse pointer) or a computer with a mouse. */
function setPointer(coarse: boolean) {
  window.matchMedia = jest.fn().mockImplementation((q: string) => ({
    matches: coarse && q.includes('coarse'), media: q, onchange: null,
    addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  }));
}
const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });

const message: ChatMessage = {
  id: 'm1', channelId: 'c1', seq: 1, kind: 'user', text: 'Stock arrives Monday — see https://example.com/eta', deleted: false,
  sender: { id: 'u2', name: 'Priya', role: 'staff', team: 'procurement', teamLabel: 'Procurement', isHead: true },
  clientId: null, attachments: [], mentions: [], mentionTeams: [], refs: [], createdAt: '2026-10-28T05:00:00Z',
} as unknown as ChatMessage;

const showMessage = (onOpenThread = jest.fn()) => render(
  <MessageItem
    message={message}
    meId="me"
    meName="Sana"
    peopleById={new Map()}
    orderHref={(id) => `/team/orders/${id}`}
    onRetry={() => {}}
    onOpenThread={onOpenThread}
    onReact={() => {}}
    onQuote={() => {}}
  />,
);
const bar = () => screen.getByTestId('message-actions');
const isOpen = () => bar().classList.contains('flex') && !bar().classList.contains('hidden');

afterEach(() => {
  setWidth(1024);
  query = '';
  replace.mockReset();
});

describe('message actions on a touch screen', () => {
  beforeEach(() => setPointer(true));

  it('stay hidden until the message is tapped, and close on a tap elsewhere', () => {
    showMessage();
    expect(isOpen()).toBe(false);

    fireEvent.click(screen.getByText(/Stock arrives Monday/));
    expect(isOpen()).toBe(true);

    fireEvent.mouseDown(document.body);
    expect(isOpen()).toBe(false);
  });

  it('a second tap on the same message closes them again', () => {
    showMessage();
    fireEvent.click(screen.getByText(/Stock arrives Monday/));
    fireEvent.click(screen.getByText(/Stock arrives Monday/));
    expect(isOpen()).toBe(false);
  });

  it('a link inside the message opens the link, not the bar', () => {
    showMessage();
    fireEvent.click(screen.getByRole('link', { name: /example\.com/ }));
    expect(isOpen()).toBe(false);
  });

  it('picking an action does it and closes the bar', () => {
    const open = jest.fn();
    showMessage(open);
    fireEvent.click(screen.getByText(/Stock arrives Monday/));
    fireEvent.click(screen.getByRole('button', { name: 'Reply in thread' }));
    expect(open).toHaveBeenCalledWith(message);
    expect(isOpen()).toBe(false);
  });
});

describe('message actions with a mouse', () => {
  it('a click does not pin the bar open (hover shows it)', () => {
    setPointer(false);
    showMessage();
    fireEvent.click(screen.getByText(/Stock arrives Monday/));
    expect(isOpen()).toBe(false);
  });
});

describe('one pane at a time below 1024 px', () => {
  beforeEach(() => setPointer(true));
  const list = () => screen.getByRole('complementary', { name: 'Chat channels' });

  it('a phone starts on the list — no conversation is opened for it', () => {
    setWidth(390);
    render(<TeamChat />);
    expect(list()).not.toHaveClass('hidden');
    expect(replace).not.toHaveBeenCalled();
  });

  it('a tablet starts on the list too', () => {
    setWidth(768);
    render(<TeamChat />);
    expect(replace).not.toHaveBeenCalled();
  });

  it('picking a conversation opens it; the list hides until "back"', () => {
    setWidth(390);
    const { rerender } = render(<TeamChat />);
    fireEvent.click(screen.getByRole('button', { name: /#gtm/ }));
    expect(replace).toHaveBeenLastCalledWith('/team/chat?c=c2', { scroll: false });

    query = 'c=c2';
    rerender(<TeamChat />);
    expect(screen.getByRole('region', { name: 'Conversation gtm' })).toBeInTheDocument();
    // Hidden on a small screen, shown beside the conversation from lg up.
    expect(list()).toHaveClass('hidden', 'lg:flex');

    fireEvent.click(screen.getByRole('button', { name: 'Back to channels' }));
    expect(replace).toHaveBeenLastCalledWith('/team/chat', { scroll: false });
  });

  it('a wide screen opens the first conversation beside the list', () => {
    setWidth(1280);
    render(<TeamChat />);
    expect(replace).toHaveBeenCalledWith('/team/chat?c=c1', { scroll: false });
  });
});

describe('the chat box fits the visible screen', () => {
  function Box() {
    const ref = useRef<HTMLDivElement>(null);
    useFitToViewport(ref);
    return <div ref={ref} data-testid="box" />;
  }
  const placeAt = (top: number) => {
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) });
  };
  afterEach(() => jest.restoreAllMocks());

  it('ends at the bottom of the screen below 1024 px, whatever sits above it', async () => {
    setWidth(390);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    placeAt(230); // the panel bar plus the "pop-ups are blocked" banner
    render(<Box />);
    await waitFor(() => expect(screen.getByTestId('box').style.height).toBe('570px'));
  });

  it('follows the screen when it shrinks (the keyboard opening)', async () => {
    setWidth(390);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    placeAt(72);
    render(<Box />);
    await waitFor(() => expect(screen.getByTestId('box').style.height).toBe('728px'));
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 });
    act(() => { window.dispatchEvent(new Event('resize')); });
    await waitFor(() => expect(screen.getByTestId('box').style.height).toBe('428px'));
  });

  it('leaves the height to the stylesheet from 1024 px up', async () => {
    setWidth(1280);
    placeAt(72);
    render(<Box />);
    await new Promise((r) => setTimeout(r, 40));
    expect(screen.getByTestId('box').style.height).toBe('');
  });
});
