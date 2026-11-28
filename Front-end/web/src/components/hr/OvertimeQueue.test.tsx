/** Overtime approvals: never optimistic, edit-minutes bounds, reject needs a reason, states. */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api-types';
import OvertimeQueue from './OvertimeQueue';
import { deferred, wrap } from './testUtils';

const overtimePending = jest.fn();
const decideOvertime = jest.fn();
jest.mock('@/lib/hr/api', () => ({
  HR_PAGE_SIZE: 25,
  hrApi: {
    overtimePending: (...a: unknown[]) => overtimePending(...a),
    decideOvertime: (...a: unknown[]) => decideOvertime(...a),
  },
}));

const item = {
  id: 'D1',
  employee: { id: 'E1', name: 'Test Person', employeeCode: 'EMP-0001', team: 'sales', designation: 'Advisor' },
  day: {
    date: '2026-11-20', status: 'present', firstIn: '2026-11-20T04:30:00Z', lastOut: '2026-11-20T15:30:00Z',
    workedMinutes: 600, lateMinutes: 0, isLate: false, overtimeMinutes: 60, autoClosed: false, needsReview: false, overtimeStatus: 'pending',
  },
};

beforeEach(() => { overtimePending.mockReset(); decideOvertime.mockReset(); });

it('shows the empty state', async () => {
  overtimePending.mockResolvedValue({ items: [], nextCursor: null });
  wrap(<OvertimeQueue />);
  expect(await screen.findByText(/no overtime waiting/i)).toBeTruthy();
});

it('shows a friendly error', async () => {
  overtimePending.mockRejectedValue(new ApiError(500, 'x', '/x'));
  wrap(<OvertimeQueue />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
});

it('approves all minutes; the row stays until the server confirms', async () => {
  overtimePending.mockResolvedValueOnce({ items: [item], nextCursor: null }).mockResolvedValue({ items: [], nextCursor: null });
  const d = deferred<unknown>();
  decideOvertime.mockReturnValue(d.promise);
  wrap(<OvertimeQueue />);
  fireEvent.click(await screen.findByRole('button', { name: /^approve$/i }));
  // Sends the overtime HR saw (60) so a changed day is refused, not decided on old numbers.
  await waitFor(() => expect(decideOvertime).toHaveBeenCalledWith('D1', 'approve', 60, { minutes: undefined, note: undefined }));
  expect(screen.getByText('Test Person')).toBeTruthy();
  expect(screen.getByRole('button', { name: /approving/i })).toBeDisabled();
  d.resolve({ day: item.day, replay: false });
  expect(await screen.findByText(/no overtime waiting/i)).toBeTruthy();
});

it('approves part of it with edited minutes, refusing more than was worked', async () => {
  overtimePending.mockResolvedValue({ items: [item], nextCursor: null });
  decideOvertime.mockReturnValue(new Promise(() => {}));
  wrap(<OvertimeQueue />);
  fireEvent.click(await screen.findByRole('button', { name: /edit minutes/i }));
  const box = screen.getByLabelText(/minutes to approve/i);
  fireEvent.change(box, { target: { value: '90' } });
  fireEvent.click(screen.getByRole('button', { name: /approve these minutes/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/1 to 60/);
  expect(decideOvertime).not.toHaveBeenCalled();
  fireEvent.change(box, { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: /approve these minutes/i }));
  await waitFor(() => expect(decideOvertime).toHaveBeenCalledWith('D1', 'approve', 60, { minutes: 30, note: '' }));
});

it('rejects only with a reason', async () => {
  overtimePending.mockResolvedValue({ items: [item], nextCursor: null });
  decideOvertime.mockReturnValue(new Promise(() => {}));
  wrap(<OvertimeQueue />);
  fireEvent.click(await screen.findByRole('button', { name: /^reject$/i }));
  fireEvent.click(screen.getByRole('button', { name: /reject overtime/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/say why/i);
  fireEvent.change(screen.getByLabelText(/reason for rejecting/i), { target: { value: 'Not asked to stay' } });
  fireEvent.click(screen.getByRole('button', { name: /reject overtime/i }));
  await waitFor(() => expect(decideOvertime).toHaveBeenCalledWith('D1', 'reject', 60, { minutes: undefined, note: 'Not asked to stay' }));
});

it('a refused decision leaves the row undecided with the server message', async () => {
  overtimePending.mockResolvedValue({ items: [item], nextCursor: null });
  decideOvertime.mockRejectedValue(new ApiError(409, 'This day changed. Reload and decide again.', '/x'));
  wrap(<OvertimeQueue />);
  fireEvent.click(await screen.findByRole('button', { name: /^approve$/i }));
  expect(await screen.findByText(/this day changed/i)).toBeTruthy();
  expect(screen.getByText('Test Person')).toBeTruthy();
});
