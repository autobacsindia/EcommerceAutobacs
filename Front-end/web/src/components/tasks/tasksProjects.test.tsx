/**
 * Projects in the Tasks module: the Projects page, one project's page (its
 * header over its tasks), starting a project, and filing a task in one. The
 * server decides who sees what (tests/staffProjects.test.js); these pin what
 * the screen shows and sends.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TasksWorkspace from './TasksWorkspace';
import TaskDetail from './TaskDetail';
import { type Project, type Task } from './types';
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
  id: 'p1', code: 'PRJ-0007', name: 'Diwali launch', description: 'Banners, stock and the offer page', colour: 'violet',
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

describe('the Projects page', () => {
  it('opens from the side menu and shows each project’s progress, status, owner, dates and teams', async () => {
    serve();
    head();
    fireEvent.click(await screen.findByRole('button', { name: 'Projects' }));
    const card = await screen.findByRole('button', { name: /Diwali launch/ });
    expect(within(card).getByText('At risk')).toBeInTheDocument();
    expect(within(card).getByText('1 of 3 tasks done')).toBeInTheDocument();
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
    expect(within(card).getByText('1 late')).toBeInTheDocument();
    expect(within(card).getByText('Meera')).toBeInTheDocument();
    expect(within(card).getByText('Marketing')).toBeInTheDocument();
    expect(within(card).getByText('Procurement')).toBeInTheDocument();
    // Its project ID, to type on a payment.
    expect(within(card).getByText('PRJ-0007')).toBeInTheDocument();
  });

  it('a member who cannot start projects sees no New project button, and a plain empty message', async () => {
    serve({ projects: [], canCreate: false });
    addressBar.reset('/team/tasks', 'view=projects');
    head();
    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
    expect(screen.getByText(/admin and team heads start projects/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New project/ })).toBeNull();
  });

  it('a head starts a project with members and dates; one id per form so a double click makes one', async () => {
    serve({ projects: [] });
    post.mockResolvedValue({ project: project({ id: 'p9', name: 'Website relaunch' }) });
    addressBar.reset('/team/tasks', 'view=projects');
    head();
    fireEvent.click((await screen.findAllByRole('button', { name: /New project/ }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    fireEvent.change(within(dialog).getByLabelText('Project name'), { target: { value: '  Website relaunch ' } });
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: '2026-11-01' } });
    fireEvent.change(within(dialog).getByLabelText('Deadline'), { target: { value: '2026-12-15' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Add members/ }));
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: /Arun/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/staff/tasks/projects');
    expect(body).toMatchObject({ name: 'Website relaunch', startOn: '2026-11-01', dueOn: '2026-12-15', ownerId: 'u1', memberIds: ['u2'] });
    expect(body.clientId).toEqual(expect.any(String));
    // It opens the new project.
    await waitFor(() => expect(addressBar.search).toContain('project=p9'));
  });

  it('a name typed into the description box is explained, not silently refused', async () => {
    serve({ projects: [] });
    addressBar.reset('/team/tasks', 'view=projects');
    head();
    fireEvent.click((await screen.findAllByRole('button', { name: /New project/ }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    const nameBox = within(dialog).getByLabelText('Project name');
    expect(nameBox).toHaveFocus();
    expect(nameBox).toBeRequired();
    // The owner's mistake: the name went into the description.
    fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: 'Black Friday 2026 campaign' } });
    expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeDisabled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Name is required');
    expect(within(dialog).getByText('Add a project name to continue.')).toBeInTheDocument();
    expect(nameBox).toHaveAttribute('aria-invalid', 'true');
    // Typing the name clears both and enables the button.
    fireEvent.change(nameBox, { target: { value: 'Black Friday 2026 campaign' } });
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).queryByText('Add a project name to continue.')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeEnabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses a start date after the deadline before sending anything', async () => {
    serve({ projects: [] });
    addressBar.reset('/team/tasks', 'view=projects');
    head();
    fireEvent.click((await screen.findAllByRole('button', { name: /New project/ }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    fireEvent.change(within(dialog).getByLabelText('Project name'), { target: { value: 'Backwards' } });
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: '2026-12-20' } });
    fireEvent.change(within(dialog).getByLabelText('Deadline'), { target: { value: '2026-12-15' } });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('start date is after the deadline');
    expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeDisabled();
  });
});

describe('one project', () => {
  it('shows its header over its tasks, and lists only that project’s tasks', async () => {
    serve();
    addressBar.reset('/team/tasks', 'view=project&project=p1');
    head();
    const header = await screen.findByRole('region', { name: 'Project' });
    expect(within(header).getByRole('heading', { name: 'Diwali launch' })).toBeInTheDocument();
    expect(within(header).getByText('At risk')).toBeInTheDocument();
    expect(within(header).getByText('2 people')).toBeInTheDocument();
    expect(within(header).getByText('PRJ-0007')).toBeInTheDocument();
    expect(await screen.findByText('Design banners')).toBeInTheDocument();
    const call = listCalls().find((u) => u.includes('view=project'));
    expect(call).toContain('project=p1');
    // A new task made here starts in the project.
    fireEvent.click(screen.getByRole('button', { name: /^New task/ }));
    expect(await screen.findByRole('combobox', { name: 'Project' })).toHaveValue('p1');
  });

  it('a project you may not see shows a plain message and loads no tasks', async () => {
    serve({ oneFails: true });
    addressBar.reset('/team/tasks', 'view=project&project=p1');
    head();
    expect(await screen.findByText('This project isn’t available')).toBeInTheDocument();
    // The list request goes out beside the project's (the server refuses it too); nothing of it is shown.
    expect(screen.queryByText('Design banners')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByLabelText('Search tasks')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Projects' }));
    await waitFor(() => expect(addressBar.search).toContain('view=projects'));
  });

  it('a member without edit rights gets no Edit button; the owner edits and sends the rev', async () => {
    serve({ one: project({ can: { edit: false, archive: false, restore: false } }) });
    addressBar.reset('/team/tasks', 'view=project&project=p1');
    const view = head();
    await screen.findByRole('region', { name: 'Project' });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    view.unmount();

    serve();
    patch.mockResolvedValue({ project: project({ name: 'Diwali 2026', rev: 3 }) });
    head();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit project' });
    fireEvent.change(within(dialog).getByLabelText('Project name'), { target: { value: 'Diwali 2026' } });
    fireEvent.change(within(dialog).getByLabelText('Status'), { target: { value: 'on_track' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][0]).toBe('/staff/tasks/projects/p1');
    expect(patch.mock.calls[0][1]).toMatchObject({ rev: 2, name: 'Diwali 2026', statusOverride: 'on_track', memberIds: ['u2'] });
    // Not the admin: the owner is not sent, so it cannot be given away.
    expect(patch.mock.calls[0][1]).not.toHaveProperty('ownerId');
  });
});

describe('a task’s Project field', () => {
  it('files the task in a project, against its rev', async () => {
    serve();
    patch.mockResolvedValue({ task: task({ project: 'p1', rev: 4 }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} onOpen={() => {}} />);
    const picker = await screen.findByRole('combobox', { name: 'Project' });
    await waitFor(() => expect(within(picker).getByRole('option', { name: 'Diwali launch' })).toBeInTheDocument());
    fireEvent.change(picker, { target: { value: 'p1' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, projectId: 'p1' }));
  });

  it('is read-only for someone who may not edit the task, and absent on a personal task', async () => {
    serve({ t: task({ project: 'p1', can: { ...can, edit: false } }) });
    const view = wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Project' })).toBeDisabled());
    view.unmount();
    serve({ t: task({ personal: true, team: null }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} onOpen={() => {}} />);
    await screen.findAllByText('Design banners');
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull();
  });
});

describe('job templates', () => {
  const FITTING = {
    id: 'jt1', name: 'Fitting job', colour: 'blue', columns: ['To do', 'Garage 1', 'Garage 2', 'Done'], lists: ['Fitting', 'Paperwork'],
    taskCount: 9, tasks: ['Order parts', 'Fit roof rack'], fromProject: 'PRJ-0007', createdByName: 'Meera', can: { delete: true },
  };
  const withTemplates = (list: unknown[]) => {
    const orig = get.getMockImplementation()!;
    get.mockImplementation((url: string) => (url === '/staff/tasks/projects/job-templates' ? Promise.resolve({ templates: list }) : orig(url)));
  };
  const openNew = async () => {
    addressBar.reset('/team/tasks', 'view=projects');
    head();
    fireEvent.click((await screen.findAllByRole('button', { name: /New project/ }))[0]);
    return screen.findByRole('dialog', { name: 'New project' });
  };

  it('New project starts from a template: it shows what comes with it and sends only its id, not lists or columns', async () => {
    serve({ projects: [] });
    withTemplates([FITTING]);
    post.mockResolvedValue({ project: project({ id: 'p9' }), fromTemplate: { name: 'Fitting job', tasks: 9, movedEarlier: 0, failed: [] } });
    const dialog = await openNew();
    fireEvent.change(await within(dialog).findByLabelText('Start from'), { target: { value: 'jt1' } });
    expect(within(dialog).getByText(/To do · Garage 1 · Garage 2 · Done/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Order parts, Fit roof rack and 7 more/)).toBeInTheDocument();
    // The template brings its own: the editors step aside.
    expect(within(dialog).queryByText(/Use this project’s own statuses/)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Project name'), { target: { value: 'Arun’s Thar' } });
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: '2026-11-20' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, body] = post.mock.calls[0];
    expect(body).toMatchObject({ name: 'Arun’s Thar', startOn: '2026-11-20', templateId: 'jt1', clientId: expect.any(String) });
    expect(body).not.toHaveProperty('lists');
    expect(body).not.toHaveProperty('statuses');
    const toast = (jest.requireMock('react-hot-toast') as { default: { success: jest.Mock } }).default;
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Project created from “Fitting job” with 9 tasks.', undefined));
  });

  it('with no templates the form is as before; its author can delete one', async () => {
    serve({ projects: [] });
    withTemplates([]);
    const dialog = await openNew();
    expect(within(dialog).queryByLabelText('Start from')).toBeNull();
    expect(within(dialog).getByText(/Use this project’s own statuses/)).toBeInTheDocument();
  });

  it('the author deletes a template from the picker', async () => {
    serve({ projects: [] });
    withTemplates([FITTING]);
    const del = jest.requireMock('@/lib/api-client').default.delete as jest.Mock;
    del.mockResolvedValue({ deleted: true });
    const dialog = await openNew();
    fireEvent.change(await within(dialog).findByLabelText('Start from'), { target: { value: 'jt1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Delete this template/ }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/staff/tasks/projects/job-templates/jt1'));
  });

  it('the owner saves a project as a template by name; someone without edit rights sees no button', async () => {
    serve({ one: project() });
    post.mockResolvedValue({ template: { ...FITTING, taskCount: 3 } });
    addressBar.reset('/team/tasks', 'view=project&project=p1');
    head();
    fireEvent.click(await screen.findByRole('button', { name: /Save as template/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Save as job template' });
    expect(within(dialog).getByRole('button', { name: /Save template/ })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Template name'), { target: { value: ' Fitting job ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Save template/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/projects/p1/template', { name: 'Fitting job' }));
  });

  it('a name already taken is said in the box', async () => {
    serve({ one: project() });
    post.mockRejectedValue({ status: 409, rawData: { message: 'There is already a template called “Fitting job”. Pick another name.' } });
    addressBar.reset('/team/tasks', 'view=project&project=p1');
    head();
    fireEvent.click(await screen.findByRole('button', { name: /Save as template/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Save as job template' });
    fireEvent.change(within(dialog).getByLabelText('Template name'), { target: { value: 'Fitting job' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Save template/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/already a template/);
  });

  it('no Save as template without edit rights', async () => {
    serve({ one: project({ can: { edit: false, archive: false, restore: false } }) });
    addressBar.reset('/team/tasks', 'view=project&project=p1');
    head();
    expect(await screen.findByRole('region', { name: 'Project' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save as template/ })).toBeNull();
  });
});
