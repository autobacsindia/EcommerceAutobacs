/**
 * Tasks phase 6b-2 — time on tasks: the timer and the Time section.
 *
 * What must hold:
 *   - lengths read and print the way people write them ("1h 30m", "1:30", "90")
 *   - nothing is optimistic: the timer shows as running only once the server
 *     started it; a refused start leaves no chip; a double-click sends ONE start
 *   - the header chip names the task, ticks from the server's reading, opens
 *     the task and stops the timer
 *   - starting on another task says which one was stopped and what was saved
 *   - a timer that stopped itself at the limit says so, with a link, until dismissed
 *   - the Time section: total and each person's share; Edit / Delete only where
 *     the server allows; add by hand with checks first and ONE clientId per form;
 *     a refused save says why; "Load more" asks for the next page; an error retries
 *   - an archived task offers neither Start nor Add
 *   - list rows and board cards show the time logged
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import TasksWorkspace from './TasksWorkspace';
import {
  durationProblem, formatClock, formatDuration, parseDuration, todayIST,
  type RunningTimer, type Task, type TaskTimePage, type TimeEntry, type TimerState,
} from './types';
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
  follow: true, followers: true, subtask: true, time: true,
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
const people = { people: [{ id: 'u1', name: 'Priya', team: 'procurement', teamLabel: 'Procurement', isHead: true, me: true }] };
const TODAY = todayIST();
const entry = (id: string, over: Partial<TimeEntry> = {}): TimeEntry => ({
  id, by: { id: 'u1', name: 'Priya' }, source: 'manual', day: TODAY, startedAt: '2026-11-02T04:00:00Z', endedAt: '2026-11-02T05:05:00Z',
  seconds: 3900, running: false, autoStopped: false, edited: false, note: '', can: { edit: true, delete: true }, ...over,
});
const runningOn = (t: Task, seconds = 0): RunningTimer => ({
  id: 'run1', task: { id: t.id, code: t.code, title: t.title }, startedAt: '2026-11-02T04:00:00Z', seconds, limitSeconds: 36000,
});
const refused = (status: number, message: string) => Promise.reject({ status, rawData: { message } });

type Serve = {
  list?: Task[]; tasks?: Record<string, Task>; timer?: RunningTimer | null; autoStopped?: TimeEntry | null;
  entries?: TimeEntry[]; more?: TimeEntry[]; people?: TaskTimePage['total']['people']; track?: boolean; timeError?: boolean;
};
/** A fake server that keeps one running timer, like the real one. */
function serve({
  list = [task()], tasks = {}, timer = null, autoStopped = null, entries = [], more = [], people: shares, track = true, timeError = false,
}: Serve = {}) {
  const all: Record<string, Task> = { t1: task(), ...tasks };
  const state = { timer, autoStopped };
  get.mockImplementation((url: string) => {
    if (url === '/staff/tasks/summary') return Promise.resolve({ late: 0, today: 0 });
    if (url === '/staff/tasks/assignees') return Promise.resolve(people);
    if (url === '/staff/tasks/time/current') {
      const out: TimerState = { timer: state.timer, autoStopped: state.autoStopped };
      state.autoStopped = null; // said once, like the server
      return Promise.resolve(out);
    }
    if (url.startsWith('/staff/tasks?')) return Promise.resolve({ tasks: url.includes('state=done') ? [] : list, nextCursor: null });
    if (url.includes('/time')) {
      if (timeError) return refused(500, 'The server is busy.');
      const page: TaskTimePage = url.includes('cursor=')
        ? { entries: more, nextCursor: null, total: { seconds: 0, people: [] }, can: { track } }
        : {
          entries, nextCursor: more.length ? entries[entries.length - 1].id : null,
          total: { seconds: [...entries, ...more].reduce((s, e) => s + e.seconds, 0), people: shares ?? [] }, can: { track },
        };
      return Promise.resolve(page);
    }
    if (url.endsWith('/subtasks')) return Promise.resolve({ subtasks: [], total: 0, done: 0 });
    if (url.includes('/comments')) return Promise.resolve({ comments: [], nextBefore: null });
    const id = url.split('/')[3];
    return all[id] ? Promise.resolve({ task: all[id] }) : refused(404, 'Task not found.');
  });
  return state;
}
const confirm = jest.spyOn(window, 'confirm');
beforeEach(() => {
  localStorage.clear();
  [get, post, patch, del].forEach((f) => f.mockReset());
  (toast.success as jest.Mock).mockReset();
  (toast.error as jest.Mock).mockReset();
  addressBar.reset('/team/tasks');
  confirm.mockReset().mockReturnValue(true);
});
const workspace = () => wrap(<TasksWorkspace base="/team/tasks" canSeeTeam={false} />);
const openTask = async (title: string) => {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Open .*${title}`) }));
  return screen.findByRole('dialog', { name: 'Task' });
};
const timeSection = async (win: HTMLElement) => within(win).findByRole('region', { name: 'Time' });
const posts = (path: string) => post.mock.calls.filter(([url]) => url === path);

describe('lengths of time', () => {
  it('print short: seconds under a minute, then minutes, hours and minutes, whole hours', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59)).toBe('59s');
    expect(formatDuration(12 * 60 + 40)).toBe('12m');
    expect(formatDuration(3900)).toBe('1h 05m');
    expect(formatDuration(36000)).toBe('10h');
    expect(formatClock(2530)).toBe('0:42:10');
    expect(formatClock(36000)).toBe('10:00:00');
  });

  it('read the ways people type them, and refuse the rest', () => {
    expect(parseDuration('90')).toBe(90);
    expect(parseDuration('45m')).toBe(45);
    expect(parseDuration('1h 30m')).toBe(90);
    expect(parseDuration('1h30')).toBe(90);
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('1.5h')).toBe(90);
    expect(parseDuration(' 2 H ')).toBe(120);
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('1:75')).toBeNull();
    expect(durationProblem(null)).toMatch(/Type a length/);
    expect(durationProblem(0)).toMatch(/between 1 minute and 24 hours/);
    expect(durationProblem(24 * 60 + 1)).toMatch(/between 1 minute and 24 hours/);
    expect(durationProblem(24 * 60)).toBe('');
  });
});

describe('the timer', () => {
  it('nothing running: no chip; the window offers Start and says there is no time yet', async () => {
    serve();
    workspace();
    const win = await openTask('Diwali stock check');
    expect(await within(win).findByRole('button', { name: 'Start timer' })).toBeInTheDocument();
    expect(await within(await timeSection(win)).findByText(/No time yet/)).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /Timer running/ })).toBeNull();
  });

  it('a double-click sends ONE start; the chip shows only once the server started it, then ticks', async () => {
    const state = serve();
    let answer: (v: unknown) => void = () => {};
    post.mockImplementation((url: string) => {
      if (url !== '/staff/tasks/t1/time/start') return Promise.resolve({});
      return new Promise((resolve) => { answer = resolve; });
    });
    workspace();
    const win = await openTask('Diwali stock check');
    const start = await within(win).findByRole('button', { name: 'Start timer' });
    fireEvent.click(start);
    fireEvent.click(start);
    expect(await within(win).findByRole('button', { name: 'Starting…' })).toBeDisabled();
    expect(posts('/staff/tasks/t1/time/start')).toHaveLength(1);
    // Not yet confirmed: no chip.
    expect(screen.queryByRole('status', { name: /Timer running/ })).toBeNull();

    state.timer = runningOn(task(), 2530);
    answer({ timer: state.timer, stopped: null });
    const chip = await screen.findByRole('status', { name: /Timer running on T-20/ });
    expect(chip).toHaveTextContent('0:42:1');
    expect(await within(win).findByRole('button', { name: 'Stop timer' })).toBeInTheDocument();
    // It ticks in the browser, from the server's reading.
    await waitFor(() => expect(chip.textContent).toMatch(/0:42:1[1-9]/), { timeout: 3000 });
  });

  it('the chip opens its task and stops the timer, saying what was saved', async () => {
    const other = task({ id: 't30', number: 30, code: 'T-30', title: 'Bosch invoice' });
    const state = serve({ list: [task()], tasks: { t30: other }, timer: runningOn(other, 720) });
    post.mockImplementation((url: string) => {
      if (url === '/staff/tasks/time/stop') {
        state.timer = null;
        return Promise.resolve({ entry: entry('run1', { source: 'timer', seconds: 725, task: { id: 't30', code: 'T-30' } }) });
      }
      return Promise.resolve({});
    });
    workspace();
    const chip = await screen.findByRole('status', { name: /Timer running on T-30/ });
    fireEvent.click(within(chip).getByRole('button', { name: 'T-30' }));
    await waitFor(() => expect(new URLSearchParams(addressBar.search).get('task')).toBe('t30'));

    fireEvent.click(within(chip).getByRole('button', { name: 'Stop the timer on T-30' }));
    await waitFor(() => expect(screen.queryByRole('status', { name: /Timer running/ })).toBeNull());
    expect(posts('/staff/tasks/time/stop')).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith('Stopped T-30 — 12m saved', expect.anything());
  });

  it('starting on another task says which one stopped; the window names the one it will stop', async () => {
    const other = task({ id: 't30', number: 30, code: 'T-30', title: 'Bosch invoice' });
    const state = serve({ timer: runningOn(other, 700) });
    post.mockImplementation(() => {
      state.timer = runningOn(task());
      return Promise.resolve({ timer: state.timer, stopped: entry('run1', { source: 'timer', seconds: 720, task: { id: 't30', code: 'T-30' } }) });
    });
    workspace();
    const win = await openTask('Diwali stock check');
    expect(await within(win).findByText('stops T-30')).toBeInTheDocument();
    fireEvent.click(within(win).getByRole('button', { name: 'Start timer' }));
    expect(await screen.findByRole('status', { name: /Timer running on T-20/ })).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Stopped T-30 — 12m saved', expect.anything());
  });

  it('a start the server refuses says why and leaves no chip', async () => {
    serve();
    post.mockImplementation(() => refused(409, 'Your timer was changed in another tab. Reload and try again.'));
    workspace();
    const win = await openTask('Diwali stock check');
    fireEvent.click(await within(win).findByRole('button', { name: 'Start timer' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Your timer was changed in another tab. Reload and try again.'));
    expect(await within(win).findByRole('button', { name: 'Start timer' })).toBeEnabled();
    expect(screen.queryByRole('status', { name: /Timer running/ })).toBeNull();
  });

  it('a timer that stopped itself at the limit says so, links to its task, and goes when dismissed', async () => {
    const other = task({ id: 't30', number: 30, code: 'T-30', title: 'Bosch invoice' });
    serve({ tasks: { t30: other }, autoStopped: entry('run1', { source: 'timer', seconds: 36000, autoStopped: true, day: '2026-11-01', task: { id: 't30', code: 'T-30' } }) });
    workspace();
    const note = await screen.findByRole('alert');
    expect(note).toHaveTextContent(/Your timer on T-30 stopped itself at 10h/);
    fireEvent.click(within(note).getByRole('button', { name: 'T-30' }));
    await waitFor(() => expect(new URLSearchParams(addressBar.search).get('task')).toBe('t30'));
    fireEvent.click(within(note).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText(/stopped itself/)).toBeNull());
  });

  it('an archived task offers neither Start nor Add time', async () => {
    const old = task({ bucket: 'archived', archivedAt: '2026-11-01T04:00:00Z', can: { ...can, time: false } });
    serve({ list: [old], tasks: { t1: old }, track: false, entries: [entry('e1', { can: { edit: false, delete: false } })] });
    workspace();
    const win = await openTask('Diwali stock check');
    expect(await within(win).findByText('Archived tasks can’t be timed')).toBeInTheDocument();
    const section = await timeSection(win);
    expect(await within(section).findByText('1h 05m', { selector: 'span.font-mono.tabular-nums.text-gray-900' })).toBeInTheDocument();
    expect(within(win).queryByRole('button', { name: 'Start timer' })).toBeNull();
    expect(within(section).queryByRole('button', { name: /Add time/ })).toBeNull();
  });
});

describe('the Time section', () => {
  const mine = entry('e2', { seconds: 3900, note: 'Counted the shelf' });
  const theirs = entry('e1', { by: { id: 'u2', name: 'Arun' }, seconds: 720, source: 'timer', can: { edit: false, delete: false } });

  it('shows the total and each person’s share; Edit and Delete only on what the server allows', async () => {
    serve({ entries: [mine, theirs], people: [{ id: 'u1', name: 'Priya', seconds: 3900 }, { id: 'u2', name: 'Arun', seconds: 720 }] });
    workspace();
    const section = await timeSection(await openTask('Diwali stock check'));
    expect(await within(section).findByText('Priya 1h 05m · Arun 12m')).toBeInTheDocument();
    expect(within(section).getByText('1h 17m')).toBeInTheDocument();
    expect(within(section).getByText('Counted the shelf')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Correct Priya’s 1h 05m' })).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Delete Priya’s 1h 05m' })).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: /Arun’s/ })).toBeNull();
  });

  it('adding by hand checks first, sends ONE clientId even on a retry, and says what the server refused', async () => {
    serve();
    let tries = 0;
    let answer: (v: unknown) => void = () => {};
    post.mockImplementation(() => {
      tries += 1;
      if (tries === 1) return refused(400, 'Time can be added for the last 90 days only.');
      return new Promise((resolve) => { answer = resolve; });
    });
    workspace();
    const section = await timeSection(await openTask('Diwali stock check'));
    fireEvent.click(await within(section).findByRole('button', { name: /Add time/ }));
    const form = within(section).getByRole('form', { name: 'Add time' });
    const length = within(form).getByLabelText('How long');

    // Checked before anything is sent.
    fireEvent.change(length, { target: { value: 'abc' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add time' }));
    expect(within(form).getByRole('alert')).toHaveTextContent(/Type a length/);
    fireEvent.change(length, { target: { value: '25h' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add time' }));
    expect(within(form).getByRole('alert')).toHaveTextContent(/between 1 minute and 24 hours/);
    expect(post).not.toHaveBeenCalled();

    fireEvent.change(length, { target: { value: '1h 30m' } });
    fireEvent.change(within(form).getByLabelText('Note (optional)'), { target: { value: ' Shelf count ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add time' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Time can be added for the last 90 days only.');

    // The retry, double-clicked: one more request, with the same clientId.
    fireEvent.click(within(form).getByRole('button', { name: 'Add time' }));
    fireEvent.click(within(form).getByRole('button', { name: /Add time|Saving/ }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const [first, second] = post.mock.calls;
    expect(first[0]).toBe('/staff/tasks/t1/time');
    expect(first[1]).toEqual({ minutes: 90, on: TODAY, note: 'Shelf count', clientId: expect.any(String) });
    expect(second[1].clientId).toBe(first[1].clientId);

    answer({ entry: entry('e9') });
    await waitFor(() => expect(within(section).queryByRole('form', { name: 'Add time' })).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Time added', expect.anything());
  });

  it('corrects an entry with what was typed, and deletes one after asking', async () => {
    serve({ entries: [mine] });
    patch.mockResolvedValue({ entry: mine });
    del.mockResolvedValue({});
    workspace();
    const section = await timeSection(await openTask('Diwali stock check'));
    fireEvent.click(await within(section).findByRole('button', { name: 'Correct Priya’s 1h 05m' }));
    const form = within(section).getByRole('form', { name: 'Correct the time' });
    expect(within(form).getByLabelText('How long')).toHaveValue('1h 5m');
    fireEvent.change(within(form).getByLabelText('How long'), { target: { value: '1:15' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1/time/e2', { minutes: 75, on: TODAY, note: 'Counted the shelf' }));

    confirm.mockReturnValueOnce(false);
    fireEvent.click(await within(section).findByRole('button', { name: 'Delete Priya’s 1h 05m' }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(within(section).getByRole('button', { name: 'Delete Priya’s 1h 05m' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/staff/tasks/t1/time/e2'));
  });

  it('a running entry says so, without a length that would sit still', async () => {
    serve({ entries: [entry('run1', { source: 'timer', running: true, seconds: 2530, endedAt: null, can: { edit: false, delete: true } })] });
    workspace();
    const section = await timeSection(await openTask('Diwali stock check'));
    expect(await within(section).findByText('running now')).toBeInTheDocument();
    expect(within(section).getByRole('listitem')).not.toHaveTextContent('42m');
    expect(within(section).queryByRole('button', { name: /Correct/ })).toBeNull();
  });

  it('"Load more" asks for the page after the last entry', async () => {
    serve({ entries: [mine], more: [theirs] });
    workspace();
    const section = await timeSection(await openTask('Diwali stock check'));
    fireEvent.click(await within(section).findByRole('button', { name: 'Load more' }));
    expect(await within(section).findByText('Arun')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/staff/tasks/t1/time?cursor=e2');
  });

  it('says when the time could not be loaded, and "Try again" asks again', async () => {
    serve({ timeError: true });
    workspace();
    const section = await timeSection(await openTask('Diwali stock check'));
    expect(await within(section).findByRole('alert')).toHaveTextContent('The server is busy.');
    const before = get.mock.calls.filter(([u]) => u === '/staff/tasks/t1/time').length;
    fireEvent.click(within(section).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(get.mock.calls.filter(([u]) => u === '/staff/tasks/t1/time').length).toBe(before + 1));
  });
});

describe('time on the lists', () => {
  it('rows and cards show the time logged; none logged shows nothing', async () => {
    serve({ list: [task({ timeSeconds: 12000 }), task({ id: 't2', number: 21, code: 'T-21', title: 'Shelf labels', timeSeconds: 0 })] });
    workspace();
    const row = (await screen.findByRole('button', { name: /Open .*Diwali stock check/ })).closest('li, tr, [role=row]') as HTMLElement;
    expect(within(row).getByText('3h 20m')).toBeInTheDocument();
    const quiet = screen.getByRole('button', { name: /Open .*Shelf labels/ }).closest('li, tr, [role=row]') as HTMLElement;
    expect(within(quiet).queryByTitle(/tracked/)).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Board/ }));
    const card = await screen.findByRole('button', { name: 'Open T-20: Diwali stock check' });
    expect(within(card).getByText('3h 20m')).toBeInTheDocument();
  });
});
