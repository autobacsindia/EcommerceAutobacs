/**
 * Folders and lists in a team's space: the side menu tree, a list's page, making
 * and deleting them, and moving a task between lists. The server decides who may
 * (tests/staffTaskLists.test.js); these pin what the screen shows and sends.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TasksWorkspace from './TasksWorkspace';
import TaskDetail from './TaskDetail';
import { type Task } from './types';
import { type Space } from './spaces';
import { addressBar } from '@/test-utils/addressBarMock';

const get = jest.fn();
const post = jest.fn();
const patch = jest.fn();
const del = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a), delete: (...a: unknown[]) => del(...a),
  },
}));
const toastSuccess = jest.fn();
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: (...a: unknown[]) => toastSuccess(...a), error: jest.fn(), dismiss: jest.fn() } }));
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
  status: 'todo', statusLabel: 'To do', priority: 'normal', priorityLabel: 'Normal',
  dueOn: null, startOn: null, tags: [], overdue: false, dueToday: false,
  assignees: [], followers: [], following: false, assignee: { id: 'u2', name: 'Arun' }, team: 'procurement', teamLabel: 'Procurement',
  createdBy: { id: 'u1', name: 'Priya' }, order: null, group: null, list: null, checklist: { done: 0, total: 0 }, bucket: 'open',
  completedAt: null, archivedAt: null, commentCount: 0, lastCommentAt: null,
  createdAt: '2026-10-27T04:00:00Z', updatedAt: '2026-10-27T04:00:00Z', rev: 3, can,
  history: [], ...over,
});
const item = (id: string, name: string, over: Partial<Space['lists'][number]> = {}) => ({ id, kind: 'list' as const, name, colour: 'red', folderId: null, rev: 1, open: 0, ...over });
const space = (over: Partial<Space> = {}): Space => ({
  team: 'procurement', teamLabel: 'Procurement', canManage: false,
  folders: [{ ...item('f1', 'Suppliers', { kind: 'folder', colour: 'gray' }), lists: [item('l1', 'Bosch orders', { folderId: 'f1', open: 6 })] }],
  lists: [item('l2', 'Weekly stock check', { colour: 'green', open: 4 })],
  other: 8,
  colours: ['gray', 'red', 'green', 'blue'],
  ...over,
});

function serve({ sp = space(), one = task() }: { sp?: Space; one?: Task } = {}) {
  get.mockImplementation((url: string) => {
    if (url.startsWith('/staff/tasks/space')) return Promise.resolve({ space: sp });
    if (url === '/staff/tasks/summary') return Promise.resolve({ late: 0, today: 0 });
    if (url === '/staff/tasks/assignees') return Promise.resolve({ people: [{ id: 'u1', name: 'Priya', team: 'procurement', teamLabel: 'Procurement', isHead: true, me: true }] });
    if (url.startsWith('/staff/tasks?')) return Promise.resolve({ tasks: [task({ list: 'l1' })], nextCursor: null });
    if (url.includes('/comments')) return Promise.resolve({ comments: [], nextBefore: null });
    if (url.includes('/links')) return Promise.resolve({ waitingOn: [], blocking: [], related: [], hidden: 0, hiddenWaiting: 0, canAdd: false });
    if (url.startsWith('/staff/tasks/')) return Promise.resolve({ task: one });
    return Promise.resolve({ orders: [] });
  });
}
const listCalls = () => get.mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith('/staff/tasks?'));
const member = (over = {}) => wrap(<TasksWorkspace base="/team/tasks" canSeeTeam myTeam="procurement" myTeamLabel="Procurement" {...over} />);

beforeEach(() => {
  localStorage.clear();
  [get, post, patch, del, toastSuccess].forEach((f) => f.mockReset());
  addressBar.reset('/team/tasks');
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('the side menu', () => {
  it('shows the team, its folders and lists with open counts, and Other tasks; a member cannot arrange them', async () => {
    serve();
    member();
    const tree = await screen.findByRole('group', { name: 'Procurement space' });
    expect(await within(tree).findByRole('button', { name: /Bosch orders\s*6/ })).toBeInTheDocument();
    expect(within(tree).getByRole('button', { name: /Weekly stock check\s*4/ })).toBeInTheDocument();
    expect(within(tree).getByRole('button', { name: /Other tasks\s*8/ })).toBeInTheDocument();
    expect(within(tree).getByRole('button', { name: /Suppliers/ })).toHaveAttribute('aria-expanded', 'true');
    expect(within(tree).queryByRole('button', { name: /New folder or list/ })).toBeNull();
    expect(within(tree).queryByRole('button', { name: /More actions for/ })).toBeNull();
  });

  it('a list opens its own page: only its tasks, its name, where it is; Other tasks asks for no list', async () => {
    serve();
    member();
    const tree = await screen.findByRole('group', { name: 'Procurement space' });
    fireEvent.click(await within(tree).findByRole('button', { name: /Bosch orders/ }));
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=team&state=open&list=l1'));
    expect(await screen.findByRole('heading', { level: 1, name: /Bosch orders/ })).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(crumbs).toHaveTextContent(/Tasks.*Procurement.*Suppliers.*Bosch orders/);
    expect(screen.getByText('New tasks made here go straight into this list.')).toBeInTheDocument();

    fireEvent.click(within(tree).getByRole('button', { name: /Other tasks/ }));
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=team&state=open&list=none'));
    // The team itself: every task in the space.
    fireEvent.click(within(tree).getByRole('button', { name: 'Procurement' }));
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=team&state=open'));
    expect(screen.getByRole('heading', { level: 1, name: /Procurement tasks/ })).toBeInTheDocument();
  });

  it('a folder folds away and stays folded', async () => {
    serve();
    const { unmount } = member();
    const tree = await screen.findByRole('group', { name: 'Procurement space' });
    fireEvent.click(await within(tree).findByRole('button', { name: /Suppliers/ }));
    expect(within(tree).getByRole('button', { name: /Suppliers/ })).toHaveAttribute('aria-expanded', 'false');
    unmount();
    member();
    const again = await screen.findByRole('group', { name: 'Procurement space' });
    await within(again).findByRole('button', { name: /Weekly stock check/ });
    expect(within(again).getByRole('button', { name: /Suppliers/ })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('arranging (team head)', () => {
  it('makes a list in a folder; a taken name is said in the window, not lost', async () => {
    serve({ sp: space({ canManage: true }) });
    post.mockRejectedValueOnce({ status: 409, rawData: { message: 'There is already a list called “Bosch orders” here.' } })
      .mockResolvedValueOnce({ item: item('l9', 'Denso orders', { folderId: 'f1' }) });
    member({ isHead: true });
    const tree = await screen.findByRole('group', { name: 'Procurement space' });
    fireEvent.click(await within(tree).findByRole('button', { name: 'More actions for Suppliers' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New list in this folder' }));
    const dialog = await screen.findByRole('dialog', { name: 'New folder or list' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Bosch orders' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make list' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already a list called');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '  Denso   orders ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Blue' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make list' }));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/staff/tasks/space/items', {
      team: 'procurement', kind: 'list', name: 'Denso orders', colour: 'blue', folderId: 'f1',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New folder or list' })).toBeNull());
  });

  it('deleting a list asks first, says its tasks are kept, and sends one delete', async () => {
    serve({ sp: space({ canManage: true }) });
    del.mockResolvedValue({ deleted: ['l1'], tasksMoved: 6 });
    member({ isHead: true });
    const tree = await screen.findByRole('group', { name: 'Procurement space' });
    fireEvent.click(await within(tree).findByRole('button', { name: 'More actions for Bosch orders' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete list' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/No task is deleted: its 6 tasks move to “Other tasks”/));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/staff/tasks/space/items/l1'));
    expect(toastSuccess).toHaveBeenCalledWith('“Bosch orders” deleted. 6 tasks are now in Other tasks.');
  });

  it('saying no to the question deletes nothing', async () => {
    serve({ sp: space({ canManage: true }) });
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    member({ isHead: true });
    const tree = await screen.findByRole('group', { name: 'Procurement space' });
    fireEvent.click(await within(tree).findByRole('button', { name: 'More actions for Suppliers' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete folder' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/folder “Suppliers” and its list\?/));
    expect(del).not.toHaveBeenCalled();
  });
});

describe('a task\'s list', () => {
  const detail = (t: Task) => wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);

  it('the task window shows its list; an editor moves it with one change against its revision', async () => {
    serve({ one: task({ list: 'l1' }) });
    patch.mockResolvedValue({ task: task({ list: 'l2', rev: 4 }) });
    detail(task());
    const pick = await screen.findByLabelText('List');
    await waitFor(() => expect(pick).toHaveValue('l1'));
    fireEvent.change(pick, { target: { value: 'l2' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, listId: 'l2' }));
    fireEvent.change(screen.getByLabelText('List'), { target: { value: '' } });
    await waitFor(() => expect(patch).toHaveBeenLastCalledWith('/staff/tasks/t1', { rev: 4, listId: null }));
  });

  it('moving a task reloads the side menu, so the list counts follow it', async () => {
    serve({ one: task({ list: 'l1' }) });
    patch.mockResolvedValue({ task: task({ list: 'l2', rev: 4 }) });
    detail(task());
    const pick = await screen.findByLabelText('List');
    await waitFor(() => expect(pick).toHaveValue('l1'));
    const spaceReads = () => get.mock.calls.filter((c) => (c[0] as string).startsWith('/staff/tasks/space')).length;
    const before = spaceReads();
    fireEvent.change(pick, { target: { value: 'l2' } });
    await waitFor(() => expect(spaceReads()).toBeGreaterThan(before));
  });

  it('a task from a team whose lists this person cannot see says "No list" (or that it is in one), never a blank line', async () => {
    serve({ one: task() });
    const base = get.getMockImplementation()!;
    get.mockImplementation((url: string) => (url.startsWith('/staff/tasks/space') ? Promise.reject({ status: 403 }) : base(url)));
    detail(task());
    expect(await screen.findByText('No list')).toBeInTheDocument();
    expect(get.mock.calls.filter((c) => (c[0] as string).startsWith('/staff/tasks/space'))).toHaveLength(1);
  });

  it('...and one filed in a list there says so', async () => {
    serve({ one: task({ list: 'l9' }) });
    const base = get.getMockImplementation()!;
    get.mockImplementation((url: string) => (url.startsWith('/staff/tasks/space') ? Promise.reject({ status: 403 }) : base(url)));
    detail(task());
    expect(await screen.findByText('In a Procurement list')).toBeInTheDocument();
  });

  it('someone who may not change the task sees the list but cannot move it', async () => {
    serve({ one: task({ list: 'l1', can: { ...can, edit: false } }) });
    detail(task());
    const pick = await screen.findByLabelText('List');
    await waitFor(() => expect(pick).toHaveValue('l1'));
    expect(pick).toBeDisabled();
  });

  it('the history says where it went', async () => {
    serve({ one: task({ history: [
      { at: '2026-11-04T05:00:00Z', by: 'Priya', action: 'list', from: 'Bosch orders', to: 'Weekly stock check' },
      { at: '2026-11-04T04:00:00Z', by: 'Priya', action: 'list', from: 'Suppliers', to: '' },
    ] }) });
    detail(task());
    expect(await screen.findByText(/moved it from the list Bosch orders to Weekly stock check/)).toBeInTheDocument();
    expect(screen.getByText(/took it out of the list Suppliers/)).toBeInTheDocument();
  });

  it('a new task made on a list\'s page goes in that list', async () => {
    serve();
    post.mockResolvedValue({ task: task({ id: 't9' }), tasks: [task({ id: 't9' })] });
    addressBar.reset('/team/tasks', 'view=team&list=l1');
    member();
    fireEvent.click(await screen.findByRole('button', { name: /New task/ }));
    fireEvent.change(await screen.findByPlaceholderText(/What needs doing/i), { target: { value: 'Ask Bosch for prices' } });
    await waitFor(() => expect(screen.getAllByLabelText('List').at(-1)).toHaveValue('l1'));
    fireEvent.click(screen.getByRole('button', { name: /^Create/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks', expect.objectContaining({ title: 'Ask Bosch for prices', listId: 'l1' })));
  });
});
