/**
 * Team chat layout on computers:
 * - ☰ folds the left sections to an icon strip (remembered per person; never on phones);
 * - the line between the Home list and the chat is dragged (or moved with the
 *   keyboard) to resize the list, double-click resets, dragging far left or
 *   Enter hides the lists; the width is remembered per person.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import TeamChat from './TeamChat';
import {
  LIST_DEFAULT, LIST_MAX, LIST_MIN, clampListWidth, dragHidesList, readListWidth, readRail,
  saveListWidth, saveRail, widthForKey, widthKey, railKey,
} from './chatLayout';
import type { ChatChannel } from '@/hooks/queries/useTeamChat';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
let query = '';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => '/team/chat',
  useSearchParams: () => new URLSearchParams(query),
}));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn(), setQueryData: jest.fn() }) }));
jest.mock('@/hooks/useSSE', () => ({ useSSE: () => undefined }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', name: 'Sana', role: 'staff' } }) }));
jest.mock('./Conversation', () => ({
  __esModule: true,
  default: ({ channel }: { channel: ChatChannel }) => <section aria-label={`Conversation ${channel.name}`} />,
}));
const channels = [
  { id: 'c1', kind: 'space', key: 'company', name: 'company', audience: 'all', unread: 0, lastMessageAt: '2026-11-02T04:00:00Z', partner: null },
  { id: 'c2', kind: 'space', key: 'team:sales', name: 'gtm', audience: 'team', unread: 2, lastMessageAt: '2026-11-02T06:00:00Z', partner: null },
] as unknown as ChatChannel[];
jest.mock('@/hooks/queries/useTeamChat', () => ({
  useCanChat: () => true,
  useChatChannels: () => ({ data: channels, isLoading: false, isError: false, refetch: jest.fn() }),
  useChatMe: () => ({ data: { userId: 'me', canCreateSpace: false } }),
  useChatPeople: () => ({ data: [] }),
  usePresence: () => new Set<string>(),
  countedUnread: (c: ChatChannel) => ({ chat: c.unread, updates: 0 }),
  notifyOf: () => 'all',
  liveStatus: () => null,
  useOpenDm: () => ({ mutate: jest.fn(), isPending: false }),
}));

function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  window.matchMedia = jest.fn().mockImplementation((q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    return {
      matches: min ? w >= Number(min[1]) : false, media: q, onchange: null,
      addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
    };
  });
}
// jsdom has no PointerEvent; a MouseEvent carries clientX the same way.
if (!('PointerEvent' in window)) (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;

beforeEach(() => { localStorage.clear(); query = ''; });

describe('list width maths', () => {
  it('keeps widths inside the limits and turns junk into the default', () => {
    expect(clampListWidth(100)).toBe(LIST_MIN);
    expect(clampListWidth(9999)).toBe(LIST_MAX);
    expect(clampListWidth(400.4)).toBe(400);
    expect(clampListWidth(NaN)).toBe(LIST_DEFAULT);
  });

  it('arrow keys step 16px (48 with Shift), Home/End jump to the ends, other keys are ignored', () => {
    expect(widthForKey(340, 'ArrowRight')).toBe(356);
    expect(widthForKey(340, 'ArrowLeft', true)).toBe(292);
    expect(widthForKey(LIST_MIN, 'ArrowLeft')).toBe(LIST_MIN);
    expect(widthForKey(340, 'Home')).toBe(LIST_MIN);
    expect(widthForKey(340, 'End')).toBe(LIST_MAX);
    expect(widthForKey(340, 'a')).toBeNull();
  });

  it('only a drag well past the narrowest width hides the lists', () => {
    expect(dragHidesList(LIST_MIN - 10)).toBe(false);
    expect(dragHidesList(LIST_MIN - 81)).toBe(true);
  });

  it('remembers per person, ignores bad saved values, and survives blocked storage', () => {
    saveListWidth('me', 420);
    expect(readListWidth('me')).toBe(420);
    expect(readListWidth('someone-else')).toBe(LIST_DEFAULT);
    localStorage.setItem(widthKey('me'), 'banana');
    expect(readListWidth('me')).toBe(LIST_DEFAULT);
    saveListWidth('me', LIST_DEFAULT);
    expect(localStorage.getItem(widthKey('me'))).toBeNull();
    saveRail('me', true);
    expect(readRail('me')).toBe(true);
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readListWidth('me')).toBe(LIST_DEFAULT);
    expect(readRail('me')).toBe(false);
    expect(() => { saveListWidth('me', 300); saveRail('me', true); }).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('resizing the chat list', () => {
  const handle = () => screen.getByRole('separator', { name: 'Resize the chat list' });
  const home = () => screen.getByRole('region', { name: 'Home' });
  const listW = () => home().style.getPropertyValue('--gc-list-w');

  it('starts at the default width and announces its limits', () => {
    setWidth(1440);
    query = 'c=c1';
    render(<TeamChat />);
    expect(handle()).toHaveAttribute('aria-valuenow', String(LIST_DEFAULT));
    expect(handle()).toHaveAttribute('aria-valuemin', String(LIST_MIN));
    expect(handle()).toHaveAttribute('aria-valuemax', String(LIST_MAX));
    expect(handle()).toHaveAttribute('tabindex', '0');
    expect(listW()).toBe(`${LIST_DEFAULT}px`);
  });

  it('dragging widens the list and saves the width', () => {
    setWidth(1440);
    query = 'c=c1';
    render(<TeamChat />);
    fireEvent.pointerDown(handle(), { clientX: 500, button: 0 });
    fireEvent.pointerMove(handle(), { clientX: 600 });
    expect(listW()).toBe('440px');
    expect(localStorage.getItem(widthKey('me'))).toBeNull(); // not saved mid-drag
    fireEvent.pointerUp(handle(), { clientX: 600 });
    expect(localStorage.getItem(widthKey('me'))).toBe('440');
  });

  it('dragging past the widest stops at the widest', () => {
    setWidth(1440);
    query = 'c=c1';
    render(<TeamChat />);
    fireEvent.pointerDown(handle(), { clientX: 500, button: 0 });
    fireEvent.pointerMove(handle(), { clientX: 1400 });
    fireEvent.pointerUp(handle(), { clientX: 1400 });
    expect(listW()).toBe(`${LIST_MAX}px`);
  });

  it('dragging far to the left hides the lists, keeping the old width for later', () => {
    setWidth(1440);
    query = 'c=c1';
    render(<TeamChat />);
    fireEvent.pointerDown(handle(), { clientX: 500, button: 0 });
    fireEvent.pointerMove(handle(), { clientX: 200 });
    fireEvent.pointerUp(handle(), { clientX: 200 });
    expect(home()).toHaveAttribute('data-collapsed', 'true');
    expect(localStorage.getItem('roavion-chat-wide:me')).toBe('1');
    expect(localStorage.getItem(widthKey('me'))).toBeNull(); // still the default
    // The lists come back with the button.
    fireEvent.click(screen.getByRole('button', { name: 'Show the chat list' }));
    expect(home()).not.toHaveAttribute('data-collapsed');
  });

  it('keyboard: arrows resize, Enter hides the lists; double-click resets', () => {
    setWidth(1440);
    query = 'c=c1';
    render(<TeamChat />);
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(handle()).toHaveAttribute('aria-valuenow', '356');
    expect(localStorage.getItem(widthKey('me'))).toBe('356');
    fireEvent.keyDown(handle(), { key: 'End' });
    expect(handle()).toHaveAttribute('aria-valuenow', String(LIST_MAX));
    fireEvent.doubleClick(handle());
    expect(handle()).toHaveAttribute('aria-valuenow', String(LIST_DEFAULT));
    expect(localStorage.getItem(widthKey('me'))).toBeNull();
    fireEvent.keyDown(handle(), { key: 'Enter' });
    expect(home()).toHaveAttribute('data-collapsed', 'true');
  });

  it('uses the saved width next time', () => {
    setWidth(1440);
    query = 'c=c1';
    localStorage.setItem(widthKey('me'), '300');
    render(<TeamChat />);
    expect(handle()).toHaveAttribute('aria-valuenow', '300');
  });

  it('there is nothing to drag until a chat is open', () => {
    setWidth(1440);
    render(<TeamChat />);
    expect(screen.queryByRole('separator', { name: 'Resize the chat list' })).toBeNull();
  });
});

describe('folding the left sections (☰)', () => {
  const nav = () => screen.getByRole('complementary', { name: 'Chat channels' });

  it('folds to an icon strip and back, and remembers it', () => {
    setWidth(1440);
    render(<TeamChat />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse the side menu' }));
    expect(nav()).toHaveAttribute('data-rail', 'true');
    expect(screen.getByTestId('gc-rail')).toBeInTheDocument();
    // The folded strip still does everything: new chat, search, shortcuts, status.
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search all messages' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home, 2 unread' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set a status' })).toBeInTheDocument();
    expect(screen.queryByText('Direct messages')).toBeNull();
    expect(localStorage.getItem(railKey('me'))).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Expand the side menu' }));
    expect(nav()).not.toHaveAttribute('data-rail');
    expect(screen.getByText('Direct messages')).toBeInTheDocument();
    expect(localStorage.getItem(railKey('me'))).toBeNull();
  });

  it('a saved fold is used next time on a computer, but never on a phone', () => {
    localStorage.setItem(railKey('me'), '1');
    setWidth(1440);
    const { unmount } = render(<TeamChat />);
    expect(nav()).toHaveAttribute('data-rail', 'true');
    unmount();
    setWidth(390);
    render(<TeamChat />);
    expect(nav()).not.toHaveAttribute('data-rail');
    expect(screen.getByText('Direct messages')).toBeInTheDocument();
  });
});
