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
import type {
  Employee, EmployeeInput, EmployeeListFilter, EmployeeListRow, HrSettings, HrSettingsInput, LeaveBalance,
  LeaveDecision, LeaveRequest, Page, PayrollMonth, PayrollRun, Shift, TodayBoard, WorkSite,
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

  // ── Leave ──
  leaveInbox: (cursor?: string | null) =>
    apiClient.get<Page<LeaveRequest>>(`/hr/leave/inbox${qs({ cursor, limit: HR_PAGE_SIZE })}`),
  /** A rejection needs a reason (server rule: ≥ 3 characters). `rev` guards against a stale screen. */
  decideLeave: (id: string, decision: LeaveDecision, rev: number, note = '') =>
    apiClient.post<{ request: LeaveRequest; replay?: boolean }>(`/hr/leave/${seg(id)}/decide`, { decision, note, rev }, WRITE),
  employeeBalances: (id: string, year: number) =>
    apiClient.get<Page<LeaveBalance>>(`/hr/employees/${seg(id)}/leave/balances${qs({ year })}`),

  // ── Payroll ──
  payrollMonth: (month: string, cursor?: string | null) =>
    apiClient.get<PayrollMonth>(`/hr/payroll/${seg(month)}${qs({ cursor, limit: 50 })}`),
  preparePayroll: (month: string) => apiClient.post<{ run: PayrollRun }>(`/hr/payroll/${seg(month)}/prepare`, {}, WRITE),
  recomputePayroll: (month: string, rev: number) =>
    apiClient.post<{ run: PayrollRun }>(`/hr/payroll/${seg(month)}/recompute`, { rev }, WRITE),
  /** Lock = frozen and handed to admin for approval. */
  lockPayroll: (month: string, rev: number) => apiClient.post<{ run: PayrollRun }>(`/hr/payroll/${seg(month)}/lock`, { rev }, WRITE),
  unlockPayroll: (month: string, rev: number, reason: string) =>
    apiClient.post<{ run: PayrollRun }>(`/hr/payroll/${seg(month)}/unlock`, { rev, reason }, WRITE),
  /** Admin only; the server re-checks the inputs fingerprint taken at lock. */
  approvePayroll: (month: string, rev: number, fingerprint: string) =>
    apiClient.post<{ run: PayrollRun }>(`/hr/payroll/${seg(month)}/approve`, { rev, fingerprint }, WRITE),
  createPayouts: (month: string) => apiClient.post<{ run: PayrollRun }>(`/hr/payroll/${seg(month)}/payouts`, {}, WRITE),
};

export type HrApi = typeof hrApi;
