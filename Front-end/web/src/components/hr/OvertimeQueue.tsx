'use client';

import { useState, type FormEvent } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hrApi } from '@/lib/hr/api';
import { hrKeys } from '@/lib/hr/keys';
import { describeHrError } from '@/lib/hr/errors';
import { dayLabel, minutesLabel, timeLabel } from '@/lib/hr/format';
import type { OvertimeDecision, OvertimeItem } from '@/lib/hr/types';
import { PersonCell } from './Initials';
import { teamLabel } from './EmployeesList';
import { useHrList } from './useHrList';
import {
  HrEmpty, HrErrorState, HrLoadMore, HrLoading, HrPageHeader, hrBtnDanger, hrBtnGhost, hrBtnPrimary, hrCard, hrField, hrTable, hrTd, hrTh,
} from './HrStates';

type Mode = null | 'edit' | 'reject';
type Vars = { decision: OvertimeDecision; minutes?: number; note?: string };

/**
 * One waiting day. Nothing changes on screen until the server answers: the row
 * leaves the queue only when the list is re-read after a confirmed decision.
 * The overtime minutes HR saw go with the request, so a day that changed in
 * between is refused (409) rather than decided on old numbers.
 */
function OvertimeRow({ item }: { item: OvertimeItem }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>(null);
  const [minutes, setMinutes] = useState(String(item.day.overtimeMinutes));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (v: Vars) => hrApi.decideOvertime(item.id, v.decision, item.day.overtimeMinutes, { minutes: v.minutes, note: v.note }),
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: hrKeys.overtime() }); },
    onError: (err) => {
      const v = describeHrError(err);
      setError(v.message);
      if (v.kind === 'conflict' || v.kind === 'notFound') qc.invalidateQueries({ queryKey: hrKeys.overtime() });
    },
  });
  const busy = decide.isPending;
  const max = item.day.overtimeMinutes;

  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    const m = Number(minutes);
    if (!Number.isInteger(m) || m < 1 || m > max) { setError(`Enter whole minutes from 1 to ${max}. To pay none, reject instead.`); return; }
    setError(null);
    decide.mutate({ decision: 'approve', minutes: m, note: note.trim() });
  };
  const submitReject = (e: FormEvent) => {
    e.preventDefault();
    if (note.trim().length < 3) { setError('Say why it is rejected (the employee sees this).'); return; }
    setError(null);
    decide.mutate({ decision: 'reject', note: note.trim() });
  };

  const e = item.employee;
  const d = item.day;
  return (
    <tr>
      <td className={hrTd}><PersonCell name={e.name} sub={[e.employeeCode, teamLabel(e.team)].filter(Boolean).join(' · ')} /></td>
      <td className={hrTd}>{dayLabel(d.date)}</td>
      <td className={`${hrTd} whitespace-nowrap`}>{timeLabel(d.firstIn)} – {timeLabel(d.lastOut)}</td>
      <td className={`${hrTd} tabular-nums`}>{minutesLabel(d.workedMinutes)}</td>
      <td className={`${hrTd} font-semibold tabular-nums`}>{minutesLabel(d.overtimeMinutes)}</td>
      <td className={hrTd}>
        {mode === 'edit' ? (
          <form noValidate onSubmit={submitEdit} className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`ot-min-${item.id}`}>Minutes to approve</label>
            <input id={`ot-min-${item.id}`} type="number" min={1} max={max} value={minutes} onChange={(ev) => setMinutes(ev.target.value)} className={`${hrField} w-24`} disabled={busy} />
            <span className="text-xs text-gray-500">of {max} min</span>
            <label className="sr-only" htmlFor={`ot-note-${item.id}`}>Note</label>
            <input id={`ot-note-${item.id}`} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Note (optional)" className={`${hrField} w-40`} disabled={busy} />
            <button type="submit" className={hrBtnPrimary} disabled={busy}>{busy ? 'Saving…' : 'Approve these minutes'}</button>
            <button type="button" className={hrBtnGhost} disabled={busy} onClick={() => { setMode(null); setError(null); }}>Back</button>
          </form>
        ) : mode === 'reject' ? (
          <form noValidate onSubmit={submitReject} className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`ot-why-${item.id}`}>Reason for rejecting</label>
            <input id={`ot-why-${item.id}`} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Why? (employee sees this)" className={`${hrField} w-56`} disabled={busy} />
            <button type="submit" className={hrBtnDanger} disabled={busy}>{busy ? 'Saving…' : 'Reject overtime'}</button>
            <button type="button" className={hrBtnGhost} disabled={busy} onClick={() => { setMode(null); setError(null); }}>Back</button>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={hrBtnPrimary} disabled={busy} onClick={() => decide.mutate({ decision: 'approve' })}>
              <Check className="h-4 w-4" aria-hidden="true" /> {busy ? 'Approving…' : 'Approve'}
            </button>
            <button type="button" className={hrBtnGhost} disabled={busy} onClick={() => setMode('edit')}><Pencil className="h-4 w-4" aria-hidden="true" /> Edit minutes</button>
            <button type="button" className={hrBtnDanger} disabled={busy} onClick={() => setMode('reject')}><X className="h-4 w-4" aria-hidden="true" /> Reject</button>
          </div>
        )}
        {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
      </td>
    </tr>
  );
}

export default function OvertimeQueue() {
  const list = useHrList<OvertimeItem>(hrKeys.overtime(), (cursor) => hrApi.overtimePending(cursor));
  return (
    <div className="max-w-6xl">
      <HrPageHeader title="Overtime approvals" sub="Overtime is paid only after it is approved. Oldest first." />
      {list.isError ? <HrErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isPending ? <HrLoading /> : !list.rows.length ? (
        <HrEmpty title="No overtime waiting">New overtime shows here after a day is closed.</HrEmpty>
      ) : (
        <div className={`${hrCard} overflow-x-auto`}>
          <table className={`${hrTable} min-w-[860px]`}>
            <thead>
              <tr>
                <th className={hrTh}>Employee</th><th className={hrTh}>Day</th><th className={hrTh}>In – out</th>
                <th className={hrTh}>Worked</th><th className={hrTh}>Overtime</th><th className={hrTh}>Decision</th>
              </tr>
            </thead>
            <tbody>{list.rows.map((item) => <OvertimeRow key={`${item.id}:${item.day.overtimeMinutes}`} item={item} />)}</tbody>
          </table>
          <HrLoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500">Approving pays the minutes at the overtime rate in that month&rsquo;s payroll. A locked month cannot be changed here.</p>
    </div>
  );
}
