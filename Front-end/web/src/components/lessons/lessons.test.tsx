/**
 * The Lesson Library screens.
 *
 * What must hold:
 *   - loading, empty and error (with retry) each say so; "Show more" sends the cursor
 *   - "Post a lesson" only for people who can post
 *   - a member sees no edit or file tools; a named owner edits, but not who sees it
 *   - an edit names the rev it was made against, and a conflict is shown, not lost
 *   - uploads go link → storage → attach, and a file off the list never asks for a link
 *   - video gets a player only when pressed; a stale lesson says so
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LessonLibrary from './LessonLibrary';
import LessonDetail from './LessonDetail';
import { lessonFileProblem, lessonFileType, type Lesson } from './types';

const get = jest.fn();
const post = jest.fn();
const patch = jest.fn();
const put = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a), put: (...a: unknown[]) => put(...a), delete: jest.fn(),
  },
}));
const toastError = jest.fn();
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: (...a: unknown[]) => toastError(...a) } }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
jest.mock('@/components/ui/RichTextBox', () => ({
  __esModule: true,
  default: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) => <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />,
}));

const lesson = (over: Partial<Lesson> = {}): Lesson => ({
  id: 'L1', title: 'Raise a PO', topic: '', audience: 'procurement', audienceLabel: 'Procurement',
  owner: { id: 'U1', name: 'Asha' }, createdByName: 'Asha', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  lastCheckedAt: '2026-11-01T00:00:00Z', lastCheckedByName: 'Asha', stale: false, rev: 3, fileKinds: [], fileCount: 0, doneAt: null,
  can: { edit: false, manage: false }, body: '<p>Steps</p>', files: [], ...over,
});
const meta = (postTo = [{ key: 'procurement', label: 'Procurement' }]) => ({
  sections: [{ key: 'company', label: 'Whole company' }, { key: 'procurement', label: 'Procurement' }], postTo, people: [], staleDays: 90,
});
const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const routeGet = (routes: Record<string, unknown>) => get.mockImplementation((url: string) => {
  const hit = Object.keys(routes).find((k) => url.startsWith(k));
  if (!hit) return Promise.reject(new Error(url));
  const v = routes[hit];
  return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
});

beforeEach(() => { jest.clearAllMocks(); get.mockReset(); post.mockReset(); patch.mockReset(); put.mockReset(); });

describe('library', () => {
  test('empty', async () => {
    routeGet({ '/staff/lessons/meta': meta(), '/staff/lessons?': { lessons: [], nextCursor: null } });
    wrap(<LessonLibrary base="/team/lessons" />);
    expect(await screen.findByText('No lessons yet.')).toBeInTheDocument();
  });

  test('an error offers a retry', async () => {
    routeGet({ '/staff/lessons/meta': meta(), '/staff/lessons?': new Error('x') });
    wrap(<LessonLibrary base="/team/lessons" />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  test('"Post a lesson" is only for people who can post', async () => {
    routeGet({ '/staff/lessons/meta': meta([]), '/staff/lessons?': { lessons: [lesson()], nextCursor: null } });
    wrap(<LessonLibrary base="/team/lessons" />);
    await screen.findByText('Raise a PO');
    expect(screen.queryByText('Post a lesson')).not.toBeInTheDocument();
  });

  test('a head can post; "Show more" sends the cursor and flags stale lessons', async () => {
    routeGet({ '/staff/lessons/meta': meta(), '/staff/lessons?': { lessons: [lesson({ stale: true })], nextCursor: 'abc' } });
    wrap(<LessonLibrary base="/team/lessons" />);
    expect(await screen.findByText('Needs checking')).toBeInTheDocument();
    expect(await screen.findByText('Post a lesson')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Show more'));
    await waitFor(() => expect(get.mock.calls.some(([u]) => String(u).includes('cursor=abc'))).toBe(true));
  });
});

describe('lesson page', () => {
  const show = (l: Lesson) => {
    routeGet({
      '/staff/lessons/meta': meta(),
      '/staff/lessons/L1/progress': { people: [{ id: 'U2', name: 'Ravi', teamLabel: 'Procurement', doneAt: null }] },
      '/staff/lessons/L1/files/': { url: 'https://r2.test/v.mp4' },
      '/staff/lessons/L1': { lesson: l },
    });
    wrap(<LessonDetail id="L1" base="/team/lessons" />);
  };

  test('a member reads and can finish, with no tools to change it', async () => {
    show(lesson());
    await screen.findByText('Raise a PO');
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Add files')).not.toBeInTheDocument();
    expect(screen.queryByText(/Who has finished/)).not.toBeInTheDocument();
    put.mockResolvedValue({ lesson: lesson({ doneAt: '2026-11-02T00:00:00Z' }) });
    fireEvent.click(screen.getByText("I've finished this lesson"));
    expect(await screen.findByText(/You finished this on/)).toBeInTheDocument();
    expect(put).toHaveBeenCalledWith('/staff/lessons/L1/done', { done: true });
  });

  test('a lesson someone cannot see just says so', async () => {
    routeGet({ '/staff/lessons/L1': new Error('404') });
    wrap(<LessonDetail id="L1" base="/team/lessons" />);
    expect(await screen.findByText(/isn't available/)).toBeInTheDocument();
  });

  test('a named owner edits the words, naming the rev, and not who sees it', async () => {
    show(lesson({ can: { edit: true, manage: false } }));
    fireEvent.click(await screen.findByText('Edit'));
    expect(screen.queryByLabelText('Who can see it')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New title' } });
    patch.mockResolvedValue({ lesson: lesson({ title: 'New title', can: { edit: true, manage: false } }) });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const body = patch.mock.calls[0][1];
    expect(body).toMatchObject({ rev: 3, title: 'New title' });
    expect(body.audience).toBeUndefined();
    expect(await screen.findByText('New title')).toBeInTheDocument();
  });

  test('someone else\'s newer edit is shown, and the form stays open', async () => {
    show(lesson({ can: { edit: true, manage: true } }));
    fireEvent.click(await screen.findByText('Edit'));
    patch.mockRejectedValue({ rawData: { message: 'Someone else changed this lesson. Reload and try again.' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed');
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
  });

  test('a video gets a player only when pressed', async () => {
    show(lesson({ files: [{ name: 'a.mp4', kind: 'video', size: 2048, mime: 'video/mp4', fileName: 'file-a.mp4', byName: '', at: null }] }));
    fireEvent.click(await screen.findByText('Play'));
    await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toBe('https://r2.test/v.mp4'));
  });

  test('a file off the list never asks for an upload link', async () => {
    show(lesson({ can: { edit: true, manage: true } }));
    await screen.findByText('Add files');
    const bad = new File(['x'], 'virus.exe');
    fireEvent.change(screen.getByTestId('lesson-file-input'), { target: { files: [bad] } });
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(post).not.toHaveBeenCalled();
  });

  test('editors see who has finished', async () => {
    show(lesson({ can: { edit: true, manage: false } }));
    expect(await screen.findByText('Who has finished (0 of 1)')).toBeInTheDocument();
  });
});

describe('file rules', () => {
  test('type comes from the name, as Windows labels PowerPoint inconsistently', () => {
    expect(lessonFileType('Week 1.PPTX')).toContain('presentation');
    expect(lessonFileType('x.exe')).toBe('');
  });
  test('size limits', () => {
    const sized = (name: string, size: number) => Object.defineProperty(new File(['x'], name), 'size', { value: size });
    expect(lessonFileProblem(sized('a.pdf', 101 * 1024 * 1024))).toMatch(/100 MB/);
    expect(lessonFileProblem(sized('a.mp4', 3 * 1024 * 1024 * 1024))).toMatch(/2 GB/);
    expect(lessonFileProblem(sized('a.mp4', 1024))).toBeNull();
  });
});
