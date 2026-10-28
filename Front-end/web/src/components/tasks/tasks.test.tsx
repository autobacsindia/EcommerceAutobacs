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
import { initialsOf, toneFor } from './ui';
import { formatDueDay, isPastDay, todayIST, type Task } from './types';

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
let search = '';
const replace = jest.fn((url: string) => { search = url.split('?')[1] ?? ''; });
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace }),
  usePathname: () => '/team/tasks',
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
// Motion off: elements appear and disappear at once.
jest.mock('framer-motion', () => {
  const MOTION = new Set(['initial', 'animate', 'exit', 'transition']);
  const strip = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([k]) => !MOTION.has(k)));
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
      div: (p: Record<string, unknown>) => <div {...strip(p)} />,
      aside: (p: Record<string, unknown>) => <aside {...strip(p)} />,
    },
  };
});

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const can = { edit: true, status: true, reassign: true, archive: true, restore: false, comment: true, checklist: true };
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', number: 7, code: 'T-7', title: 'Call Bosch', summary: '', description: 'Ask about the lift kit',
  status: 'todo', statusLabel: 'To do', priority: 'high', priorityLabel: 'High',
  dueOn: '2026-10-27', overdue: false, dueToday: true,
  assignee: { id: 'u2', name: 'Arun' }, team: 'procurement', teamLabel: 'Procurement',
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
  [get, post, patch, remove, toastSuccess, toastError, replace].forEach((f) => f.mockClear());
  get.mockReset(); post.mockReset(); patch.mockReset(); remove.mockReset();
  search = '';
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

const workspace = (props: Partial<{ base: string; canSeeTeam: boolean }> = {}) =>
  wrap(<TasksWorkspace base={props.base ?? '/team/tasks'} canSeeTeam={props.canSeeTeam ?? false} />);

