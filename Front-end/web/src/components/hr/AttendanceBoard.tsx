'use client';

import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { hrApi } from '@/lib/hr/api';
import { hrKeys } from '@/lib/hr/keys';
import { dayLabel, minutesLabel, timeLabel } from '@/lib/hr/format';
import type { TodayRow, TodayBoard } from '@/lib/hr/types';
import { STAFF_TEAM_OPTIONS } from '@/lib/staffTeams';
import StatusChip, { type ChipTone } from './StatusChip';
import { PersonCell } from './Initials';
import { useHrList } from './useHrList';
import {
  HrEmpty, HrErrorState, HrLoadMore, HrLoading, HrPageHeader, hrBtnGhost, hrCard, hrInput, hrTable, hrTd, hrTh,
} from './HrStates';

export type BoardFilter = 'all' | 'late' | 'absent' | 'review';

/** One status chip per row, from the server's day record. */
export function rowStatus(row: TodayRow): { label: string; tone: ChipTone } {
  const d = row.day;
  if (!d) return { label: 'Not in yet', tone: 'muted' };
  if (d.needsReview) return { label: 'Needs review', tone: 'warn' };
  switch (d.status) {
    case 'leave': return { label: 'On leave', tone: 'info' };
    case 'half_leave': return { label: 'Half-day leave', tone: 'info' };
    case 'holiday': return { label: 'Holiday', tone: 'muted' };
    case 'weekly_off': return { label: 'Weekly off', tone: 'muted' };
    case 'absent': return { label: 'Absent', tone: 'bad' };
    default:
      if (d.isLate) return { label: `Late ${d.lateMinutes}m`, tone: 'warn' };
      return { label: row.state === 'out' ? 'Clocked out' : 'Present', tone: 'ok' };
  }
}

const matches = (row: TodayRow, f: BoardFilter): boolean => {
  if (f === 'late') return !!row.day?.isLate;
  if (f === 'absent') return !row.day || row.day.status === 'absent';
  if (f === 'review') return !!row.day?.needsReview;
  return true;
};

const FILTERS: { key: BoardFilter; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'late', label: 'Late' },
  { key: 'absent', label: 'Not in / absent' },
  { key: 'review', label: 'Needs review' },
];

export default function AttendanceBoard() {
  const [team, setTeam] = useState('');
  const [filter, setFilter] = useState<BoardFilter>('all');
  const list = useHrList<TodayRow, TodayBoard>(hrKeys.today({ team }), (cursor) => hrApi.todayBoard({ team: team || undefined, cursor }));

  const stats = useMemo(() => {
    const s = { present: 0, late: 0, leave: 0, review: 0, notIn: 0 };
    for (const r of list.rows) {
      const d = r.day;
      if (!d) { s.notIn += 1; continue; }
      if (d.needsReview) s.review += 1;
      if (d.status === 'leave' || d.status === 'half_leave') s.leave += 1;
      else if (d.status === 'present' || d.status === 'half_day' || d.status === 'holiday_worked') s.present += 1;
      if (d.isLate) s.late += 1;
    }
    return s;
  }, [list.rows]);
  const shown = list.rows.filter((r) => matches(r, filter));

  return (
    <div className="max-w-6xl">
      <HrPageHeader
        title="Today's attendance"
        sub={list.first?.date ? `Today · ${dayLabel(list.first.date)}` : 'Today'}
        actions={(
          <>
            <label className="sr-only" htmlFor="hr-team">Team</label>
            <select id="hr-team" value={team} onChange={(e) => setTeam(e.target.value)} className={`${hrInput} w-auto`}>
              <option value="">All teams</option>
              {STAFF_TEAM_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <button type="button" className={hrBtnGhost} onClick={() => list.refetch()} disabled={list.isFetching}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
            </button>
          </>
        )}
      />

      {list.isError ? <HrErrorState error={list.error} onRetry={() => list.refetch()} /> : (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Present', stats.present, 'text-emerald-700'],
              ['Late', stats.late, 'text-amber-700'],
              ['On leave', stats.leave, 'text-sky-700'],
              ['Needs review', stats.review, 'text-red-700'],
            ].map(([label, value, cls]) => (
              <div key={label as string} className={`${hrCard} p-4`}>
                <dd className={`text-2xl font-bold ${cls}`}>{value as number}</dd>
                <dt className="text-xs font-medium text-gray-500">{label as string}</dt>
              </div>
            ))}
          </dl>
          {list.hasNextPage && <p className="mb-2 text-xs text-gray-500">Counts cover the people loaded so far — load more to include everyone.</p>}

          <div role="tablist" aria-label="Filter" className="mb-3 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3 py-1 text-sm font-semibold ${filter === f.key ? 'bg-emerald-700 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-300'}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {list.isPending ? <HrLoading /> : !list.rows.length ? (
            <HrEmpty title="No employees yet">Add people under Employees and they will show here each day.</HrEmpty>
          ) : (
            <div className={`${hrCard} overflow-x-auto`}>
              <table className={hrTable}>
                <thead>
                  <tr>
                    <th className={hrTh}>Employee</th><th className={hrTh}>In</th><th className={hrTh}>Out</th>
                    <th className={hrTh}>Status</th><th className={hrTh}>Worked</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const st = rowStatus(r);
                    return (
                      <tr key={r.employee.id}>
                        <td className={hrTd}><PersonCell name={r.employee.name} sub={[r.employee.designation, r.employee.employeeCode].filter(Boolean).join(' · ')} /></td>
                        <td className={hrTd}>{r.day?.firstIn ? timeLabel(r.day.firstIn) : '—'}</td>
                        <td className={hrTd}>{r.day?.lastOut ? timeLabel(r.day.lastOut) : '—'}{r.day?.autoClosed ? ' (auto)' : ''}</td>
                        <td className={hrTd}><StatusChip tone={st.tone}>{st.label}</StatusChip></td>
                        <td className={hrTd}>{r.day?.workedMinutes ? minutesLabel(r.day.workedMinutes) : '—'}</td>
                      </tr>
                    );
                  })}
                  {!shown.length && (
                    <tr><td colSpan={5} className={`${hrTd} text-center text-gray-500`}>Nobody matches this filter.</td></tr>
                  )}
                </tbody>
              </table>
              <HrLoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
            </div>
          )}
          <p className="mt-3 text-xs text-gray-500">
            &ldquo;Needs review&rdquo; means the face didn&rsquo;t match well. HR sees the photo for that one punch and says yes or no. The photo is deleted after 30 days.
          </p>
        </>
      )}
    </div>
  );
}
