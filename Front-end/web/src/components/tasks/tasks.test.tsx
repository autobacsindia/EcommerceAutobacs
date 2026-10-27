/**
 * Staff tasks screens. The API decides who may do what (services/staffTaskService.js
 * on the backend); these pin what each person sees and what is sent — above all
 * that a create carries one clientId however often it is pressed, and that every
 * edit names the revision it was made against.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TaskList from './TaskList';
import TaskDetail from './TaskDetail';
import { formatDueDay, type Task } from './types';

const get = jest.fn();
const post = jest.fn();
const patch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a) },
}));
let search = '';
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search) }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const can = { edit: true, status: true, reassign: true, archive: true, restore: false, comment: true };
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', number: 7, code: 'T-7', title: 'Call Bosch', summary: '', description: 'Ask about the lift kit',
  status: 'todo', statusLabel: 'To do', priority: 'high', priorityLabel: 'High',
  dueOn: '2026-10-27', overdue: false, dueToday: true,
  assignee: { id: 'u2', name: 'Arun' }, team: 'procurement', teamLabel: 'Procurement',
  createdBy: { id: 'u1', name: 'Priya' }, order: null, bucket: 'open',
  completedAt: null, archivedAt: null, commentCount: 0, lastCommentAt: null,
  createdAt: '2026-10-27T04:00:00Z', updatedAt: '2026-10-27T04:00:00Z', rev: 3, can,
  ...over,
});
const people = {
  people: [
    { id: 'u1', name: 'Priya', team: 'procurement', teamLabel: 'Procurement', isHead: true, me: true },
    { id: 'u2', name: 'Arun', team: 'procurement', teamLabel: 'Procurement', isHead: false, me: false },
  ],
};

/** GET router: lists, assignees, one task, comments. */
function serve({ list = [task()], one = task(), assignees = people } = {}) {
  get.mockImplementation((url: string) => {
    if (url.startsWith('/staff/tasks?')) return Promise.resolve({ tasks: list, nextCursor: null });
    if (url === '/staff/tasks/assignees') return Promise.resolve(assignees);
    if (url.includes('/comments')) return Promise.resolve({ comments: [], nextBefore: null });
    if (url.startsWith('/staff/tasks/')) return Promise.resolve({ task: one });
    return Promise.resolve({ orders: [] });
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  search = '';
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('the task list', () => {
  it('shows my open tasks with due, priority and a link to the task', async () => {
    serve();
    wrap(<TaskList base="/team/tasks" canSeeTeam={false} />);
    expect(await screen.findByText('Call Bosch')).toBeInTheDocument();
    expect(screen.getByText(/Today ·/)).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Call Bosch').closest('a')).toHaveAttribute('href', '/team/tasks/t1');
    expect(get).toHaveBeenCalledWith('/staff/tasks?view=mine&state=open');
  });

  it('only heads and the admin get the Team tab', async () => {
    serve();
    const { unmount } = wrap(<TaskList base="/team/tasks" canSeeTeam={false} />);
    await screen.findByText('Call Bosch');
    expect(screen.queryByRole('tab', { name: 'Team tasks' })).toBeNull();
    unmount();
    wrap(<TaskList base="/admin/tasks" canSeeTeam />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Team tasks' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/tasks?view=team&state=open'));
  });

  it('opens on what is due now when the bell sends ?due=late', async () => {
    search = 'due=late';
    serve();
    wrap(<TaskList base="/team/tasks" canSeeTeam={false} />);
    await screen.findByText('Call Bosch');
    expect(get).toHaveBeenCalledWith('/staff/tasks?view=mine&state=open&due=late');
  });

  it('moving the status sends the revision it was made against', async () => {
    serve();
    patch.mockResolvedValue({ task: task({ status: 'in_progress', rev: 4 }) });
    wrap(<TaskList base="/team/tasks" canSeeTeam={false} />);
    fireEvent.change(await screen.findByLabelText('Status of T-7'), { target: { value: 'in_progress' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, status: 'in_progress' }));
  });

  it('a stale status change says so and reloads the list', async () => {
    serve();
    patch.mockRejectedValue({ status: 409, rawData: { message: 'Someone changed this task just now.' } });
    wrap(<TaskList base="/team/tasks" canSeeTeam={false} />);
    await screen.findByText('Call Bosch');
    const before = get.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Status of T-7'), { target: { value: 'done' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone changed this task just now.');
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before));
  });

  it('without permission the status is a label, not a control', async () => {
    serve({ list: [task({ can: { ...can, status: false } })] });
    wrap(<TaskList base="/team/tasks" canSeeTeam={false} />);
    await screen.findByText('Call Bosch');
    expect(screen.queryByLabelText('Status of T-7')).toBeNull();
    expect(screen.getByText('To do')).toBeInTheDocument();
  });
});