describe('the Tasks page', () => {
  it('groups open tasks by status, each with "+ Add task"; Done is folded until opened', async () => {
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
    fireEvent.click(within(await group('Done')).getByRole('button', { name: /Done/ }));
    expect(await screen.findByText('Old job')).toBeInTheDocument();
    expect(listCalls()).toContain('/staff/tasks?view=mine&state=done');
  });

  it('shows late / due-today counters that filter the list', async () => {
    serve({ summary: { late: 3, today: 2 } });
    workspace();
    fireEvent.click(await screen.findByRole('button', { name: /3 late/ }));
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=mine&state=open&due=overdue'));
    fireEvent.click(screen.getByRole('button', { name: /2 due today/ }));
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=mine&state=open&due=today'));
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
    expect(screen.getByRole('button', { name: 'For me' })).toHaveAttribute('aria-pressed', 'true');
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
    search = 'due=late';
    serve();
    workspace();
    await screen.findByText('Call Bosch');
    expect(listCalls()).toContain('/staff/tasks?view=mine&state=open&due=late');
  });

  it('ticking the circle marks a task done, with the revision; a refused tick says why', async () => {
    serve();
    patch.mockResolvedValueOnce({ task: task({ status: 'done', rev: 4 }) }).mockRejectedValueOnce({ status: 409 });
    workspace();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark T-7 done' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, status: 'done' }));
    expect(toastSuccess).toHaveBeenCalledWith('T-7 done', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Mark T-7 done' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('changed by someone else')));
  });

  it('without permission the circle is not a button', async () => {
    serve({ list: [task({ can: { ...can, status: false } })] });
    workspace();
    await screen.findByText('Call Bosch');
    expect(screen.queryByRole('button', { name: 'Mark T-7 done' })).toBeNull();
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

  it('explains how tasks work until hidden, and remembers that', async () => {
    serve();
    const { unmount } = workspace();
    expect(await screen.findByText('How tasks work')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide how tasks work' }));
    expect(screen.queryByText('How tasks work')).toBeNull();
    unmount();
    workspace();
    await screen.findByText('Call Bosch');
    expect(screen.queryByText('How tasks work')).toBeNull();
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
    expect(await within(col('Done')).findByText('Old job')).toBeInTheDocument();
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
    fireEvent.drop(col('Done'), { dataTransfer: dt('t1') });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('T-7 was changed by someone else')));
    await waitFor(() => expect(within(col('To do')).getByText('Call Bosch')).toBeInTheDocument());
  });

  it('cards you may not move cannot be dragged, dropped or picked', async () => {
    await board([task({ can: { ...can, status: false } })]);
    const card = await screen.findByRole('button', { name: 'Open T-7: Call Bosch' });
    expect(card).toHaveAttribute('draggable', 'false');
    fireEvent.drop(col('Done'), { dataTransfer: dt('t1') });
    expect(patch).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Move T-7')).toBeNull();
  });

  it('on a phone, "Move to" on the card does the same move', async () => {
    patch.mockResolvedValue({ task: task({ status: 'waiting', rev: 4 }) });
    await board([task()]);
    fireEvent.change(await screen.findByLabelText('Move T-7'), { target: { value: 'waiting' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, status: 'waiting' }));
  });

  it('a date filter shows only what is still to do (no Done column)', async () => {
    await board([task()]);
    await screen.findByText('Call Bosch');
    fireEvent.click(screen.getByRole('button', { name: 'Late' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Done' })).toBeNull());
  });
});

describe('new task', () => {
  const openForm = async (props: Partial<{ base: string; canSeeTeam: boolean }> = {}) => {
    workspace(props);
    await screen.findByText(/Nothing on your plate|Call Bosch/);
    fireEvent.keyDown(window, { key: 'n' });
    return screen.findByRole('dialog', { name: 'New task' });
  };

  it('opens with N; a head ticks someone; pressing Create twice sends ONE clientId', async () => {
    serve({ list: [] });
    post.mockRejectedValueOnce({ status: 503, rawData: { message: 'Try again' } }).mockResolvedValue({ task: task(), tasks: [task()] });
    const dialog = await openForm({ canSeeTeam: true });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Pack order 51234' } });
    expect(await within(dialog).findByRole('checkbox', { name: /Priya \(me\)/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Priya \(me\)/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Arun/ }));
    fireEvent.change(within(dialog).getByLabelText('Due date'), { target: { value: '2099-10-30' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Try again');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const [first, second] = post.mock.calls.map((c) => c[1]);
    expect(first).toMatchObject({ title: 'Pack order 51234', assigneeIds: ['u2'], dueOn: '2099-10-30', priority: 'normal', orderId: null });
    expect(second.clientId).toBe(first.clientId);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Task created'));
    // The new task opens in the side panel.
    expect(replace).toHaveBeenLastCalledWith('/team/tasks?task=t1', { scroll: false });
  });

  it('heads are labelled as heads; several ticked people make one copy each, in list order', async () => {
    serve({ list: [] });
    post.mockResolvedValue({ task: task(), tasks: [task(), task(), task()] });
    const dialog = await openForm({ base: '/admin/tasks', canSeeTeam: true });
    expect(await within(dialog).findByText('Priya (me) · Procurement head')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Stock count' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Bala/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Arun/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 3 tasks' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks', expect.objectContaining({ assigneeIds: ['u1', 'u2', 'u3'] })));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('3 tasks created'));
  });

  it('a member adds only for themselves; nobody ticked cannot be created; steps go one per line', async () => {
    serve({ list: [], assignees: { people: [{ ...people.people[1], me: true }] } });
    post.mockResolvedValue({ task: task(), tasks: [task()] });
    const dialog = await openForm();
    expect(await within(dialog).findByText(/This task is for you/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Mine' } });
    fireEvent.change(within(dialog).getByLabelText('Checklist steps'), { target: { value: 'Pack\n\n  Label  \n' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks', expect.objectContaining({ assigneeIds: ['u2'], checklist: ['Pack', 'Label'] })));
  });

  it('nobody ticked: says so and cannot create', async () => {
    serve({ list: [] });
    const dialog = await openForm({ canSeeTeam: true });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'x' } });
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: /Priya \(me\)/ }));
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
    fireEvent.change(await screen.findByLabelText('Who does it'), { target: { value: 'u3' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', expect.objectContaining({ assigneeId: 'u3' })));
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
      { comments: [{ id: 'm1', by: { id: 'u2', name: 'Arun' }, text: 'Bosch says Friday', createdAt: '2026-10-27T05:00:00Z' }] },
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
    expect(toneFor('u1')).toBe(toneFor('u1'));
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
