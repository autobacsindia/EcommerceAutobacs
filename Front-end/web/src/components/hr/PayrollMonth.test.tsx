/**
 * Payroll: server figures only, nothing optimistic, admin-only approve /
 * payouts / re-open, each payslip line explained, PDF link, and the empty,
 * loading, error and "not deployed" states.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '@/lib/api-types';
import PayrollMonth from './PayrollMonth';
import { deferred, wrap } from './testUtils';

const payrollRun = jest.fn();
const preparePayroll = jest.fn();
const lockPayroll = jest.fn();
const approvePayroll = jest.fn();
const createPayouts = jest.fn();
const payslip = jest.fn();
jest.mock('@/lib/hr/api', () => ({
  hrApi: {
    payrollRun: (...a: unknown[]) => payrollRun(...a),
    preparePayroll: (...a: unknown[]) => preparePayroll(...a),
    lockPayroll: (...a: unknown[]) => lockPayroll(...a),
    approvePayroll: (...a: unknown[]) => approvePayroll(...a),
    createPayouts: (...a: unknown[]) => createPayouts(...a),
    payslip: (...a: unknown[]) => payslip(...a),
    recomputePayroll: jest.fn(), unlockPayroll: jest.fn(), reopenPayroll: jest.fn(),
  },
  payslipPdfUrl: (e: string, id: string) => `/api/v1/hr/employees/${e}/payslips/${id}/pdf`,
}));

const row = {
  id: 'P1', month: '2026-10', employee: 'E1', name: 'Test Person', employeeCode: 'EMP-0001',
  grossPaise: 3104000, deductionsPaise: 300000, netPaise: 2804000, warnings: [], released: false, payoutRequest: null,
};
const run = (over: Record<string, unknown> = {}) => ({
  id: 'R1', month: '2026-10', status: 'draft', rev: 2, employeeCount: 1, fingerprint: 'fp1',
  totals: { grossPaise: 3104000, deductionsPaise: 300000, netPaise: 2804000 },
  blockedCount: 0, skipped: [], computedAt: '2026-11-02T00:00:00Z', lockedAt: null, approvedAt: null,
  payoutsCreatedAt: null, payoutsCount: 0, history: [], payslips: [row], ...over,
});

beforeEach(() => { [payrollRun, preparePayroll, lockPayroll, approvePayroll, createPayouts, payslip].forEach((m) => m.mockReset()); });

it('shows loading, then the server totals and each person as given', async () => {
  const d = deferred<unknown>();
  payrollRun.mockReturnValue(d.promise);
  wrap(<PayrollMonth />);
  expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  d.resolve(run());
  expect((await screen.findAllByText('Test Person')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('₹28,040').length).toBeGreaterThan(0);
  expect(screen.getAllByText('₹31,040').length).toBeGreaterThan(0);
});

it('opens on last month and offers Prepare when there is no run yet', async () => {
  payrollRun.mockResolvedValue(null);
  preparePayroll.mockReturnValue(new Promise(() => {}));
  wrap(<PayrollMonth />);
  expect(await screen.findByText(/isn't prepared yet/i)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^prepare/i }));
  await waitFor(() => expect(preparePayroll).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/)));
  expect(screen.getByRole('button', { name: /preparing/i })).toBeDisabled();
});

it('does not offer Prepare for the month that is still running', async () => {
  payrollRun.mockResolvedValue(null);
  wrap(<PayrollMonth />);
  await screen.findByText(/isn't prepared yet/i);
  fireEvent.click(screen.getByRole('button', { name: /next month/i }));
  expect(await screen.findByText(/runs after the month ends/i)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^prepare/i })).toBeNull();
});

it('locks only after a confirm, sending the rev it showed', async () => {
  payrollRun.mockResolvedValue(run());
  lockPayroll.mockReturnValue(new Promise(() => {}));
  wrap(<PayrollMonth />);
  fireEvent.click(await screen.findByRole('button', { name: /check and lock/i }));
  expect(lockPayroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /yes, lock and send/i }));
  await waitFor(() => expect(lockPayroll).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/), 2));
  expect(screen.getByRole('button', { name: /locking/i })).toBeDisabled();
});

it('cannot lock while a payslip is blocked, and says why', async () => {
  payrollRun.mockResolvedValue(run({ blockedCount: 1 }));
  wrap(<PayrollMonth />);
  expect(await screen.findByText(/deductions above earnings/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /check and lock/i })).toBeDisabled();
});

it('hides approve from HR; admin approves with rev and fingerprint', async () => {
  payrollRun.mockResolvedValue(run({ status: 'locked' }));
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

it('shows the server refusal and keeps the run as it was', async () => {
  payrollRun.mockResolvedValue(run({ status: 'locked' }));
  approvePayroll.mockRejectedValue(new ApiError(409, 'Attendance changed since this payroll was worked out.', '/x'));
  wrap(<PayrollMonth isAdmin />);
  fireEvent.click(await screen.findByRole('button', { name: /^approve$/i }));
  fireEvent.click(screen.getByRole('button', { name: /yes, approve/i }));
  expect(await screen.findByText(/attendance changed since/i)).toBeTruthy();
  // Nothing moved on: still locked, the admin can read the message and decide again.
  expect(screen.getByRole('button', { name: /yes, approve/i })).not.toBeDisabled();
  expect(screen.getByRole('list', { name: /payroll steps/i }).querySelector('[aria-current="step"]')).toHaveTextContent('2. Locked');
});

it('only admin can raise missing salary payments on an approved run', async () => {
  payrollRun.mockResolvedValue(run({ status: 'approved', payoutsCount: 0 }));
  const { unmount } = wrap(<PayrollMonth />);
  expect(await screen.findByText(/0 of 1 salary payments raised/i)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /raise the missing/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /re-open/i })).toBeNull();
  unmount();

  createPayouts.mockResolvedValue({ payouts: [] });
  wrap(<PayrollMonth isAdmin />);
  fireEvent.click(await screen.findByRole('button', { name: /raise the missing/i }));
  await waitFor(() => expect(createPayouts).toHaveBeenCalled());
});

it('explains a payslip line by line with the server working and links the PDF', async () => {
  payrollRun.mockResolvedValue(run());
  payslip.mockResolvedValue({
    payslip: {
      ...row, number: 'PS-2026-10-0001', snapshot: { name: 'Test Person', employeeCode: 'EMP-0001' }, attendance: null, employerPaise: 0, releasedAt: null,
      lines: [
        { code: 'basic', label: 'Basic', kind: 'earning', amountPaise: 1500000, calc: '30 of 31 paid days' },
        { code: 'marks_lop', label: 'Late/early marks', kind: 'deduction', amountPaise: 30000, calc: 'Late/early marks: 4 → ½ day LOP ₹300' },
      ],
    },
  });
  wrap(<PayrollMonth />);
  fireEvent.click(await screen.findByRole('button', { name: /explain test person/i }));
  expect(await screen.findByText('Late/early marks: 4 → ½ day LOP ₹300')).toBeTruthy();
  expect(payslip).toHaveBeenCalledWith('E1', 'P1');
  const pdf = screen.getByRole('link', { name: /payslip pdf/i });
  expect(pdf).toHaveAttribute('href', '/api/v1/hr/employees/E1/payslips/P1/pdf');
  expect(within(pdf.closest('div')!.parentElement!).getByText('₹28,040')).toBeTruthy();
});

it('shows a friendly error and "coming soon" when the API is missing', async () => {
  payrollRun.mockRejectedValue(new ApiError(500, 'boom', '/x'));
  const { unmount } = wrap(<PayrollMonth />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
  unmount();
  payrollRun.mockRejectedValue(new ApiError(404, 'Route not found', '/x'));
  wrap(<PayrollMonth />);
  expect(await screen.findByText(/coming soon/i)).toBeTruthy();
});
