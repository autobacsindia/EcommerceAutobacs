/**
 * The task panel's comments and files. What must hold: an @mention sends the
 * person's id only while their "@Name" is still in the words; only your own
 * comment, and only while the server says it may change, offers edit and
 * delete; a reaction names the emoji and whether it goes on or off; a deleted
 * comment keeps its place with no words; files go as multipart, comment files
 * with the comment and task files on their own.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TaskDetail from './TaskDetail';
import type { Task, TaskComment } from './types';

const get = jest.fn();
const post = jest.fn();
const patch = jest.fn();
const put = jest.fn();
const del = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a),
    put: (...a: unknown[]) => put(...a), delete: (...a: unknown[]) => del(...a),
  },
}));
const submitMultipart = jest.fn();
jest.mock('@/lib/multipartResponse', () => ({
  submitMultipart: (...a: unknown[]) => submitMultipart(...a),
  parseApiResponse: (res: { body: unknown }) => Promise.resolve(res.body),
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/team/tasks',
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const can = { edit: true, status: true, reassign: true, archive: true, restore: false, comment: true, checklist: true, files: true };
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', number: 7, code: 'T-7', title: 'Call Bosch', description: '', status: 'todo', statusLabel: 'To do',
  priority: 'normal', dueOn: null, startOn: null, tags: [], overdue: false, assignee: { id: 'u2', name: 'Arun' }, team: 'procurement',
  teamLabel: 'Procurement', createdBy: { id: 'u1', name: 'Priya' }, order: null, group: null, checklist: { done: 0, total: 0 },
  checklistItems: [], bucket: 'open', completedAt: null, archivedAt: null, commentCount: 0, lastCommentAt: null,
  createdAt: '2026-10-27T04:00:00Z', updatedAt: '2026-10-27T04:00:00Z', rev: 3, can, history: [], files: [], ...over,
} as Task);
const comment = (over: Partial<TaskComment> = {}): TaskComment => ({
  id: 'c1', by: { id: 'u2', name: 'Arun' }, text: 'Bosch says Friday', createdAt: new Date().toISOString(),
  editedAt: null, deleted: false, mine: false, editableUntil: null, mentions: [], files: [], reactions: [], ...over,
});
const later = () => new Date(Date.now() + 10 * 60_000).toISOString();

function open({ one = task(), comments = [] as TaskComment[] } = {}) {
  get.mockImplementation((url: string) => {
    if (url === '/staff/tasks/assignees') return Promise.resolve({ people: [] });
    if (url.endsWith('/mentionable')) return Promise.resolve({ people: [{ id: 'u1', name: 'Priya Nair' }, { id: 'u3', name: 'Bala' }] });
    if (url.includes('/comments')) return Promise.resolve({ comments, nextBefore: null });
    return Promise.resolve({ task: one });
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  [get, post, patch, put, del, submitMultipart].forEach((f) => f.mockReset());
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('@mentions', () => {
  it('typing @ offers the people on the task; picking one writes @Name and sends their id', async () => {
    post.mockResolvedValue({ comment: comment({ id: 'c9' }) });
    open();
    const box = await screen.findByLabelText('Comment');
    fireEvent.change(box, { target: { value: 'Please check @pri', selectionStart: 17 } });
    const list = await screen.findByRole('listbox', { name: 'People to mention' });
    expect(within(list).queryByText('Bala')).not.toBeInTheDocument();
    fireEvent.mouseDown(within(list).getByRole('button', { name: /Priya Nair/ }));
    expect(box).toHaveValue('Please check @Priya Nair ');
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/t1/comments', expect.objectContaining({
      text: 'Please check @Priya Nair', mentions: ['u1'], clientId: expect.any(String),
    })));
  });

  it('a mention whose name was deleted from the words is not sent', async () => {
    post.mockResolvedValue({ comment: comment({ id: 'c9' }) });
    open();
    const box = await screen.findByLabelText('Comment');
    fireEvent.change(box, { target: { value: '@ba', selectionStart: 3 } });
    fireEvent.mouseDown(await screen.findByRole('button', { name: /Bala/ }));
    fireEvent.change(box, { target: { value: 'never mind', selectionStart: 10 } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/tasks/t1/comments', expect.objectContaining({ text: 'never mind', mentions: [] })));
  });

  it('a mentioned name stands out in the comment', async () => {
    open({ comments: [comment({ text: 'Thanks @Priya Nair', mentions: [{ id: 'u1', name: 'Priya Nair' }] })] });
    expect(await screen.findByText('@Priya Nair')).toHaveClass('font-medium');
  });
});

describe('edit and delete', () => {
  it('only your own comment, while it may still change, offers edit and delete', async () => {
    open({ comments: [
      comment({ id: 'a', text: 'mine, fresh', mine: true, editableUntil: later() }),
      comment({ id: 'b', text: 'mine, too old', mine: true, editableUntil: null }),
      comment({ id: 'c', text: 'someone else', mine: false }),
    ] });
    await screen.findByText('mine, fresh');
    expect(screen.getAllByRole('button', { name: 'Edit comment' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Delete comment' })).toHaveLength(1);
  });

  it('an edit saves the new words and shows "edited"', async () => {
    patch.mockResolvedValue({ comment: comment({ text: 'Bosch says Monday', mine: true, editableUntil: later(), editedAt: new Date().toISOString() }) });
    open({ comments: [comment({ mine: true, editableUntil: later() })] });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit comment' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit comment' }), { target: { value: 'Bosch says Monday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1/comments/c1', { text: 'Bosch says Monday' }));
    expect(await screen.findByText('Bosch says Monday')).toBeInTheDocument();
    expect(screen.getByText(/edited/)).toBeInTheDocument();
  });

  it('a delete asks first, then the comment keeps its place with no words', async () => {
    del.mockResolvedValue({ comment: comment({ text: '', deleted: true, mine: true }) });
    open({ comments: [comment({ mine: true, editableUntil: later() })] });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete comment' }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(del).toHaveBeenCalledWith('/staff/tasks/t1/comments/c1'));
    expect(await screen.findByText('This comment was deleted.')).toBeInTheDocument();
    expect(screen.queryByText('Bosch says Friday')).not.toBeInTheDocument();
  });
});

describe('reactions', () => {
  it('tapping a reaction takes mine off; another person’s puts mine on', async () => {
    const reactions = [
      { emoji: '👍', count: 2, mine: true, names: ['You', 'Priya'] },
      { emoji: '✅', count: 1, mine: false, names: ['Priya'] },
    ];
    put.mockResolvedValue({ comment: comment({ reactions }) });
    open({ comments: [comment({ reactions })] });
    fireEvent.click(await screen.findByRole('button', { name: /👍 2/ }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/staff/tasks/t1/comments/c1/reactions', { emoji: '👍', on: false }));
    fireEvent.click(screen.getByRole('button', { name: /✅ 1/ }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/staff/tasks/t1/comments/c1/reactions', { emoji: '✅', on: true }));
  });

  it('a deleted comment has no reactions to tap', async () => {
    open({ comments: [comment({ deleted: true, text: '', reactions: [{ emoji: '👍', count: 1, mine: false, names: ['Priya'] }] })] });
    await screen.findByText('This comment was deleted.');
    expect(screen.queryByRole('button', { name: /👍/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a reaction' })).not.toBeInTheDocument();
  });
});

describe('files', () => {
  const pdf = () => new File(['%PDF-1.4'], 'bill.pdf', { type: 'application/pdf' });

  it('a comment with a file goes as multipart, with its words, clientId and mentions', async () => {
    submitMultipart.mockResolvedValue({ ok: true, body: { comment: comment({ id: 'c9' }) } });
    open();
    fireEvent.change(await screen.findByLabelText('Attach files to the comment'), { target: { files: [pdf()] } });
    expect(screen.getByRole('list', { name: 'Files to send' })).toHaveTextContent('bill.pdf');
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'The bill', selectionStart: 8 } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(submitMultipart).toHaveBeenCalled());
    const [url, method, form] = submitMultipart.mock.calls[0] as [string, string, FormData];
    expect([url, method]).toEqual(['/api/v1/staff/tasks/t1/comments', 'POST']);
    expect(form.get('text')).toBe('The bill');
    expect(form.get('clientId')).toEqual(expect.any(String));
    expect((form.getAll('files') as File[]).map((f) => f.name)).toEqual(['bill.pdf']);
    expect(post).not.toHaveBeenCalled();
  });

  it('a file alone (no words) can be posted', async () => {
    submitMultipart.mockResolvedValue({ ok: true, body: { comment: comment({ id: 'c9' }) } });
    open();
    fireEvent.change(await screen.findByLabelText('Attach files to the comment'), { target: { files: [pdf()] } });
    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled();
  });

  it('a file over 10 MB is left out and says why', async () => {
    open();
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'huge.pdf', { type: 'application/pdf' });
    fireEvent.change(await screen.findByLabelText('Attach files to the comment'), { target: { files: [big] } });
    expect(screen.getByRole('alert')).toHaveTextContent('"huge.pdf" is over 10 MB');
    expect(screen.queryByRole('list', { name: 'Files to send' })).not.toBeInTheDocument();
  });

  it('task files: listed with a link, added as multipart, removed after asking (only where allowed)', async () => {
    submitMultipart.mockResolvedValue({ ok: true, body: { task: task() } });
    del.mockResolvedValue({ task: task() });
    open({ one: task({ files: [
      { url: '/api/v1/staff/tasks/t1/files/1-ab-bill.pdf', name: 'bill.pdf', mime: 'application/pdf', size: 2048, kind: 'file', canRemove: true },
      { url: '/api/v1/staff/tasks/t1/files/2-cd-photo.jpg', name: 'photo.jpg', mime: 'image/jpeg', size: 4096, kind: 'image', canRemove: false },
    ] }) });
    expect(await screen.findByRole('link', { name: 'bill.pdf' })).toHaveAttribute('href', '/api/v1/staff/tasks/t1/files/1-ab-bill.pdf');
    expect(screen.queryByRole('button', { name: 'Remove photo.jpg' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove bill.pdf' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/staff/tasks/t1/files/1-ab-bill.pdf'));

    fireEvent.change(screen.getByLabelText('Add files to the task'), { target: { files: [pdf()] } });
    await waitFor(() => expect(submitMultipart).toHaveBeenCalledWith('/api/v1/staff/tasks/t1/files', 'POST', expect.any(FormData)));
  });

  it('someone who may not add files sees no add button, and no Files section when there are none', async () => {
    open({ one: task({ can: { ...can, files: false } }) });
    await screen.findByRole('heading', { name: 'Call Bosch' });
    expect(screen.queryByRole('button', { name: /Add files/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Files/ })).not.toBeInTheDocument();
  });
});
