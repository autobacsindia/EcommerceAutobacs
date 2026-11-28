'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useQueries } from '@tanstack/react-query';
import { hrApi } from '@/lib/hr/api';
import { hrKeys } from '@/lib/hr/keys';
import { describeHrError } from '@/lib/hr/errors';
import { currentMonthIST, daysLabel, minutesLabel, monthLabel, shiftMonth } from '@/lib/hr/format';
import { downloadCsv, toCsv } from '@/lib/hr/csv';
import type { EmployeeListRow, MonthSummary } from '@/lib/hr/types';
import { PersonCell } from './Initials';
import { teamLabel } from './EmployeesList';
import { useHrList } from './useHrList';
import {
  HrEmpty, HrErrorState, HrLoadMore, HrLoading, HrPageHeader, hrBtnGhost, hrCard, hrTable, hrTd, hrTh,
} from './HrStates';

const COLUMNS = ['Late', 'Early', 'Marks', 'Marks cut', 'OT approved', 'Absent'] as const;

const cells = (s: MonthSummary) => [
  String(s.lateCount ?? 0),
  String(s.earlyCount ?? 0),
  String(s.marks ?? 0),
  (s.marksLopDays ?? 0) > 0 ? daysLabel(s.marksLopDays) : '—',
  (s.otApprovedMinutes ?? 0) > 0 ? minutesLabel(s.otApprovedMinutes) : '—',
  (s.absentDays ?? 0) > 0 ? daysLabel(s.absentDays) : '—',
];

/**
 * Late / early report for one month. Each person's counts come from the same
 * server summary payroll is paid on (GET /hr/employees/:id/attendance?month).
 * The list pages through employees 25 at a time, so a page is at most 25 small
 * reads, fetched in parallel and cached per person and month.
 */
export default function LateEarlyReport() {
  const [month, setMonth] = useState(() => currentMonthIST());
  const people = useHrList<EmployeeListRow>(hrKeys.reportPeople(month), (cursor) => hrApi.listEmployees({ status: 'all', cursor }));
  const rows = people.rows;
  const months = useQueries({
    queries: rows.map((p) => ({
      queryKey: hrKeys.employeeMonth(p.id, month),
      queryFn: () => hrApi.employeeMonth(p.id, month),
      retry: false,
      staleTime: 60_000,
    })),
  });

  const ready = rows.length > 0 && months.every((q) => q.isSuccess || q.isError);
  const exportCsv = () => {
    const header = ['Employee', 'Code', 'Team', 'Late', 'Early', 'Marks', 'Marks cut (days)', 'OT approved (min)', 'Absent (days)'];
    const data = rows.map((p, i) => {
      const s = months[i]?.data?.summary;
      if (!s) return [p.name, p.employeeCode, teamLabel(p.team), 'not loaded', '', '', '', '', ''];
      return [p.name, p.employeeCode, teamLabel(p.team), s.lateCount ?? 0, s.earlyCount ?? 0, s.marks ?? 0, s.marksLopDays ?? 0, s.otApprovedMinutes ?? 0, s.absentDays ?? 0];
    });
    downloadCsv(`late-early-${month}.csv`, toCsv(header, data));
  };

  return (
    <div className="max-w-6xl">
      <HrPageHeader
        title={`Late & early · ${monthLabel(month)}`}
        sub="Late or leaving early = 1 mark. Marks cut salary in steps; payroll shows the rupees."
        actions={(
          <>
            <button type="button" className={hrBtnGhost} aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" className={hrBtnGhost} aria-label="Next month" disabled={month >= currentMonthIST()} onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" className={hrBtnGhost} disabled={!ready} onClick={exportCsv}><Download className="h-4 w-4" aria-hidden="true" /> Download CSV</button>
          </>
        )}
      />
      {people.isError ? <HrErrorState error={people.error} onRetry={() => people.refetch()} /> : people.isPending ? <HrLoading /> : !rows.length ? (
        <HrEmpty title="No employees yet">Add employees to see their late and early counts.</HrEmpty>
      ) : (
        <div className={`${hrCard} overflow-x-auto`}>
          <table className={`${hrTable} min-w-[820px]`}>
            <thead>
              <tr>
                <th className={hrTh}>Employee</th>
                {COLUMNS.map((c) => <th key={c} className={`${hrTh} text-right`}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const q = months[i];
                return (
                  <tr key={p.id}>
                    <td className={hrTd}><PersonCell name={p.name} sub={[p.employeeCode, teamLabel(p.team)].filter(Boolean).join(' · ')} /></td>
                    {q?.isSuccess ? cells(q.data.summary).map((v, j) => (
                      <td key={COLUMNS[j]} className={`${hrTd} text-right tabular-nums`}>{v}</td>
                    )) : (
                      <td colSpan={COLUMNS.length} className={`${hrTd} text-right text-xs ${q?.isError ? 'text-amber-800' : 'text-gray-500'}`}>
                        {q?.isError ? describeHrError(q.error).title : 'Loading…'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <HrLoadMore hasMore={!!people.hasNextPage} loading={people.isFetchingNextPage} onClick={() => people.fetchNextPage()} />
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500">Absent counts days without approved leave. OT shows approved overtime only; waiting overtime is in Overtime approvals.</p>
    </div>
  );
}
