/** payrollRun: "no run yet" is an empty month; everything else still throws. */
import { ApiError } from '@/lib/api-types';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

import { hrApi, payslipPdfUrl } from './api';

beforeEach(() => { get.mockReset(); post.mockReset(); });

it('returns the run', async () => {
  get.mockResolvedValue({ run: { month: '2026-10' } });
  await expect(hrApi.payrollRun('2026-10')).resolves.toEqual({ month: '2026-10' });
  expect(get).toHaveBeenCalledWith('/hr/payroll/2026-10');
});

it('treats "No payroll for this month yet." as no run', async () => {
  get.mockRejectedValue(new ApiError(404, 'No payroll for this month yet.', '/x'));
  await expect(hrApi.payrollRun('2026-10')).resolves.toBeNull();
});

it('still throws "Route not found" and other errors', async () => {
  get.mockRejectedValue(new ApiError(404, 'Route not found', '/x'));
  await expect(hrApi.payrollRun('2026-10')).rejects.toBeInstanceOf(ApiError);
  get.mockRejectedValue(new ApiError(500, 'x', '/x'));
  await expect(hrApi.payrollRun('2026-10')).rejects.toBeInstanceOf(ApiError);
});

it('overtime decide sends the shown minutes; partial minutes only on approve', async () => {
  post.mockResolvedValue({});
  await hrApi.decideOvertime('D1', 'approve', 60, { minutes: 30 });
  expect(post).toHaveBeenLastCalledWith('/hr/attendance/D1/overtime/decide', { decision: 'approve', overtimeMinutes: 60, minutes: 30, note: '' }, { retries: 0 });
  await hrApi.decideOvertime('D1', 'reject', 60, { minutes: 30, note: 'no' });
  expect(post).toHaveBeenLastCalledWith('/hr/attendance/D1/overtime/decide', { decision: 'reject', overtimeMinutes: 60, note: 'no' }, { retries: 0 });
});

it('payslip PDF link is relative and escaped', () => {
  expect(payslipPdfUrl('E 1', 'P/1')).toBe('/api/v1/hr/employees/E%201/payslips/P%2F1/pdf');
});
