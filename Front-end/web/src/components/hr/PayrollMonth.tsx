'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Lock, Send, ShieldCheck, RefreshCw } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hrApi } from '@/lib/hr/api';
import { hrKeys } from '@/lib/hr/keys';
import { describeHrError } from '@/lib/hr/errors';
import { currentMonthIST, monthLabel, paise, shiftMonth } from '@/lib/hr/format';
import type { PayrollMonth as PayrollMonthData, PayrollRun, PayslipRow } from '@/lib/hr/types';
import StatusChip from './StatusChip';
import { PersonCell } from './Initials';
import { useHrList } from './useHrList';
import {
  HrEmpty, HrErrorState, HrLoadMore, HrLoading, HrPageHeader, hrBtnGhost, hrBtnPrimary, hrCard, hrField, hrInput, hrTable, hrTd, hrTh,
} from './HrStates';

const STEPS = [
  { key: 'draft', title: '1. Draft', note: 'Numbers update as attendance changes' },
  { key: 'locked', title: '2. Locked', note: 'Frozen and sent to admin for approval' },
  { key: 'approved', title: '3. Approved', note: 'Admin approved, then payouts' },
] as const;

export function PayrollSteps({ status }: { status: PayrollRun['status'] | null }) {
  const at = status ? STEPS.findIndex((s) => s.key === status) : -1;
  return (
    <ol className="mb-4 grid gap-2 sm:grid-cols-3" aria-label="Payroll steps">
      {STEPS.map((s, i) => {
        const state = i < at ? 'done' : i === at ? 'current' : 'todo';
        return (
          <li
            key={s.key}
            aria-current={state === 'current' ? 'step' : undefined}
            className={`rounded-xl border p-3 text-sm ${state === 'current' ? 'border-emerald-600 bg-emerald-50' : state === 'done' ? 'border-emerald-200 bg-white' : 'border-gray-200 bg-white text-gray-500'}`}
          >
            <p className="font-semibold">{s.title}{state === 'done' && ' ✓'}</p>
            <p className="text-xs">{s.note}</p>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The step buttons. Each one waits for the server; the run shown afterwards is
 * the server's. Lock and approve need a second click to confirm.
 */
function RunActions({ month, run, isAdmin }: { month: string; run: PayrollRun | null; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<null | 'lock' | 'approve'>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setError(null); setConfirm(null); setUnlocking(false); setReason('');
      qc.invalidateQueries({ queryKey: hrKeys.payrollMonth(month) });
    },
    onError: (err) => {
      setError(describeHrError(err).message);
      qc.invalidateQueries({ queryKey: hrKeys.payrollMonth(month) });
    },
  });
  const busy = act.isPending;
  const label = monthLabel(month).split(' ')[0];

  let body: React.ReactNode = null;
  if (!run) {
    body = <button type="button" className={hrBtnPrimary} disabled={busy} onClick={() => act.mutate(() => hrApi.preparePayroll(month))}>{busy ? 'Preparing…' : `Prepare ${label}`}</button>;
  } else if (run.status === 'draft') {
    body = confirm === 'lock' ? (
      <>
        <span className="text-sm text-gray-700">Lock {label} and send it to admin? Numbers stop changing.</span>
        <button type="button" className={hrBtnPrimary} disabled={busy} onClick={() => act.mutate(() => hrApi.lockPayroll(month, run.rev))}>{busy ? 'Locking…' : 'Yes, lock and send'}</button>
        <button type="button" className={hrBtnGhost} disabled={busy} onClick={() => setConfirm(null)}>Not yet</button>
      </>
    ) : (
      <>
        <button type="button" className={hrBtnGhost} disabled={busy} onClick={() => act.mutate(() => hrApi.recomputePayroll(month, run.rev))}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Recalculate</button>
        <button type="button" className={hrBtnPrimary} disabled={busy} onClick={() => setConfirm('lock')}><Lock className="h-4 w-4" aria-hidden="true" /> Check and lock {label}</button>
      </>
    );
  } else if (run.status === 'locked') {
    body = isAdmin && confirm === 'approve' ? (
      <>
        <span className="text-sm text-gray-700">Approve {label} payroll of {paise(run.totals.netPaise)}?</span>
        <button type="button" className={hrBtnPrimary} disabled={busy} onClick={() => act.mutate(() => hrApi.approvePayroll(month, run.rev, run.inputsFingerprint || ''))}>{busy ? 'Approving…' : 'Yes, approve'}</button>
        <button type="button" className={hrBtnGhost} disabled={busy} onClick={() => setConfirm(null)}>Not yet</button>
      </>
    ) : unlocking ? (
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (reason.trim().length < 3) { setError('Say why it is being unlocked.'); return; } act.mutate(() => hrApi.unlockPayroll(month, run.rev, reason.trim())); }}>
        <label className="sr-only" htmlFor="unlock-reason">Reason for unlocking</label>
        <input id="unlock-reason" className={`${hrField} w-64`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why unlock? (logged)" disabled={busy} />
        <button type="submit" className={hrBtnPrimary} disabled={busy}>{busy ? 'Unlocking…' : 'Unlock'}</button>
        <button type="button" className={hrBtnGhost} disabled={busy} onClick={() => setUnlocking(false)}>Back</button>
      </form>
    ) : (
      <>
        <StatusChip tone="info">Sent to admin for approval</StatusChip>
        <button type="button" className={hrBtnGhost} disabled={busy} onClick={() => setUnlocking(true)}>Unlock</button>
        {isAdmin && <button type="button" className={hrBtnPrimary} disabled={busy} onClick={() => setConfirm('approve')}><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Approve</button>}
      </>
    );
  } else if (run.payoutsCreatedAt) {
    body = <StatusChip tone="ok">Approved · payouts are in Payments</StatusChip>;
  } else {
    body = <button type="button" className={hrBtnPrimary} disabled={busy} onClick={() => act.mutate(() => hrApi.createPayouts(month))}><Send className="h-4 w-4" aria-hidden="true" /> {busy ? 'Sending…' : 'Send payouts to Payments'}</button>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">{body}</div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

/**
 * `isAdmin` comes from the server layout's session check (not the client auth
 * context, which added ~85 kB to this page). It only decides whether the Approve
 * button shows; the API refuses approval from anyone but admin regardless.
 */
export default function PayrollMonth({ isAdmin = false }: { isAdmin?: boolean }) {
  const [month, setMonth] = useState(() => currentMonthIST());
  const list = useHrList<PayslipRow, PayrollMonthData>(hrKeys.payrollMonth(month), (cursor) => hrApi.payrollMonth(month, cursor));
  const run = list.first?.run ?? null;

  return (
    <div className="max-w-6xl">
      <HrPageHeader
        title={`Payroll · ${monthLabel(month)}`}
        actions={(
          <div className="flex items-center gap-1">
            <button type="button" className={hrBtnGhost} aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" className={hrBtnGhost} aria-label="Next month" disabled={month >= currentMonthIST()} onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        )}
      />

      {list.isError ? <HrErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isPending ? <HrLoading /> : (
        <>
          <PayrollSteps status={run?.status ?? null} />
          <div className="mb-4 flex justify-end"><RunActions month={month} run={run} isAdmin={isAdmin} /></div>
          {run?.changedAfterLock && (
            <p role="status" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Attendance or leave changed after this month was locked. The difference is paid as arrears next month.</p>
          )}
          {run && (
            <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Total take-home', paise(run.totals.netPaise)],
                ['Gross', paise(run.totals.grossPaise)],
                ['Deductions', paise(run.totals.deductionsPaise)],
                ['Payslips', String(run.employeeCount)],
              ].map(([label, value]) => (
                <div key={label} className={`${hrCard} p-4`}>
                  <dd className="text-xl font-bold text-gray-900">{value}</dd>
                  <dt className="text-xs font-medium text-gray-500">{label}</dt>
                </div>
              ))}
            </dl>
          )}
          {!run ? (
            <HrEmpty title={`${monthLabel(month)} isn't prepared yet`}>Prepare it to see each person&rsquo;s pay. Nothing is paid until admin approves.</HrEmpty>
          ) : !list.rows.length ? (
            <HrEmpty title="No payslips in this run" />
          ) : (
            <div className={`${hrCard} overflow-x-auto`}>
              <table className={hrTable}>
                <thead>
                  <tr>
                    <th className={hrTh}>Employee</th><th className={hrTh}>Paid days</th><th className={`${hrTh} text-right`}>Gross</th>
                    <th className={`${hrTh} text-right`}>Deductions</th><th className={`${hrTh} text-right`}>Take-home</th><th className={hrTh}>Check</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((p) => (
                    <tr key={p.id}>
                      <td className={hrTd}><PersonCell name={p.snapshot.name} sub={p.snapshot.employeeCode} /></td>
                      <td className={hrTd}>{p.attendance.paidDays} / {p.attendance.daysInMonth}</td>
                      <td className={`${hrTd} text-right tabular-nums`}>{paise(p.grossPaise)}</td>
                      <td className={`${hrTd} text-right tabular-nums`}>{paise(p.deductionsPaise)}</td>
                      <td className={`${hrTd} text-right font-semibold tabular-nums`}>{paise(p.netPaise)}</td>
                      <td className={hrTd}>{p.notes?.length ? <StatusChip tone="warn">{p.notes.join(' · ')}</StatusChip> : <StatusChip tone="ok">OK</StatusChip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <HrLoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
            </div>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-gray-500">The server works out every number. HR can add a one-off bonus or deduction with a reason; each change is logged.</p>
    </div>
  );
}
