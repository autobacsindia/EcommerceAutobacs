/**
 * Leave decisions are never optimistic: the row only says Approved/Rejected after
 * the server answers, a rejection needs a reason, and a failure leaves the
 * request undecided with the server's message.
 */
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-types';
import LeaveInbox from './LeaveInbox';

const leaveInbox = jest.fn();
const decideLeave = jest.fn();
jest.mock('@/lib/hr/api', () => ({
  HR_PAGE_SIZE: 25,
  hrApi: {
    leaveInbox: (...a: unknown[]) => leaveInbox(...a),
    decideLeave: (...a: unknown[]) => decideLeave(...a),
  },
}));

const req = (over: Record<string, unknown> = {}) => ({
  id: 'L1', employee: 'E1', employeeName: 'Test Person', employeeCode: 'EMP-0001', leaveType: 'T1', leaveTypeName: 'Casual',
  from: '2026-12-04', to: '2026-12-04', firstHalfOnly: false, secondHalfOnly: false, halfDays: 2, paid: true,
  reason: 'Family function', status: 'pending_hr', decisions: [], rev: 3, createdAt: '2026-11-22T05:00:00Z', ...over,
});

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  leaveInbox.mockReset();
  decideLeave.mockReset();
});

it('shows the waiting request with days from the server', async () => {
  leaveInbox.mockResolvedValue({ items: [req()], nextCursor: null });
  wrap(<LeaveInbox />);
  const row = (await screen.findByText('Test Person')).closest('tr')!;
  expect(within(row).getByText('Casual')).toBeTruthy();
  expect(within(row).getByText('1 day')).toBeTruthy();
});

it('approves only after the server confirms, sending the rev it was shown', async () => {
  leaveInbox.mockResolvedValue({ items: [req()], nextCursor: null });
  const d = deferred<unknown>();
  decideLeave.mockReturnValue(d.promise);
  wrap(<LeaveInbox />);

  fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
  await waitFor(() => expect(decideLeave).toHaveBeenCalledWith('L1', 'approved', 3, ''));
  // While the server decides: buttons locked, nothing says "Approved" yet.
  expect(screen.getByRole('button', { name: /approving/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /reject/i })).toBeDisabled();
  expect(screen.queryByText('Approved')).toBeNull();

  d.resolve({ request: req({ status: 'approved', rev: 4 }) });
  expect(await screen.findByText('Approved')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
});

it('says "next step" when HR approval was not the final one', async () => {
  leaveInbox.mockResolvedValue({ items: [req({ status: 'pending_head' })], nextCursor: null });
  decideLeave.mockResolvedValue({ request: req({ status: 'pending_hr', rev: 4 }) });
  wrap(<LeaveInbox />);
  fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
  expect(await screen.findByText(/next step/i)).toBeTruthy();
});

it('needs a reason to reject, then rejects with it', async () => {
  leaveInbox.mockResolvedValue({ items: [req()], nextCursor: null });
  decideLeave.mockResolvedValue({ request: req({ status: 'rejected', rev: 4 }) });
  wrap(<LeaveInbox />);

  fireEvent.click(await screen.findByRole('button', { name: /^reject$/i }));
  fireEvent.click(screen.getByRole('button', { name: /reject leave/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/write why/i);
  expect(decideLeave).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText(/reason for rejecting/i), { target: { value: 'Month-end stock count' } });
  fireEvent.click(screen.getByRole('button', { name: /reject leave/i }));
  await waitFor(() => expect(decideLeave).toHaveBeenCalledWith('L1', 'rejected', 3, 'Month-end stock count'));
  expect(await screen.findByText('Rejected')).toBeTruthy();
});

it('keeps the request undecided and shows the reason when someone else decided first (409)', async () => {
  leaveInbox.mockResolvedValue({ items: [req()], nextCursor: null });
  decideLeave.mockRejectedValue(new ApiError(409, 'This request was already decided by someone else.', '/x'));
  wrap(<LeaveInbox />);

  fireEvent.click(await screen.findByRole('button', { name: /approve/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/already decided/i);
  expect(screen.queryByText('Approved')).toBeNull();
  // Inbox is reloaded so the stale row can go away.
  await waitFor(() => expect(leaveInbox).toHaveBeenCalledTimes(2));
});

it('shows an empty state when nothing is waiting', async () => {
  leaveInbox.mockResolvedValue({ items: [], nextCursor: null });
  wrap(<LeaveInbox />);
  expect(await screen.findByText('Nothing waiting')).toBeTruthy();
});

it('loads more with the server cursor', async () => {
  leaveInbox
    .mockResolvedValueOnce({ items: [req()], nextCursor: 'c1' })
    .mockResolvedValueOnce({ items: [req({ id: 'L2', employeeName: 'Second Person' })], nextCursor: null });
  wrap(<LeaveInbox />);
  fireEvent.click(await screen.findByRole('button', { name: /load more/i }));
  expect(await screen.findByText('Second Person')).toBeTruthy();
  expect(leaveInbox).toHaveBeenLastCalledWith('c1');
  expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
});

it.each([
  [new ApiError(404, 'Route not found', '/x'), /coming soon/i],
  [new ApiError(403, 'Forbidden', '/x'), /only for HR and admin/i],
  [new ApiError(500, 'boom', '/x'), /could not load/i],
])('shows a friendly state when the inbox fails (%s)', async (error, text) => {
  leaveInbox.mockRejectedValue(error);
  wrap(<LeaveInbox />);
  expect(await screen.findByText(text)).toBeTruthy();
});
