/**
 * The ClickUp-style parts of Projects: lists inside a project (tabs), a
 * project's own statuses (board columns, list groups, the task's status menu),
 * editing both, and the Calendar view. The server's rules are pinned in
 * Back-end tests/staffProjectListsStatuses.test.js; these pin what the screen
 * shows and sends.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TasksWorkspace from './TasksWorkspace';
import TaskDetail from './TaskDetail';
import { monthGrid } from './TaskCalendar';
import { groupTasks } from './grouping';
import { type Project, type ProjectStage, type Task } from './types';
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
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn(), dismiss: jest.fn() } }));
jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'Diwali launch', description: 'Banners, stock and the offer page', colour: 'violet',
  owner: { id: 'u1', name: 'Meera' },
  people: [{ id: 'u1', name: 'Meera', team: 'marketing' }, { id: 'u2', name: 'Arun', team: 'procurement' }],
  teams: [{ value: 'marketing', label: 'Marketing' }, { value: 'procurement', label: 'Procurement' }],
  startOn: '2026-10-01', dueOn: '2026-10-25', lists: [], statuses: [],
  status: 'at_risk', statusLabel: 'At risk', statusOverride: null,
  progress: { total: 3, done: 1, overdue: 1, percent: 33 },
  archivedAt: null, createdBy: { id: 'u1', name: 'Meera' }, rev: 2,
  can: { edit: true, archive: true, restore: false },
  ...over,
});
const can = { edit: true, status: true, reassign: true, archive: true, restore: false, comment: true, checklist: true, files: true, follow: true, followers: true };
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', number: 7, code: 'T-7', title: 'Design banners', summary: '', description: '',
  status: 'todo', statusLabel: 'To do', priority: 'normal', priorityLabel: 'Normal',
  dueOn: null, startOn: null, tags: [], overdue: false, dueToday: false,
  assignees: [], followers: [], following: false, assignee: { id: 'u1', name: 'Meera' }, team: 'marketing', teamLabel: 'Marketing',
  createdBy: { id: 'u1', name: 'Meera' }, order: null, group: null, list: null, project: null, checklist: { done: 0, total: 0 }, bucket: 'open',
  completedAt: null, archivedAt: null, commentCount: 0, lastCommentAt: null,
  createdAt: '2026-10-27T04:00:00Z', updatedAt: '2026-10-27T04:00:00Z', rev: 3, can,
  history: [], ...over,
});
const me = { id: 'u1', name: 'Meera', team: 'marketing', teamLabel: 'Marketing', isHead: true, me: true };
const arun = { id: 'u2', name: 'Arun', team: 'procurement', teamLabel: 'Procurement', isHead: false, me: false };

function serve({ projects = [project()], canCreate = true, one = project(), oneFails = false, t = task() }: {
  projects?: Project[]; canCreate?: boolean; one?: Project; oneFails?: boolean; t?: Task;
} = {}) {
  get.mockImplementation((url: string) => {
    if (url.startsWith('/staff/tasks/projects?')) return Promise.resolve({ projects, nextCursor: null, canCreate });
    if (url === '/staff/tasks/projects/pick') return Promise.resolve({ projects: projects.map((p) => ({ id: p.id, name: p.name, colour: p.colour })) });
    if (url.startsWith('/staff/tasks/projects/')) return oneFails ? Promise.reject(Object.assign(new Error('Project not found.'), { status: 404 })) : Promise.resolve({ project: one });
    if (url.startsWith('/staff/tasks/space')) return Promise.resolve({ space: { team: 'marketing', teamLabel: 'Marketing', canManage: false, folders: [], lists: [], other: 0, colours: [] } });
    if (url === '/staff/tasks/summary') return Promise.resolve({ late: 0, today: 0 });
    if (url === '/staff/tasks/assignees') return Promise.resolve({ people: [me, arun] });
    if (url.startsWith('/staff/tasks?')) return Promise.resolve({ tasks: [task({ project: 'p1' })], nextCursor: null });
    if (url.includes('/comments')) return Promise.resolve({ comments: [], nextBefore: null });
    if (url.includes('/links')) return Promise.resolve({ waitingOn: [], blocking: [], related: [], hidden: 0, hiddenWaiting: 0, canAdd: false });
    if (url.includes('/subtasks')) return Promise.resolve({ subtasks: [] });
    if (url.startsWith('/staff/tasks/')) return Promise.resolve({ task: t });
    return Promise.resolve({ orders: [] });
  });
}
const listCalls = () => get.mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith('/staff/tasks?'));
const head = () => wrap(<TasksWorkspace base="/team/tasks" canSeeTeam myTeam="marketing" myTeamLabel="Marketing" isHead />);

beforeEach(() => {
  localStorage.clear();
  [get, post, patch].forEach((f) => f.mockReset());
  addressBar.reset('/team/tasks');
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});


const STAGES: ProjectStage[] = [
  { id: 's1', name: 'Ideas', colour: 'gray', type: 'todo' },
  { id: 's2', name: 'Designing', colour: 'blue', type: 'in_progress' },
  { id: 's3', name: 'Review', colour: 'amber', type: 'in_progress' },
  { id: 's4', name: 'Live', colour: 'green', type: 'done' },
];
const LISTS = [{ id: 'l1', name: 'Ads' }, { id: 'l2', name: 'Website' }];
const openProject = (plist = '') => addressBar.reset('/team/tasks', `view=project&project=p1${plist ? `&plist=${plist}` : ''}`);

describe('lists inside a project', () => {
  it('shows a tab per list; picking one lists only that list’s tasks', async () => {
    serve({ one: project({ lists: LISTS }) });
    openProject();
    head();
    const tabs = await screen.findByRole('tablist', { name: 'Lists in this project' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['All tasks', 'Ads', 'Website', 'No list']);
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Website' }));
    await waitFor(() => expect(addressBar.search).toContain('plist=l2'));
    await waitFor(() => expect(listCalls().some((u) => u.includes('projectList=l2'))).toBe(true));
  });

  it('the owner adds a list from the tabs, and it opens', async () => {
    serve({ one: project({ lists: LISTS }) });
    patch.mockResolvedValue({ project: project({ lists: [...LISTS, { id: 'l3', name: 'Emails' }], rev: 3 }) });
    openProject();
    head();
    fireEvent.click(await screen.findByRole('button', { name: /Add list/ }));
    fireEvent.change(screen.getByLabelText('New list name'), { target: { value: ' Emails ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/projects/p1', { rev: 2, lists: [...LISTS, { name: 'Emails' }] }));
    await waitFor(() => expect(addressBar.search).toContain('plist=l3'));
  });

  it('someone who can’t change the project sees no tabs when it has no lists', async () => {
    serve({ one: project({ can: { edit: false, archive: false, restore: false } }) });
    openProject();
    head();
    await screen.findByText('Diwali launch', { selector: 'h2, h1, p, span' }).catch(() => null);
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    expect(screen.queryByRole('tablist', { name: 'Lists in this project' })).toBeNull();
  });
});

describe('a project’s own statuses', () => {
  it('the board’s columns are the project’s statuses, and moving a card sends the status chosen', async () => {
    localStorage.setItem('tasks-view-mode', 'board');
    serve({ one: project({ statuses: STAGES }) });
    get.mockImplementation(((orig) => (url: string) => (url.startsWith('/staff/tasks?')
      ? Promise.resolve({ tasks: url.includes('state=done') ? [] : [task({ project: 'p1', stage: 's3', status: 'in_progress', statusLabel: 'Review' })], nextCursor: null })
      : orig(url)))(get.getMockImplementation()!));
    patch.mockResolvedValue({ task: task() });
    openProject();
    head();
    for (const name of ['Ideas', 'Designing', 'Review', 'Live']) expect(await screen.findByRole('region', { name })).toBeInTheDocument();
    const review = screen.getByRole('region', { name: 'Review' });
    expect(within(review).getByText('Design banners')).toBeInTheDocument();
    // Each column header wears the colour the owner picked for that status.
    expect(review.querySelector('[data-status]')).toHaveAttribute('data-colour', 'amber');
    // The phone's move picker lists the project's statuses.
    fireEvent.change(within(review).getByLabelText('Move T-7'), { target: { value: 's4' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, stageId: 's4' }));
    // A project task has no date here, and in a project none is asked for, whatever the column.
    expect(screen.queryByRole('dialog', { name: 'When will this be done?' })).toBeNull();
  });

  it('the list groups by the project’s open statuses, active ones first', () => {
    const rows = [
      task({ id: 'a', stage: 's1', status: 'todo' }),
      task({ id: 'b', stage: 's3', status: 'in_progress' }),
      // No status yet (just moved in): placed by its kind, as the server would.
      task({ id: 'c', stage: null, status: 'in_progress' }),
    ];
    const groups = groupTasks(rows, 'status', { stages: STAGES });
    expect(groups.map((g) => [g.label, g.tasks.map((t) => t.id)])).toEqual([['Designing', ['c']], ['Review', ['b']], ['Ideas', ['a']]]);
    expect(groups[0]).toMatchObject({ addStage: 's2', addStatus: 'in_progress', colour: 'blue' });
  });

  it('the task window’s status menu offers the project’s statuses and sends the one picked', async () => {
    const t = task({ project: 'p1', stage: 's1', statusLabel: 'Ideas' });
    serve({ one: project({ statuses: STAGES, lists: LISTS }), t });
    patch.mockResolvedValue({ task: t });
    wrap(<TaskDetail id="t1" base="/team/tasks" />);
    const status = await screen.findByLabelText('Status');
    await waitFor(() => expect(within(status).getAllByRole('option').map((o) => o.textContent)).toEqual(['Ideas', 'Designing', 'Review', 'Live']));
    fireEvent.change(status, { target: { value: 's3' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, stageId: 's3' }));
    // And its project list.
    fireEvent.change(screen.getByLabelText('Project list'), { target: { value: 'l1' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, projectListId: 'l1' }));
  });

  it('the owner turns on the project’s own statuses and lists; the form says what is wrong before saving', async () => {
    serve({ one: project() });
    patch.mockResolvedValue({ project: project() });
    openProject();
    head();
    fireEvent.click(await screen.findByRole('button', { name: /Edit/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit project' });
    fireEvent.click(within(dialog).getByRole('button', { name: /own statuses/ }));
    expect(within(dialog).getByLabelText('Status 1 name')).toHaveValue('To do');
    // Rename the done one into "not started": no Done left.
    fireEvent.change(within(dialog).getByLabelText('Done counts as'), { target: { value: 'todo' } });
    expect(within(dialog).getByText('Keep at least one status that counts as “Done”.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Done counts as'), { target: { value: 'done' } });
    fireEvent.change(within(dialog).getByLabelText('Status 2 name'), { target: { value: 'Review' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add a list' }));
    fireEvent.change(within(dialog).getByLabelText('List 1 name'), { target: { value: 'Ads' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1]).toMatchObject({
      rev: 2,
      lists: [{ name: 'Ads' }],
      statuses: [
        { name: 'To do', colour: 'gray', type: 'todo' },
        { name: 'Review', colour: 'blue', type: 'in_progress' },
        { name: 'Done', colour: 'green', type: 'done' },
      ],
    });
  });
});

describe('columns changed from the board', () => {
  const board = (one: Project) => {
    localStorage.setItem('tasks-view-mode', 'board');
    serve({ one });
    get.mockImplementation(((orig) => (url: string) => (url.startsWith('/staff/tasks?')
      ? Promise.resolve({ tasks: url.includes('state=done') ? [] : [task({ project: 'p1', stage: 's3', status: 'in_progress', statusLabel: 'Review' })], nextCursor: null })
      : orig(url)))(get.getMockImplementation()!));
    patch.mockResolvedValue({ project: one });
    openProject();
    head();
  };

  it('"Add column" on a board with the usual three keeps them and adds the new one before Complete', async () => {
    board(project());
    fireEvent.click(await screen.findByRole('button', { name: /Add column/ }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Garage 1'), { target: { value: 'Garage 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/projects/p1', {
      rev: 2,
      statuses: [
        { name: 'To do', colour: 'gray', type: 'todo' },
        { name: 'In progress', colour: 'blue', type: 'in_progress' },
        { name: 'Garage 1', colour: 'gray', type: 'in_progress' },
        { name: 'Complete', colour: 'green', type: 'done' },
      ],
    }));
  });

  it('a name another column has is refused before saving', async () => {
    board(project({ statuses: STAGES }));
    fireEvent.click(await screen.findByRole('button', { name: /Add column/ }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Garage 1'), { target: { value: ' review ' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Another column already has that name.');
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('renames and recolours a column, keeping every other column by its id', async () => {
    board(project({ statuses: STAGES }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change column Review' }));
    const dialog = await screen.findByRole('dialog', { name: 'Column Review' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Garage 2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'teal' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/projects/p1', {
      rev: 2,
      statuses: [
        { id: 's1', name: 'Ideas', colour: 'gray', type: 'todo' },
        { id: 's2', name: 'Designing', colour: 'blue', type: 'in_progress' },
        { id: 's3', name: 'Garage 2', colour: 'teal', type: 'in_progress' },
        { id: 's4', name: 'Live', colour: 'green', type: 'done' },
      ],
    }));
  });

  it('moves a column left', async () => {
    board(project({ statuses: STAGES }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change column Review' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Move left/ }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect((patch.mock.calls[0][1] as { statuses: { id: string }[] }).statuses.map((x) => x.id)).toEqual(['s1', 's3', 's2', 's4']);
  });

  it('deleting asks where its tasks go, offering only columns that are open the same way', async () => {
    board(project({ statuses: STAGES }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change column Review' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Delete column/ }));
    const where = screen.getByLabelText('Move its tasks to');
    // Live is a Done column: open tasks can't go there.
    expect(within(where).getAllByRole('option').map((o) => o.textContent)).toEqual(['Ideas', 'Designing']);
    expect(screen.getByText(/Its task will move to/)).toBeInTheDocument();
    fireEvent.change(where, { target: { value: 's1' } });
    fireEvent.click(screen.getByRole('button', { name: /Delete and move tasks/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/projects/p1', {
      rev: 2,
      statuses: [
        { id: 's1', name: 'Ideas', colour: 'gray', type: 'todo' },
        { id: 's2', name: 'Designing', colour: 'blue', type: 'in_progress' },
        { id: 's4', name: 'Live', colour: 'green', type: 'done' },
      ],
      statusMoves: [{ from: 's3', to: 's1' }],
    }));
  });

  it('the last Done column can’t be deleted, and says why', async () => {
    board(project({ statuses: STAGES }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change column Live' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Delete column/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('is the last “Done” column');
    expect(screen.getByRole('button', { name: /Delete and move tasks/ })).toBeDisabled();
  });

  it('a member (not the owner) adds and renames columns, but can’t delete one or change what it counts as', async () => {
    board(project({ statuses: STAGES, can: { edit: false, archive: false, restore: false, columns: true } }));
    expect(await screen.findByRole('button', { name: /Add column/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change column Review' }));
    const dialog = await screen.findByRole('dialog', { name: 'Column Review' });
    expect(within(dialog).queryByRole('button', { name: /Delete column/ })).not.toBeInTheDocument();
    expect(within(dialog).getByText('Only the project owner or the admin can delete a column.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Tasks here count as/)).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Garage 2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect((patch.mock.calls[0][1] as { statuses: { name: string }[] }).statuses.map((x) => x.name)).toEqual(['Ideas', 'Designing', 'Garage 2', 'Live']);
  });

  it('someone who can’t change the project sees no column controls', async () => {
    board(project({ statuses: STAGES, can: { edit: false, archive: false, restore: false, columns: false } }));
    expect(await screen.findByRole('region', { name: 'Review' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add column/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change column/ })).not.toBeInTheDocument();
  });
});

describe('the Calendar view', () => {
  it('a month is whole weeks, Monday first', () => {
    const nov = monthGrid('2026-11-01');
    expect(nov[0]).toBe('2026-10-26');
    expect(nov.length % 7).toBe(0);
    expect(nov[nov.length - 1]).toBe('2026-12-06');
    expect(monthGrid('2027-02-01')).toHaveLength(28);
  });

  it('asks for the days on screen and puts each task on its due day', async () => {
    localStorage.setItem('tasks-view-mode', 'calendar');
    serve();
    get.mockImplementation(((orig) => (url: string) => (url.startsWith('/staff/tasks?')
      ? Promise.resolve({ tasks: [task({ title: 'Launch ads', dueOn: '2026-11-20' }), task({ id: 't2', code: 'T-8', title: 'Late one', dueOn: '2026-11-03', overdue: true })], nextCursor: null })
      : orig(url)))(get.getMockImplementation()!));
    jest.useFakeTimers({ now: new Date('2026-11-16T06:00:00Z'), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'nextTick', 'setImmediate'] });
    try {
      head();
      await screen.findByRole('region', { name: 'Calendar' });
      const day = await waitFor(() => { const d = document.querySelector('[data-day="2026-11-20"]'); if (!d) throw new Error('no day'); return d as HTMLElement; });
      expect(await within(day).findByRole('button', { name: 'Launch ads' })).toBeInTheDocument();
      const calls = listCalls();
      expect(calls.some((u) => u.includes('dueFrom=2026-10-26') && u.includes('dueTo=2026-12-06'))).toBe(true);
      // The calendar is the dates: no due filter, no other order.
      expect(calls.every((u) => !u.includes('due=') || u.includes('dueFrom'))).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
      await waitFor(() => expect(listCalls().some((u) => u.includes('dueFrom=2026-11-30'))).toBe(true));
    } finally {
      jest.useRealTimers();
    }
  });
});
