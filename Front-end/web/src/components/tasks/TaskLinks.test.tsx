import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TaskLinks, { WaitingWarning } from './TaskLinks';
import { TaskMeta } from './TaskList';
import type { Task, TaskLinkRow, TaskLinks as Data } from './types';

const get = jest.fn();
const post = jest.fn();
const del = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), delete: (...a: unknown[]) => del(...a) },
}));

const task = { id: 't1', code: 'T-1', bucket: 'open' } as Task;
const row = (code: string, over: Partial<TaskLinkRow['task']> = {}, canRemove = true): TaskLinkRow => ({
  linkId: `l-${code}`, canRemove, task: { id: `id-${code}`, code, title: `Job ${code}`, status: 'todo', statusLabel: 'To do', bucket: 'open', ...over },
});
const links = (over: Partial<Data> = {}): Data => ({ waitingOn: [], blocking: [], related: [], hidden: 0, hiddenWaiting: 0, canAdd: true, ...over });
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const serve = (data: Data, options: unknown[] = []) => get.mockImplementation((url: string) => Promise.resolve(url.includes('/options') ? { tasks: options } : data));

beforeEach(() => { get.mockReset(); post.mockReset(); del.mockReset(); });

describe('the links panel', () => {
  it('groups the links; a blank task invites one', async () => {
    serve(links({ waitingOn: [row('T-2')], blocking: [row('T-3')], related: [row('T-4')] }));
    const { unmount } = wrap(<TaskLinks task={task} base="/team/tasks" onOpen={() => {}} />);
    expect(await screen.findByText('Job T-2')).toBeInTheDocument();
    for (const t of ['Waiting on', 'Blocking', 'Related']) expect(screen.getByText(t)).toBeInTheDocument();
    unmount();
    serve(links());
    wrap(<TaskLinks task={{ ...task, id: 't9' }} base="/team/tasks" />);
    expect(await screen.findByText(/No links yet/)).toBeInTheDocument();
  });

  it('adds through search: the kind picked and the task chosen, and closes', async () => {
    serve(links(), [{ id: 'x', code: 'T-9', title: 'Pack', status: 'todo', statusLabel: 'To do', bucket: 'open' }]);
    post.mockResolvedValue(links());
    wrap(<TaskLinks task={task} base="/team/tasks" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add link' }));
    fireEvent.change(screen.getByLabelText('How they are linked'), { target: { value: 'blocking' } });
    fireEvent.change(screen.getByLabelText('Find a task to link'), { target: { value: 'pack' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/tasks/t1/links/options?q=pack'));
    fireEvent.click(await screen.findByRole('button', { name: /T-9/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/t1/links', { kind: 'blocking', taskId: 'x' }));
    await waitFor(() => expect(screen.queryByLabelText('Find a task to link')).toBeNull());
  });

  it('a refused link says why and keeps the picker open', async () => {
    serve(links(), [{ id: 'x', code: 'T-9', title: 'Pack', status: 'todo', statusLabel: 'To do', bucket: 'open' }]);
    post.mockRejectedValue({ status: 400, rawData: { message: 'That would leave these tasks waiting on each other' } });
    wrap(<TaskLinks task={task} base="/team/tasks" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add link' }));
    fireEvent.click(await screen.findByRole('button', { name: /T-9/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/waiting on each other/);
    expect(screen.getByLabelText('Find a task to link')).toBeInTheDocument();
  });

  it('nothing to pick says so', async () => {
    serve(links());
    wrap(<TaskLinks task={task} base="/team/tasks" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add link' }));
    expect(await screen.findByText(/No tasks to link/)).toBeInTheDocument();
  });

  it('removes one link; a person who cannot change it has no buttons', async () => {
    serve(links({ related: [row('T-2')] }));
    del.mockResolvedValue(links());
    const { unmount } = wrap(<TaskLinks task={task} base="/team/tasks" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove the link to T-2' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/staff/tasks/t1/links/l-T-2'));
    unmount();
    serve(links({ canAdd: false, related: [row('T-3', {}, false)] }));
    wrap(<TaskLinks task={{ ...task, id: 't7' }} base="/team/tasks" />);
    await screen.findByText('Job T-3');
    expect(screen.queryByRole('button', { name: 'Add link' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove the link/ })).toBeNull();
  });

  it('a task that cannot be opened is a count, and a failed load says so', async () => {
    serve(links({ hidden: 2 }));
    const { unmount } = wrap(<TaskLinks task={task} base="/team/tasks" />);
    expect(await screen.findByText(/2 linked tasks you can’t open/)).toBeInTheDocument();
    unmount();
    get.mockRejectedValue({ status: 500 });
    wrap(<TaskLinks task={{ ...task, id: 't8' }} base="/team/tasks" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load|wrong/i);
  });
});

describe('the waiting warning', () => {
  it('names what is unfinished, and is silent once all are done', async () => {
    serve(links({ waitingOn: [row('T-2'), row('T-3', { bucket: 'done', status: 'done' })] }));
    const { unmount } = wrap(<WaitingWarning task={task} />);
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent('Waiting on T-2 Job T-2');
    expect(note).not.toHaveTextContent('T-3');
    unmount();
    serve(links({ waitingOn: [row('T-3', { bucket: 'done', status: 'done' })] }));
    wrap(<WaitingWarning task={{ ...task, id: 't5' }} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/tasks/t5/links'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a hidden blocker is counted without a name; a finished task warns of nothing', async () => {
    serve(links({ hiddenWaiting: 1 }));
    const { unmount } = wrap(<WaitingWarning task={task} />);
    expect(await screen.findByRole('status')).toHaveTextContent('1 task you can’t open');
    unmount();
    wrap(<WaitingWarning task={{ ...task, id: 't6', bucket: 'done' }} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/tasks/t6/links'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('list rows', () => {
  const base = { checklist: { done: 0, total: 0 }, commentCount: 0, bucket: 'open' } as unknown as Task;
  it('show "Waiting" only for open tasks with unfinished blockers', () => {
    const { rerender } = render(<TaskMeta t={{ ...base, waitingOn: 2 }} />);
    expect(screen.getByTitle('Waiting on 2 unfinished tasks')).toBeInTheDocument();
    rerender(<TaskMeta t={{ ...base, waitingOn: 0 }} />);
    expect(screen.queryByText('Waiting')).toBeNull();
    rerender(<TaskMeta t={{ ...base, waitingOn: 2, bucket: 'done' } as Task} />);
    expect(screen.queryByText('Waiting')).toBeNull();
  });
});
