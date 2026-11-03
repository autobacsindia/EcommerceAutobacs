/**
 * The Tasks module screens. The API decides who may do what
 * (services/staffTaskService.js on the backend); these pin what each person
 * sees and what is sent — above all that a create carries one clientId however
 * often it is pressed, and that every edit names the revision it was made against.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TasksWorkspace from './TasksWorkspace';
import TaskDetail, { timeAgo } from './TaskDetail';
import { AvatarStack, colourFor, initialsOf } from './ui';
import { formatDueDay, isPastDay, todayIST, type Task } from './types';
import { groupTasks } from './grouping';
import { placePopover } from './AssigneePicker';
import { addressBar } from '@/test-utils/addressBarMock';

const get = jest.fn();
const post = jest.fn();
const patch = jest.fn();
const remove = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a), delete: (...a: unknown[]) => remove(...a),
  },
}));
const toastSuccess = jest.fn();
const toastError = jest.fn();
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
// The page keeps whose tasks, the search, filters, sort and the open task in the address.
jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);
const { replace } = addressBar;
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const can = { edit: true, status: true, reassign: true, archive: true, restore: false, comment: true, checklist: true, files: true, follow: true, followers: true };
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', number: 7, code: 'T-7', title: 'Call Bosch', summary: '', description: 'Ask about the lift kit',
  status: 'todo', statusLabel: 'To do', priority: 'high', priorityLabel: 'High',
  dueOn: '2026-10-27', startOn: null, tags: [], overdue: false, dueToday: true,
  assignees: [], followers: [], following: false, assignee: { id: 'u2', name: 'Arun' }, team: 'procurement', teamLabel: 'Procurement',
  createdBy: { id: 'u1', name: 'Priya' }, order: null, group: null, checklist: { done: 0, total: 0 }, bucket: 'open',
  completedAt: null, archivedAt: null, commentCount: 0, lastCommentAt: null,
  createdAt: '2026-10-27T04:00:00Z', updatedAt: '2026-10-27T04:00:00Z', rev: 3, can,
  history: [], ...over,
});
const people = {
  people: [
    { id: 'u1', name: 'Priya', team: 'procurement', teamLabel: 'Procurement', isHead: true, me: true },
    { id: 'u2', name: 'Arun', team: 'procurement', teamLabel: 'Procurement', isHead: false, me: false },
    { id: 'u3', name: 'Bala', team: 'procurement', teamLabel: 'Procurement', isHead: false, me: false },
  ],
};

/** GET router: lists (open / done), summary, assignees, one task, comments. */
function serve({
  list = [task()], done = [] as Task[], one = task(), assignees = people, summary = { late: 0, today: 0 }, comments = [] as unknown[],
} = {}) {
  get.mockImplementation((url: string) => {
    if (url === '/staff/tasks/summary') return Promise.resolve(summary);
    if (url === '/staff/tasks/assignees') return Promise.resolve(assignees);
    if (url.startsWith('/staff/tasks?') && url.includes('state=done')) return Promise.resolve({ tasks: done, nextCursor: null });
    if (url.startsWith('/staff/tasks?')) return Promise.resolve({ tasks: list, nextCursor: null });
    if (url.includes('/comments')) return Promise.resolve({ comments, nextBefore: null });
    if (url.startsWith('/staff/tasks/')) return Promise.resolve({ task: one });
    return Promise.resolve({ orders: [] });
  });
}
const listCalls = () => get.mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith('/staff/tasks?'));