describe('new task', () => {
  it('a head picks someone in the team; pressing Create twice sends ONE clientId', async () => {
    serve({ list: [] });
    post.mockRejectedValueOnce({ status: 503, rawData: { message: 'Try again' } }).mockResolvedValue({ task: task() });
    wrap(<TaskList base="/team/tasks" canSeeTeam />);
    fireEvent.click(await screen.findByRole('button', { name: /New task/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Pack order 51234' } });
    await screen.findByRole('option', { name: /Arun/ });
    fireEvent.change(screen.getByLabelText('Who does it'), { target: { value: 'u2' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-10-30' } });
    fireEvent.click(screen.getByRole('button', { name: /Create task/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
    fireEvent.click(screen.getByRole('button', { name: /Create task/ }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const [first, second] = post.mock.calls.map((c) => c[1]);
    expect(first).toMatchObject({ title: 'Pack order 51234', assigneeId: 'u2', dueOn: '2026-10-30', priority: 'normal', orderId: null });
    expect(first.clientId).toBeTruthy();
    expect(second.clientId).toBe(first.clientId);
  });

  it('a member can only add for themselves, and is told why', async () => {
    serve({ list: [], assignees: { people: [{ ...people.people[1], me: true }] } });
    wrap(<TaskList base="/team/tasks" canSeeTeam={false} />);
    fireEvent.click(await screen.findByRole('button', { name: /New task/ }));
    expect(await screen.findByText(/Tasks you add here are for you/)).toBeInTheDocument();
    expect(screen.getByLabelText('Who does it')).toBeDisabled();
  });
});

describe('one task', () => {
  it('shows the details; edits carry the revision', async () => {
    serve({ one: task({ order: { id: 'o1', code: '#51234' } }) });
    patch.mockResolvedValue({ task: task({ priority: 'urgent', priorityLabel: 'Urgent', rev: 4 }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" />);
    expect(await screen.findByRole('heading', { name: 'Call Bosch' })).toBeInTheDocument();
    expect(screen.getByText('Ask about the lift kit')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#51234' })).toHaveAttribute('href', '/team/orders');
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'urgent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', expect.objectContaining({ rev: 3, priority: 'urgent', title: 'Call Bosch' })));
  });

  it('the assignee (no edit rights) sees no Edit, Archive or reassign', async () => {
    serve({ one: task({ can: { ...can, edit: false, reassign: false, archive: false } }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" />);
    await screen.findByRole('heading', { name: 'Call Bosch' });
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Archive/ })).toBeNull();
    expect(screen.queryByLabelText('Who does it')).toBeNull();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
  });

  it('archives after a confirm; the admin\'s order link opens the admin order', async () => {
    serve({ one: task({ order: { id: 'o1', code: '#51234' } }) });
    patch.mockResolvedValue({ task: task({ bucket: 'archived', can: { ...can, edit: false, archive: false, restore: true, comment: false } }) });
    wrap(<TaskDetail id="t1" base="/admin/tasks" />);
    expect(await screen.findByRole('link', { name: '#51234' })).toHaveAttribute('href', '/admin/orders?order=o1');
    fireEvent.click(screen.getByRole('button', { name: /Archive/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, archived: true }));
    expect(await screen.findByText('This task is archived.')).toBeInTheDocument();
  });

  it('comments post with a clientId and refresh', async () => {
    serve();
    post.mockResolvedValue({ comment: { id: 'c1', by: { id: 'u1', name: 'Priya' }, text: 'Done?', createdAt: '2026-10-27T05:00:00Z' } });
    wrap(<TaskDetail id="t1" base="/team/tasks" />);
    fireEvent.change(await screen.findByLabelText('Comment'), { target: { value: 'Done?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/t1/comments', expect.objectContaining({ text: 'Done?', clientId: expect.any(String) })));
  });

  it('a task you cannot see says so', async () => {
    get.mockImplementation((url: string) => (url === '/staff/tasks/assignees'
      ? Promise.resolve(people)
      : Promise.reject({ status: 404, rawData: { message: 'Task not found.' } })));
    wrap(<TaskDetail id="t9" base="/team/tasks" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Task not found.');
  });
});

describe('due days', () => {
  it('reads a calendar day without shifting it by timezone', () => {
    expect(formatDueDay('2031-01-15')).toBe('15 Jan 2031');
    expect(formatDueDay(null)).toBe('');
  });
});
