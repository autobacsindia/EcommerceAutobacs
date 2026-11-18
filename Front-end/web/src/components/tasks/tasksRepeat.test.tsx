/**
 * Repeating tasks on screen. The server decides every date and makes each copy
 * (Back-end/server/tests/staffTaskRepeat.test.js); these pin what the panel shows
 * and sends:
 *   - the rule reads in plain words ("Every month on the 1st")
 *   - the picker: Never / Daily / Weekly / Monthly, every N, the day of the month
 *     (taken from the due date), a note for the 29th-31st
 *   - the new-task form sends the rule only when one is picked
 *   - the task page: whoever may edit changes it and saves once; "Never" sends
 *     'never'; others only read it; a sub-task has no repeat field; "Next: T-…"
 *   - list rows and board cards carry the small "repeats" mark
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import TaskDetail from './TaskDetail';
import TaskForm from './TaskForm';
import { TaskMeta } from './TaskList';
import { RepeatPicker } from './RepeatPicker';
import { DEFAULT_TASK_RULES } from './dueRules';
import { repeatText, todayIST, type Assignee, type RepeatInput, type Task } from './types';

const get = jest.fn();
const post = jest.fn();
const patch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a),
    put: jest.fn(), patch: (...a: unknown[]) => patch(...a), delete: jest.fn(),
  },
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn(), dismiss: jest.fn() } }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const TODAY = todayIST();
const can = { edit: true, status: true, reassign: true, archive: true, restore: false, comment: true, checklist: true, files: true, follow: true, followers: true, repeat: true };
const MONTHLY = { unit: 'month' as const, every: 1, day: 1, label: 'Every month on the 1st' };
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', number: 7, code: 'T-7', title: 'Monthly office supply purchase', summary: '', description: '',
  status: 'todo', statusLabel: 'To do', priority: 'normal', priorityLabel: 'Normal',
  dueOn: TODAY, dueTime: null, startOn: null, tags: [], overdue: false, dueToday: true,
  assignees: [{ id: 'u2', name: 'Arun' }], followers: [], following: false, assignee: { id: 'u2', name: 'Arun' }, team: 'procurement', teamLabel: 'Procurement',
  createdBy: { id: 'u1', name: 'Priya' }, order: null, group: null, checklist: { done: 0, total: 0 }, bucket: 'open',
  completedAt: null, archivedAt: null, commentCount: 0, lastCommentAt: null,
  createdAt: '2026-11-17T04:00:00Z', updatedAt: '2026-11-17T04:00:00Z', rev: 3, can, history: [], repeat: null, ...over,
});
const me: Assignee = { id: 'u1', name: 'Priya', team: 'procurement', teamLabel: 'Procurement', isHead: true, me: true };

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const serve = (t: Task = task()) => {
  get.mockImplementation((url: string) => {
    if (url === '/staff/tasks/rules') return Promise.resolve({ rules: DEFAULT_TASK_RULES });
    if (url === '/staff/tasks/assignees') return Promise.resolve({ people: [me] });
    if (url.endsWith('/links')) return Promise.resolve({ waitingOn: [], blocking: [], related: [], hidden: 0, hiddenWaiting: 0, canAdd: false });
    if (url.includes('/comments')) return Promise.resolve({ comments: [], nextBefore: null });
    if (url.includes('/subtasks')) return Promise.resolve({ subtasks: [], total: 0, done: 0 });
    if (url.includes('/time')) return Promise.resolve({ entries: [], total: { seconds: 0 }, people: [], nextCursor: null });
    return Promise.resolve({ task: t });
  });
};

beforeEach(() => {
  get.mockReset(); post.mockReset(); patch.mockReset();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('the rule in words', () => {
  it('reads like the server\'s label', () => {
    expect(repeatText(null)).toBe('Never');
    expect(repeatText({ unit: 'day', every: 1 })).toBe('Every day');
    expect(repeatText({ unit: 'week', every: 2 })).toBe('Every 2 weeks');
    expect(repeatText({ unit: 'month', every: 1, day: 1 })).toBe('Every month on the 1st');
    expect(repeatText({ unit: 'month', every: 3, day: 22 })).toBe('Every 3 months on the 22nd');
    expect(repeatText({ unit: 'month', every: 1, day: 11 })).toBe('Every month on the 11th');
  });
});

describe('the picker', () => {
  const Harness = ({ dueOn, onValue }: { dueOn: string; onValue: (v: RepeatInput | null) => void }) => {
    const [v, setV] = useState<RepeatInput | null>(null);
    return <RepeatPicker value={v} dueOn={dueOn} onChange={(next) => { setV(next); onValue(next); }} />;
  };

  it('Monthly starts on the due date\'s day; the day and "every" can change; Never clears it', () => {
    const seen = jest.fn();
    render(<Harness dueOn="2026-12-01" onValue={seen} />);
    expect(screen.queryByLabelText('Repeat every')).toBeNull();
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'month' } });
    expect(seen).toHaveBeenLastCalledWith({ unit: 'month', every: 1, day: 1 });
    expect(screen.getByLabelText('Day of the month')).toHaveValue('1');
    fireEvent.change(screen.getByLabelText('Repeat every'), { target: { value: '2' } });
    expect(seen).toHaveBeenLastCalledWith({ unit: 'month', every: 2, day: 1 });
    expect(screen.getByText('months')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Day of the month'), { target: { value: '31' } });
    expect(seen).toHaveBeenLastCalledWith({ unit: 'month', every: 2, day: 31 });
    expect(screen.getByText(/In shorter months it is due on the last day/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'never' } });
    expect(seen).toHaveBeenLastCalledWith(null);
    expect(screen.queryByLabelText('Day of the month')).toBeNull();
  });

  it('"every" stays within 1 to 99; weekly has no day of the month', () => {
    const seen = jest.fn();
    render(<Harness dueOn="2026-12-01" onValue={seen} />);
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'week' } });
    expect(seen).toHaveBeenLastCalledWith({ unit: 'week', every: 1 });
    expect(screen.queryByLabelText('Day of the month')).toBeNull();
    fireEvent.change(screen.getByLabelText('Repeat every'), { target: { value: '500' } });
    expect(seen).toHaveBeenLastCalledWith({ unit: 'week', every: 99 });
    fireEvent.change(screen.getByLabelText('Repeat every'), { target: { value: '0' } });
    expect(seen).toHaveBeenLastCalledWith({ unit: 'week', every: 1 });
  });
});

describe('the new-task form', () => {
  const fill = async () => {
    serve();
    post.mockResolvedValue({ task: task(), tasks: [task()] });
    wrap(<TaskForm onDone={() => {}} onCancel={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Monthly office supply purchase' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: TODAY } });
  };

  it('sends the rule picked', async () => {
    await fill();
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'month' } });
    fireEvent.change(screen.getByLabelText('Day of the month'), { target: { value: '1' } });
    expect(screen.getByText(/the next one is made by itself/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toMatchObject({ title: 'Monthly office supply purchase', repeat: { unit: 'month', every: 1, day: 1 } });
  });

  it('sends nothing about repeating when left at Never', async () => {
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).not.toHaveProperty('repeat');
  });
});

describe('the task page', () => {
  it('shows the rule and the next copy', async () => {
    serve(task({ repeat: MONTHLY, repeatNext: { id: 't9', code: 'T-9' }, status: 'done', bucket: 'done' }));
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: /Repeats: Every month on the 1st/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Next: T-9/ })).toHaveAttribute('href', '/team/tasks/t9');
  });

  it('whoever may edit changes it and saves once, against the task\'s revision', async () => {
    serve();
    patch.mockResolvedValue({ task: task({ rev: 4, repeat: MONTHLY }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Repeats: Never/ }));
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'month' } });
    fireEvent.change(screen.getByLabelText('Day of the month'), { target: { value: '1' } });
    expect(patch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1]).toEqual({ rev: 3, repeat: { unit: 'month', every: 1, day: 1 } });
  });

  it('"Never" stops it', async () => {
    serve(task({ repeat: MONTHLY }));
    patch.mockResolvedValue({ task: task({ rev: 4 }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Repeats: Every month on the 1st/ }));
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'never' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1]).toEqual({ rev: 3, repeat: 'never' });
  });

  it('someone who may not edit only reads it', async () => {
    serve(task({ repeat: MONTHLY, can: { ...can, edit: false, repeat: false } }));
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    expect(await screen.findByText('Every month on the 1st')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Repeats:/ })).toBeNull();
  });

  it('a sub-task has no repeat field', async () => {
    serve(task({ parent: { id: 'p1', code: 'T-1', title: 'Office' }, can: { ...can, repeat: false } }));
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    await screen.findByText('Office');
    expect(screen.queryByText('Repeats')).toBeNull();
  });

  it('the history says who set it, and that a copy came from a repeat', async () => {
    serve(task({
      history: [
        { at: '2026-11-17T05:00:00Z', by: 'Priya', action: 'repeat', from: 'Never', to: 'Every month on the 1st' },
        { at: '2026-11-17T04:00:00Z', by: 'Arun', action: 'created', from: 'repeat of T-6', to: 'Arun' },
      ],
    }));
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    expect(await screen.findByText(/set it to repeat: every month on the 1st/)).toBeInTheDocument();
    expect(screen.getByText(/created this task for Arun \(repeat of T-6\)/)).toBeInTheDocument();
  });
});

describe('the "repeats" mark', () => {
  it('is on a repeating task\'s row or card, and not on a one-off', () => {
    const { rerender } = render(<TaskMeta t={task({ repeat: MONTHLY })} />);
    expect(screen.getByTitle('Repeats: Every month on the 1st')).toBeInTheDocument();
    rerender(<TaskMeta t={task()} />);
    expect(screen.queryByTitle(/Repeats:/)).toBeNull();
  });
});
