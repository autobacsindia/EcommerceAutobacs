/**
 * The Tasks list's tools: groups, order, tags, start dates, team "spaces" and
 * changing several tasks at once. What must hold: grouping never reorders the
 * server's order inside a group; a bulk change names every task's revision and
 * says which were refused; a tag is cleaned the way the server cleans it; a start
 * date after the due date can never be sent.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TasksWorkspace from './TasksWorkspace';
import TaskDetail from './TaskDetail';
import { dueBucket, groupTasks } from './grouping';
import { cleanTag, type Task } from './types';
import { addressBar } from '@/test-utils/addressBarMock';

const get = jest.fn();
const post = jest.fn();
const patch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), delete: jest.fn() },
}));
const toastSuccess = jest.fn();
const toastError = jest.fn();
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const can = { edit: true, status: true, reassign: true, archive: true, restore: false, comment: true, checklist: true, files: true, follow: true, followers: true };
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', number: 7, code: 'T-7', title: 'Call Bosch', summary: '', description: '',
  status: 'todo', statusLabel: 'To do', priority: 'high', priorityLabel: 'High',
  dueOn: '2099-10-27', startOn: null, tags: [], overdue: false, dueToday: false,
  assignees: [], followers: [], following: false, assignee: { id: 'u2', name: 'Arun Kumar' }, team: 'procurement', teamLabel: 'Procurement',
  createdBy: { id: 'u1', name: 'Priya' }, order: null, group: null, checklist: { done: 0, total: 0 }, bucket: 'open',
  completedAt: null, archivedAt: null, commentCount: 0, lastCommentAt: null,
  createdAt: '2026-10-27T04:00:00Z', updatedAt: '2026-10-27T04:00:00Z', rev: 3, can, history: [], ...over,
});
const people = { people: [
  { id: 'u1', name: 'Priya', team: 'procurement', teamLabel: 'Procurement', isHead: true, me: true },
  { id: 'u2', name: 'Arun Kumar', team: 'procurement', teamLabel: 'Procurement', isHead: false, me: false },
  { id: 'u3', name: 'Bala', team: 'procurement', teamLabel: 'Procurement', isHead: false, me: false },
] };
function serve({ list = [task()], one = task() } = {}) {
  get.mockImplementation((url: string) => {
    if (url === '/staff/tasks/summary') return Promise.resolve({ late: 0, today: 0 });
    if (url === '/staff/tasks/assignees') return Promise.resolve(people);
    if (url.startsWith('/staff/tasks?') && url.includes('state=done')) return Promise.resolve({ tasks: [], nextCursor: null });
    if (url.startsWith('/staff/tasks?')) return Promise.resolve({ tasks: list, nextCursor: null });
    if (url.includes('/comments')) return Promise.resolve({ comments: [], nextBefore: null });
    if (url.startsWith('/staff/tasks/')) return Promise.resolve({ task: one });
    return Promise.resolve({ orders: [] });
  });
}
const listCalls = () => get.mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith('/staff/tasks?'));
const workspace = (props: Partial<{ base: string; canSeeTeam: boolean }> = {}) =>
  wrap(<TasksWorkspace base={props.base ?? '/team/tasks'} canSeeTeam={props.canSeeTeam ?? false} />);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('tasks-help-hidden', '1');
  addressBar.reset('/team/tasks');
  [get, post, patch, toastSuccess, toastError].forEach((f) => f.mockReset());
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('grouping', () => {
  const t = (id: string, over: Partial<Task>) => task({ id, code: `T-${id}`, ...over });
  const today = '2026-11-02';

  it('by status: in progress, then to do (no "Waiting", like ClickUp) — empty ones kept unless asked; order inside kept', () => {
    const rows = [t('1', { status: 'todo' }), t('2', { status: 'in_progress' }), t('3', { status: 'todo' })];
    expect(groupTasks(rows, 'status', { today }).map((g) => [g.label, g.tasks.map((x) => x.id)]))
      .toEqual([['In progress', ['2']], ['To do', ['1', '3']]]);
    const todoOnly = [t('1', { status: 'todo' })];
    expect(groupTasks(todoOnly, 'status', { today }).map((g) => [g.label, g.tasks.length])).toEqual([['In progress', 0], ['To do', 1]]);
    expect(groupTasks(todoOnly, 'status', { today, hideEmpty: true }).map((g) => g.label)).toEqual(['To do']);
    expect(groupTasks(rows, 'status', { today })[1].addStatus).toBe('todo');
  });

  it('by priority (most urgent first), by person (by name), or not at all', () => {
    const rows = [t('1', { priority: 'low' }), t('2', { priority: 'urgent' }), t('3', { priority: 'low', assignee: { id: 'u9', name: 'Bala' } })];
    expect(groupTasks(rows, 'priority', { today }).map((g) => [g.label, g.tasks.length])).toEqual([['Urgent', 1], ['Low', 2]]);
    expect(groupTasks(rows, 'assignee', { today }).map((g) => [g.label, g.tasks.length])).toEqual([['Arun Kumar', 2], ['Bala', 1]]);
    expect(groupTasks(rows, 'none', { today })[0].tasks).toHaveLength(3);
    expect(groupTasks(rows, 'priority', { today }).every((g) => !g.addStatus)).toBe(true);
  });

  it('by due date: late, today, tomorrow, next 7 days, later, none — across a month end', () => {
    const d = (dueOn: string | null) => dueBucket({ dueOn }, '2026-10-30').value;
    expect([d('2026-10-29'), d('2026-10-30'), d('2026-10-31'), d('2026-11-05'), d('2026-11-06'), d(null)])
      .toEqual(['late', 'today', 'tomorrow', 'week', 'later', 'none']);
    const rows = [t('1', { dueOn: null }), t('2', { dueOn: '2026-11-01' }), t('3', { dueOn: '2026-11-02' })];
    expect(groupTasks(rows, 'due', { today }).map((g) => g.value)).toEqual(['late', 'today', 'none']);
  });

  it('a tag is cleaned the way the server cleans it', () => {
    expect(cleanTag('  #Kochi   Warehouse ')).toBe('kochi warehouse');
    expect(cleanTag('#')).toBe('');
  });
});

describe('the list', () => {
  it('has columns, shows tags, and a tag click filters the list (and again clears it)', async () => {
    serve({ list: [task({ tags: ['supplier', 'kochi', 'urgent'], order: { id: 'o1', code: '#51234' } })] });
    workspace();
    const region = await screen.findByRole('region', { name: 'To do' });
    expect(within(region).getAllByText('#51234').length).toBeGreaterThan(0);
    expect(within(region).getAllByText('+1').length).toBeGreaterThan(0);
    fireEvent.click(within(region).getAllByRole('button', { name: 'supplier' })[0]);
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=mine&state=open&tag=supplier'));
    fireEvent.click(screen.getByRole('button', { name: 'Stop filtering by supplier' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop filtering by supplier' })).toBeNull());
  });

  it('the grouping is remembered on this device; the order is in the address and asked of the server', async () => {
    serve({ list: [task(), task({ id: 't2', code: 'T-8', title: 'Pack', assignee: { id: 'u3', name: 'Bala' } })] });
    const { unmount } = workspace();
    await screen.findByText('Pack');
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'assignee' } });
    expect(await screen.findByRole('region', { name: 'Arun Kumar' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Bala' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'updated' } });
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=mine&state=open&sort=updated'));
    expect(addressBar.search).toBe('sort=updated');
    unmount();
    workspace();
    expect(await screen.findByRole('region', { name: 'Bala' })).toBeInTheDocument();
    expect(screen.getByLabelText('Sort')).toHaveValue('updated');
  });

  it('the admin picks a team from the side list; a head has no team list of their own', async () => {
    serve();
    const head = workspace({ canSeeTeam: true });
    await screen.findByText('Call Bosch');
    expect(screen.queryByRole('group', { name: 'Teams' })).toBeNull();
    head.unmount();
    workspace({ base: '/admin/tasks', canSeeTeam: true });
    const teams = await screen.findByRole('group', { name: 'Teams' });
    fireEvent.click(within(teams).getByRole('button', { name: 'Procurement' }));
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=team&state=open&team=procurement'));
    expect(screen.getByRole('heading', { level: 1, name: /Procurement tasks/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All teams' }));
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=team&state=open'));
  });
});

describe('changing several tasks at once', () => {
  const rows = [task(), task({ id: 't2', code: 'T-8', title: 'Pack', rev: 9 }), task({ id: 't3', code: 'T-9', title: 'Ship', rev: 2 })];

  it('ticked tasks get a bar; a change goes once, naming each task and its revision', async () => {
    serve({ list: rows });
    post.mockResolvedValue({ results: [], changed: 2, unchanged: 0, failed: 0 });
    workspace();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select T-7' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select T-8' }));
    const bar = screen.getByRole('toolbar', { name: '2 selected tasks' });
    fireEvent.change(within(bar).getByLabelText('Set status'), { target: { value: 'in_progress' } });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/bulk', {
      items: [{ id: 't1', rev: 3 }, { id: 't2', rev: 9 }], changes: { status: 'in_progress' },
    }));
    expect(toastSuccess).toHaveBeenCalledWith('2 tasks updated', expect.anything());
    fireEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('a whole group is ticked from its heading; refusals are named in the message', async () => {
    serve({ list: rows });
    post.mockResolvedValue({
      results: [{ id: 't1', ok: true, changed: true }, { id: 't2', ok: false, status: 403, error: 'Only whoever gave this task can change it.' }, { id: 't3', ok: true, changed: false }],
      changed: 1, unchanged: 1, failed: 1,
    });
    workspace();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select every task in To do' }));
    const bar = screen.getByRole('toolbar', { name: '3 selected tasks' });
    fireEvent.change(within(bar).getByLabelText('Set priority'), { target: { value: 'urgent' } });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('2 updated, 1 not changed.'), expect.anything()));
    expect(toastError.mock.calls[0][0]).toContain('T-8: Only whoever gave this task can change it.');
  });

  it('adds a tag (cleaned) and deletes (to Trash) after a confirm', async () => {
    serve({ list: rows });
    post.mockResolvedValue({ results: [], changed: 1, unchanged: 0, failed: 0 });
    workspace();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select T-9' }));
    const bar = screen.getByRole('toolbar', { name: '1 selected task' });
    fireEvent.click(within(bar).getByRole('button', { name: /Tag/ }));
    const input = within(bar).getByLabelText('Tag to add');
    fireEvent.change(input, { target: { value: '#Diwali ' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/bulk', { items: [{ id: 't3', rev: 2 }], changes: { addTags: ['diwali'] } }));
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    fireEvent.click(within(bar).getByRole('button', { name: /Delete/ }));
    expect(post).toHaveBeenCalledTimes(1);
    fireEvent.click(within(bar).getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/staff/tasks/bulk', { items: [{ id: 't3', rev: 2 }], changes: { archived: true } }));
  });

  it('a new filter starts a new selection', async () => {
    serve({ list: rows });
    workspace();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select T-7' }));
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Priority filter'), { target: { value: 'urgent' } });
    await waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());
  });
});

describe('tags and start dates on a task', () => {
  it('the new-task form cleans tags as typed and never sends a start after the due date', async () => {
    serve({ list: [] });
    post.mockResolvedValue({ task: task(), tasks: [task()] });
    workspace();
    await screen.findByText('Nothing on your plate');
    fireEvent.keyDown(window, { key: 'n' });
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Stock count' } });
    const tags = within(dialog).getByLabelText('Tags');
    fireEvent.change(tags, { target: { value: '#Kochi' } });
    fireEvent.keyDown(tags, { key: 'Enter' });
    fireEvent.change(tags, { target: { value: 'Supplier,' } });
    fireEvent.change(tags, { target: { value: 'kochi' } });
    fireEvent.keyDown(tags, { key: 'Enter' });
    expect(within(dialog).getByRole('button', { name: 'Remove tag kochi' })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Due date'), { target: { value: '2099-11-10' } });
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: '2099-11-12' } });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The start date is after the due date.');
    expect(within(dialog).getByRole('button', { name: 'Create task' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: '2099-11-08' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks', expect.objectContaining({
      tags: ['kochi', 'supplier'], startOn: '2099-11-08', dueOn: '2099-11-10',
    })));
  });

  it('the task panel edits tags and the start date with the revision, and reads them in the history', async () => {
    patch.mockResolvedValue({ task: task({ rev: 4 }) });
    serve({ one: task({ tags: ['kochi'], history: [{ at: '2026-10-27T05:00:00Z', by: 'Priya', action: 'tags', from: 'none', to: 'kochi' }] }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" />);
    expect(await screen.findByText(/set the tags to kochi/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag kochi' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, tags: [] }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2099-10-20' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 4, startOn: '2099-10-20' }));
  });

  it('someone who may not edit sees tags and the start date, but cannot change them', async () => {
    serve({ one: task({ tags: ['kochi'], startOn: '2099-10-20', can: { ...can, edit: false } }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" />);
    expect(await screen.findByText('kochi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove tag kochi' })).toBeNull();
    expect(screen.queryByLabelText('Start date')).toBeNull();
  });
});
