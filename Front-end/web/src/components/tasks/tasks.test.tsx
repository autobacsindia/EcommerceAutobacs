/**
 * Staff tasks screens. The API decides who may do what (services/staffTaskService.js
 * on the backend); these pin what each person sees and what is sent — above all
 * that a create carries one clientId however often it is pressed, and that every
 * edit names the revision it was made against.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TaskList from './TaskList';
import TaskDetail from './TaskDetail';
import { formatDueDay, isPastDay, todayIST, type Task } from './types';

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
  createdBy: { id: 'u1', name: 'Priya' }, order: null, group: null, bucket: 'open',
  completedAt: null, archivedAt: null, commentCount: 0, lastCommentAt: null,
  createdAt: '2026-10-27T04:00:00Z', updatedAt: '2026-10-27T04:00:00Z', rev: 3, can,
  ...over,
});
const people = {
  people: [
    { id: 'u1', name: 'Priya', team: 'procurement', teamLabel: 'Procurement', isHead: true, me: true },
    { id: 'u2', name: 'Arun', team: 'procurement', teamLabel: 'Procurement', isHead: false, me: false },
    { id: 'u3', name: 'Bala', team: 'procurement', teamLabel: 'Procurement', isHead: false, me: false },
  ],
};

/** GET router: lists, assignees, one task, comments. */
function serve({ list = [task()], one = task(), assignees = people, done = [] as Task[] } = {}) {
  get.mockImplementation((url: string) => {
    if (url.startsWith('/staff/tasks?') && url.includes('state=done')) return Promise.resolve({ tasks: done, nextCursor: null });
    if (url.startsWith('/staff/tasks?')) return Promise.resolve({ tasks: list, nextCursor: null });
    if (url === '/staff/tasks/assignees') return Promise.resolve(assignees);
    if (url.includes('/comments')) return Promise.resolve({ comments: [], nextBefore: null });
    if (url.startsWith('/staff/tasks/')) return Promise.resolve({ task: one });
    return Promise.resolve({ orders: [] });
  });
}

beforeEach(() => {
  localStorage.clear();
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

  it('plain tab names, each explained; only heads and the admin get the team list', async () => {
    serve();
    const { unmount } = wrap(<TaskList base="/team/tasks" canSeeTeam={false} />);
    await screen.findByText('Call Bosch');
    expect(screen.getByRole('tab', { name: 'For me' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Jobs someone gave to you/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'I gave out' }));
    expect(screen.getByText(/Jobs you gave to other people/)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'My team' })).toBeNull();
    unmount();

    const head = wrap(<TaskList base="/team/tasks" canSeeTeam />);
    expect(await screen.findByRole('tab', { name: 'My team' })).toBeInTheDocument();
    head.unmount();

    wrap(<TaskList base="/admin/tasks" canSeeTeam />);
    fireEvent.click(await screen.findByRole('tab', { name: 'All teams' }));
    expect(screen.getByText('Every job in every team.')).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/tasks?view=team&state=open'));
  });

  it('explains how tasks work until hidden, and remembers that', async () => {
    serve();
    const { unmount } = wrap(<TaskList base="/team/tasks" canSeeTeam={false} />);
    expect(await screen.findByText('How tasks work')).toBeInTheDocument();
    expect(screen.getByText(/you can add jobs for yourself/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide how tasks work' }));
    expect(screen.queryByText('How tasks work')).toBeNull();
    unmount();
    wrap(<TaskList base="/team/tasks" canSeeTeam={false} />);
    await screen.findByText('Call Bosch');
    expect(screen.queryByText('How tasks work')).toBeNull();
  });

  it('says plainly when a list is empty', async () => {
    serve({ list: [] });
    wrap(<TaskList base="/team/tasks" canSeeTeam={false} />);
    expect(await screen.findByText(/Nobody has given you a job yet/)).toBeInTheDocument();
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

describe('the board', () => {
  const dt = (id: string) => ({ getData: () => id, setData: () => {}, dropEffect: '', effectAllowed: '' });
  const board = async (list: Task[], done: Task[] = []) => {
    serve({ list, done });
    wrap(<TaskList base="/team/tasks" canSeeTeam />);
    fireEvent.click(await screen.findByRole('button', { name: /Board/ }));
  };

  it('shows each job in its status column, and remembers the choice', async () => {
    await board(
      [task(), task({ id: 't2', code: 'T-8', title: 'Chase supplier', status: 'waiting', statusLabel: 'Waiting' })],
      [task({ id: 't3', code: 'T-9', title: 'Old job', status: 'done', statusLabel: 'Done', bucket: 'done' })],
    );
    const col = (name: string) => screen.getByRole('region', { name });
    await waitFor(() => expect(within(col('To do')).getByText('Call Bosch')).toBeInTheDocument());
    expect(within(col('Waiting')).getByText('Chase supplier')).toBeInTheDocument();
    expect(await within(col('Done')).findByText('Old job')).toBeInTheDocument();
    expect(within(col('In progress')).queryAllByRole('listitem')).toHaveLength(0);
    expect(localStorage.getItem('tasks-view-mode')).toBe('board');
  });

  it('dropping a card on a column moves it, with the revision', async () => {
    patch.mockResolvedValue({ task: task({ status: 'in_progress', rev: 4 }) });
    await board([task()]);
    const card = (await screen.findByText('Call Bosch')).closest('li')!;
    expect(card).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(card, { dataTransfer: dt('t1') });
    fireEvent.drop(screen.getByRole('region', { name: 'In progress' }), { dataTransfer: dt('t1') });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, status: 'in_progress' }));
  });

  it('a refused move puts the card back and says why', async () => {
    patch.mockRejectedValue({ status: 409, rawData: { message: 'changed' } });
    await board([task()]);
    await screen.findByText('Call Bosch');
    fireEvent.drop(screen.getByRole('region', { name: 'Done' }), { dataTransfer: dt('t1') });
    expect(await screen.findByRole('alert')).toHaveTextContent('T-7 was changed by someone else just now');
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'To do' })).getByText('Call Bosch')).toBeInTheDocument());
  });

  it('cards you may not move cannot be dragged or dropped', async () => {
    await board([task({ can: { ...can, status: false } })]);
    const card = (await screen.findByText('Call Bosch')).closest('li')!;
    expect(card).toHaveAttribute('draggable', 'false');
    fireEvent.drop(screen.getByRole('region', { name: 'Done' }), { dataTransfer: dt('t1') });
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
    expect(get).toHaveBeenCalledWith('/staff/tasks?view=mine&state=open&due=overdue');
  });
});

