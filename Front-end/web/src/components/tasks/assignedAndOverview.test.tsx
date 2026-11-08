import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssignedComments } from './AssignedComments';
import { AssignCommentButton, CommentAssignment } from './CommentAssign';
import { TeamOverview } from './TeamOverview';
import type { AssignedComment, Task, TaskComment, TeamOverviewData } from './types';

const get = jest.fn();
const put = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) },
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { error: jest.fn(), success: jest.fn() } }));

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const task = { id: 't1', code: 'T-1', bucket: 'open' } as Task;
const row = (over: Partial<AssignedComment> = {}): AssignedComment => ({
  id: 'c1', task: { id: 't1', code: 'T-1', title: 'Call Ravi' }, canOpen: true, text: 'Please check', by: { id: 'u1', name: 'Arun' },
  assignedBy: 'Priya', at: '2026-11-01T10:00:00Z', resolvedAt: null, ...over,
});
const comment = (assignment: TaskComment['assignment']) => ({ id: 'c1', assignment } as TaskComment);
const assignment = (over = {}) => ({ to: { id: 'u2', name: 'Bala' }, by: { id: 'u1', name: 'Priya' }, at: 'x', resolvedAt: null, resolvedBy: '', canChange: true, ...over });
const overview = (over: Partial<TeamOverviewData> = {}): TeamOverviewData => ({
  team: 'sales', counts: { open: 4, late: 2, today: 1, nextWeek: 1, noDate: 0, unassigned: 1, doneWeek: 3 }, capped: false,
  byStatus: [{ status: 'todo', label: 'To do', count: 4 }], people: [{ id: 'u1', name: 'Arun', open: 3, late: 2 }], morePeople: 0,
  late: [{ id: 't2', code: 'T-2', title: 'Late job', dueOn: '2026-11-01', dueTime: '', completedAt: null }], recentDone: [], ...over,
});

beforeEach(() => { get.mockReset(); put.mockReset(); });

describe('Assigned comments', () => {
  it('lists them; Resolve waits for the server and refreshes', async () => {
    get.mockResolvedValue({ comments: [row()], nextBefore: null });
    let finish: (v: unknown) => void = () => {};
    put.mockReturnValue(new Promise((r) => { finish = r; }));
    const onOpen = jest.fn();
    wrap(<AssignedComments onOpen={onOpen} />);
    expect(await screen.findByText('Please check')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /T-1/ }));
    expect(onOpen).toHaveBeenCalledWith('t1');
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/staff/tasks/t1/comments/c1/resolved', { resolved: true }));
    expect(screen.getByText('Please check')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeDisabled();
    get.mockResolvedValue({ comments: [], nextBefore: null });
    finish({});
    expect(await screen.findByText('No comments waiting for you')).toBeInTheDocument();
  });

  it('asks for the next page by cursor', async () => {
    get.mockResolvedValueOnce({ comments: [row()], nextBefore: 'abc' });
    wrap(<AssignedComments onOpen={() => {}} />);
    get.mockResolvedValueOnce({ comments: [row({ id: 'c2', text: 'Older' })], nextBefore: null });
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Older')).toBeInTheDocument();
    expect(get).toHaveBeenLastCalledWith('/staff/tasks/assigned-comments?state=open&before=abc');
  });

  it('a task they lost shows no words, but can be cleared', async () => {
    get.mockResolvedValue({ comments: [row({ canOpen: false, text: '', by: null, task: { id: 't1', code: '', title: '' } })], nextBefore: null });
    wrap(<AssignedComments onOpen={() => {}} />);
    expect(await screen.findByText('You can no longer open this task.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeEnabled();
  });

  it('switches to Resolved; shows an error with retry', async () => {
    get.mockRejectedValueOnce(new Error('down'));
    wrap(<AssignedComments onOpen={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load');
    get.mockResolvedValue({ comments: [], nextBefore: null });
    fireEvent.click(screen.getByRole('tab', { name: 'Resolved' }));
    expect(await screen.findByText('Nothing resolved yet')).toBeInTheDocument();
    expect(get).toHaveBeenLastCalledWith('/staff/tasks/assigned-comments?state=resolved');
  });
});

describe('on the comment', () => {
  it('picks a person, me first, and saves', async () => {
    get.mockResolvedValue({ people: [{ id: 'u2', name: 'Bala' }], me: { id: 'u9', name: 'Asha' } });
    put.mockResolvedValue({ comment: comment(assignment()) });
    const save = jest.fn();
    wrap(<AssignCommentButton task={task} c={comment(null)} put={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Assign comment' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((x) => x.textContent)).toEqual(['Asha (me)', 'Bala']);
    fireEvent.click(items[1]);
    await waitFor(() => expect(put).toHaveBeenCalledWith('/staff/tasks/t1/comments/c1/assignee', { userId: 'u2' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows who has it; Resolve and remove only for those allowed', async () => {
    put.mockResolvedValue({ comment: comment(assignment({ resolvedAt: 'x', resolvedBy: 'Bala' })) });
    const { unmount } = wrap(<CommentAssignment task={task} c={comment(assignment())} put={() => {}} />);
    expect(screen.getByText('Bala')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/staff/tasks/t1/comments/c1/resolved', { resolved: true }));
    unmount();
    wrap(<CommentAssignment task={task} c={comment(assignment({ canChange: false }))} put={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove assignment' })).toBeNull();
  });

  it('a resolved one offers Reopen', () => {
    wrap(<CommentAssignment task={task} c={comment(assignment({ resolvedAt: 'x', resolvedBy: 'Bala' }))} put={() => {}} />);
    expect(screen.getByText(/Resolved by/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
  });
});

describe('Team overview', () => {
  const serve = (d: TeamOverviewData) => get.mockImplementation((u: string) => Promise.resolve(u.includes('/overview') ? d : { teamLabel: 'Sales', canManage: false, folders: [], lists: [{ id: 'l1', kind: 'list', name: 'Calls', colour: '', open: 2 }], other: 0 }));

  it('shows the numbers, people and late tasks, and opens one', async () => {
    serve(overview());
    const onOpen = jest.fn();
    wrap(<TeamOverview team="sales" spaceTeam="sales" onOpen={onOpen} onPickList={() => {}} />);
    expect(await screen.findByText('Done, last 7 days')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/staff/tasks/overview?team=sales');
    expect(screen.getByText('2 late')).toBeInTheDocument();
    expect(screen.getByText('1 with nobody on them')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Late job/ }));
    expect(onOpen).toHaveBeenCalledWith('t2');
  });

  it('is calm when empty, and says when capped', async () => {
    serve(overview({ counts: { open: 0, late: 0, today: 0, nextWeek: 0, noDate: 0, unassigned: 0, doneWeek: 0 }, byStatus: [], people: [], late: [], capped: true }));
    wrap(<TeamOverview team="" spaceTeam="" onOpen={() => {}} onPickList={() => {}} />);
    expect(await screen.findByText('Nothing is late.')).toBeInTheDocument();
    expect(screen.getByText('No open tasks.')).toBeInTheDocument();
    expect(screen.getByText(/first 5,000/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/staff/tasks/overview');
  });

  it('offers a retry on failure', async () => {
    get.mockRejectedValue(new Error('down'));
    wrap(<TeamOverview team="sales" spaceTeam="" onOpen={() => {}} onPickList={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the overview');
  });
});
