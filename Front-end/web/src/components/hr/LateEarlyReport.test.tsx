/** Late/early report: server counts per person, per-row errors, CSV export, states. */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '@/lib/api-types';
import LateEarlyReport from './LateEarlyReport';
import { wrap } from './testUtils';

const listEmployees = jest.fn();
const employeeMonth = jest.fn();
jest.mock('@/lib/hr/api', () => ({
  HR_PAGE_SIZE: 25,
  hrApi: {
    listEmployees: (...a: unknown[]) => listEmployees(...a),
    employeeMonth: (...a: unknown[]) => employeeMonth(...a),
  },
}));
const downloadCsv = jest.fn();
jest.mock('@/lib/hr/csv', () => ({ ...jest.requireActual('@/lib/hr/csv'), downloadCsv: (...a: unknown[]) => downloadCsv(...a) }));

const person = (id: string, name: string) => ({ id, name, employeeCode: `EMP-${id}`, team: 'sales', status: 'active', designation: '', joinDate: null, user: null, phone: '' });
const summary = {
  daysInMonth: 30, presentDays: 24, halfDays: 0, absentDays: 1, leaveDays: 0,
  lateCount: 3, earlyCount: 1, marks: 4, marksPerHalfDayLop: 3, marksLopDays: 0.5, otApprovedMinutes: 120,
};

beforeEach(() => { listEmployees.mockReset(); employeeMonth.mockReset(); downloadCsv.mockReset(); });

it('shows each person’s server counts', async () => {
  listEmployees.mockResolvedValue({ items: [person('1', 'Test Person')], nextCursor: null });
  employeeMonth.mockResolvedValue({ month: '2026-11', days: [], summary });
  wrap(<LateEarlyReport />);
  const row = (await screen.findByText('Test Person')).closest('tr')!;
  await within(row).findByText('½ day');
  const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
  expect(cells.slice(1)).toEqual(['3', '1', '4', '½ day', '2h 00m', '1 day']);
});

it('one person failing does not hide the others, and CSV exports what loaded', async () => {
  listEmployees.mockResolvedValue({ items: [person('1', 'Test Person'), person('2', 'Other Person')], nextCursor: null });
  employeeMonth.mockImplementation((id: string) => (id === '1'
    ? Promise.resolve({ month: '2026-11', days: [], summary })
    : Promise.reject(new ApiError(404, 'Employee not found', '/x'))));
  wrap(<LateEarlyReport />);
  const other = (await screen.findByText('Other Person')).closest('tr')!;
  expect(await within(other).findByText('Not found')).toBeTruthy();
  const btn = screen.getByRole('button', { name: /download csv/i });
  await waitFor(() => expect(btn).not.toBeDisabled());
  fireEvent.click(btn);
  const [name, csv] = downloadCsv.mock.calls[0];
  expect(name).toMatch(/^late-early-\d{4}-\d{2}\.csv$/);
  expect(csv.split('\r\n')[1]).toBe('Test Person,EMP-1,GTM,3,1,4,0.5,120,1');
  expect(csv.split('\r\n')[2]).toContain('not loaded');
});

it('shows empty, loading and error states', async () => {
  listEmployees.mockReturnValue(new Promise(() => {}));
  const a = wrap(<LateEarlyReport />);
  expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  expect(screen.getByRole('button', { name: /download csv/i })).toBeDisabled();
  a.unmount();
  listEmployees.mockResolvedValue({ items: [], nextCursor: null });
  const b = wrap(<LateEarlyReport />);
  expect(await screen.findByText(/no employees yet/i)).toBeTruthy();
  b.unmount();
  listEmployees.mockRejectedValue(new ApiError(403, 'no', '/x'));
  wrap(<LateEarlyReport />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/only for hr and admin/i);
});