describe('new task', () => {
  it('a head ticks someone in the team; pressing Create twice sends ONE clientId', async () => {
    serve({ list: [] });
    post.mockRejectedValueOnce({ status: 503, rawData: { message: 'Try again' } }).mockResolvedValue({ task: task(), tasks: [task()] });
    wrap(<TaskList base="/team/tasks" canSeeTeam />);
    fireEvent.click(await screen.findByRole('button', { name: /New task/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Pack order 51234' } });
    // Starts with "me" ticked; swap to Arun.
    expect(await screen.findByRole('checkbox', { name: /Priya \(me\)/ })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /Priya \(me\)/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Arun/ }));
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-10-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const [first, second] = post.mock.calls.map((c) => c[1]);
    expect(first).toMatchObject({ title: 'Pack order 51234', assigneeIds: ['u2'], dueOn: '2026-10-30', priority: 'normal', orderId: null });
    expect(first.clientId).toBeTruthy();
    expect(second.clientId).toBe(first.clientId);
  });

  it('heads are labelled as heads; several ticked people make one copy each', async () => {
    serve({ list: [] });
    post.mockResolvedValue({ task: task(), tasks: [task(), task()] });
    wrap(<TaskList base="/admin/tasks" canSeeTeam />);
    fireEvent.click(await screen.findByRole('button', { name: /New task/ }));
    expect(await screen.findByText('Priya (me) · Procurement head')).toBeInTheDocument();
    expect(screen.getByText('Arun · Procurement')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Stock count' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Bala/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Arun/ }));
    expect(screen.getByText(/3 people picked — each gets their own copy/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create 3 tasks' }));
    // Sent in the list's order (me, then heads, then the rest), not the order ticked.
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks', expect.objectContaining({ assigneeIds: ['u1', 'u2', 'u3'] })));
  });

  it('nobody ticked: says so and cannot create', async () => {
    serve({ list: [] });
    wrap(<TaskList base="/team/tasks" canSeeTeam />);
    fireEvent.click(await screen.findByRole('button', { name: /New task/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'x' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: /Priya \(me\)/ }));
    expect(screen.getByText('Pick at least one person.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create task' })).toBeDisabled();
  });

  it('warns when the due date has already passed, not when it is today or later', async () => {
    serve({ list: [] });
    wrap(<TaskList base="/team/tasks" canSeeTeam />);
    fireEvent.click(await screen.findByRole('button', { name: /New task/ }));
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2020-01-01' } });
    expect(screen.getByText(/This due date has already passed/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: todayIST() } });
    expect(screen.queryByText(/This due date has already passed/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2099-01-01' } });
    expect(screen.queryByText(/This due date has already passed/)).toBeNull();
  });

  it('a member can only add for themselves, and is told why', async () => {
    serve({ list: [], assignees: { people: [{ ...people.people[1], me: true }] } });
    post.mockResolvedValue({ task: task(), tasks: [task()] });
    wrap(<TaskList base="/team/tasks" canSeeTeam={false} />);
    fireEvent.click(await screen.findByRole('button', { name: /New task/ }));
    expect(await screen.findByText(/This task is for you/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks', expect.objectContaining({ assigneeIds: ['u2'] })));
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

  it('a task given to several people shows who else has it and how many are done', async () => {
    serve({
      one: task({
        group: { id: 'g1', size: 3 },
        siblings: [
          { id: 't2', code: 'T-8', assignee: { id: 'u3', name: 'Bala' }, status: 'done', statusLabel: 'Done', bucket: 'done' },
          { id: 't3', code: 'T-9', assignee: { id: 'u4', name: 'Sam' }, status: 'todo', statusLabel: 'To do', bucket: 'open' },
        ],
      }),
    });
    wrap(<TaskDetail id="t1" base="/admin/tasks" />);
    expect(await screen.findByRole('heading', { name: 'Given to 3 people' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Bala/ })).toHaveAttribute('href', '/admin/tasks/t2');
    expect(screen.getByText('1 of 3 done')).toBeInTheDocument();
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
  it('"today" is the day in India, and only earlier days are past', () => {
    // 20:00 UTC on 26 Oct is already 01:30 on 27 Oct in India.
    expect(todayIST(new Date('2026-10-26T20:00:00Z'))).toBe('2026-10-27');
    expect(isPastDay('2026-10-26', '2026-10-27')).toBe(true);
    expect(isPastDay('2026-10-27', '2026-10-27')).toBe(false);
    expect(isPastDay('', '2026-10-27')).toBe(false);
  });

  it('reads a calendar day without shifting it by timezone', () => {
    expect(formatDueDay('2031-01-15')).toBe('15 Jan 2031');
    expect(formatDueDay(null)).toBe('');
  });
});