beforeEach(() => {
  localStorage.clear();
  [get, post, patch, remove, toastSuccess, toastError].forEach((f) => f.mockClear());
  get.mockReset(); post.mockReset(); patch.mockReset(); remove.mockReset();
  addressBar.reset('/team/tasks');
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

const workspace = (props: Partial<{ base: string; canSeeTeam: boolean }> = {}) =>
  wrap(<TasksWorkspace base={props.base ?? '/team/tasks'} canSeeTeam={props.canSeeTeam ?? false} />);

describe('the Tasks page', () => {
  it('groups open tasks by status, each with "+ Add task"; Complete is folded until opened', async () => {
    serve({
      list: [task(), task({ id: 't2', code: 'T-8', title: 'Chase supplier', status: 'in_progress', statusLabel: 'In progress' })],
      done: [task({ id: 't3', code: 'T-9', title: 'Old job', status: 'done', bucket: 'done' })],
    });
    workspace();
    const group = async (name: string) => screen.findByRole('region', { name });
    expect(within(await group('In progress')).getByText('Chase supplier')).toBeInTheDocument();
    expect(within(await group('To do')).getByText('Call Bosch')).toBeInTheDocument();
    expect(within(await group('To do')).getByRole('button', { name: /Add task/ })).toBeInTheDocument();
    expect(screen.queryByText('Old job')).toBeNull();
    fireEvent.click(within(await group('Complete')).getByRole('button', { name: /Complete/ }));
    expect(await screen.findByText('Old job')).toBeInTheDocument();
    expect(listCalls()).toContain('/staff/tasks?view=mine&state=done');
  });

  it('"Today & overdue" counts what is late or due today, and filters to it (a second press goes back)', async () => {
    serve({ summary: { late: 3, today: 2 } });
    workspace();
    const nav = await screen.findByRole('navigation', { name: 'Task lists' });
    const dueNow = await within(nav).findByRole('button', { name: /Today & overdue 5 due now/ });
    fireEvent.click(dueNow);
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=mine&state=open&due=late'));
    expect(dueNow).toHaveAttribute('aria-pressed', 'true');
    expect(within(nav).getByRole('button', { name: 'Assigned to me' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('heading', { level: 1, name: /Today & overdue/ })).toBeInTheDocument();
    fireEvent.click(dueNow);
    await waitFor(() => expect(dueNow).toHaveAttribute('aria-pressed', 'false'));
    expect(within(nav).getByRole('button', { name: 'Assigned to me' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('searches after a short pause, and "/" jumps to the search box', async () => {
    serve();
    workspace();
    await screen.findByText('Call Bosch');
    fireEvent.keyDown(window, { key: '/' });
    expect(screen.getByLabelText('Search tasks')).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'T-7' } });
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=mine&state=open&q=T-7'));
  });

  it('who sees what: a member has no team list; a head has "My team"; the admin "All teams" with a person filter', async () => {
    serve();
    const { unmount } = workspace();
    await screen.findByText('Call Bosch');
    expect(screen.getByRole('button', { name: 'Assigned to me' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'My team' })).toBeNull();
    unmount();
    const head = workspace({ canSeeTeam: true });
    expect(await screen.findByRole('button', { name: 'My team' })).toBeInTheDocument();
    head.unmount();
    workspace({ base: '/admin/tasks', canSeeTeam: true });
    fireEvent.click(await screen.findByRole('button', { name: 'All teams' }));
    fireEvent.change(await screen.findByLabelText('Person'), { target: { value: 'u3' } });
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=team&state=open&assignee=u3'));
  });

  it('opens on what is due now when the bell sends ?due=late', async () => {
    addressBar.search = 'due=late';
    serve();
    workspace();
    await screen.findByText('Call Bosch');
    expect(listCalls()).toContain('/staff/tasks?view=mine&state=open&due=late');
  });

  it('ticking the circle marks a task done, with the revision; a refused tick says why', async () => {
    serve();
    patch.mockResolvedValueOnce({ task: task({ status: 'done', rev: 4 }) }).mockRejectedValueOnce({ status: 409 });
    workspace();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark T-7 complete' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, status: 'done' }));
    expect(toastSuccess).toHaveBeenCalledWith('T-7 complete', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Mark T-7 complete' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('changed by someone else')));
  });

  it('without permission the circle is not a button', async () => {
    serve({ list: [task({ can: { ...can, status: false } })] });
    workspace();
    await screen.findByText('Call Bosch');
    expect(screen.queryByRole('button', { name: 'Mark T-7 complete' })).toBeNull();
  });

  it('"+ Add task" in a group: type, Enter — it starts in that status; Escape closes', async () => {
    serve({ list: [task({ status: 'in_progress', statusLabel: 'In progress' })] });
    post.mockResolvedValue({ task: task() });
    workspace();
    const group = await screen.findByRole('region', { name: 'In progress' });
    fireEvent.click(within(group).getByRole('button', { name: /Add task/ }));
    const input = screen.getByLabelText('New task in In progress');
    fireEvent.change(input, { target: { value: 'Ring the courier' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks', expect.objectContaining({ title: 'Ring the courier', status: 'in_progress', clientId: expect.any(String) })));
    fireEvent.keyDown(screen.getByLabelText('New task in In progress'), { key: 'Escape' });
    expect(screen.queryByLabelText('New task in In progress')).toBeNull();
  });

  it('a task opens in the side panel (linkable as ?task=) and closes again', async () => {
    serve();
    const { rerender } = workspace();
    fireEvent.click(await screen.findByRole('button', { name: 'Open T-7: Call Bosch' }));
    expect(replace).toHaveBeenCalledWith('/team/tasks?task=t1', { scroll: false });
    rerender(<QueryClientProvider client={new QueryClient()}><TasksWorkspace base="/team/tasks" canSeeTeam={false} /></QueryClientProvider>);
    const panel = await screen.findByRole('dialog', { name: 'Task' });
    expect(await within(panel).findByText('Ask about the lift kit')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(replace).toHaveBeenLastCalledWith('/team/tasks', { scroll: false });
  });

  it('says plainly when a list is empty, and offers to add one', async () => {
    serve({ list: [] });
    workspace();
    expect(await screen.findByText('Nothing on your plate')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /New task/ }).at(-1)!);
    expect(await screen.findByRole('dialog', { name: 'New task' })).toBeInTheDocument();
  });

  it('the side list picks whose tasks; the header names the list; "needs attention" shows only when something is late or due', async () => {
    serve({ summary: { late: 0, today: 0 } });
    workspace({ canSeeTeam: true });
    const nav = await screen.findByRole('navigation', { name: 'Task lists' });
    expect(screen.getByRole('heading', { level: 1, name: 'Assigned to me' })).toBeInTheDocument();
    // Nothing due: "Today & overdue" carries no count.
    expect(within(nav).getByRole('button', { name: 'Today & overdue' })).toBeInTheDocument();
    fireEvent.click(within(nav).getByRole('button', { name: 'I gave out' }));
    expect(screen.getByRole('heading', { level: 1, name: 'I gave out' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'I gave out' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=created&state=open'));
  });

  it('L and B switch list and board; "?" lists the shortcuts; none of them fire while typing', async () => {
    serve();
    workspace();
    await screen.findByText('Call Bosch');
    fireEvent.keyDown(window, { key: 'b' });
    expect(screen.getByRole('tab', { name: /Board/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByLabelText('Search tasks'), { key: 'l' });
    expect(screen.getByRole('tab', { name: /Board/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(window, { key: 'l' });
    expect(screen.getByRole('tab', { name: /List/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(window, { key: '?' });
    const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(sheet).toHaveTextContent('Show as a board');
    // While a pop-up is open, "n" does not open a second one behind it.
    fireEvent.keyDown(window, { key: 'n' });
    expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
  });

  it('explains how tasks work until hidden, and remembers that', async () => {
    serve();
    const { unmount } = workspace();
    expect(await screen.findByText('How tasks work')).toBeInTheDocument();
    // A member (no team view) is told they can give tasks to anyone, too.
    expect(screen.getByText(/yourself or anyone in the panel/)).toBeInTheDocument();
    expect(screen.queryByText(/Team heads and the admin can give/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide how tasks work' }));
    expect(screen.queryByText('How tasks work')).toBeNull();
    unmount();
    workspace();
    await screen.findByText('Call Bosch');
    expect(screen.queryByText('How tasks work')).toBeNull();
  });
});

describe('search, filters and sort in the address', () => {
  it('a sort reaches the open list only; done keeps its own order', async () => {
    serve({ done: [task({ id: 't3', code: 'T-9', title: 'Old job', status: 'done', bucket: 'done' })] });
    workspace();
    await screen.findByText('Call Bosch');
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'newest' } });
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=mine&state=open&sort=newest'));
    expect(addressBar.search).toBe('sort=newest');
    fireEvent.click(within(await screen.findByRole('region', { name: 'Complete' })).getByRole('button', { name: /Complete/ }));
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=mine&state=done'));
    expect(listCalls().filter((u) => u.includes('state=done') && u.includes('sort='))).toEqual([]);
  });

  it('opens from a link with whose tasks, the search, priority and sort; Clear all keeps whose and the sort', async () => {
    addressBar.search = 'view=created&priority=high&q=bosch&sort=oldest';
    serve();
    workspace();
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=created&state=open&priority=high&q=bosch&sort=oldest'));
    expect(screen.getByLabelText('Search tasks')).toHaveValue('bosch');
    expect(screen.getByRole('button', { name: 'I gave out' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(addressBar.search).toBe('view=created&sort=oldest'));
    expect(screen.getByLabelText('Search tasks')).toHaveValue('');
  });

  it('a team list in a link, for someone without one, opens on "For me"', async () => {
    addressBar.search = 'view=team&assignee=u3';
    serve();
    workspace({ canSeeTeam: false });
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=mine&state=open'));
    expect(listCalls().some((u) => u.includes('view=team'))).toBe(false);
  });

  it('says how many open tasks match', async () => {
    serve();
    const base = get.getMockImplementation()!;
    get.mockImplementation((url: string) => (url.startsWith('/staff/tasks?') && url.includes('state=open')
      ? Promise.resolve({ tasks: [task()], nextCursor: null, summary: { count: 1, capped: false } })
      : base(url)));
    workspace();
    expect(await screen.findByRole('status')).toHaveTextContent('1 open task found');
  });
});

describe('the board', () => {
  const dt = (id: string) => ({ getData: () => id, setData: () => {}, dropEffect: '', effectAllowed: '' });
  const board = async (list: Task[], done: Task[] = []) => {
    serve({ list, done });
    workspace();
    fireEvent.click(await screen.findByRole('tab', { name: /Board/ }));
  };
  const col = (name: string) => screen.getByRole('region', { name });

  it('shows each job in its status column, and remembers the choice', async () => {
    await board(
      [task(), task({ id: 't2', code: 'T-8', title: 'Chase supplier', status: 'waiting', statusLabel: 'Waiting' })],
      [task({ id: 't3', code: 'T-9', title: 'Old job', status: 'done', statusLabel: 'Done', bucket: 'done' })],
    );
    await waitFor(() => expect(within(col('To do')).getByText('Call Bosch')).toBeInTheDocument());
    expect(within(col('Waiting')).getByText('Chase supplier')).toBeInTheDocument();
    expect(await within(col('Complete')).findByText('Old job')).toBeInTheDocument();
    expect(localStorage.getItem('tasks-view-mode')).toBe('board');
  });

  it('dropping a card on a column moves it, with the revision', async () => {
    patch.mockResolvedValue({ task: task({ status: 'in_progress', rev: 4 }) });
    await board([task()]);
    const card = (await screen.findByRole('button', { name: 'Open T-7: Call Bosch' }));
    expect(card).toHaveAttribute('draggable', 'true');
    fireEvent.drop(col('In progress'), { dataTransfer: dt('t1') });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, status: 'in_progress' }));
  });

  it('a refused move puts the card back and says why', async () => {
    patch.mockRejectedValue({ status: 409 });
    await board([task()]);
    await screen.findByText('Call Bosch');
    fireEvent.drop(col('Complete'), { dataTransfer: dt('t1') });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('T-7 was changed by someone else')));
    await waitFor(() => expect(within(col('To do')).getByText('Call Bosch')).toBeInTheDocument());
  });

  it('cards you may not move cannot be dragged, dropped or picked', async () => {
    await board([task({ can: { ...can, status: false } })]);
    const card = await screen.findByRole('button', { name: 'Open T-7: Call Bosch' });
    expect(card).toHaveAttribute('draggable', 'false');
    fireEvent.drop(col('Complete'), { dataTransfer: dt('t1') });
    expect(patch).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Move T-7')).toBeNull();
  });

  it('on a phone, "Move to" on the card does the same move', async () => {
    patch.mockResolvedValue({ task: task({ status: 'waiting', rev: 4 }) });
    await board([task()]);
    fireEvent.change(await screen.findByLabelText('Move T-7'), { target: { value: 'waiting' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, status: 'waiting' }));
  });

  it('a date filter shows only what is still to do (no Complete column)', async () => {
    await board([task()]);
    await screen.findByText('Call Bosch');
    fireEvent.click(screen.getByRole('button', { name: 'Late' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Complete' })).toBeNull());
  });
});

describe('new task', () => {
  const openForm = async (props: Partial<{ base: string; canSeeTeam: boolean }> = {}) => {
    workspace(props);
    await screen.findByText(/Nothing on your plate|Call Bosch/);
    fireEvent.keyDown(window, { key: 'n' });
    return screen.findByRole('dialog', { name: 'New task' });
  };

  /** Open the people picker in the form. */
  const picker = async (dialog: HTMLElement) => {
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Who does it' }));
    return screen.getByRole('listbox', { name: 'Assignees' });
  };

  it('opens with N; a head swaps themselves for someone; pressing Create twice sends ONE clientId', async () => {
    serve({ list: [] });
    post.mockRejectedValueOnce({ status: 503, rawData: { message: 'Try again' } }).mockResolvedValue({ task: task(), tasks: [task()] });
    const dialog = await openForm({ canSeeTeam: true });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Pack order 51234' } });
    const list = await picker(dialog);
    // You are at the top, already picked.
    const [first] = within(list).getAllByRole('option');
    expect(first).toHaveTextContent('Me');
    expect(first).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(first);
    fireEvent.click(within(list).getByRole('option', { name: /Arun/ }));
    fireEvent.change(within(dialog).getByLabelText('Due date'), { target: { value: '2099-10-30' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Try again');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const [sent, again] = post.mock.calls.map((c) => c[1]);
    expect(sent).toMatchObject({ title: 'Pack order 51234', assigneeIds: ['u2'], shared: true, dueOn: '2099-10-30', priority: 'normal', orderId: null });
    expect(again.clientId).toBe(sent.clientId);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Task created'));
    // The new task opens in the side panel.
    expect(replace).toHaveBeenLastCalledWith('/team/tasks?task=t1', { scroll: false });
  });

  it('heads are labelled as heads; several people share ONE task by default', async () => {
    serve({ list: [] });
    post.mockResolvedValue({ task: task(), tasks: [task()] });
    const dialog = await openForm({ base: '/admin/tasks', canSeeTeam: true });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Stock count' } });
    const list = await picker(dialog);
    expect(within(list).getByRole('option', { name: /Priya · Procurement head/ })).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('option', { name: /Bala/ }));
    fireEvent.click(within(list).getByRole('option', { name: /Arun/ }));
    expect(within(dialog).getByRole('radio', { name: /One shared task/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks', expect.objectContaining({ assigneeIds: ['u1', 'u3', 'u2'], shared: true })));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Task created'));
  });

  it('"Own copy each" makes one task per person', async () => {
    serve({ list: [] });
    post.mockResolvedValue({ task: task(), tasks: [task(), task(), task()] });
    const dialog = await openForm({ canSeeTeam: true });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Read the policy' } });
    const list = await picker(dialog);
    fireEvent.click(within(list).getByRole('option', { name: /Bala/ }));
    fireEvent.click(within(list).getByRole('option', { name: /Arun/ }));
    fireEvent.click(within(dialog).getByRole('radio', { name: /Own copy each/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 3 tasks' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks', expect.objectContaining({ assigneeIds: ['u1', 'u3', 'u2'], shared: false })));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('3 tasks created'));
  });

  it('the picker: search narrows it, arrow keys and Enter tick, Escape closes and returns focus', async () => {
    serve({ list: [] });
    const dialog = await openForm({ canSeeTeam: true });
    const list = await picker(dialog);
    const search = screen.getByRole('combobox', { name: 'Search assignees' });
    expect(search).toHaveAttribute('placeholder', 'Search or enter name…');
    fireEvent.change(search, { target: { value: 'ar' } });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('Arun')]);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(within(list).getByRole('option', { name: /Arun/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(within(list).getByRole('option', { name: /Bala/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(within(list).getByText(/Nobody matches/)).toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Assignees' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Who does it' })).toHaveFocus();
    // The form is still open: Escape in the picker closes only the picker.
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeInTheDocument();
  });

  it('a member picks people from other teams like anyone else', async () => {
    serve({ list: [] });
    post.mockResolvedValue({ task: task(), tasks: [task()] });
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Quote for 4512' } });
    fireEvent.click(within(await picker(dialog)).getByRole('option', { name: /Bala/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /^Create/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks', expect.objectContaining({ assigneeIds: expect.arrayContaining(['u3']) })));
  });

  it('only one person in the panel: the task is for you; nobody ticked cannot be created; steps go one per line', async () => {
    serve({ list: [], assignees: { people: [{ ...people.people[1], me: true }] } });
    post.mockResolvedValue({ task: task(), tasks: [task()] });
    const dialog = await openForm();
    expect(await within(dialog).findByText(/This task is for you/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Who does it' })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Mine' } });
    fireEvent.change(within(dialog).getByLabelText('Checklist steps'), { target: { value: 'Pack\n\n  Label  \n' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks', expect.objectContaining({ assigneeIds: ['u2'], checklist: ['Pack', 'Label'] })));
  });

  it('nobody ticked: says so and cannot create', async () => {
    serve({ list: [] });
    const dialog = await openForm({ canSeeTeam: true });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'x' } });
    fireEvent.click(within(await picker(dialog)).getByRole('option', { name: /Priya/ }));
    expect(within(dialog).getByText('Pick at least one person.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create task' })).toBeDisabled();
  });

  it('warns when the due date has already passed', async () => {
    serve({ list: [] });
    const dialog = await openForm({ canSeeTeam: true });
    fireEvent.change(within(dialog).getByLabelText('Due date'), { target: { value: '2020-01-01' } });
    expect(within(dialog).getByText(/This due date has already passed/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Due date'), { target: { value: todayIST() } });
    expect(within(dialog).queryByText(/This due date has already passed/)).toBeNull();
  });

  it('Escape closes the form', async () => {
    serve({ list: [] });
    await openForm();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
  });
});

describe('one task', () => {
  const detail = (one: Task, opts: Record<string, unknown> = {}) => {
    serve({ one, ...opts });
    return wrap(<TaskDetail id="t1" base="/team/tasks" />);
  };

  it('shows the properties; the title is edited in place and saved with the revision', async () => {
    patch.mockResolvedValue({ task: task({ title: 'Call Bosch today', rev: 4 }) });
    detail(task({ order: { id: 'o1', code: '#51234' } }));
    expect(await screen.findByText('Ask about the lift kit')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#51234' })).toHaveAttribute('href', '/team/orders');
    fireEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    const input = screen.getByLabelText('title');
    fireEvent.change(input, { target: { value: 'Call Bosch today' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, title: 'Call Bosch today' }));
    expect(toastSuccess).toHaveBeenCalledWith('Saved', expect.anything());
  });

  it('Escape abandons an edit; nothing is sent', async () => {
    detail(task());
    fireEvent.click(await screen.findByRole('button', { name: 'Edit title' }));
    fireEvent.change(screen.getByLabelText('title'), { target: { value: 'Something else' } });
    fireEvent.keyDown(screen.getByLabelText('title'), { key: 'Escape' });
    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit title' })).toHaveTextContent('Call Bosch');
  });

  it('priority, assignee, status and due change in place; a past due date asks first', async () => {
    patch.mockResolvedValue({ task: task({ rev: 4 }) });
    detail(task());
    fireEvent.change(await screen.findByLabelText('Priority'), { target: { value: 'urgent' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, priority: 'urgent' }));
    // People: ticked in a draft, saved ONCE when the picker closes.
    fireEvent.click(await screen.findByRole('button', { name: 'Who does it' }));
    fireEvent.click(screen.getByRole('option', { name: /Bala/ }));
    fireEvent.click(screen.getByRole('option', { name: /Priya/ }));
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', expect.objectContaining({ assigneeIds: ['u2', 'u3', 'u1'] })));
    expect(patch.mock.calls.filter((c) => 'assigneeIds' in c[1])).toHaveLength(1);
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2020-01-01' } });
    expect(patch).not.toHaveBeenCalledWith('/staff/tasks/t1', expect.objectContaining({ dueOn: '2020-01-01' }));
  });

  it('the person doing it (no edit rights) moves the status but sees no edit, archive or reassign', async () => {
    detail(task({ can: { ...can, edit: false, reassign: false, archive: false, checklist: false } }));
    expect(await screen.findByText('Ask about the lift kit')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit title' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.queryByLabelText('Who does it')).toBeNull();
    expect(screen.queryByLabelText('Priority')).toBeNull();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
  });

  it('a stale save says so and reloads the task', async () => {
    patch.mockRejectedValue({ status: 409, rawData: { message: 'Someone changed this task just now.' } });
    detail(task());
    fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'waiting' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone changed this task just now.');
    await waitFor(() => expect(get.mock.calls.filter((c) => c[0] === '/staff/tasks/t1').length).toBeGreaterThan(1));
  });

  it('archives after a confirm, then offers Restore; an order can be unlinked', async () => {
    patch.mockResolvedValueOnce({ task: task({ order: null, rev: 4 }) })
      .mockResolvedValueOnce({ task: task({ bucket: 'archived', rev: 5, can: { ...can, edit: false, archive: false, restore: true, comment: false } }) });
    detail(task({ order: { id: 'o1', code: '#51234' } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink the order' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, orderId: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('This task is archived.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restore/ })).toBeInTheDocument();
  });

  it('the checklist ticks, adds and removes steps', async () => {
    const steps = [
      { id: 'c1', text: 'Pack', done: true, doneAt: '2026-10-28T05:00:00Z', doneBy: 'Arun' },
      { id: 'c2', text: 'Book courier', done: false, doneAt: null, doneBy: '' },
    ];
    patch.mockResolvedValue({ task: task({ checklistItems: steps.map((c) => ({ ...c, done: true })) }) });
    post.mockResolvedValue({ task: task({ checklistItems: [...steps, { id: 'c3', text: 'Label', done: false, doneAt: null, doneBy: '' }] }) });
    remove.mockResolvedValue({ task: task({ checklistItems: [steps[1]] }) });
    detail(task({ checklistItems: steps }));
    expect(await screen.findByText('1 of 2 done')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Step: Book courier'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1/checklist/c2', { done: true }));
    expect(await screen.findByText('2 of 2 done')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('New step'), { target: { value: 'Label' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/t1/checklist', expect.objectContaining({ text: 'Label', clientId: expect.any(String) })));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Pack' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('/staff/tasks/t1/checklist/c1'));
  });

  it('activity puts history and comments on one timeline, oldest first; a comment posts with a clientId', async () => {
    post.mockResolvedValue({ comment: { id: 'c9' } });
    detail(
      task({ history: [{ at: '2026-10-27T04:00:00Z', by: 'Priya', action: 'created', from: '', to: 'Arun' }] }),
      { comments: [{
        id: 'm1', by: { id: 'u2', name: 'Arun' }, text: 'Bosch says Friday', createdAt: '2026-10-27T05:00:00Z',
        editedAt: null, deleted: false, mine: false, editableUntil: null, mentions: [], files: [], reactions: [],
      }] },
    );
    const created = await screen.findByText(/created this task for Arun/);
    const comment = await screen.findByText('Bosch says Friday');
    expect(created.compareDocumentPosition(comment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Thanks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/t1/comments', expect.objectContaining({ text: 'Thanks', clientId: expect.any(String) })));
  });

  it('a task given to several people shows who else has it and how many are done', async () => {
    detail(task({
      group: { id: 'g1', size: 3 },
      siblings: [
        { id: 't2', code: 'T-8', assignee: { id: 'u3', name: 'Bala' }, status: 'done', statusLabel: 'Done', bucket: 'done' },
        { id: 't3', code: 'T-9', assignee: { id: 'u4', name: 'Sam' }, status: 'todo', statusLabel: 'To do', bucket: 'open' },
      ],
    }));
    expect(await screen.findByText('Given to 3 people')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Bala/ })).toHaveAttribute('href', '/team/tasks/t2');
    expect(screen.getByText('1 of 3 done')).toBeInTheDocument();
  });

  it('a task you cannot see says so', async () => {
    get.mockImplementation((url: string) => (url === '/staff/tasks/assignees'
      ? Promise.resolve(people)
      : Promise.reject({ status: 404, rawData: { message: 'Task not found.' } })));
    wrap(<TaskDetail id="t9" base="/team/tasks" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Task not found.');
  });
});

describe('helpers', () => {
  it('"today" is the day in India, and only earlier days are past', () => {
    expect(todayIST(new Date('2026-10-26T20:00:00Z'))).toBe('2026-10-27');
    expect(isPastDay('2026-10-26', '2026-10-27')).toBe(true);
    expect(isPastDay('2026-10-27', '2026-10-27')).toBe(false);
    expect(formatDueDay('2031-01-15')).toBe('15 Jan 2031');
  });

  it('initials and colours are stable per person', () => {
    expect(initialsOf('Herald Winston Pottipati')).toBe('HP');
    expect(initialsOf('Akash')).toBe('A');
    expect(colourFor('u1')).toBe(colourFor('u1'));
  });

  it('times read as "5m ago", then the date', () => {
    const now = Date.parse('2026-10-28T10:00:00Z');
    expect(timeAgo('2026-10-28T09:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-10-28T09:55:00Z', now)).toBe('5m ago');
    expect(timeAgo('2026-10-28T07:00:00Z', now)).toBe('3h ago');
    expect(timeAgo('2026-10-26T10:00:00Z', now)).toBe('2d ago');
  });
});

// Keep `act` referenced for environments that warn on unused imports.
void act;

describe('the board card', () => {
  const board = async (list: Task[], done: Task[] = []) => {
    serve({ list, done });
    localStorage.setItem('tasks-view-mode', 'board');
    workspace();
    return screen.findByRole('button', { name: `Open ${list[0]?.code ?? done[0].code}: ${list[0]?.title ?? done[0].title}` });
  };

  it('shows the person, the date, the T-number, comments and a Late badge', async () => {
    const card = await board([task({ commentCount: 3, overdue: true, dueToday: false, dueOn: '2026-10-21' })]);
    expect(within(card).getByRole('img', { name: 'Arun' })).toBeInTheDocument();
    expect(within(card).getByText('T-7')).toBeInTheDocument();
    expect(within(card).getByText('3')).toBeInTheDocument();
    expect(within(card).getByText('Late')).toBeInTheDocument();
    expect(within(card).getByTitle('Due 21 Oct')).toBeInTheDocument();
    expect(within(card).getByTitle('High priority')).toBeInTheDocument();
  });

  it('a bare task: no comment count, no Late; the empty date, flag and tag say so to screen readers', async () => {
    const card = await board([task({ priority: 'normal', dueOn: null, overdue: false, dueToday: false })]);
    expect(within(card).queryByText('Late')).toBeNull();
    expect(within(card).queryByTitle(/comments/)).toBeNull();
    expect(within(card).getByText('No due date')).toBeInTheDocument();
    expect(within(card).getByText('Normal priority')).toBeInTheDocument();
    expect(within(card).getByText('No tags')).toBeInTheDocument();
  });

  it('a finished task is never Late', async () => {
    const card = await board([], [task({ status: 'done', bucket: 'done', overdue: true, dueToday: false })]);
    expect(within(card).queryByText('Late')).toBeNull();
  });

  it('clicking the card opens the task; the column headings are status pills', async () => {
    const card = await board([task()]);
    expect(screen.getByRole('region', { name: 'To do' }).querySelector('.tk-pill')).toHaveAttribute('data-status', 'todo');
    fireEvent.click(card);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringContaining('task=t1'), expect.anything()));
  });
});

describe('AvatarStack', () => {
  it('shows up to three faces, then "+n", and names everyone', () => {
    const people = ['Arun', 'Bala', 'Chitra', 'Dev', 'Esha'].map((name, i) => ({ id: `u${i}`, name }));
    render(<AvatarStack people={people} />);
    const stack = screen.getByRole('img', { name: 'Arun, Bala, Chitra, Dev, Esha' });
    expect(within(stack).getByText('+2')).toHaveAttribute('title', 'Dev, Esha');
    expect(within(stack).getAllByTitle(/^(Arun|Bala|Chitra)$/)).toHaveLength(3);
  });

  it('renders nothing for nobody', () => {
    const { container } = render(<AvatarStack people={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('shared tasks and followers (phase 4)', () => {
  const shared = (over: Partial<Task> = {}) => task({
    assignees: [{ id: 'u2', name: 'Arun' }, { id: 'u3', name: 'Bala' }], ...over,
  });
  const detail = (one: Task, opts: Record<string, unknown> = {}, onClose?: () => void) => {
    serve({ one, ...opts });
    return wrap(<TaskDetail id="t1" base="/team/tasks" onClose={onClose} />);
  };

  it('everyone on a shared task shows on its board card and list row', async () => {
    serve({ list: [shared()] });
    localStorage.setItem('tasks-view-mode', 'board');
    workspace();
    const card = await screen.findByRole('button', { name: 'Open T-7: Call Bosch' });
    expect(within(card).getByRole('img', { name: 'Arun, Bala' })).toBeInTheDocument();
  });

  it('grouped by person, a shared task sits under each of its people', () => {
    const groups = groupTasks([shared(), task({ id: 't2', title: 'Solo' })], 'assignee');
    expect(groups.map((g) => [g.label, g.tasks.map((t) => t.id)])).toEqual([['Arun', ['t1', 't2']], ['Bala', ['t1']]]);
  });

  it('taking everyone off is refused on the screen; nothing is sent', async () => {
    detail(task());
    fireEvent.click(await screen.findByRole('button', { name: 'Who does it' }));
    fireEvent.click(screen.getByRole('option', { name: /Arun/ }));
    fireEvent.mouseDown(document.body);
    expect(toastError).toHaveBeenCalledWith('Keep at least one person on the task.');
    expect(patch).not.toHaveBeenCalled();
  });

  it('closing the picker with nothing changed sends nothing', async () => {
    detail(task());
    fireEvent.click(await screen.findByRole('button', { name: 'Who does it' }));
    fireEvent.click(screen.getByRole('option', { name: /Bala/ }));
    fireEvent.click(screen.getByRole('option', { name: /Bala/ }));
    fireEvent.mouseDown(document.body);
    expect(patch).not.toHaveBeenCalled();
  });

  it('Follow and Unfollow, without a revision (following never makes an edit stale)', async () => {
    patch.mockResolvedValueOnce({ task: task({ following: true, followers: [{ id: 'u1', name: 'Priya' }] }) })
      .mockResolvedValueOnce({ task: task() });
    detail(task());
    fireEvent.click(await screen.findByRole('button', { name: 'Follow' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1/followers', { add: ['u1'] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unfollow' }));
    await waitFor(() => expect(patch).toHaveBeenLastCalledWith('/staff/tasks/t1/followers', { remove: ['u1'] }));
    // The giver may see it anyway: no warning.
    expect(window.confirm).not.toHaveBeenCalledWith('Stop following? You will no longer see this task.');
  });

  it('someone who only follows is warned before unfollowing, and the panel closes after', async () => {
    const onClose = jest.fn();
    patch.mockResolvedValue({ task: null });
    detail(task({
      createdBy: { id: 'u9', name: 'Owner' }, following: true, followers: [{ id: 'u1', name: 'Priya' }],
      can: { ...can, edit: false, reassign: false, status: false, followers: false },
    }), {}, onClose);
    fireEvent.click(await screen.findByRole('button', { name: 'Unfollow' }));
    expect(window.confirm).toHaveBeenCalledWith('Stop following? You will no longer see this task.');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('the person doing it has no Follow button', async () => {
    detail(task(), { assignees: { people: people.people.map((p) => ({ ...p, me: p.id === 'u2' })) } });
    expect(await screen.findByText('Ask about the lift kit')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Follow' })).toBeNull();
  });

  it('the giver chooses followers (never the people doing it), saved once when the picker closes', async () => {
    patch.mockResolvedValue({ task: task({ followers: [{ id: 'u3', name: 'Bala' }] }) });
    detail(task());
    fireEvent.click(await screen.findByRole('button', { name: 'Choose followers' }));
    const list = screen.getByRole('listbox', { name: 'Followers' });
    expect(within(list).queryByRole('option', { name: /Arun/ })).toBeNull();
    fireEvent.click(within(list).getByRole('option', { name: /Bala/ }));
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1/followers', { add: ['u3'], remove: [] }));
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('the history says who changed the people and the followers', async () => {
    detail(task({ history: [
      { at: '2026-10-27T05:00:00Z', by: 'Priya', action: 'assignee', from: 'Arun', to: 'Arun, Bala' },
      { at: '2026-10-27T06:00:00Z', by: 'Priya', action: 'follower_added', from: '', to: 'Sam' },
    ] }));
    expect(await screen.findByText(/changed who does it to Arun, Bala \(was Arun\)/)).toBeInTheDocument();
    expect(screen.getByText(/added Sam as a follower/)).toBeInTheDocument();
  });

  it('"Following" lists the tasks you follow', async () => {
    serve({ list: [] });
    workspace();
    fireEvent.click(await screen.findByRole('button', { name: /Following/ }));
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=following&state=open'));
    expect(await screen.findByText('You aren’t following any tasks')).toBeInTheDocument();
  });

  it('the people pop-over opens below its button, flips above near the bottom, and stays inside the window', () => {
    const at = (top: number, left: number) => ({ top, bottom: top + 28, left, right: left + 120 });
    // Room below: just under the button.
    expect(placePopover(at(100, 50), 'left', 1280, 860)).toEqual({ top: 132, left: 50 });
    // Near the bottom: above it, pinned by its bottom edge.
    expect(placePopover(at(700, 50), 'left', 1280, 860)).toEqual({ bottom: 164, left: 50 });
    // Right-aligned near the left edge, or too far right: kept 8px inside.
    expect(placePopover(at(100, 0), 'right', 1280, 860)).toEqual({ top: 132, left: 8 });
    expect(placePopover(at(100, 1200), 'left', 1280, 860)).toEqual({ top: 132, left: 1280 - 304 - 8 });
  });

  it('an empty board draft stays open while its people picker is in use, and closes when you leave it', async () => {
    serve({ list: [task()] });
    localStorage.setItem('tasks-view-mode', 'board');
    workspace();
    const column = await screen.findByRole('region', { name: 'In progress' });
    fireEvent.click(within(column).getByRole('button', { name: /Add task/ }));
    const name = within(column).getByLabelText('New task in In progress');
    const chip = within(column).getByRole('button', { name: 'Add assignee' });
    fireEvent.click(chip);
    const search = await screen.findByRole('combobox', { name: 'Search assignees' });
    // The pop-over is drawn on the page, outside the column, so nothing clips it.
    expect(column.contains(search)).toBe(false);
    fireEvent.blur(name, { relatedTarget: search });
    expect(within(column).getByLabelText('New task in In progress')).toBeInTheDocument();
    fireEvent.blur(name, { relatedTarget: document.body });
    expect(within(column).queryByLabelText('New task in In progress')).toBeNull();
  });

  it('the board\'s "+ Add task" sets people, a date, priority and a tag; a retry keeps one clientId', async () => {
    serve({ list: [task()] });
    localStorage.setItem('tasks-view-mode', 'board');
    post.mockRejectedValueOnce({ status: 503, rawData: { message: 'Try again' } }).mockResolvedValue({ task: task(), tasks: [task()] });
    workspace();
    const column = await screen.findByRole('region', { name: 'In progress' });
    fireEvent.click(within(column).getByRole('button', { name: /Add task/ }));
    fireEvent.change(within(column).getByLabelText('New task in In progress'), { target: { value: 'Ring Bosch' } });
    fireEvent.click(within(column).getByRole('button', { name: 'Add assignee' }));
    fireEvent.click(await screen.findByRole('option', { name: /Bala/ }));
    fireEvent.click(screen.getByRole('option', { name: /Arun/ }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search assignees' }), { key: 'Escape' });
    // Escape closed the picker, not the draft.
    expect(within(column).getByLabelText('New task in In progress')).toHaveValue('Ring Bosch');
    fireEvent.click(within(column).getByRole('button', { name: /Add dates/ }));
    fireEvent.change(within(column).getByLabelText('Due date'), { target: { value: '2099-11-05' } });
    fireEvent.change(within(column).getByLabelText('Priority'), { target: { value: 'urgent' } });
    fireEvent.click(within(column).getByRole('button', { name: /Add tag/ }));
    fireEvent.change(within(column).getByLabelText('New tag'), { target: { value: '#Kochi' } });
    fireEvent.keyDown(within(column).getByLabelText('New tag'), { key: 'Enter' });
    expect(within(column).getByText('#kochi')).toBeInTheDocument();
    fireEvent.click(within(column).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    fireEvent.click(within(column).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const [sent, again] = post.mock.calls.map((c) => c[1]);
    expect(sent).toEqual({
      title: 'Ring Bosch', status: 'in_progress', assigneeIds: ['u3', 'u2'], shared: true,
      dueOn: '2099-11-05', priority: 'urgent', tags: ['kochi'], clientId: expect.any(String),
    });
    expect(again.clientId).toBe(sent.clientId);
    // Saved: the name clears for the next one, and a new one gets a new id.
    await waitFor(() => expect(within(column).getByLabelText('New task in In progress')).toHaveValue(''));
  });
});
