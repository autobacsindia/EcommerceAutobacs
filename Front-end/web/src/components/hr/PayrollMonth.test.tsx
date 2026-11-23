/** Payroll: server figures only, nothing optimistic, admin-only approve, "coming soon" while the API isn't deployed. */
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-types';
import PayrollMonth from './PayrollMonth';

const payrollMonth = jest.fn();
const lockPayroll = jest.fn();
const approvePayroll = jest.fn();
jest.mock('@/lib/hr/api', () => ({
  hrApi: {
    payrollMonth: (...a: unknown[]) => payrollMonth(...a),
    lockPayroll: (...a: unknown[]) => lockPayroll(...a),
    approvePayroll: (...a: unknown[]) => approvePayroll(...a),
    preparePayroll: jest.fn(), recomputePayroll: jest.fn(), unlockPayroll: jest.fn(), createPayouts: jest.fn(),
  },
}));

const run = (over: Record<string, unknown> = {}) => ({
  month: '2026-11', status: 'draft', employeeCount: 1, rev: 2, inputsFingerprint: 'fp1',
  totals: { grossPaise: 3104000, deductionsPaise: 300000, netPaise: 2804000 },
  lockedAt: null, approvedAt: null, payoutsCreatedAt: null, ...over,
});
const slip = {
  id: 'P1', employee: 'E1', snapshot: { name: 'Test Person', employeeCode: 'EMP-0001' },
  attendance: { daysInMonth: 30, paidDays: 29 }, grossPaise: 3104000, deductionsPaise: 300000, netPaise: 2804000,
};

const wrap = (ui: ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{ui}</QueryClientProvider>,
);

beforeEach(() => { payrollMonth.mockReset(); lockPayroll.mockReset(); approvePayroll.mockReset(); });

it('shows the server totals and per-person figures as given', async () => {
  payrollMonth.mockResolvedValue({ run: run(), items: [slip], nextCursor: null });
  wrap(<PayrollMonth />);
  expect(await screen.findByText('Test Person')).toBeTruthy();
  expect(screen.getAllByText('₹28,040').length).toBeGreaterThan(0);
  expect(screen.getByText('29 / 30')).toBeTruthy();
});

it('locks only after a confirm, with the rev it showed', async () => {
  payrollMonth.mockResolvedValue({ run: run(), items: [slip], nextCursor: null });
  lockPayroll.mockReturnValue(new Promise(() => {}));
  wrap(<PayrollMonth />);
  fireEvent.click(await screen.findByRole('button', { name: /check and lock/i }));
  expect(lockPayroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /yes, lock and send/i }));
  await waitFor(() => expect(lockPayroll).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/), 2));
  expect(screen.getByRole('button', { name: /locking/i })).toBeDisabled();
});

it('only admin gets the approve button on a locked month', async () => {
  payrollMonth.mockResolvedValue({ run: run({ status: 'locked' }), items: [slip], nextCursor: null });
  const { unmount } = wrap(<PayrollMonth />);
  expect(await screen.findByText('Sent to admin for approval')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull();
  unmount();

  approvePayroll.mockReturnValue(new Promise(() => {}));
  wrap(<PayrollMonth isAdmin />);
  fireEvent.click(await screen.findByRole('button', { name: /^approve$/i }));
  fireEvent.click(screen.getByRole('button', { name: /yes, approve/i }));
  await waitFor(() => expect(approvePayroll).toHaveBeenCalledWith(expect.any(String), 2, 'fp1'));
});

it('says "coming soon" while the payroll API is not deployed', async () => {
  payrollMonth.mockRejectedValue(new ApiError(404, 'Route not found', '/x'));
  wrap(<PayrollMonth />);
  expect(await screen.findByText(/coming soon/i)).toBeTruthy();
});
