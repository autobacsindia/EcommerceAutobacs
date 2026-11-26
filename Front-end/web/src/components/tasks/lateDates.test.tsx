/**
 * Late tasks and new dates on screen (lateDates.tsx). The server decides and is
 * tested in Back-end/server/tests/staffTaskNewDate.test.js; these pin what the
 * panel shows and sends:
 *   - a late task asks the person doing it for a reason, a note and a new date,
 *     and sends nothing until all three are there (and the date is ahead)
 *   - missed twice or more: dark red with a danger sign
 *   - whoever gave it approves the asked date, gives another, or says no with a note
 *   - someone else sees who it waits for, and no buttons
 *   - before the deadline, "Need more time?" opens the same form
 *   - the corner pop-up lists late tasks still waiting for a reason, links to
 *     each, and "Remind me in 30 min" hides it
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LateMark, LateTasksPrompt, NewDatePanel, SNOOZE_KEY } from './lateDates';
import { addDays } from './dueRules';
import { todayIST, type LateRequest, type Task } from './types';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn(), dismiss: jest.fn() } }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

const TODAY = todayIST();
const inDays = (n: number) => addDays(TODAY, n);
const can = { edit: false, status: true, reassign: false, archive: false, restore: false, comment: true, checklist: false, files: true, follow: true, followers: false };
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', number: 7, code: 'T-7', title: 'Send quote to RK', summary: '', description: '',
  status: 'in_progress', statusLabel: 'In progress', priority: 'normal', priorityLabel: 'Normal',
  dueOn: inDays(-1), dueTime: null, startOn: null, tags: [], overdue: true, dueToday: false,
  assignees: [{ id: 'u2', name: 'Arun' }], followers: [], following: false, assignee: { id: 'u2', name: 'Arun' }, team: 'sales', teamLabel: 'Sales',
  createdBy: { id: 'u1', name: 'Priya' }, order: null, group: null, checklist: { done: 0, total: 0 }, bucket: 'open',
  completedAt: null, archivedAt: null, commentCount: 0, lastCommentAt: null,
  createdAt: '2026-11-17T04:00:00Z', updatedAt: '2026-11-17T04:00:00Z', rev: 3,
  misses: 1, danger: false, needsReason: true, lateRequest: null,
  can: { ...can, askNewDate: true, decideNewDate: false }, ...over,
});
const asked = (over: Partial<LateRequest> = {}): LateRequest => ({
  status: 'pending', late: true, reason: 'needed_info', reasonLabel: 'Needed more information', note: 'RK hasn’t sent the car model',
  fromDue: inDays(-1), dueOn: inDays(2), dueTime: '17:00', requestedBy: { id: 'u2', name: 'Arun' }, requestedAt: '2026-11-24T10:00:00Z',
  decidedBy: null, decidedAt: null, approvedDue: '', decisionNote: '', ...over,
});

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

beforeEach(() => { get.mockReset(); post.mockReset(); window.sessionStorage.clear(); });

describe('the person doing a late task', () => {
  it('must give a reason, a note and a date still ahead before it sends', async () => {
    post.mockResolvedValue({ task: task({ lateRequest: asked(), needsReason: false, can: { ...can, askNewDate: false } }) });
    wrap(<NewDatePanel task={task()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This task is late. Say why, and when it will be done.');
    const send = screen.getByRole('button', { name: /send for approval/i });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Why wasn’t it done on time?'), { target: { value: 'needed_info' } });
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'RK hasn’t sent the car model' } });
    fireEvent.change(screen.getByLabelText('New date'), { target: { value: inDays(-1) } });
    expect(screen.getByText('Pick a date and time that is still ahead.')).toBeInTheDocument();
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('New date'), { target: { value: inDays(2) } });
    fireEvent.change(screen.getByLabelText('New time'), { target: { value: '17:00' } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/t1/new-date', {
      rev: 3, reason: 'needed_info', note: 'RK hasn’t sent the car model', dueOn: inDays(2), dueTime: '17:00',
    }));
  });

  it('missed twice is dark red with a danger sign', () => {
    wrap(<NewDatePanel task={task({ misses: 2, danger: true })} />);
    const box = screen.getByRole('alert');
    expect(box).toHaveTextContent('This task is late — missed 2 times.');
    expect(box.className).toContain('bg-red-900');
  });

  it('a refused date shows why, and asks again', () => {
    wrap(<NewDatePanel task={task({ lateRequest: asked({ status: 'rejected', decidedBy: { id: 'u1', name: 'Priya' }, decisionNote: 'Needed today — call RK now' }) })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Priya did not approve');
    expect(screen.getByRole('alert')).toHaveTextContent('“Needed today — call RK now”');
    expect(screen.getByRole('button', { name: /send for approval/i })).toBeInTheDocument();
  });

  it('before the deadline, "Need more time?" opens the same form', () => {
    wrap(<NewDatePanel task={task({ dueOn: inDays(1), overdue: false, misses: 0, needsReason: false })} />);
    fireEvent.click(screen.getByRole('button', { name: /need more time/i }));
    expect(screen.getByLabelText('Why do you need more time?')).toBeInTheDocument();
  });
});

describe('whoever gave it', () => {
  const waiting = () => task({ lateRequest: asked(), needsReason: false, can: { ...can, askNewDate: false, decideNewDate: true } });

  it('approves the date asked for', async () => {
    post.mockResolvedValue({ task: task({ overdue: false, lateRequest: asked({ status: 'approved' }) }) });
    wrap(<NewDatePanel task={waiting()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Needed more information: “RK hasn’t sent the car model”');
    fireEvent.click(screen.getByRole('button', { name: /^Approve/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/t1/new-date/decision', { rev: 3, decision: 'approve' }));
  });

  it('gives another date', async () => {
    post.mockResolvedValue({ task: task() });
    wrap(<NewDatePanel task={waiting()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Give another date' }));
    fireEvent.change(screen.getByLabelText('Your date'), { target: { value: inDays(1) } });
    fireEvent.change(screen.getByLabelText('Your time'), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve this date' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/t1/new-date/decision', { rev: 3, decision: 'approve', dueOn: inDays(1), dueTime: '10:00' }));
  });

  it('says no only with a note', async () => {
    post.mockResolvedValue({ task: task() });
    wrap(<NewDatePanel task={waiting()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not approve' }));
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/why not/i), { target: { value: 'Call RK now' } });
    fireEvent.click(send);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/t1/new-date/decision', { rev: 3, decision: 'reject', note: 'Call RK now' }));
  });

  it('anyone else sees who it waits for, and no buttons', () => {
    wrap(<NewDatePanel task={task({ lateRequest: asked(), needsReason: false, can: { ...can } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for Priya to approve.');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('the mark on a row', () => {
  it('danger, or a new date asked, or nothing', () => {
    const { rerender } = render(<LateMark task={task({ danger: true, misses: 3 })} />);
    expect(screen.getByText('Missed 3 times')).toBeInTheDocument();
    rerender(<LateMark task={task({ lateRequest: asked() })} />);
    expect(screen.getByText('New date asked')).toBeInTheDocument();
    rerender(<LateMark task={task({ bucket: 'done', danger: true })} />);
    expect(screen.queryByText(/Missed/)).toBeNull();
  });
});

describe('the late-tasks pop-up', () => {
  it('lists late tasks still waiting for a reason, and "Remind me in 30 min" hides it', async () => {
    get.mockResolvedValue({ tasks: [task(), task({ id: 't2', code: 'T-8', title: 'Call supplier', danger: true, misses: 2 }), task({ id: 't3', code: 'T-9', needsReason: false })] });
    wrap(<LateTasksPrompt base="/team/tasks" />);
    const box = await screen.findByRole('alert', { name: 'Late tasks' });
    expect(get).toHaveBeenCalledWith('/staff/tasks?view=mine&due=overdue');
    expect(box).toHaveTextContent('2 tasks of yours are late');
    expect(screen.getByRole('link', { name: /T-7 · Send quote to RK/ })).toHaveAttribute('href', '/team/tasks/t1');
    expect(screen.getByRole('link', { name: /T-8 · Call supplier/ })).toBeInTheDocument();
    expect(screen.queryByText(/T-9/)).toBeNull();
    // Any task missed twice turns the whole card dark red.
    expect(box.className).toContain('bg-red-900');
    fireEvent.click(screen.getByRole('button', { name: 'Remind me in 30 min' }));
    expect(screen.queryByRole('alert', { name: 'Late tasks' })).toBeNull();
    expect(Number(window.sessionStorage.getItem(SNOOZE_KEY))).toBeGreaterThan(Date.now());
  });

  it('shows nothing when every late task has a reason', async () => {
    get.mockResolvedValue({ tasks: [task({ needsReason: false })] });
    wrap(<LateTasksPrompt base="/team/tasks" />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByRole('alert', { name: 'Late tasks' })).toBeNull();
  });
});

describe('taking a task on', () => {
  const given = (over: Partial<Task> = {}) => task({
    dueOn: inDays(2), dueTime: '17:00', overdue: false, misses: 0, needsReason: false, needsAccept: true,
    notAccepted: [{ id: 'u2', name: 'Arun' }], can: { ...can, askNewDate: true, accept: true }, ...over,
  });

  it('Accept takes it on at its date', async () => {
    post.mockResolvedValue({ task: given({ needsAccept: false, notAccepted: [], can: { ...can, askNewDate: true, accept: false } }) });
    wrap(<NewDatePanel task={given()} />);
    expect(screen.getByRole('region', { name: 'Accept this task' })).toHaveTextContent(/^Priya gave you this task — due .*\. Can you do it by then\?/);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/t1/accept', { rev: 3 }));
  });

  it('"Can’t make this date" asks why and for a date they can make', async () => {
    post.mockResolvedValue({ task: given({ lateRequest: asked({ late: false, atStart: true }), can: { ...can, accept: false } }) });
    wrap(<NewDatePanel task={given()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Can’t make this date' }));
    fireEvent.change(screen.getByLabelText('Why can’t you make this date?'), { target: { value: 'more_work' } });
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'On the Hilux job till Friday' } });
    fireEvent.change(screen.getByLabelText('New date'), { target: { value: inDays(4) } });
    fireEvent.click(screen.getByRole('button', { name: /send for approval/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/t1/new-date', expect.objectContaining({ reason: 'more_work', dueOn: inDays(4) })));
  });

  it('a refused date shows why, and asks again', () => {
    wrap(<NewDatePanel task={given({ lateRequest: asked({ late: false, atStart: true, status: 'rejected', decidedBy: { id: 'u1', name: 'Priya' }, decisionNote: 'Needed Thursday' }) })} />);
    expect(screen.getByRole('region', { name: 'Accept this task' })).toHaveTextContent('Priya did not approve');
  });

  it('whoever gave it sees who has not accepted; the request reads "Can’t make this date"', () => {
    const { unmount } = wrap(<NewDatePanel task={given({ needsAccept: false, can: { ...can } })} />);
    expect(screen.getByText('Not accepted yet by Arun.')).toBeInTheDocument();
    unmount();
    wrap(<NewDatePanel task={given({ needsAccept: false, lateRequest: asked({ late: false, atStart: true }), can: { ...can, decideNewDate: true } })} />);
    expect(screen.getByRole('status')).toHaveTextContent(/^Can’t make this date: Arun asks for/);
  });

  it('the row mark: "New — accept it" for them, "Not accepted yet" for others', () => {
    const { rerender } = render(<LateMark task={given()} />);
    expect(screen.getByText('New — accept it')).toBeInTheDocument();
    rerender(<LateMark task={given({ needsAccept: false })} />);
    expect(screen.getByText('Not accepted yet')).toBeInTheDocument();
  });
});
