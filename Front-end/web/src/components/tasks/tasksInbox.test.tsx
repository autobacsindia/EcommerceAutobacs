/**
 * Tasks phase 6a-2 — the Inbox screen.
 *
 * What must hold:
 *   - "Inbox" heads the task lists, with the unread count ("99+" past the cap)
 *   - lines read as sentences, newest first under Today / Yesterday / Earlier;
 *     loading, empty (all, unread) and error (with a retry) each say so
 *   - opening a line opens its task in the window and reads that task's lines —
 *     each line once, however often the screen renders; a failed read puts it back
 *   - read, unread and Clear change the screen at once and undo on a refusal
 *   - "Mark all read" sends the newest line shown, once, however often it is pressed
 *   - a line on a task you can no longer open is shown, not opened
 *   - "Load more" asks for the page after the last line
 *   - J / K step through the Inbox's tasks, skipping the ones that do not open
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import TasksWorkspace from './TasksWorkspace';
import type { InboxItem, Task } from './types';
import { addressBar } from '@/test-utils/addressBarMock';

const get = jest.fn();
const post = jest.fn();
const patch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a), delete: jest.fn(),
  },
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, className, ...rest }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className} {...rest}>{children}</a>,
}));
const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

// 2 Nov 2026, 11:30 in India. Only Date is fake: the screen's own timers stay real.
const NOW = new Date('2026-11-02T06:00:00Z');
beforeAll(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
      'queueMicrotask', 'nextTick', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'performance', 'hrtime'],
  });
});
afterAll(() => { jest.useRealTimers(); });
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const can = {
  edit: true, status: true, reassign: true, archive: true, restore: false, comment: true, checklist: true, files: true,
  follow: true, followers: true, subtask: false,
};
const task = (id: string, n: number, title: string): Task => ({
  id, number: n, code: `T-${n}`, title, summary: '', description: '',
  status: 'todo', statusLabel: 'To do', priority: 'normal', priorityLabel: 'Normal',
  dueOn: null, startOn: null, tags: [], overdue: false, dueToday: false,
  assignees: [], followers: [], following: false, assignee: { id: 'u1', name: 'Priya' }, team: 'procurement', teamLabel: 'Procurement',
  createdBy: { id: 'u2', name: 'Asha' }, order: null, group: null, checklist: { done: 0, total: 0 }, bucket: 'open',
  parent: null, subtasks: { total: 0, done: 0 },
  completedAt: null, archivedAt: null, commentCount: 0, lastCommentAt: null,
  createdAt: ago(60), updatedAt: ago(60), rev: 1, can, history: [], checklistItems: [],
});
// Ids are ObjectId-like: higher = newer.
const line = (id: string, over: Partial<InboxItem> = {}): InboxItem => ({
  id, kind: 'comment', task: { id: 't15', code: 'T-15', title: 'Diwali stock check' },
  by: { id: 'u2', name: 'Asha' }, text: 'Check the date', read: false, at: ago(5), canOpen: true, ...over,
});
const LINES: InboxItem[] = [
  line('0000000000000000000000a5', { kind: 'mention', at: ago(5) }),
  line('0000000000000000000000a4', { kind: 'status', task: { id: 't30', code: 'T-30', title: 'Bosch invoice' }, text: 'Done', by: { id: 'u3', name: 'Ravi' }, at: ago(90) }),
  line('0000000000000000000000a3', { kind: 'assigned', task: { id: 't42', code: 'T-42', title: 'Shelf labels' }, text: 'due 2026-11-20', read: true, at: ago(60 * 24) }),
  line('0000000000000000000000a2', { kind: 'comment', task: { id: 't9', code: 'T-9', title: 'Old secret task' }, canOpen: false, at: ago(60 * 24 * 4) }),
  line('0000000000000000000000a1', { kind: 'comment', at: ago(60 * 24 * 5) }),
];
const TASKS: Record<string, Task> = {
  t15: task('t15', 15, 'Diwali stock check'), t30: task('t30', 30, 'Bosch invoice'), t42: task('t42', 42, 'Shelf labels'),
};

type Serve = { lines?: InboxItem[]; unread?: number; next?: string | null; more?: InboxItem[]; inboxError?: boolean };
/** A fake server that remembers reads and clears, like the real one. */
function serve({ lines = LINES, unread, next = null, more = [], inboxError = false }: Serve = {}) {
  let rows = lines.map((l) => ({ ...l }));
  const count = () => unread ?? rows.filter((l) => !l.read).length;
  patch.mockImplementation((url: string, body: { state: string }) => {
    const id = url.split('/').pop();
    rows = body.state === 'cleared' ? rows.filter((l) => l.id !== id) : rows.map((l) => (l.id === id ? { ...l, read: body.state === 'read' } : l));
    return Promise.resolve({ id, state: body.state, unread: count() });
  });
  get.mockImplementation((url: string) => {
    if (url.endsWith('/links')) return Promise.resolve({ waitingOn: [], blocking: [], related: [], hidden: 0, hiddenWaiting: 0, canAdd: false });
    if (url === '/staff/tasks/summary') return Promise.resolve({ late: 0, today: 0, inbox: count() });
    if (url === '/staff/tasks/assignees') return Promise.resolve({ people: [] });
    if (url.startsWith('/staff/tasks/inbox?')) {
      if (inboxError) return Promise.reject({ status: 500, rawData: { message: 'The server is busy.' } });
      const qs = new URLSearchParams(url.split('?')[1]);
      if (qs.get('cursor')) return Promise.resolve({ items: more, nextCursor: null, unread: count() });
      const shown = qs.get('state') === 'unread' ? rows.filter((l) => !l.read) : rows;
      return Promise.resolve({ items: shown, nextCursor: next, unread: count() });
    }
    if (url.startsWith('/staff/tasks?')) return Promise.resolve({ tasks: [], nextCursor: null });
    if (url.endsWith('/subtasks')) return Promise.resolve({ subtasks: [], total: 0, done: 0 });
    if (url.includes('/comments')) return Promise.resolve({ comments: [], nextBefore: null });
    const id = url.split('/')[3];
    return TASKS[id] ? Promise.resolve({ task: TASKS[id] }) : Promise.reject({ status: 404, rawData: { message: 'Task not found.' } });
  });
}
const inboxCalls = () => get.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/staff/tasks/inbox'));
const openId = () => new URLSearchParams(addressBar.search).get('task');
beforeEach(() => {
  localStorage.clear();
  [get, post, patch].forEach((f) => f.mockReset());
  (toast.error as jest.Mock).mockReset();
  addressBar.reset('/team/tasks', 'view=inbox');
});
const workspace = () => wrap(<TasksWorkspace base="/team/tasks" canSeeTeam={false} />);
const inbox = () => screen.findByRole('region', { name: 'Inbox' });

