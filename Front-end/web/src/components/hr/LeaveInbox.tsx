'use client';

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hrApi } from '@/lib/hr/api';
import { hrKeys } from '@/lib/hr/keys';
import { describeHrError } from '@/lib/hr/errors';
import { halfDaysLabel, leaveWhen } from '@/lib/hr/format';
import type { LeaveDecision, LeaveRequest } from '@/lib/hr/types';
import StatusChip from './StatusChip';
import { PersonCell } from './Initials';
import { useHrList } from './useHrList';
import {
  HrEmpty, HrErrorState, HrLoadMore, HrLoading, HrPageHeader, hrBtnDanger, hrBtnGhost, hrBtnPrimary, hrCard, hrInput, hrTable, hrTd, hrTh,
} from './HrStates';

const MIN_REASON = 3;

type Decided = { decision: LeaveDecision; request: LeaveRequest };

/**
 * One request's decision cell. Nothing is optimistic: the buttons lock while the
 * server decides, and the row says "Approved"/"Rejected" only once it answered.
 */
export function DecisionCell({ request, decided, onDecided }: {
  request: LeaveRequest;
  decided?: Decided;
  onDecided: (d: Decided) => void;
}) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: ({ decision, note }: { decision: LeaveDecision; note: string }) => hrApi.decideLeave(request.id, decision, request.rev, note),
    onSuccess: (res, vars) => {
      setError(null);
      onDecided({ decision: vars.decision, request: res.request });
      // Balances moved on the server; refresh anything that shows them, and the badge.
      qc.invalidateQueries({ queryKey: hrKeys.employees() });
      qc.invalidateQueries({ queryKey: hrKeys.leaveBadge() });
    },
    onError: (err) => {
      const view = describeHrError(err);
      setError(view.message);
      // Someone else decided first, or it was cancelled: reload the inbox.
      if (view.kind === 'conflict' || view.kind === 'notFound') qc.invalidateQueries({ queryKey: hrKeys.leaveInbox() });
    },
  });

  if (decided) {
    const s = decided.request.status;
    const label = decided.decision === 'rejected' ? 'Rejected' : s === 'approved' ? 'Approved' : 'Approved · next step';
    return <StatusChip tone={decided.decision === 'rejected' ? 'bad' : 'ok'}>{label}</StatusChip>;
  }

  const busy = decide.isPending;
  return (
    <div className="min-w-[13rem] space-y-2">
      {rejecting ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length < MIN_REASON) { setError('Please write why, so the employee knows.'); return; }
            decide.mutate({ decision: 'rejected', note: reason.trim() });
          }}
          className="space-y-2"
        >
          <label className="sr-only" htmlFor={`reason-${request.id}`}>Reason for rejecting</label>
          <input
            id={`reason-${request.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
            placeholder="Reason (the employee sees this)" className={hrInput} disabled={busy} autoFocus
          />
          <div className="flex gap-2">
            <button type="submit" className={hrBtnDanger} disabled={busy}>{busy ? 'Rejecting…' : 'Reject leave'}</button>
            <button type="button" className={hrBtnGhost} disabled={busy} onClick={() => { setRejecting(false); setError(null); }}>Back</button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <button type="button" className={hrBtnGhost} disabled={busy} onClick={() => setRejecting(true)}>
            <X className="h-4 w-4" aria-hidden="true" /> Reject
          </button>
          <button type="button" className={hrBtnPrimary} disabled={busy} onClick={() => decide.mutate({ decision: 'approved', note: '' })}>
            <Check className="h-4 w-4" aria-hidden="true" /> {busy ? 'Approving…' : 'Approve'}
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

export default function LeaveInbox() {
  const list = useHrList<LeaveRequest>(hrKeys.leaveInbox(), (cursor) => hrApi.leaveInbox(cursor));
  const [decided, setDecided] = useState<Record<string, Decided>>({});

  return (
    <div className="max-w-6xl">
      <HrPageHeader title="Leave requests" sub="Waiting for HR. Oldest first." />
      {list.isError ? <HrErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isPending ? <HrLoading /> : !list.rows.length ? (
        <HrEmpty title="Nothing waiting">New leave requests from the Autobacs Team app arrive here.</HrEmpty>
      ) : (
        <div className={`${hrCard} overflow-x-auto`}>
          <table className={hrTable}>
            <thead>
              <tr>
                <th className={hrTh}>Employee</th><th className={hrTh}>Type</th><th className={hrTh}>When</th>
                <th className={hrTh}>Days</th><th className={hrTh}>Reason</th><th className={hrTh}>Decision</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id}>
                  <td className={hrTd}><PersonCell name={r.employeeName || 'Employee'} sub={r.employeeCode} /></td>
                  <td className={hrTd}>
                    {r.leaveTypeName || r.leaveTypeCode || 'Leave'}
                    {!r.paid && <span className="ml-1"><StatusChip tone="warn">Unpaid</StatusChip></span>}
                  </td>
                  <td className={hrTd}>{leaveWhen(r)}</td>
                  <td className={hrTd}>{halfDaysLabel(r.halfDays)}</td>
                  <td className={`${hrTd} max-w-xs`}><span className="line-clamp-2">{r.reason || '—'}</span></td>
                  <td className={hrTd}>
                    <DecisionCell request={r} decided={decided[r.id]} onDecided={(d) => setDecided((p) => ({ ...p, [r.id]: d }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <HrLoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500">Approving takes the days off their balance straight away. Rejecting needs a reason, which the employee sees in the app.</p>
    </div>
  );
}
