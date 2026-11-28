/**
 * TanStack Query keys for the HR panel. Kept here rather than in
 * hooks/queries/keys.ts because this session owns only lib/hr/** (ADR §3); the
 * shape follows that factory (prefix → list → params) so invalidating a prefix
 * refreshes every variant. Move it into keys.ts when the HR work lands.
 */
import { normalizeParams } from '@/hooks/queries/keys';

type Params = Record<string, string | undefined>;

export const hrKeys = {
  all: ['hr'] as const,
  employees: () => [...hrKeys.all, 'employees'] as const,
  employeeList: (p: Params) => [...hrKeys.employees(), 'list', normalizeParams(p)] as const,
  employee: (id: string) => [...hrKeys.employees(), 'detail', id] as const,
  balances: (id: string, year: number) => [...hrKeys.employees(), 'balances', id, year] as const,
  today: (p: Params) => [...hrKeys.all, 'today', normalizeParams(p)] as const,
  leave: () => [...hrKeys.all, 'leave'] as const,
  /** The paged inbox (useInfiniteQuery: { pages }). */
  leaveInbox: () => [...hrKeys.leave(), 'inbox'] as const,
  /** The sidebar badge (useQuery: one page). A separate key: a query and an
   *  infinite query must never share one, their cached shapes differ. */
  leaveBadge: () => [...hrKeys.leave(), 'badge'] as const,
  payroll: () => [...hrKeys.all, 'payroll'] as const,
  payrollMonth: (month: string) => [...hrKeys.payroll(), month] as const,
  payslip: (id: string) => [...hrKeys.payroll(), 'payslip', id] as const,
  salary: (employeeId: string) => [...hrKeys.employees(), 'salary', employeeId] as const,
  overtime: () => [...hrKeys.all, 'overtime'] as const,
  /** Paged list of employees for the report (useInfiniteQuery). */
  reportPeople: (month: string) => [...hrKeys.all, 'report', month, 'people'] as const,
  employeeMonth: (id: string, month: string) => [...hrKeys.employees(), 'month', id, month] as const,
  sites: () => [...hrKeys.all, 'sites'] as const,
  shifts: () => [...hrKeys.all, 'shifts'] as const,
  settings: () => [...hrKeys.all, 'settings'] as const,
};
