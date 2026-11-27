/**
 * Typed client for /api/v1/hr (docs/ADR-hr-system.md §4).
 *
 * Every call goes through lib/api-client (relative /api/v1, cookies + CSRF), so
 * there is no backend host here. Writes are sent with `retries: 0`: a decision,
 * a lock or an approval is never silently re-sent by the client — the server is
 * idempotent anyway (rev / clientRequestId), but a person should see the error
 * and choose to retry.
 */
import apiClient from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';
import type {
  AttendanceDay, Employee, EmployeeInput, EmployeeListFilter, EmployeeListRow, EmployeeMonth, HrSettings, HrSettingsInput,
  LeaveBalance, LeaveDecision, LeaveRequest, OvertimeDecision, OvertimeItem, Page, Payslip, PayrollRun, PolicySettingsInput,
  SalaryInput, SalaryStructure, Shift, TodayBoard, WorkSite,
} from './types';

const WRITE = { retries: 0 } as const;
export const HR_PAGE_SIZE = 25;

const qs = (params: Record<string, string | number | undefined | null>): string => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};
const seg = encodeURIComponent;

/**
 * GET /hr/payroll/:month answers 404 "No payroll for this month yet." when the
 * month has no run. That is an empty month, not an error. "Route not found"
 * (endpoint not deployed) and every other failure still throw.
 */
const NO_RUN = /no payroll for this month/i;
async function runOrNull(month: string): Promise<PayrollRun | null> {
  try {
    const { run } = await apiClient.get<{ run: PayrollRun }>(`/hr/payroll/${seg(month)}`);
    return run ?? null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404 && NO_RUN.test(err.message)) return null;
    throw err;
  }
}

type RunWrite = { run: PayrollRun };

// ── Employees ────────────────────────────────────────────────────────────────
export type EmployeeListParams = { status?: EmployeeListFilter; team?: string; q?: string; cursor?: string | null };

