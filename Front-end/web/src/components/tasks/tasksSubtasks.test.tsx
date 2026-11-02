/**
 * Tasks phase 5b — the task window and sub-tasks.
 *
 * What must hold:
 *   - a task opens in a window: details, and the activity beside them; it can
 *     open as a full page; Escape that cancels an edit leaves the window open
 *   - previous / next (and J / K) follow the list as it is on screen, never
 *     while typing, and stop at the ends
 *   - every sub-task is listed under its parent; one the viewer may not open
 *     is shown, not linked; loading, empty and error (with a retry) each say so
 *   - "+ Add sub-task" sends the parent and ONE clientId per draft, kept on a
 *     failed try so a retry makes one, fresh after a success
 *   - a step made into a sub-task sends one clientId however often it is retried
 *   - completing a task with open sub-tasks, or archiving one with sub-tasks,
 *     asks first, and saying no sends nothing
 *   - a sub-task names its parent (in the window and on its row); a parent's row
 *     shows its "1/2"
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TasksWorkspace from './TasksWorkspace';
import TaskDetail from './TaskDetail';
import type { Subtask, Task } from './types';
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

const can = {
  edit: true, status: true, reassign: true, archive: true, restore: false, comment: true, checklist: true, files: true,
  follow: true, followers: true, subtask: true,
};
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', number: 20, code: 'T-20', title: 'Diwali stock check', summary: '', description: '',
  status: 'in_progress', statusLabel: 'In progress', priority: 'normal', priorityLabel: 'Normal',
  dueOn: null, startOn: null, tags: [], overdue: false, dueToday: false,
  assignees: [], followers: [], following: false, assignee: { id: 'u1', name: 'Priya' }, team: 'procurement', teamLabel: 'Procurement',
  createdBy: { id: 'u1', name: 'Priya' }, order: null, group: null, checklist: { done: 0, total: 0 }, bucket: 'open',
  parent: null, subtasks: { total: 0, done: 0 },
  completedAt: null, archivedAt: null, commentCount: 0, lastCommentAt: null,
  createdAt: '2026-11-01T04:00:00Z', updatedAt: '2026-11-01T04:00:00Z', rev: 3, can, history: [], checklistItems: [], ...over,
});
const sub = (over: Partial<Subtask> = {}): Subtask => ({
  ...task({
    id: 's1', number: 21, code: 'T-21', title: 'Count Bosch pads', status: 'todo', statusLabel: 'To do', rev: 2,
    parent: { id: 't1', code: 'T-20', title: 'Diwali stock check' }, assignees: [{ id: 'u2', name: 'Arun' }], can: { ...can, subtask: false },
  }),
  canOpen: true,
  ...over,
});
const people = { people: [
  { id: 'u1', name: 'Priya', team: 'procurement', teamLabel: 'Procurement', isHead: true, me: true },
  { id: 'u2', name: 'Arun', team: 'procurement', teamLabel: 'Procurement', isHead: false, me: false },
] };

/** GET router: lists, one task by id, its sub-tasks, comments. */
function serve({ list = [task()], tasks = {} as Record<string, Task>, subtasks = [] as Subtask[], subtasksError = false } = {}) {
  const all: Record<string, Task> = { t1: task(), ...tasks };
  get.mockImplementation((url: string) => {
    if (url === '/staff/tasks/summary') return Promise.resolve({ late: 0, today: 0 });
    if (url === '/staff/tasks/assignees') return Promise.resolve(people);
    if (url.startsWith('/staff/tasks?')) return Promise.resolve({ tasks: url.includes('state=done') ? [] : list, nextCursor: null });
    if (url.endsWith('/subtasks')) {
      return subtasksError
        ? Promise.reject({ status: 500, rawData: { message: 'The server is busy.' } })
        : Promise.resolve({ subtasks, total: subtasks.length, done: subtasks.filter((s) => s.status === 'done').length });
    }
    if (url.includes('/comments')) return Promise.resolve({ comments: [], nextBefore: null });
    const id = url.split('/')[3];
    return all[id] ? Promise.resolve({ task: all[id] }) : Promise.reject({ status: 404, rawData: { message: 'Task not found.' } });
  });
}
const confirm = jest.spyOn(window, 'confirm');
beforeEach(() => {
  localStorage.clear();
  [get, post, patch].forEach((f) => f.mockReset());
  addressBar.reset('/team/tasks');
  confirm.mockReset().mockReturnValue(true);
});
const workspace = () => wrap(<TasksWorkspace base="/team/tasks" canSeeTeam={false} />);
const openTask = async (title: string) => {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Open .*${title}`) }));
  return screen.findByRole('dialog', { name: 'Task' });
};
const openId = () => new URLSearchParams(addressBar.search).get('task');

describe('the task window', () => {
  it('shows the details with the activity beside them, and opens as a full page', async () => {
    serve();
    workspace();
    const win = await openTask('Diwali stock check');
    expect(await within(win).findByRole('button', { name: 'Edit title' })).toHaveTextContent('Diwali stock check');
    expect(within(win).getByRole('complementary', { name: 'Activity' })).toBeInTheDocument();
    expect(within(win).getByRole('link', { name: 'Open as a full page' })).toHaveAttribute('href', '/team/tasks/t1');
  });

  it('Escape that cancels an edit leaves the window open; the next Escape closes it', async () => {
    serve();
    workspace();
    const win = await openTask('Diwali stock check');
    fireEvent.click(await within(win).findByRole('button', { name: 'Edit title' }));
    fireEvent.keyDown(within(win).getByRole('textbox', { name: 'title' }), { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Task' })).toBeInTheDocument();
    expect(openId()).toBe('t1');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(openId()).toBeNull());
  });

  it('previous / next and J / K follow the list on screen, stop at the ends, and never fire while typing', async () => {
    const a = task({ id: 'a', code: 'T-1', title: 'Alpha', status: 'in_progress' });
    const b = task({ id: 'b', code: 'T-2', title: 'Bravo', status: 'waiting' });
    const c = task({ id: 'c', code: 'T-3', title: 'Charlie', status: 'todo' });
    // The server pages by due day; the list shows In progress, Waiting, To do — that order counts.
    serve({ list: [c, b, a], tasks: { a, b, c } });
    workspace();
    const win = await openTask('Bravo');
    expect(await within(win).findByText('2 of 3')).toBeInTheDocument();
    fireEvent.click(within(win).getByRole('button', { name: 'Next task' }));
    await waitFor(() => expect(openId()).toBe('c'));
    expect(await screen.findByText('3 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next task' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'k' });
    await waitFor(() => expect(openId()).toBe('b'));
    fireEvent.keyDown(window, { key: 'K' });
    await waitFor(() => expect(openId()).toBe('a'));
    expect(await screen.findByText('1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous task' })).toBeDisabled();
    // Typing a J in a field is typing, not moving.
    fireEvent.click(await screen.findByRole('button', { name: 'Edit title' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'title' }), { key: 'j' });
    expect(openId()).toBe('a');
  });

  it('a task that is not in the list on screen (opened from a link) has no previous / next', async () => {
    serve({ list: [], tasks: { x: task({ id: 'x', title: 'From a link' }) } });
    addressBar.reset('/team/tasks', 'task=x');
    workspace();
    const win = await screen.findByRole('dialog', { name: 'Task' });
    expect(await within(win).findByRole('button', { name: 'Edit title' })).toHaveTextContent('From a link');
    expect(within(win).queryByRole('button', { name: 'Next task' })).toBeNull();
  });
});

describe('sub-tasks under a task', () => {
  const parent = task({ subtasks: { total: 2, done: 1 } });

  it('lists every one, links only those the viewer may open, and opening one switches the window', async () => {
    serve({
      list: [parent], tasks: { t1: parent, s1: sub() },
      subtasks: [sub(), sub({ id: 's2', code: 'T-22', title: 'Count wipers', status: 'done', bucket: 'done', canOpen: false })],
    });
    workspace();
    const win = await openTask('Diwali stock check');
    const section = await within(win).findByRole('region', { name: 'Sub-tasks' });
    expect(await within(section).findByText('1 of 2 done')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Count Bosch pads' })).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Count wipers' })).toBeNull();
    expect(within(section).getByText('Count wipers')).toBeInTheDocument();
    expect(within(section).getByLabelText('You can’t open this one')).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Count Bosch pads' }));
    await waitFor(() => expect(openId()).toBe('s1'));
    // The sub-task names its parent, and going up switches back.
    const up = await screen.findByRole('button', { name: /T-20 Diwali stock check/ });
    expect(screen.queryByRole('region', { name: 'Sub-tasks' })).toBeNull(); // one level only
    fireEvent.click(up);
    await waitFor(() => expect(openId()).toBe('t1'));
  });

  it('on a page of its own, sub-tasks and the parent are links', async () => {
    serve({ tasks: { t1: parent, s1: sub() }, subtasks: [sub()] });
    const { unmount } = wrap(<TaskDetail id="t1" base="/team/tasks" />);
    expect(await screen.findByRole('link', { name: 'Count Bosch pads' })).toHaveAttribute('href', '/team/tasks/s1');
    unmount();
    wrap(<TaskDetail id="s1" base="/team/tasks" />);
    expect(await screen.findByRole('link', { name: /T-20 Diwali stock check/ })).toHaveAttribute('href', '/team/tasks/t1');
  });

  it('says when it could not load them, and "Try again" asks again', async () => {
    serve({ tasks: { t1: parent }, subtasksError: true });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    const alert = await screen.findByText('The server is busy.');
    serve({ tasks: { t1: parent }, subtasks: [sub()] });
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Count Bosch pads' })).toBeInTheDocument();
  });

  it('ticking one moves it against its own revision', async () => {
    serve({ tasks: { t1: parent }, subtasks: [sub()] });
    patch.mockResolvedValue({ task: sub({ status: 'done' }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark T-21 complete' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/s1', { rev: 2, status: 'done' }));
  });

  it('none yet: says so; "+ Add sub-task" sends the parent and one clientId, kept for a retry, fresh after a success', async () => {
    serve({ tasks: { t1: task() } });
    post
      .mockRejectedValueOnce({ status: 503, rawData: { message: 'Try again in a moment.' } })
      .mockResolvedValue({ task: sub() });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    expect(await screen.findByText(/No sub-tasks yet/)).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'New sub-task' });
    fireEvent.change(box, { target: { value: 'Count Bosch pads' } });
    fireEvent.click(screen.getByRole('button', { name: 'Who does the sub-task' }));
    fireEvent.click(await screen.findByRole('option', { name: /Arun/ }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search assignees' }), { key: 'Escape' });
    fireEvent.submit(box.closest('form')!);
    expect(await screen.findByText('Try again in a moment.')).toBeInTheDocument();
    expect(box).toHaveValue('Count Bosch pads');
    fireEvent.submit(box.closest('form')!);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const [first, second] = post.mock.calls.map((c) => c[1]);
    expect(first).toEqual({ title: 'Count Bosch pads', parentId: 't1', clientId: expect.any(String), shared: true, assigneeIds: ['u2'] });
    expect(second.clientId).toBe(first.clientId);
    await waitFor(() => expect(box).toHaveValue(''));
    fireEvent.change(box, { target: { value: 'Count wipers' } });
    fireEvent.submit(box.closest('form')!);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(post.mock.calls[2][1].clientId).not.toBe(first.clientId);
    expect(post.mock.calls[2][1].assigneeIds).toEqual(['u2']); // who stays for the next one
  });

  it('someone who may not add sees the list without the add row; a task with none and no right to add shows nothing', async () => {
    serve({ tasks: { t1: task({ subtasks: { total: 1, done: 0 }, can: { ...can, subtask: false } }) }, subtasks: [sub()] });
    const { unmount } = wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    expect(await screen.findByRole('link', { name: 'Count Bosch pads' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'New sub-task' })).toBeNull();
    unmount();
    get.mockClear();
    serve({ tasks: { t1: task({ can: { ...can, subtask: false } }) } });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    await screen.findByRole('button', { name: 'Edit title' });
    expect(screen.queryByRole('region', { name: 'Sub-tasks' })).toBeNull();
    expect(get.mock.calls.map((c) => c[0])).not.toContain('/staff/tasks/t1/subtasks');
  });
});

describe('asking first', () => {
  const parent = task({ subtasks: { total: 3, done: 1 } });

  it('completing a task with open sub-tasks asks; "no" sends nothing, "yes" completes it', async () => {
    serve({ tasks: { t1: parent }, subtasks: [] });
    patch.mockResolvedValue({ task: { ...parent, status: 'done' } });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    const status = await screen.findByRole('combobox', { name: 'Status' });
    confirm.mockReturnValueOnce(false);
    fireEvent.change(status, { target: { value: 'done' } });
    expect(confirm).toHaveBeenCalledWith('2 sub-tasks are still open. Complete anyway?');
    expect(patch).not.toHaveBeenCalled();
    fireEvent.change(status, { target: { value: 'done' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, status: 'done' }));
  });

  it('the same from the list\'s tick', async () => {
    serve({ list: [parent], tasks: { t1: parent } });
    confirm.mockReturnValue(false);
    workspace();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark T-20 complete' }));
    expect(confirm).toHaveBeenCalledWith('2 sub-tasks are still open. Complete anyway?');
    expect(patch).not.toHaveBeenCalled();
  });

  it('archiving a task with sub-tasks says they go with it', async () => {
    serve({ tasks: { t1: parent } });
    confirm.mockReturnValue(false);
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    expect(confirm).toHaveBeenCalledWith('Archive this task and its 3 sub-tasks? They move to Archived and can be restored together.');
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('a step becomes a sub-task', () => {
  it('sends one clientId however often it is retried', async () => {
    const withStep = task({ checklistItems: [{ id: 'c1', text: 'Count wipers', done: false, doneAt: null, doneBy: '' }], checklist: { done: 0, total: 1 } });
    serve({ tasks: { t1: withStep } });
    post
      .mockRejectedValueOnce({ status: 503, rawData: { message: 'Try again in a moment.' } })
      .mockResolvedValue({ task: task(), subtask: sub({ title: 'Count wipers' }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    const make = await screen.findByRole('button', { name: 'Make Count wipers a sub-task' });
    fireEvent.click(make);
    expect(await screen.findByText('Try again in a moment.')).toBeInTheDocument();
    fireEvent.click(make);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[0][0]).toBe('/staff/tasks/t1/checklist/c1/subtask');
    expect(post.mock.calls[1][1].clientId).toBe(post.mock.calls[0][1].clientId);
  });
});

describe('rows and history', () => {
  it('a sub-task\'s row names its parent; a parent\'s row shows its count', async () => {
    serve({ list: [task({ subtasks: { total: 2, done: 1 } }), sub()] });
    workspace();
    expect(await screen.findByTitle('1 of 2 sub-tasks done')).toHaveTextContent('1/2');
    expect(screen.getByTitle('A sub-task of T-20 Diwali stock check')).toHaveTextContent('in T-20 Diwali stock check');
  });

  it('the activity says what happened to sub-tasks', async () => {
    serve({ tasks: { t1: task({ history: [
      { at: '2026-11-01T05:00:00Z', by: 'Priya', action: 'subtask_added', from: '', to: 'T-21 Count Bosch pads' },
      { at: '2026-11-01T05:01:00Z', by: 'Priya', action: 'check_to_subtask', from: 'Count wipers', to: 'T-22' },
      { at: '2026-11-01T05:02:00Z', by: 'Priya', action: 'archived', from: '', to: 'with T-20' },
    ] }) } });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    expect(await screen.findByText(/added the sub-task T-21 Count Bosch pads/)).toBeInTheDocument();
    expect(screen.getByText(/made the step "Count wipers" into the sub-task T-22/)).toBeInTheDocument();
    expect(screen.getByText(/archived it with T-20/)).toBeInTheDocument();
  });
});
