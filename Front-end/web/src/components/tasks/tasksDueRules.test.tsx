/**
 * Due-date rules on screen (the server's are tested in
 * Back-end/server/tests/staffTaskDueRules.test.js — the server decides; these pin
 * what the panel warns about and sends):
 *   - the new-task form can't be sent without a due date, or with one later
 *     than the priority allows; a far date says it will wait for approval
 *     (not to the admin, who approves it there and then)
 *   - the task window shows where the date stands; a manager approves, or
 *     refuses with a reason; nobody else sees the buttons
 *   - the history says who asked and who decided
 *   - the admin's rules box sends the numbers
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TaskDetail from './TaskDetail';
import TaskForm from './TaskForm';
import { TaskRulesEditor, addDays, daysAhead, dueCheck, managesDue, DEFAULT_TASK_RULES } from './dueRules';
import { todayIST, type Assignee, type DueApproval, type Task } from './types';

const get = jest.fn();
const post = jest.fn();
const put = jest.fn();
const patch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a), patch: (...a: unknown[]) => patch(...a), delete: jest.fn(),
  },
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn(), dismiss: jest.fn() } }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const TODAY = todayIST();
const inDays = (n: number) => addDays(TODAY, n);
const can = { edit: true, status: true, reassign: true, archive: true, restore: false, comment: true, checklist: true, files: true, follow: true, followers: true };
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', number: 7, code: 'T-7', title: 'Count the stock', summary: '', description: '',
  status: 'todo', statusLabel: 'To do', priority: 'normal', priorityLabel: 'Normal',
  dueOn: inDays(12), dueTime: null, startOn: null, tags: [], overdue: false, dueToday: false,
  assignees: [{ id: 'u2', name: 'Arun' }], followers: [], following: false, assignee: { id: 'u2', name: 'Arun' }, team: 'procurement', teamLabel: 'Procurement',
  createdBy: { id: 'u2', name: 'Arun' }, order: null, group: null, checklist: { done: 0, total: 0 }, bucket: 'open',
  completedAt: null, archivedAt: null, commentCount: 0, lastCommentAt: null,
  createdAt: '2026-11-17T04:00:00Z', updatedAt: '2026-11-17T04:00:00Z', rev: 3, can, history: [], ...over,
});
const pending: DueApproval = {
  status: 'pending', dueOn: inDays(12), auto: false, requestedBy: { id: 'u2', name: 'Arun' }, requestedAt: '2026-11-17T04:00:00Z',
  decidedBy: null, decidedAt: null, note: '',
};
const person = (over: Partial<Assignee>): Assignee => ({ id: 'x', name: 'X', team: 'procurement', teamLabel: 'Procurement', isHead: false, me: false, ...over });
const PEOPLE = {
  head: person({ id: 'u1', name: 'Priya', isHead: true }),
  arun: person({ id: 'u2', name: 'Arun' }),
  sam: person({ id: 'u3', name: 'Sam', team: 'sales', teamLabel: 'Sales' }),
  admin: person({ id: 'u0', name: 'Owner', team: null, teamLabel: 'Admin' }),
};

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const serve = ({ t = task(), people = [{ ...PEOPLE.arun, me: true }, PEOPLE.head] as Assignee[] } = {}) => {
  get.mockImplementation((url: string) => {
    if (url === '/staff/tasks/rules') return Promise.resolve({ rules: DEFAULT_TASK_RULES });
    if (url === '/staff/tasks/assignees') return Promise.resolve({ people });
    if (url.endsWith('/links')) return Promise.resolve({ waitingOn: [], blocking: [], related: [], hidden: 0, hiddenWaiting: 0, canAdd: false });
    if (url.includes('/comments')) return Promise.resolve({ comments: [], nextBefore: null });
    if (url.includes('/subtasks')) return Promise.resolve({ subtasks: [], total: 0, done: 0 });
    return Promise.resolve({ task: t });
  });
};

beforeEach(() => {
  get.mockReset(); post.mockReset(); put.mockReset(); patch.mockReset();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('the rules, as the panel reads them', () => {
  it('counts calendar days, and the 9-day line: day 9 is fine, day 10 waits', () => {
    expect(daysAhead('2026-12-01', '2026-11-30')).toBe(1);
    expect(dueCheck(addDays('2026-11-17', 9), 'normal', DEFAULT_TASK_RULES, '2026-11-17')).toMatchObject({ tooLate: null, needsApproval: false });
    expect(dueCheck(addDays('2026-11-17', 10), 'normal', DEFAULT_TASK_RULES, '2026-11-17')).toMatchObject({ tooLate: null, needsApproval: true });
  });

  it('High: today or tomorrow; Urgent: today; Normal 30; Low 60', () => {
    const at = (n: number, p: Task['priority']) => dueCheck(addDays('2026-11-17', n), p, DEFAULT_TASK_RULES, '2026-11-17').tooLate;
    expect(at(1, 'high')).toBeNull();
    expect(at(2, 'high')).toMatch(/High tasks must be due today or tomorrow/);
    expect(at(0, 'urgent')).toBeNull();
    expect(at(1, 'urgent')).toMatch(/Urgent tasks must be due today/);
    expect(at(30, 'normal')).toBeNull();
    expect(at(31, 'normal')).toMatch(/within 30 days/);
    expect(at(61, 'low')).toMatch(/within 60 days/);
  });

  it('"today" is India\'s day: 23:59 and 00:01 IST are different days', () => {
    expect(todayIST(new Date('2026-11-17T18:29:00Z'))).toBe('2026-11-17');
    expect(todayIST(new Date('2026-11-17T18:31:00Z'))).toBe('2026-11-18');
  });

  it('who sets a date as its manager: the admin, or a head for their own team (not only for themselves)', () => {
    expect(managesDue(PEOPLE.admin, [PEOPLE.sam])).toBe(true);
    expect(managesDue(PEOPLE.head, [PEOPLE.arun])).toBe(true);
    expect(managesDue(PEOPLE.head, [PEOPLE.head])).toBe(false);
    expect(managesDue(PEOPLE.head, [PEOPLE.sam])).toBe(false);
    expect(managesDue(PEOPLE.arun, [PEOPLE.arun])).toBe(false);
  });
});

describe('the new-task form', () => {
  const open = async (people?: Assignee[]) => {
    serve({ people });
    wrap(<TaskForm onDone={() => {}} onCancel={() => {}} />);
    const title = await screen.findByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Count the stock' } });
    return screen.getByRole('button', { name: 'Create task' });
  };

  it('can\'t be sent without a due date', async () => {
    const create = await open();
    expect(screen.getByLabelText('Due date')).toBeRequired();
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: TODAY } });
    expect(create).toBeEnabled();
  });

  it('a date later than the priority allows is refused before it is sent', async () => {
    const create = await open();
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: inDays(2) } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/High tasks must be due today or tomorrow/);
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: inDays(1) } });
    expect(create).toBeEnabled();
  });

  it('a far date says it will wait for approval — day 10, not day 9', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: inDays(9) } });
    expect(screen.queryByText(/your manager needs to approve/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: inDays(10) } });
    expect(await screen.findByText(/your manager needs to approve/)).toBeInTheDocument();
  });

  it('the admin is the manager: no approval note', async () => {
    await open([{ ...PEOPLE.admin, me: true }, PEOPLE.arun]);
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: inDays(15) } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create task' })).toBeEnabled());
    expect(screen.queryByText(/your manager needs to approve/)).toBeNull();
  });
});

describe('the task window', () => {
  it('a manager approves: one request against the task\'s revision', async () => {
    serve({ t: task({ dueApproval: pending, can: { ...can, approveDue: true } }) });
    post.mockResolvedValue({ task: task({ rev: 4, dueApproval: { ...pending, status: 'approved', decidedBy: { id: 'u1', name: 'Priya' } } }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    expect(await screen.findByText(/Waiting for approval:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve date' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/t1/due-approval', { rev: 3, decision: 'approve' }));
    expect(await screen.findByText(/Due date approved by Priya/)).toBeInTheDocument();
  });

  it('refusing needs a reason, which is sent with it', async () => {
    serve({ t: task({ dueApproval: pending, can: { ...can, approveDue: true } }) });
    post.mockResolvedValue({ task: task({ rev: 4, dueApproval: { ...pending, status: 'rejected', note: 'Finish by Friday', decidedBy: { id: 'u1', name: 'Priya' } } }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not approve' }));
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Why\? Which date would do\?/), { target: { value: 'Finish by Friday' } });
    fireEvent.click(send);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/t1/due-approval', { rev: 3, decision: 'reject', note: 'Finish by Friday' }));
    expect(await screen.findByText('“Finish by Friday”')).toBeInTheDocument();
  });

  it('the person who asked sees where it stands, with no buttons', async () => {
    serve({ t: task({ dueApproval: pending, can: { ...can, approveDue: false } }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    expect(await screen.findByText(/Waiting for approval:/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve date' })).toBeNull();
  });

  it('the history says who asked and who decided', async () => {
    serve({ t: task({ history: [
      { at: '2026-11-17T06:00:00Z', by: 'Priya', action: 'due_approval', from: 'waiting for approval', to: 'not approved — Finish by Friday' },
      { at: '2026-11-17T05:00:00Z', by: 'Arun', action: 'due_approval', from: '', to: `asked: due ${inDays(12)}` },
    ] }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    expect(await screen.findByText(/asked a manager to approve the due date/)).toBeInTheDocument();
    expect(screen.getByText(/did not approve the due date — Finish by Friday/)).toBeInTheDocument();
  });

  it('a due date can be moved but not taken off', async () => {
    serve({ t: task({ dueOn: inDays(3) }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Due date'), { target: { value: '' } });
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('the admin\'s rules box', () => {
  it('sends the numbers the admin typed', async () => {
    serve();
    put.mockResolvedValue({ rules: { ...DEFAULT_TASK_RULES, approvalAfterDays: 5, maxDays: { ...DEFAULT_TASK_RULES.maxDays, high: 2 } } });
    wrap(<TaskRulesEditor />);
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Approval needed after days'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('High latest due in days'), { target: { value: '2' } });
    expect(within(screen.getByRole('group')).getByText(/High/).parentElement).toHaveTextContent(/due within 2 days/);
    fireEvent.click(save);
    await waitFor(() => expect(put).toHaveBeenCalledWith('/staff/tasks/rules', {
      approvalAfterDays: 5, maxDays: { urgent: 0, high: 2, normal: 30, low: 60 },
    }));
  });
});
