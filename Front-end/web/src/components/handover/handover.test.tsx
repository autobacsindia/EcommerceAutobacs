/**
 * The Handover screens.
 *   - the reason box appears only when the server sends manager rights
 *   - the replacement reads the note but gets no editor
 *   - saving sends the rev; a failed note save keeps the text
 *   - "They are staying" confirms first
 *   - a member gets no record button; empty and hidden states say so
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HandoverDetail from './HandoverDetail';
import HandoverHome from './HandoverHome';
import { timing, type Departure } from './types';

const get = jest.fn();
const post = jest.fn();
const patch = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), delete: jest.fn() } }));
const toastError = jest.fn();
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: (...a: unknown[]) => toastError(...a) } }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));
jest.mock('@/components/ui/RichText', () => ({ __esModule: true, default: ({ value }: { value: string }) => <div>{value}</div> }));
jest.mock('@/components/ui/RichTextBox', () => ({ __esModule: true, default: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) => <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} /> }));

const record = (over: Partial<Departure> = {}): Departure => ({
  id: 'D1', user: { id: 'U1', name: 'Arun' }, team: 'procurement', teamLabel: 'Procurement', lastDay: '2026-11-30', daysLeft: 21, status: 'open',
  successor: { id: 'U2', name: 'Meena' }, rev: 3, createdAt: '', note: 'Call Ravi', can: { manage: false, writeNote: false }, ...over,
});
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const show = (d: Departure) => {
  get.mockImplementation((u: string) => Promise.resolve(u.endsWith('training/meta') ? { teams: [{ key: 'procurement', label: 'Procurement' }] } : u.endsWith('lessons/meta') ? { people: [] } : { departure: d }));
  wrap(<HandoverDetail id="D1" base="/team/handover" />);
};
const manager = { manage: true, writeNote: true, handover: true };

beforeEach(() => { jest.clearAllMocks(); get.mockReset(); post.mockReset(); patch.mockReset(); });
afterEach(() => jest.restoreAllMocks());

describe('record page', () => {
  test('the replacement reads the note, with no editor or reason', async () => {
    show(record());
    expect(await screen.findByText('Call Ravi')).toBeInTheDocument();
    expect(screen.queryByLabelText('Handover note')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Reason/)).not.toBeInTheDocument();
  });

  test('the person leaving can write the note only', async () => {
    show(record({ can: { manage: false, writeNote: true } }));
    fireEvent.change(await screen.findByLabelText('Handover note'), { target: { value: 'New note' } });
    patch.mockResolvedValue({ departure: record({ note: 'New note', rev: 4 }) });
    fireEvent.click(screen.getByText('Save note'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/departures/D1', { rev: 3, note: 'New note' }));
    expect(screen.queryByText('They are staying')).not.toBeInTheDocument();
  });

  test('a failed note save keeps the text', async () => {
    show(record({ can: { manage: false, writeNote: true } }));
    fireEvent.change(await screen.findByLabelText('Handover note'), { target: { value: 'Keep me' } });
    patch.mockRejectedValue(new Error('net'));
    fireEvent.click(screen.getByText('Save note'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByLabelText('Handover note')).toHaveValue('Keep me');
  });

  test('a head sees the private reason and a link to remove access', async () => {
    show(record({ reason: 'Moving city', can: manager }));
    expect(await screen.findByLabelText(/Reason/)).toHaveValue('Moving city');
    expect(screen.getByText('Remove access in My team')).toHaveAttribute('href', '/team/members');
  });

  test('"They are staying" confirms first', async () => {
    show(record({ can: manager }));
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(await screen.findByText('They are staying'));
    expect(post).not.toHaveBeenCalled();
  });

  test('a head reads the reason but has no way to change anything', async () => {
    show(record({ reason: 'Moving city' }));
    expect(await screen.findByText('Moving city')).toBeInTheDocument();
    expect(screen.queryByText('They are staying')).not.toBeInTheDocument();
    expect(screen.queryByText('Save note')).not.toBeInTheDocument();
    expect(screen.queryByText('Start handover')).not.toBeInTheDocument();
  });

  test('a record someone cannot see just says so', async () => {
    get.mockRejectedValue(new Error('404'));
    wrap(<HandoverDetail id="D1" base="/team/handover" />);
    expect(await screen.findByText(/isn't available/)).toBeInTheDocument();
  });
});

describe('Start handover', () => {
  const empty = { tasks: [], leads: [], quotations: [], lessons: [], orders: [] };
  const showWork = (work: object, goesTo: object | null, moves: object[] = []) => {
    get.mockImplementation((u: string) => Promise.resolve(u.endsWith('/work') ? { work: { ...empty, ...work }, goesTo, canStart: true, moves }
      : u.endsWith('training/meta') ? { teams: [] } : u.endsWith('lessons/meta') ? { people: [] } : { departure: record({ reason: '', can: { manage: false, writeNote: false, handover: true } }) }));
    wrap(<HandoverDetail id="D1" base="/team/handover" />);
  };
  const meena = { id: 'U2', name: 'Meena' };
  const oneTask = { tasks: [{ id: 'T1', label: 'T-1 Call' }] };

  test('nothing moves if the confirmation is refused', async () => {
    showWork(oneTask, meena);
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(await screen.findByText('Start handover'));
    expect(post).not.toHaveBeenCalled();
  });

  test('confirming starts it', async () => {
    showWork(oneTask, meena);
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    post.mockResolvedValue({ result: { moved: 1, failed: 0 }, work: empty, goesTo: meena, canStart: true, moves: [] });
    fireEvent.click(await screen.findByText('Start handover'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/departures/D1/handover', {}));
    expect(await screen.findByText('Nothing left to move.')).toBeInTheDocument();
  });

  test('no one to give it to: the button is off', async () => {
    showWork(oneTask, null);
    expect(await screen.findByText('Start handover')).toBeDisabled();
  });

  test('failures are listed with the reason', async () => {
    showWork({ leads: [{ id: 'L1', label: 'Ravi' }] }, meena, [{ id: 'M1', kind: 'lead', label: 'Ravi', state: 'failed', error: 'Not a seller', fromName: 'A', toName: 'B', byName: 'C', at: '' }]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Lead: Ravi: Not a seller');
  });

  test('orders are listed but do not count as work to move', async () => {
    showWork({ orders: [{ id: 'O1', label: 'Order ending ABC', status: 'processing' }] }, meena);
    expect(await screen.findByText(/Order ending ABC/)).toBeInTheDocument();
    expect(screen.queryByText('Start handover')).not.toBeInTheDocument();
  });

  test('someone who is not a manager gets no panel', async () => {
    show(record());
    await screen.findByText('Call Ravi');
    expect(get.mock.calls.some(([u]) => String(u).endsWith('/work'))).toBe(false);
  });
});

describe('home', () => {
  const route = (teams: unknown[], mine: Departure[], all: Departure[] = []) => get.mockImplementation((u: string) => Promise.resolve(
    u.endsWith('training/meta') ? { teams } : u.endsWith('/mine') ? { departures: mine } : u.endsWith('lessons/meta') ? { people: [] } : { departures: all, nextCursor: null },
  ));

  test('a member with nothing sees the empty state and no record button', async () => {
    route([], []);
    wrap(<HandoverHome base="/team/handover" />);
    expect(await screen.findByText('No handovers right now.')).toBeInTheDocument();
    expect(screen.queryByText('Record a resignation')).not.toBeInTheDocument();
  });

  test('the replacement sees who they take over from', async () => {
    route([], [record({ mine: 'taking_over' })]);
    wrap(<HandoverHome base="/team/handover" />);
    expect(await screen.findByText('Taking over from Arun')).toBeInTheDocument();
  });

  test('an admin can open the form', async () => {
    get.mockImplementation((u: string) => Promise.resolve(u.endsWith('training/meta') ? { teams: [{ key: 'procurement', label: 'Procurement' }] } : u.endsWith('/mine') ? { departures: [] } : u.endsWith('lessons/meta') ? { people: [] } : { departures: [record()], nextCursor: null, canRecord: true }));
    wrap(<HandoverHome base="/admin/handover" />);
    fireEvent.click(await screen.findByText('Record a resignation'));
    expect(screen.getByLabelText('Who is leaving')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeDisabled();
  });

  test('a head sees their team but gets no record button', async () => {
    get.mockImplementation((u: string) => Promise.resolve(u.endsWith('training/meta') ? { teams: [{ key: 'procurement', label: 'Procurement' }] } : u.endsWith('/mine') ? { departures: [] } : { departures: [record()], nextCursor: null, canRecord: false }));
    wrap(<HandoverHome base="/team/handover" />);
    expect(await screen.findByText('Arun')).toBeInTheDocument();
    expect(screen.queryByText('Record a resignation')).not.toBeInTheDocument();
  });
});

test.each([[5, 'open', '5 days left'], [1, 'open', '1 day left'], [0, 'open', 'Last day is today'], [-2, 'open', 'Last day has passed'], [9, 'left', 'Access removed']] as const)('timing %i %s', (daysLeft, status, label) => {
  expect(timing({ daysLeft, status }).label).toBe(label);
});
