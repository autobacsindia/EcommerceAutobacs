/**
 * A project's Updates (words, photos, videos) and the file picking shared with
 * task comments. The server checks every file and every limit
 * (Back-end tests/staffProjectUpdates.test.js); these pin what the screen
 * shows, refuses early, and sends.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProjectUpdates from './ProjectUpdates';
import { MediaFiles, pickFiles } from './media';
import type { Project, ProjectUpdate, TaskFile } from './types';

const get = jest.fn();
const post = jest.fn();
const del = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), delete: (...a: unknown[]) => del(...a), put: jest.fn(), patch: jest.fn() },
}));
const submitMultipart = jest.fn();
jest.mock('@/lib/multipartResponse', () => ({
  submitMultipart: (...a: unknown[]) => submitMultipart(...a),
  parseApiResponse: async (res: { json: () => unknown }) => res.json(),
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn(), dismiss: jest.fn() } }));
// The rich-text box is a plain textarea here: what matters is what is sent.
jest.mock('@/components/ui/RichTextBox', () => ({
  __esModule: true,
  default: ({ value, onChange, ariaLabel, maxLength }: { value: string; onChange: (v: string) => void; ariaLabel: string; maxLength?: number }) => (
    <textarea aria-label={ariaLabel} value={value} data-max={maxLength} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const MB = 1024 * 1024;
const fileOf = (name: string, type: string, size: number) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const PROJECT = { id: 'p1', name: 'Hilux', archivedAt: null } as unknown as Project;
const URL = (n: string) => `/api/v1/staff/tasks/projects/p1/files/1700000000000-abcdef12-${n}`;
const update = (over: Partial<ProjectUpdate> = {}): ProjectUpdate => ({
  id: 'u1', by: 'Ravi', byId: 'r1', mine: true, at: '2026-11-20T05:00:00Z', deleted: false,
  text: '<p>Bumper fitted</p>', files: [], canDelete: true, ...over,
});

beforeEach(() => {
  get.mockReset(); post.mockReset(); del.mockReset(); submitMultipart.mockReset();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('pickFiles', () => {
  it('takes photos and videos; refuses a video over 40 MB and other files over 10 MB, saying why', () => {
    const errors: string[] = [];
    const picked = pickFiles([
      fileOf('a.jpg', 'image/jpeg', 2 * MB),
      fileOf('clip.mp4', 'video/mp4', 30 * MB),
      fileOf('long.mov', 'video/quicktime', 41 * MB),
    ], 10, (m) => errors.push(m));
    expect(picked.map((f) => f.name)).toEqual(['a.jpg', 'clip.mp4']);
    expect(errors[0]).toMatch(/"long\.mov" is 41 MB — videos can be up to 40 MB/);

    const errs2: string[] = [];
    expect(pickFiles([fileOf('scan.pdf', 'application/pdf', 11 * MB)], 10, (m) => errs2.push(m))).toEqual([]);
    expect(errs2[0]).toMatch(/over 10 MB/);
  });

  it('refuses a type the server would refuse, and keeps one post under 40 MB together', () => {
    const errors: string[] = [];
    expect(pickFiles([fileOf('x.exe', 'application/x-msdownload', 10)], 10, (m) => errors.push(m))).toEqual([]);
    expect(errors[0]).toMatch(/can't be attached — photos, videos/);
    const errs2: string[] = [];
    const picked = pickFiles([fileOf('b.mp4', 'video/mp4', 20 * MB)], 10, (m) => errs2.push(m), 30 * MB);
    expect(picked).toEqual([]);
    expect(errs2[0]).toMatch(/up to 40 MB of files/);
  });
});

describe('MediaFiles', () => {
  it('shows a photo as a picture, a video as a player with a download link, other files as chips', () => {
    const files: TaskFile[] = [
      { url: URL('a.png'), name: 'a.png', mime: 'image/png', size: 100, kind: 'image' },
      { url: URL('clip.mp4'), name: 'clip.mp4', mime: 'video/mp4', size: 3 * MB, kind: 'video' },
      { url: URL('bill.pdf'), name: 'bill.pdf', mime: 'application/pdf', size: 100, kind: 'file' },
    ];
    const { container } = render(<MediaFiles files={files} />);
    expect(screen.getByRole('img', { name: 'a.png' })).toHaveAttribute('src', URL('a.png'));
    const video = container.querySelector('video')!;
    expect(video).toHaveAttribute('src', URL('clip.mp4'));
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('playsinline');
    expect(screen.getByRole('link', { name: /Download$/ })).toHaveAttribute('href', `${URL('clip.mp4')}?download=1`);
    expect(screen.getByRole('link', { name: 'bill.pdf' })).toBeInTheDocument();
  });

  it('a video that cannot play here says so and keeps the download link', () => {
    const { container } = render(<MediaFiles files={[{ url: URL('c.mov'), name: 'c.mov', mime: 'video/quicktime', size: 1, kind: 'video' }]} />);
    fireEvent.error(container.querySelector('video')!);
    expect(screen.getByText(/can’t play in this browser/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Download/ })).toBeInTheDocument();
  });
});

describe('loading only what is on screen (optimization pass)', () => {
  // Each video's first frame costs an access check on our API plus a storage read.
  const videos = (count: number): TaskFile[] => Array.from({ length: count }, (_, i) => (
    { url: URL(`v${i}.mp4`), name: `v${i}.mp4`, mime: 'video/mp4', size: 1, kind: 'video' as const }
  ));
  const original = global.IntersectionObserver;
  afterEach(() => { global.IntersectionObserver = original; });

  it('20 videos below the screen fetch nothing; one scrolled near fetches only its own preview', () => {
    const observed: { el: Element; cb: IntersectionObserverCallback }[] = [];
    global.IntersectionObserver = class {
      cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) { this.cb = cb; }
      observe(el: Element) { observed.push({ el, cb: this.cb }); }
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
    } as unknown as typeof IntersectionObserver;
    const { container } = render(<MediaFiles files={videos(20)} />);
    const players = Array.from(container.querySelectorAll('video'));
    // Before this pass every one was preload="metadata": 20 fetches on open.
    expect(players.filter((v) => v.getAttribute('preload') === 'metadata')).toHaveLength(0);
    const first = observed.find((o) => o.el === players[0])!;
    act(() => first.cb([{ isIntersecting: true, target: players[0] } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(players.map((v) => v.getAttribute('preload')).filter((p) => p === 'metadata')).toHaveLength(1);
    expect(players[0]).toHaveAttribute('preload', 'metadata');
  });

  it('photos load lazily', () => {
    render(<MediaFiles files={[{ url: URL('a.png'), name: 'a.png', mime: 'image/png', size: 1, kind: 'image' }]} />);
    expect(screen.getByRole('img', { name: 'a.png' })).toHaveAttribute('loading', 'lazy');
  });
});

describe('ProjectUpdates', () => {
  it('lists updates with their photos and videos; a deleted one shows only that it was deleted', async () => {
    get.mockResolvedValue({
      updates: [
        update({ files: [{ url: URL('v.mp4'), name: 'v.mp4', mime: 'video/mp4', size: 10, kind: 'video' }] }),
        update({ id: 'u0', deleted: true, text: '', canDelete: false }),
      ],
      nextBefore: null,
    });
    const { container } = wrap(<ProjectUpdates project={PROJECT} />);
    expect(await screen.findByText('Bumper fitted')).toBeInTheDocument();
    expect(container.querySelector('video')).toHaveAttribute('src', URL('v.mp4'));
    expect(screen.getByText('This update was deleted.')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/staff/tasks/projects/p1/updates');
  });

  it('posts words alone as JSON with a client id; the box has no small limit', async () => {
    get.mockResolvedValue({ updates: [], nextBefore: null });
    post.mockResolvedValue({ update: update() });
    wrap(<ProjectUpdates project={PROJECT} />);
    const box = await screen.findByLabelText('Project update');
    expect(box).toHaveAttribute('data-max', '20000');
    const long = 'w'.repeat(15000);
    fireEvent.change(box, { target: { value: long } });
    fireEvent.click(screen.getByRole('button', { name: /Post/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/staff/tasks/projects/p1/updates');
    expect(body.text).toBe(long);
    expect(body.clientId).toEqual(expect.any(String));
  });

  it('posts photos and videos as a form; a server refusal is shown', async () => {
    get.mockResolvedValue({ updates: [], nextBefore: null });
    submitMultipart.mockResolvedValue({ ok: false, json: async () => ({ message: '"clip.mp4" does not look like a real MP4 file, so it was not shared.' }) });
    wrap(<ProjectUpdates project={PROJECT} />);
    const input = await screen.findByLabelText('Attach photos, videos or files to the update');
    expect(input.getAttribute('accept')).toMatch(/video\/mp4/);
    expect(input.getAttribute('accept')).toMatch(/video\/quicktime/);
    fireEvent.change(input, { target: { files: [fileOf('clip.mp4', 'video/mp4', 5 * MB)] } });
    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Post/ }));
    await waitFor(() => expect(submitMultipart).toHaveBeenCalled());
    const [url, method, form] = submitMultipart.mock.calls[0];
    expect(url).toBe('/api/v1/staff/tasks/projects/p1/updates');
    expect(method).toBe('POST');
    expect((form as FormData).getAll('files')).toHaveLength(1);
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not look like a real MP4/);
  });

  it('delete asks first, then calls the server; an archived project has no post box', async () => {
    get.mockResolvedValue({ updates: [update()], nextBefore: null });
    del.mockResolvedValue({});
    const { unmount } = wrap(<ProjectUpdates project={PROJECT} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete update' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/staff/tasks/projects/p1/updates/u1'));
    unmount();
    wrap(<ProjectUpdates project={{ ...PROJECT, archivedAt: '2026-11-01T00:00:00Z' } as Project} />);
    await screen.findByText('Bumper fitted');
    expect(screen.queryByLabelText('Project update')).not.toBeInTheDocument();
  });
});
