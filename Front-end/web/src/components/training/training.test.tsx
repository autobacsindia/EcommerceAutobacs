/**
 * The training screens.
 *   - the test only appears once the server says it can start
 *   - the paper sends what was picked, and a failed hand-in keeps the answers
 *   - a blank answer warns first; saying no sends nothing
 *   - marking needs every answer marked; sign-off confirms first
 *   - loading/empty/error each say so; the Team tab is for managers only
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TrainingDetail from './TrainingDetail';
import PathEditor from './PathEditor';
import TrainingHome from './TrainingHome';
import type { Assignment } from './types';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: jest.fn(), delete: jest.fn() } }));
const toastError = jest.fn();
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: (...a: unknown[]) => toastError(...a) } }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useSearchParams: () => new URLSearchParams() }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));

const can = { startTest: false, mark: false, allowRetry: false, signOff: false, cancel: false };
const assignment = (over: Partial<Assignment> = {}): Assignment => ({
  id: 'A1', pathTitle: 'Procurement executive', team: 'procurement', teamLabel: 'Procurement', user: { id: 'U1', name: 'Priya' }, buddy: { id: 'U2', name: 'Arun' },
  status: 'learning', lessonsDone: 1, lessonsTotal: 2, signedOffByName: '', signedOffAt: null, createdAt: '2026-11-01T00:00:00Z',
  items: [{ stage: 'day1', lessonId: 'L1', title: 'Raise a PO', available: true, done: true }, { stage: 'week1', lessonId: 'L2', title: 'Calls', available: false, done: false }],
  passMark: 80, attemptsUsed: 0, attemptsAllowed: 3, attempts: [], openAttempt: null, can, ...over,
});
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const show = (a: Assignment) => { get.mockResolvedValue({ assignment: a }); wrap(<TrainingDetail id="A1" base="/team/training" />); };
const paper = { id: 'T1', number: 1, questions: [{ id: 'Q1', type: 'choice' as const, text: 'Who approves?', options: ['Head', 'Me'] }] };

beforeEach(() => { jest.clearAllMocks(); get.mockReset(); post.mockReset(); });
afterEach(() => jest.restoreAllMocks());

describe('assignment page', () => {
  test('no test button until the server allows it; lessons link to the library', async () => {
    show(assignment());
    expect(await screen.findByText('Raise a PO')).toHaveAttribute('href', '/team/lessons/L1');
    expect(screen.getByText(/no longer in the library/)).toBeInTheDocument();
    expect(screen.queryByText('Start the test')).not.toBeInTheDocument();
  });

  test('starts when allowed', async () => {
    show(assignment({ can: { ...can, startTest: true } }));
    post.mockResolvedValue({ attempt: paper });
    fireEvent.click(await screen.findByText('Start the test'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/training/assignments/A1/test', {}));
  });

  test('hands in what was picked', async () => {
    show(assignment({ openAttempt: paper }));
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(await screen.findByLabelText('Me'));
    post.mockResolvedValue({ result: {}, assignment: assignment({ status: 'needs_help' }) });
    fireEvent.click(screen.getByText('Hand in'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/training/assignments/A1/test/submit', { attemptId: 'T1', answers: { Q1: 1 } }));
  });

  test('a blank answer warns, and saying no sends nothing', async () => {
    show(assignment({ openAttempt: paper }));
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(await screen.findByText('Hand in'));
    expect(confirm.mock.calls[0][0]).toMatch(/1 left blank/);
    expect(post).not.toHaveBeenCalled();
  });

  test('a failed hand-in keeps the answers', async () => {
    show(assignment({ openAttempt: paper }));
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(await screen.findByLabelText('Me'));
    post.mockRejectedValue(new Error('net'));
    fireEvent.click(screen.getByText('Hand in'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByLabelText('Me')).toBeChecked();
  });

  test('marking needs every answer marked', async () => {
    const attempt = { id: 'T1', number: 1, status: 'marking' as const, score: null, passed: null, submittedAt: '', toReview: [], questions: [{ id: 'Q1', type: 'written' as const, text: 'Explain', options: [], correct: null, answer: 'Because', right: null }] };
    show(assignment({ status: 'marking', attempts: [attempt], can: { ...can, mark: true } }));
    const save = await screen.findByText('Save marks');
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Right'));
    expect(save).toBeEnabled();
    post.mockResolvedValue({ assignment: assignment() });
    fireEvent.click(save);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/training/assignments/A1/test/mark', { attemptId: 'T1', marks: { Q1: true } }));
  });

  test('sign-off confirms first', async () => {
    show(assignment({ status: 'ready_for_signoff', can: { ...can, signOff: true } }));
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(await screen.findByText('Sign off'));
    expect(post).not.toHaveBeenCalled();
  });

  test('a training someone cannot see just says so', async () => {
    get.mockRejectedValue(new Error('404'));
    wrap(<TrainingDetail id="A1" base="/team/training" />);
    expect(await screen.findByText(/isn't available/)).toBeInTheDocument();
  });
});

describe('home', () => {
  const route = (teams: unknown[], rows: unknown) => get.mockImplementation((u: string) => Promise.resolve(u.endsWith('/meta') ? { teams, passMark: 80, attemptsAllowed: 3 } : rows));

  test('empty, and no Team tab for a member', async () => {
    route([], { assignments: [], nextCursor: null });
    wrap(<TrainingHome base="/team/training" />);
    expect(await screen.findByText(/You have no training yet/)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Team' })).not.toBeInTheDocument();
    expect(screen.queryByText('Set up training')).not.toBeInTheDocument();
  });

  test('a head gets the Team tab and setup', async () => {
    route([{ key: 'procurement', label: 'Procurement' }], { assignments: [], nextCursor: null });
    wrap(<TrainingHome base="/team/training" />);
    expect(await screen.findByRole('tab', { name: 'Team' })).toBeInTheDocument();
    expect(screen.getByText('Set up training')).toBeInTheDocument();
  });
});

describe('editor', () => {
  test('removing a lesson clears the questions that pointed at it', async () => {
    const path = { id: 'P1', title: 'Job', team: 'procurement', teamLabel: 'Procurement', rev: 0, lessonCount: 1, questionCount: 1, createdByName: '', createdAt: '', items: [{ stage: 'day1', lessonId: 'L1', title: 'Raise a PO' }], questions: [{ id: 'Q1', type: 'written', text: 'Why?', options: [], correct: null, lessonId: 'L1' }] };
    get.mockImplementation((u: string) => Promise.resolve(u.includes('/paths/') ? { path } : u.includes('lesson-options') ? { lessons: [{ id: 'L1', title: 'Raise a PO' }] } : u.includes('lessons/meta') ? { people: [] } : { teams: [], passMark: 80, attemptsAllowed: 3 }));
    wrap(<PathEditor id="P1" base="/team/training" />);
    fireEvent.click(await screen.findByLabelText('Remove Raise a PO'));
    expect(screen.getByLabelText(/tell them to re-read/)).toHaveValue('');
    expect(screen.queryByLabelText('Remove Raise a PO')).not.toBeInTheDocument();
  });
});