export const hrApi = {
  listEmployees: ({ status = 'current', team, q, cursor }: EmployeeListParams = {}) =>
    apiClient.get<Page<EmployeeListRow>>(`/hr/employees${qs({ status, team, q, cursor, limit: HR_PAGE_SIZE })}`),
  getEmployee: (id: string) => apiClient.get<{ employee: Employee }>(`/hr/employees/${seg(id)}`),
  createEmployee: (input: EmployeeInput) => apiClient.post<{ employee: Employee }>('/hr/employees', input, WRITE),
  updateEmployee: (id: string, rev: number, input: EmployeeInput, reason = '') =>
    apiClient.patch<{ employee: Employee }>(`/hr/employees/${seg(id)}`, { ...input, rev, reason }, WRITE),
  setOnboardingItem: (id: string, key: string, done: boolean) =>
    apiClient.put<{ employee: Employee }>(`/hr/employees/${seg(id)}/onboarding/${seg(key)}`, { done }, WRITE),

  // ── Settings ──
  getSettings: () => apiClient.get<{ settings: HrSettings }>('/hr/settings'),
  updateSettings: (rev: number, input: HrSettingsInput, reason = '') =>
    apiClient.patch<{ settings: HrSettings }>('/hr/settings', { ...input, rev, reason }, WRITE),

  // ── Attendance ──
  todayBoard: ({ team, cursor }: { team?: string; cursor?: string | null } = {}) =>
    apiClient.get<TodayBoard>(`/hr/attendance/today${qs({ team, cursor, limit: HR_PAGE_SIZE })}`),
  listSites: (cursor?: string | null) => apiClient.get<Page<WorkSite>>(`/hr/sites${qs({ active: 'all', cursor, limit: 50 })}`),
  createSite: (input: Pick<WorkSite, 'name' | 'address' | 'lat' | 'lng' | 'radiusM'>) =>
    apiClient.post<{ site: WorkSite }>('/hr/sites', input, WRITE),
  updateSite: (id: string, rev: number, input: Partial<Pick<WorkSite, 'name' | 'address' | 'lat' | 'lng' | 'radiusM' | 'active'>>) =>
    apiClient.patch<{ site: WorkSite }>(`/hr/sites/${seg(id)}`, { ...input, rev }, WRITE),
  listShifts: (cursor?: string | null) => apiClient.get<Page<Shift>>(`/hr/shifts${qs({ active: 'all', cursor, limit: 50 })}`),
  updateShift: (id: string, rev: number, input: Partial<Pick<Shift,
    'graceMinutes' | 'earlyGraceMinutes' | 'absentBelowMinutes' | 'halfDayMinMinutes' | 'overtimeAfterMinutes'>>, reason = '') =>
    apiClient.patch<{ shift: Shift }>(`/hr/shifts/${seg(id)}`, { ...input, rev, reason }, WRITE),
  updatePolicy: (rev: number, input: PolicySettingsInput, reason = '') =>
    apiClient.patch<{ settings: HrSettings }>('/hr/settings', { ...input, rev, reason }, WRITE),
  /** One employee's month: days + the counts they are paid on (all server-computed). */
  employeeMonth: (id: string, month: string) =>
    apiClient.get<EmployeeMonth>(`/hr/employees/${seg(id)}/attendance${qs({ month })}`),

  // ── Overtime ──
  overtimePending: (cursor?: string | null) =>
    apiClient.get<Page<OvertimeItem>>(`/hr/overtime/pending${qs({ cursor, limit: HR_PAGE_SIZE })}`),
  /**
   * `overtimeMinutes` is the figure HR was shown: the server refuses (409) when
   * the day changed since. `minutes` only on approve, to approve part of it.
   */
  decideOvertime: (dayId: string, decision: OvertimeDecision, overtimeMinutes: number, opts: { minutes?: number; note?: string } = {}) =>
    apiClient.post<{ day: AttendanceDay; replay: boolean }>(
      `/hr/attendance/${seg(dayId)}/overtime/decide`,
      { decision, overtimeMinutes, ...(decision === 'approve' && opts.minutes !== undefined ? { minutes: opts.minutes } : {}), note: opts.note ?? '' },
      WRITE,
    ),

  // ── Leave ──
  leaveInbox: (cursor?: string | null) =>
    apiClient.get<Page<LeaveRequest>>(`/hr/leave/inbox${qs({ cursor, limit: HR_PAGE_SIZE })}`),
  /** A rejection needs a reason (server rule: ≥ 3 characters). `rev` guards against a stale screen. */
  decideLeave: (id: string, decision: LeaveDecision, rev: number, note = '') =>
    apiClient.post<{ request: LeaveRequest; replay?: boolean }>(`/hr/leave/${seg(id)}/decide`, { decision, note, rev }, WRITE),
  employeeBalances: (id: string, year: number) =>
    apiClient.get<Page<LeaveBalance>>(`/hr/employees/${seg(id)}/leave/balances${qs({ year })}`),

  // ── Payroll ──
  /** The month's run with its payslip rows, or null when it isn't prepared yet. */
  payrollRun: runOrNull,
  preparePayroll: (month: string) => apiClient.post<RunWrite & { created: boolean }>(`/hr/payroll/${seg(month)}/prepare`, {}, WRITE),
  recomputePayroll: (month: string, rev: number) => apiClient.post<RunWrite>(`/hr/payroll/${seg(month)}/recompute`, { rev }, WRITE),
  /** Lock = frozen and handed to admin for approval. */
  lockPayroll: (month: string, rev: number) => apiClient.post<RunWrite>(`/hr/payroll/${seg(month)}/lock`, { rev }, WRITE),
  unlockPayroll: (month: string, rev: number, reason: string) =>
    apiClient.post<RunWrite>(`/hr/payroll/${seg(month)}/unlock`, { rev, reason }, WRITE),
  /** Admin only (server-enforced); the server re-checks rev and the inputs fingerprint. */
  approvePayroll: (month: string, rev: number, fingerprint: string) =>
    apiClient.post<RunWrite & { replay: boolean }>(`/hr/payroll/${seg(month)}/approve`, { rev, fingerprint }, WRITE),
  /** Admin only: retry the salary payment requests that are still missing. */
  createPayouts: (month: string) => apiClient.post<{ payouts: unknown }>(`/hr/payroll/${seg(month)}/payouts`, {}, WRITE),
  /** Admin only: back to draft, only while no payment request was raised. */
  reopenPayroll: (month: string, rev: number, reason: string) =>
    apiClient.post<RunWrite>(`/hr/payroll/${seg(month)}/reopen`, { rev, reason }, WRITE),
  payslip: (employeeId: string, id: string) =>
    apiClient.get<{ payslip: Payslip }>(`/hr/employees/${seg(employeeId)}/payslips/${seg(id)}`),

  // ── Salary ──
  salaryRows: (employeeId: string, cursor?: string | null) =>
    apiClient.get<Page<SalaryStructure>>(`/hr/employees/${seg(employeeId)}/salary${qs({ cursor, limit: 20 })}`),
  /** Same month + same figures again → the same row (replay). Different figures → 409. */
  addSalary: (employeeId: string, input: SalaryInput) =>
    apiClient.post<{ structure: SalaryStructure; replay: boolean }>(`/hr/employees/${seg(employeeId)}/salary`, input, WRITE),
};

export type HrApi = typeof hrApi;

/** Opened as a plain link: the browser downloads it with the session cookie. */
export const payslipPdfUrl = (employeeId: string, id: string): string =>
  `/api/v1/hr/employees/${seg(employeeId)}/payslips/${seg(id)}/pdf`;
