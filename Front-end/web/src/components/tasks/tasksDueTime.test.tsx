/**
 * A time on the due day: how it reads ("Today 5:30 PM", "Late · 5:30 PM"),
 * and that picking or clearing it sends one change against the task's revision.
 * The server decides lateness (tests/staffTaskDueTime.test.js); these pin what
 * the screen says and sends.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TaskDetail from './TaskDetail';
import { dueLabel } from './ui';
import { DUE_TIMES, formatDueKey, formatDueTime, isPastDue, type Task } from './types';

const get = jest.fn();
const patch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: jest.fn(), patch: (...a: unknown[]) => patch(...a), delete: jest.fn() },
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn(), dismiss: jest.fn() } }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const can = { edit: true, status: true, reassign: true, archive: true, restore: false, comment: true, checklist: true, files: true, follow: true, followers: true };
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', number: 7, code: 'T-7', title: 'Call Bosch', summary: '', description: '',
  status: 'todo', statusLabel: 'To do', priority: 'normal', priorityLabel: 'Normal',
  dueOn: '2026-11-06', dueTime: null, startOn: null, tags: [], overdue: false, dueToday: false,
  assignees: [], followers: [], following: false, assignee: { id: 'u2', name: 'Arun' }, team: 'procurement', teamLabel: 'Procurement',
  createdBy: { id: 'u1', name: 'Priya' }, order: null, group: null, checklist: { done: 0, total: 0 }, bucket: 'open',
  completedAt: null, archivedAt: null, commentCount: 0, lastCommentAt: null,
  createdAt: '2026-10-27T04:00:00Z', updatedAt: '2026-10-27T04:00:00Z', rev: 3, can,
  history: [], ...over,
});
const detail = (t: Task) => {
  get.mockImplementation((url: string) => {
    if (url === '/staff/tasks/assignees') return Promise.resolve({ people: [] });
    if (url.includes('/comments')) return Promise.resolve({ comments: [], nextBefore: null });
    return Promise.resolve({ task: t });
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  get.mockReset(); patch.mockReset();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('how a due time reads', () => {
  it('in 12-hour India style, dropping ":00"', () => {
    expect(formatDueTime('17:30')).toBe('5:30 PM');
    expect(formatDueTime('10:00')).toBe('10 AM');
    expect(formatDueTime('00:00')).toBe('12 AM');
    expect(formatDueTime('12:05')).toBe('12:05 PM');
    expect(formatDueKey('2026-11-06 17:30')).toBe('6 Nov, 5:30 PM');
    expect(formatDueKey('2026-11-06')).toBe('6 Nov');
  });

  it('as a pill: today, late today, an earlier day, a later day, done', () => {
    const t = (over: Partial<Task>) => ({ ...task(), ...over });
    expect(dueLabel(t({ dueOn: '2026-11-04', dueTime: '17:30', dueToday: true }))).toBe('Today 5:30 PM');
    expect(dueLabel(t({ dueOn: '2026-11-04', dueToday: true }))).toBe('Today');
    expect(dueLabel(t({ dueOn: '2026-11-04', dueTime: '09:00', dueToday: true, overdue: true }))).toBe('Late · 9 AM');
    expect(dueLabel(t({ dueOn: '2026-11-03', dueTime: '09:00', overdue: true }))).toBe('Late · 3 Nov, 9 AM');
    expect(dueLabel(t({ dueOn: '2026-11-06', dueTime: '10:00' }))).toBe('6 Nov, 10 AM');
    expect(dueLabel(t({ dueOn: '2026-11-03', dueTime: '09:00', overdue: true, bucket: 'done' }))).toBe('3 Nov, 9 AM');
  });

  it('a time today that has come is past; one still to come is not (India time)', () => {
    const at = new Date('2026-11-04T12:00:00Z'); // 17:30 IST
    expect(isPastDue('2026-11-04', '17:30', at)).toBe(true);
    expect(isPastDue('2026-11-04', '17:31', at)).toBe(false);
    expect(isPastDue('2026-11-04', null, at)).toBe(false);
    expect(isPastDue('2026-11-03', null, at)).toBe(true);
  });

  it('the time list goes every 15 minutes through the day', () => {
    expect(DUE_TIMES).toHaveLength(96);
    expect(DUE_TIMES.slice(0, 3)).toEqual(['00:00', '00:15', '00:30']);
    expect(DUE_TIMES.at(-1)).toBe('23:45');
  });
});

describe('the task window', () => {
  it('picking a time sends just the time; "No time" takes it off', async () => {
    patch.mockResolvedValueOnce({ task: task({ dueTime: '17:30', rev: 4 }) }).mockResolvedValueOnce({ task: task({ dueTime: null, rev: 5 }) });
    detail(task());
    const pick = await screen.findByLabelText('Due time');
    expect(pick).toHaveValue('');
    fireEvent.change(pick, { target: { value: '17:30' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, dueTime: '17:30' }));
    await waitFor(() => expect(screen.getByLabelText('Due time')).toHaveValue('17:30'));
    fireEvent.change(screen.getByLabelText('Due time'), { target: { value: '' } });
    await waitFor(() => expect(patch).toHaveBeenLastCalledWith('/staff/tasks/t1', { rev: 4, dueTime: null }));
  });

  it('no time box until there is a due date', async () => {
    detail(task({ dueOn: null }));
    await screen.findByLabelText('Due date');
    expect(screen.queryByLabelText('Due time')).toBeNull();
  });

  it('a time set another way (not on the 15-minute list) still shows', async () => {
    detail(task({ dueTime: '17:37' }));
    expect(await screen.findByLabelText('Due time')).toHaveValue('17:37');
    expect(screen.getByRole('option', { name: '5:37 PM' })).toBeInTheDocument();
  });

  it('the history says the time', async () => {
    detail(task({ history: [{ at: '2026-11-04T05:00:00Z', by: 'Priya', action: 'due', from: '2026-11-06', to: '2026-11-06 17:30' }] }));
    expect(await screen.findByText(/changed the due date from 6 Nov to 6 Nov, 5:30 PM/)).toBeInTheDocument();
  });
});
