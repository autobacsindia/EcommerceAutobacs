/**
 * The Handover screens.
 *   - the reason box appears only when the server sends manager rights
 *   - the replacement reads the note but gets no editor
 *   - saving sends the rev; a failed note save keeps the text
 *   - "They are staying" confirms first
 *   - a member gets no record button; empty and hidden states say so
 *   - teammates read the responsibilities, note and open work, with no Start button
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
  get.mockImplementation((u: string) => Promise.resolve(u.endsWith('/work') ? { work: { tasks: [], leads: [], quotations: [], lessons: [], orders: [] }, goesTo: null, canStart: false, moves: [] }
    : u.endsWith('training/meta') ? { teams: [{ key: 'procurement', label: 'Procurement' }] } : u.endsWith('/people') ? { people: [] } : { departure: d }));
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
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/departures/D1', { rev: 3, note: 'New note', responsibilities: '' }));
    expect(screen.queryByText('They are staying')).not.toBeInTheDocument();
  });

  test('the person leaving writes their main responsibilities', async () => {
    show(record({ responsibilities: 'Old', can: { manage: false, writeNote: true } }));
    fireEvent.change(await screen.findByLabelText('Main responsibilities'), { target: { value: 'Pay suppliers on Friday' } });
    patch.mockResolvedValue({ departure: record({ responsibilities: 'Pay suppliers on Friday', rev: 4 }) });
    fireEvent.click(screen.getByText('Save note'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/departures/D1', { rev: 3, note: 'Call Ravi', responsibilities: 'Pay suppliers on Friday' }));
  });

  test('a teammate reads the responsibilities and note, with no editor', async () => {
    show(record({ responsibilities: 'Pay suppliers on Friday' }));
    expect(await screen.findByText('Pay suppliers on Friday')).toBeInTheDocument();
    expect(screen.getByText('Call Ravi')).toBeInTheDocument();
    expect(screen.queryByLabelText('Main responsibilities')).not.toBeInTheDocument();
    expect(screen.queryByText('Save note')).not.toBeInTheDocument();
  });

  test('a failed note save keeps the text', async () => {
    show(record({ can: { manage: false, writeNote: true } }));
    fireEvent.change(await screen.findByLabelText('Handover note'), { target: { value: 'Keep me' } });
    patch.mockRejectedValue(new Error('net'));
    fireEvent.click(screen.getByText('Save note'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByLabelText('Handover note')).toHaveValue('Keep me');
  });

  test('HR sees the private reason and dates, but no link to remove access (only an admin does that)', async () => {
    show(record({ reason: 'Moving city', resignedOn: '2026-11-01', createdByName: 'Hema', createdAt: '2026-11-02T10:00:00Z', can: manager }));
    expect(await screen.findByLabelText(/Reason/)).toHaveValue('Moving city');
    expect(screen.getByLabelText('Resignation date')).toHaveValue('2026-11-01');
    expect(screen.getByText(/Resigned 1 Nov 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Recorded by Hema on 2 Nov 2026/)).toBeInTheDocument();
    expect(screen.queryByText('Remove access in My team')).not.toBeInTheDocument();
  });

  test('the admin page links to remove access', async () => {
    get.mockImplementation((u: string) => Promise.resolve(u.endsWith('/work') ? { work: { tasks: [], leads: [], quotations: [], lessons: [], orders: [] }, goesTo: null, canStart: false, moves: [] }
      : u.endsWith('/people') ? { people: [] } : { departure: record({ can: manager }) }));
    wrap(<HandoverDetail id="D1" base="/admin/handover" />);
    expect(await screen.findByText('Remove access in My team')).toHaveAttribute('href', '/admin/staff');
  });

  test('a cancelled record says who cancelled it and when', async () => {
    show(record({ status: 'cancelled', createdByName: 'Hema', createdAt: '2026-11-02T10:00:00Z', cancelledByName: 'Admin', cancelledAt: '2026-11-05T10:00:00Z' }));
    expect(await screen.findByText(/Cancelled by Admin on 5 Nov 2026/)).toBeInTheDocument();
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
      : u.endsWith('training/meta') ? { teams: [] } : u.endsWith('/people') ? { people: [] } : { departure: record({ reason: '', can: { manage: false, writeNote: false, handover: true } }) }));
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

  test('a teammate sees the open work but no Start button', async () => {
    get.mockImplementation((u: string) => Promise.resolve(u.endsWith('/work') ? { work: { ...empty, ...oneTask }, goesTo: meena, canStart: false, moves: [] }
      : u.endsWith('training/meta') ? { teams: [] } : u.endsWith('/people') ? { people: [] } : { departure: record() }));
    wrap(<HandoverDetail id="D1" base="/team/handover" />);
    expect(await screen.findByText('T-1 Call')).toBeInTheDocument();
    expect(screen.getByText('Meena is taking this over.')).toBeInTheDocument();
    expect(screen.queryByText('Start handover')).not.toBeInTheDocument();
  });

  test('a cancelled record shows no work', async () => {
    show(record({ status: 'cancelled' }));
    await screen.findByText('Call Ravi');
    expect(get.mock.calls.some(([u]) => String(u).endsWith('/work'))).toBe(false);
  });
});

describe('home', () => {
  const route = (teams: unknown[], mine: Departure[], all: Departure[] = []) => get.mockImplementation((u: string) => Promise.resolve(
    u.endsWith('training/meta') ? { teams } : u.endsWith('/mine') ? { departures: mine } : u.endsWith('/people') ? { people: [] } : { departures: all, nextCursor: null },
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

  describe('HR records a resignation', () => {
    const people = [{ id: 'U1', name: 'Arun', team: 'procurement', teamLabel: 'Procurement' }, { id: 'U2', name: 'Meena', team: 'sales', teamLabel: 'Sales' }];
    const openForm = async () => {
      get.mockImplementation((u: string) => Promise.resolve(u.endsWith('training/meta') ? { teams: [] } : u.endsWith('/mine') ? { departures: [] } : u.endsWith('/people') ? { people } : { departures: [], nextCursor: null, canRecord: true }));
      wrap(<HandoverHome base="/team/handover" />);
      fireEvent.click(await screen.findByText('Record a resignation'));
      await screen.findAllByRole('option', { name: 'Arun (Procurement)' });
    };
    const fill = (resigned: string, last: string) => {
      fireEvent.change(screen.getByLabelText('Who is leaving'), { target: { value: 'U1' } });
      fireEvent.change(screen.getByLabelText('Resignation date'), { target: { value: resigned } });
      fireEvent.change(screen.getByLabelText('Last working day'), { target: { value: last } });
    };

    test('HR picks anyone from any team; Save waits for both dates; it sends them', async () => {
      await openForm();
      expect(screen.getAllByRole('option', { name: 'Meena (Sales)' }).length).toBeGreaterThan(0);
      fireEvent.change(screen.getByLabelText('Who is leaving'), { target: { value: 'U1' } });
      fireEvent.change(screen.getByLabelText('Last working day'), { target: { value: '2026-12-20' } });
      expect(screen.getByText('Save')).toBeDisabled();
      fill('2026-11-20', '2026-12-20');
      fireEvent.change(screen.getByLabelText('Who takes over (optional)'), { target: { value: 'U2' } });
      post.mockResolvedValue({ departure: record() });
      fireEvent.click(screen.getByText('Save'));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/departures', { userId: 'U1', resignedOn: '2026-11-20', lastDay: '2026-12-20', reason: '', successorId: 'U2' }));
    });

    test('a last day before the resignation date is stopped before saving', async () => {
      await openForm();
      fill('2026-11-20', '2026-11-10');
      fireEvent.click(screen.getByText('Save'));
      expect(await screen.findByRole('alert')).toHaveTextContent('The last day cannot be before the resignation date.');
      expect(post).not.toHaveBeenCalled();
    });

    test('a refusal from the server is shown', async () => {
      await openForm();
      fill('2026-11-20', '2026-12-20');
      post.mockRejectedValue(Object.assign(new Error('A resignation is already recorded for this person. Open it to change it.'), { status: 409 }));
      fireEvent.click(screen.getByText('Save'));
      expect(await screen.findByRole('alert')).toBeInTheDocument();
    });
  });

  test('an admin can open the form', async () => {
    get.mockImplementation((u: string) => Promise.resolve(u.endsWith('training/meta') ? { teams: [{ key: 'procurement', label: 'Procurement' }] } : u.endsWith('/mine') ? { departures: [] } : u.endsWith('/people') ? { people: [] } : { departures: [record()], nextCursor: null, canRecord: true }));
    wrap(<HandoverHome base="/admin/handover" />);
    fireEvent.click(await screen.findByText('Record a resignation'));
    expect(screen.getByLabelText('Who is leaving')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeDisabled();
  });

  test('a member sees who is leaving their team', async () => {
    route([], [], [record()]);
    wrap(<HandoverHome base="/team/handover" />);
    expect(await screen.findByText('Leaving your team')).toBeInTheDocument();
    expect(screen.getByText('Arun')).toBeInTheDocument();
    expect(screen.queryByText('Record a resignation')).not.toBeInTheDocument();
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
