/**
 * Links with logos, the ⋯ menu (duplicate, delete, restore), Trash, and the
 * fixes that came with them: "My tasks" after "Today & overdue", and a
 * long list of people that must not spill into the next field.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TasksWorkspace from './TasksWorkspace';
import TaskDetail from './TaskDetail';
import { Linkified, linkKind, safeUrl } from './links';
import { type Task } from './types';
import { addressBar } from '@/test-utils/addressBarMock';

const get = jest.fn();
const post = jest.fn();
const patch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), delete: jest.fn() },
}));
const toastSuccess = jest.fn();
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: (...a: unknown[]) => toastSuccess(...a), error: jest.fn(), dismiss: jest.fn() } }));
jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

const can = { edit: true, status: true, reassign: true, archive: true, restore: false, comment: true, checklist: true, files: true, follow: true, followers: true };
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', number: 7, code: 'T-7', title: 'Call Bosch', summary: '', description: '',
  status: 'todo', statusLabel: 'To do', priority: 'high', priorityLabel: 'High',
  dueOn: '2026-11-10', startOn: null, tags: ['supplier'], overdue: false, dueToday: false,
  assignees: [], followers: [], following: false, assignee: { id: 'u2', name: 'Arun' }, team: 'procurement', teamLabel: 'Procurement',
  createdBy: { id: 'u1', name: 'Priya' }, order: null, group: null, checklist: { done: 0, total: 0 }, bucket: 'open',
  completedAt: null, archivedAt: null, commentCount: 0, lastCommentAt: null,
  createdAt: '2026-10-27T04:00:00Z', updatedAt: '2026-10-27T04:00:00Z', rev: 3, can,
  history: [], ...over,
});
const people = { people: [{ id: 'u1', name: 'Priya', team: 'procurement', teamLabel: 'Procurement', isHead: true, me: true }] };

function serve({ list = [task()], archived = [] as Task[], one = task() } = {}) {
  get.mockImplementation((url: string) => {
    if (url === '/staff/tasks/summary') return Promise.resolve({ late: 1, today: 0 });
    if (url === '/staff/tasks/assignees') return Promise.resolve(people);
    if (url.startsWith('/staff/tasks?') && url.includes('state=archived')) return Promise.resolve({ tasks: archived, nextCursor: null });
    if (url.startsWith('/staff/tasks?') && url.includes('state=done')) return Promise.resolve({ tasks: [], nextCursor: null });
    if (url.startsWith('/staff/tasks?')) return Promise.resolve({ tasks: list, nextCursor: null });
    if (url.includes('/comments')) return Promise.resolve({ comments: [], nextBefore: null });
    if (url.startsWith('/staff/tasks/')) return Promise.resolve({ task: one });
    return Promise.resolve({ orders: [] });
  });
}
const listCalls = () => get.mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith('/staff/tasks?'));
const workspace = () => wrap(<TasksWorkspace base="/team/tasks" canSeeTeam={false} />);

beforeEach(() => {
  localStorage.clear();
  [get, post, patch, toastSuccess].forEach((f) => f.mockReset());
  addressBar.reset('/team/tasks');
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('links in task text', () => {
  const chips = (text: string) => {
    render(<p><Linkified text={text} /></p>);
    return screen.queryAllByRole('link');
  };

  it('a Drive link becomes a chip with the Drive name, opening safely in a new tab', () => {
    const [a] = chips('Photos: https://drive.google.com/file/d/1RqSf/view?usp=drive_link.');
    expect(a).toHaveAttribute('href', 'https://drive.google.com/file/d/1RqSf/view?usp=drive_link');
    expect(a).toHaveTextContent('Google Drive');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(a.getAttribute('rel')).toContain('noreferrer');
    // The full stop after the link stays text.
    expect(screen.getByText(/Photos:/).textContent?.endsWith('.')).toBe(true);
  });

  it('knows Docs, Sheets, YouTube and WhatsApp; anything else shows the site name', () => {
    const name = (u: string) => linkKind(new URL(u)).name;
    expect(name('https://docs.google.com/spreadsheets/d/x/edit')).toBe('Google Sheets');
    expect(name('https://docs.google.com/document/d/x/edit')).toBe('Google Docs');
    expect(name('https://youtu.be/abc')).toBe('YouTube');
    expect(name('https://wa.me/919876543210')).toBe('WhatsApp');
    expect(name('https://www.example.in/a')).toBe('example.in');
  });

  it('only web links are made clickable; "www." gets https; a closing bracket outside the link stays text', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('www.example.in/x')?.href).toBe('https://www.example.in/x');
    const links = chips('(see https://example.in/a) and www.wa.me/91 or javascript:alert(1)');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['https://example.in/a', 'https://www.wa.me/91']);
  });

  it('a link in the description opens; the pencil still edits it', async () => {
    serve({ one: task({ description: 'Brief: https://docs.google.com/document/d/1xyz/edit' }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    const link = await screen.findByRole('link', { name: /Google Docs/ });
    expect(link).toHaveAttribute('href', 'https://docs.google.com/document/d/1xyz/edit');
    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    expect(screen.getByLabelText('description')).toHaveValue('Brief: https://docs.google.com/document/d/1xyz/edit');
  });
});

describe('fixes', () => {
  it('"My tasks" after "Today & overdue" drops the Late filter (it used to look dead)', async () => {
    serve();
    workspace();
    const nav = await screen.findByRole('navigation', { name: 'Task lists' });
    fireEvent.click(await within(nav).findByRole('button', { name: /Today & overdue/ }));
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=mine&state=open&due=late'));
    get.mockClear();
    fireEvent.click(within(nav).getByRole('button', { name: 'My tasks' }));
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'My tasks' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: 'Any date' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('five people on a task show as two names and "+3", every name in the tooltip', async () => {
    const five = ['Arun', 'Bala', 'Chitra', 'Dev', 'Esha'].map((name, i) => ({ id: `p${i}`, name }));
    serve({ one: task({ assignees: five, assignee: five[0], can: { ...can, reassign: false } }) });
    wrap(<TaskDetail id="t1" base="/team/tasks" onClose={() => {}} />);
    const names = await screen.findByText('Arun, Bala +3');
    expect(names).toHaveAttribute('title', 'Arun, Bala, Chitra, Dev, Esha');
  });
});

describe('the ⋯ menu', () => {
  const openMenu = async (code = 'T-7') => {
    fireEvent.click(await screen.findByRole('button', { name: `More actions for ${code}` }));
    return screen.findByRole('menu', { name: `Actions for ${code}` });
  };

  it('Delete moves the task to Trash at once (no sub-tasks to ask about) and offers Undo', async () => {
    serve();
    patch.mockResolvedValue({ task: task({ bucket: 'archived', rev: 4 }) });
    workspace();
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, archived: true }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ id: 'bin-t1' }));
  });

  it('Duplicate reads the whole task and makes one shared copy with "(copy)" on the title', async () => {
    const full = task({
      description: 'Ask about the lift kit', assignees: [{ id: 'u2', name: 'Arun' }, { id: 'u3', name: 'Bala' }],
      order: { id: 'o1', code: '#51234' }, checklistItems: [{ id: 'c1', text: 'Pack', done: true, doneAt: null, doneBy: '' }],
    });
    serve({ one: full });
    post.mockResolvedValue({ task: task({ id: 't9', code: 'T-9' }) });
    workspace();
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/staff/tasks', expect.objectContaining({
      title: 'Call Bosch (copy)', description: 'Ask about the lift kit', priority: 'high', dueOn: '2026-11-10', tags: ['supplier'],
      assigneeIds: ['u2', 'u3'], shared: true, orderId: 'o1', checklist: ['Pack'], clientId: expect.any(String),
    }));
    expect(toastSuccess).toHaveBeenCalledWith('Copy made: T-9', expect.anything());
  });

  it('no Delete for someone who may not delete the task', async () => {
    serve({ list: [task({ can: { ...can, archive: false } })] });
    workspace();
    const menu = await openMenu();
    expect(within(menu).queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /Copy link/ })).toBeInTheDocument();
  });
});

describe('Trash', () => {
  it('lists deleted tasks (the ones I assigned) and restores one against its revision', async () => {
    const gone = task({ bucket: 'archived', archivedAt: '2026-11-04T05:00:00Z', can: { ...can, archive: false, restore: true } });
    serve({ archived: [gone] });
    patch.mockResolvedValue({ task: task({ rev: 5 }) });
    workspace();
    const nav = await screen.findByRole('navigation', { name: 'Task lists' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Trash' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Trash' })).toBeInTheDocument();
    await waitFor(() => expect(listCalls()).toContain('/staff/tasks?view=created&state=archived'));
    fireEvent.click(await screen.findByRole('button', { name: /^Restore$/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/tasks/t1', { rev: 3, archived: false }));
    // No filters, board or open-task count in Trash.
    expect(screen.queryByRole('tablist', { name: 'Show as' })).toBeNull();
    expect(screen.queryByLabelText('Priority filter')).toBeNull();
  });

  it('an empty Trash says so', async () => {
    serve();
    addressBar.reset('/team/tasks', 'view=trash');
    workspace();
    expect(await screen.findByText('Trash is empty')).toBeInTheDocument();
  });
});