describe('finding the Inbox', () => {
  it('heads the task lists with the unread count, and opens on a click', async () => {
    addressBar.reset('/team/tasks');
    serve();
    workspace();
    const nav = screen.getByRole('navigation', { name: 'Task lists' });
    const button = within(nav).getByRole('button', { name: /^Inbox/ });
    await waitFor(() => expect(button).toHaveTextContent('4 unread'));
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(new URLSearchParams(addressBar.search).get('view')).toBe('inbox');
  });

  it('says "99+" once the count reaches the cap', async () => {
    serve({ unread: 100 });
    workspace();
    const button = within(screen.getByRole('navigation', { name: 'Task lists' })).getByRole('button', { name: /^Inbox/ });
    await waitFor(() => expect(button).toHaveTextContent('99+'));
    expect(button).toHaveAttribute('aria-pressed', 'true');
    // "My tasks" is not also lit.
    expect(screen.getByRole('button', { name: 'My tasks' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('reading it', () => {
  it('reads as sentences, newest first, under Today / Yesterday / Earlier — and asks for no task lists', async () => {
    serve();
    workspace();
    const box = await inbox();
    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    await within(box).findByText('Today');
    // Headings and lines in screen order (an avatar's initial leads each line).
    const rows = [...box.querySelectorAll('ul > li')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toBe('Today');
    expect(rows[1]).toMatch(/Asha mentioned you on T-15 · Diwali stock check“Check the date”5m ago$/);
    expect(rows[2]).toMatch(/Ravi moved T-30 to DoneBosch invoice1h ago$/);
    expect(rows[3]).toBe('Yesterday');
    expect(rows[4]).toMatch(/Asha gave you T-42 · Shelf labelsDue 20 Nov1d ago$/);
    expect(rows[5]).toBe('Earlier');
    expect(rows[6]).toMatch(/Old secret task.*You no longer have access$/);
    expect(rows).toHaveLength(8);
    expect(get.mock.calls.some(([u]) => String(u).startsWith('/staff/tasks?'))).toBe(false);
  });

  it('shows placeholders while loading, then an empty Inbox', async () => {
    let answer: (v: unknown) => void = () => {};
    serve({ lines: [] });
    const real = get.getMockImplementation()!;
    get.mockImplementation((url: string) => (url.startsWith('/staff/tasks/inbox?') ? new Promise((r) => { answer = r; }) : real(url)));
    workspace();
    const box = await inbox();
    expect(within(box).queryByRole('listitem')).toBeNull();
    expect(box.querySelector('.animate-pulse')).not.toBeNull();
    await act(async () => { answer({ items: [], nextCursor: null, unread: 0 }); });
    expect(await within(box).findByText('Nothing here yet')).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: /Mark all read/ })).toBeDisabled();
  });

  it('Unread lists only unread lines, and says when there are none', async () => {
    serve({ lines: LINES.map((l) => ({ ...l, read: true })) });
    workspace();
    const box = await inbox();
    fireEvent.click(within(box).getByRole('tab', { name: 'Unread' }));
    expect(await within(box).findByText('You’re all caught up')).toBeInTheDocument();
    expect(inboxCalls()).toContain('/staff/tasks/inbox?state=unread');
  });

  it('a failed load says so, and "Try again" asks again', async () => {
    serve({ inboxError: true });
    workspace();
    const box = await inbox();
    expect(await within(box).findByRole('alert')).toHaveTextContent('The server is busy.');
    serve();
    fireEvent.click(within(box).getByRole('button', { name: /Try again/ }));
    expect(await within(box).findByText('Today')).toBeInTheDocument();
  });

  it('"Load more" asks for the page after the last line', async () => {
    serve({ next: '0000000000000000000000a1', more: [line('000000000000000000000099', { text: 'From last week' })] });
    workspace();
    const box = await inbox();
    fireEvent.click(await within(box).findByRole('button', { name: 'Load more' }));
    expect(await within(box).findByText('“From last week”')).toBeInTheDocument();
    expect(inboxCalls()).toContain('/staff/tasks/inbox?state=all&cursor=0000000000000000000000a1');
  });
});

describe('opening a line', () => {
  it('opens its task and reads its lines — each once, however often the screen renders', async () => {
    serve();
    workspace();
    const box = await inbox();
    fireEvent.click(await within(box).findByRole('button', { name: /Asha mentioned you on T-15.*\(unread\)/ }));
    expect(openId()).toBe('t15');
    await screen.findByRole('dialog', { name: 'Task' });
    // Both unread T-15 lines (the mention and the old comment), and nothing else.
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(patch.mock.calls.map(([u, b]) => [u, b])).toEqual([
      ['/staff/tasks/inbox/0000000000000000000000a5', { state: 'read' }],
      ['/staff/tasks/inbox/0000000000000000000000a1', { state: 'read' }],
    ]);
    // Re-renders and refetches do not read them again.
    fireEvent.click(within(box).getByRole('tab', { name: /Unread/ }));
    fireEvent.click(within(box).getByRole('tab', { name: 'All' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(patch).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(within(box).queryByRole('button', { name: /Asha mentioned you on T-15.*\(unread\)/ })).toBeNull());
  });

  it('a read the server refuses puts the line back to unread', async () => {
    serve({ lines: [LINES[0]] });
    patch.mockReset().mockRejectedValue({ status: 500, rawData: { message: 'Try later.' } });
    workspace();
    const box = await inbox();
    fireEvent.click(await within(box).findByRole('button', { name: /T-15.*\(unread\)/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Try later.'));
    expect(within(box).getByRole('button', { name: /T-15.*\(unread\)/ })).toBeInTheDocument();
  });

  it('a line whose task no longer opens has no way to open it', async () => {
    serve();
    workspace();
    const box = await inbox();
    await within(box).findByText('Old secret task', { exact: false });
    expect(within(box).queryByRole('button', { name: /Old secret task/ })).toBeNull();
    expect(within(box).getByText(/You no longer have access/)).toBeInTheDocument();
  });

  it('J / K step through the Inbox\'s tasks, skipping one that does not open', async () => {
    serve();
    workspace();
    const box = await inbox();
    fireEvent.click(await within(box).findByRole('button', { name: /Ravi moved T-30/ }));
    const win = await screen.findByRole('dialog', { name: 'Task' });
    expect(await within(win).findByText('2 of 3')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'j' });
    expect(openId()).toBe('t42');
    fireEvent.keyDown(window, { key: 'j' }); // T-9 does not open: T-42 is the last
    expect(openId()).toBe('t42');
    fireEvent.keyDown(window, { key: 'k' });
    expect(openId()).toBe('t30');
  });
});

describe('marking lines', () => {
  it('read / unread and Clear change the screen at once', async () => {
    serve();
    workspace();
    const box = await inbox();
    let release: () => void = () => {};
    const real = patch.getMockImplementation()!;
    // The server is slow: the screen has already changed before it answers.
    patch.mockImplementation((...a: [string, { state: string }]) => new Promise((r) => { release = () => r(real(...a)); }));
    fireEvent.click(await within(box).findByRole('button', { name: 'Mark T-30 update read' }));
    expect(await within(box).findByRole('button', { name: 'Mark T-30 update unread' })).toBeInTheDocument();
    expect(patch).toHaveBeenLastCalledWith('/staff/tasks/inbox/0000000000000000000000a4', { state: 'read' });
    await act(async () => { release(); });

    fireEvent.click(within(box).getByRole('button', { name: 'Clear T-42 update' }));
    await waitFor(() => expect(within(box).queryByText('Shelf labels', { exact: false })).toBeNull());
    expect(patch).toHaveBeenLastCalledWith('/staff/tasks/inbox/0000000000000000000000a3', { state: 'cleared' });
    await act(async () => { release(); });
  });

  it('a Clear the server refuses brings the line back', async () => {
    serve();
    patch.mockReset().mockRejectedValue({ status: 404, rawData: { message: 'Inbox item not found.' } });
    workspace();
    const box = await inbox();
    fireEvent.click(await within(box).findByRole('button', { name: 'Clear T-42 update' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Inbox item not found.'));
    expect(within(box).getByText('Shelf labels', { exact: false })).toBeInTheDocument();
  });

  it('"Mark all read" sends the newest line shown — once, however often it is pressed', async () => {
    serve();
    let done: (v: unknown) => void = () => {};
    post.mockImplementation(() => new Promise((r) => { done = r; }));
    workspace();
    const box = await inbox();
    const button = await within(box).findByRole('button', { name: /Mark all read/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/staff/tasks/inbox/read-all', { upTo: '0000000000000000000000a5' });
    // Before the server answers, every line shown is read.
    expect(within(box).queryAllByRole('button', { name: /\(unread\)/ })).toHaveLength(0);
    await act(async () => { done({ marked: 3, unread: 0 }); });
    await waitFor(() => expect(button).toBeDisabled());
  });
});
