'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileDown, Lock, RefreshCw, RotateCcw, Send, ShieldCheck } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hrApi, payslipPdfUrl } from '@/lib/hr/api';
import { hrKeys } from '@/lib/hr/keys';
import { describeHrError } from '@/lib/hr/errors';
import { currentMonthIST, monthLabel, paise, shiftMonth } from '@/lib/hr/format';
import type { PayrollRun, PayslipLine, PayslipRow } from '@/lib/hr/types';
import StatusChip from './StatusChip';
import { PersonCell } from './Initials';
import {
  HrEmpty, HrErrorState, HrLoading, HrPageHeader, hrBtnGhost, hrBtnPrimary, hrCard, hrField, hrTable, hrTd, hrTh,
} from './HrStates';

const STEPS = [
  { key: 'draft', title: '1. Draft', note: 'HR checks it. Recalculate after attendance changes' },
  { key: 'locked', title: '2. Locked', note: 'Frozen and sent to admin for approval' },
  { key: 'approved', title: '3. Approved', note: 'Payslips released, salary payments raised' },
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

/** A reason box (unlock / re-open): the reason is logged with the action. */
function ReasonForm({ id, label, busy, cta, onSubmit, onBack, onInvalid }: {
  id: string; label: string; busy: boolean; cta: string; onSubmit: (reason: string) => void; onBack: () => void; onInvalid: (m: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); if (reason.trim().length < 3) { onInvalid('Say why (it is logged).'); return; } onSubmit(reason.trim()); }}
    >
      <label className="sr-only" htmlFor={id}>{label}</label>
      <input id={id} className={`${hrField} w-64`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`${label} (logged)`} disabled={busy} />
      <button type="submit" className={hrBtnPrimary} disabled={busy}>{busy ? 'Saving…' : cta}</button>
      <button type="button" className={hrBtnGhost} disabled={busy} onClick={onBack}>Back</button>
    </form>
  );
}

/**
 * The step buttons. Each one waits for the server and the screen then shows the
 * server's run. Lock and approve need a second click. Approve, payouts and
 * re-open are shown to admins only; the server refuses them for anyone else.
 */
function RunActions({ month, run, isAdmin, monthEnded }: { month: string; run: PayrollRun | null; isAdmin: boolean; monthEnded: boolean }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<null | 'lock' | 'approve' | 'unlock' | 'reopen'>(null);
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setError(null); setMode(null); qc.invalidateQueries({ queryKey: hrKeys.payrollMonth(month) }); },
    onError: (err) => { setError(describeHrError(err).message); qc.invalidateQueries({ queryKey: hrKeys.payrollMonth(month) }); },
  });
  const busy = act.isPending;
  const name = monthLabel(month).split(' ')[0];
  const back = () => { setMode(null); setError(null); };

  let body: ReactNode = null;
  if (!run) {
    body = monthEnded
      ? <button type="button" className={hrBtnPrimary} disabled={busy} onClick={() => act.mutate(() => hrApi.preparePayroll(month))}>{busy ? 'Preparing…' : `Prepare ${name}`}</button>
      : <StatusChip tone="muted">Payroll runs after the month ends</StatusChip>;
  } else if (run.status === 'draft') {
    body = mode === 'lock' ? (
      <>
        <span className="text-sm text-gray-700">Lock {name} and send it to admin? Numbers stop changing.</span>
        <button type="button" className={hrBtnPrimary} disabled={busy} onClick={() => act.mutate(() => hrApi.lockPayroll(month, run.rev))}>{busy ? 'Locking…' : 'Yes, lock and send'}</button>
        <button type="button" className={hrBtnGhost} disabled={busy} onClick={back}>Not yet</button>
      </>
    ) : (
      <>
        <button type="button" className={hrBtnGhost} disabled={busy} onClick={() => act.mutate(() => hrApi.recomputePayroll(month, run.rev))}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> {busy ? 'Recalculating…' : 'Recalculate'}
        </button>
        <button type="button" className={hrBtnPrimary} disabled={busy || run.blockedCount > 0 || !run.employeeCount} onClick={() => setMode('lock')}>
          <Lock className="h-4 w-4" aria-hidden="true" /> Check and lock {name}
        </button>
      </>
    );
  } else if (run.status === 'locked') {
    if (mode === 'approve' && isAdmin) {
      body = (
        <>
          <span className="text-sm text-gray-700">Approve {name} payroll, take-home {paise(run.totals.netPaise)}? Payslips are released and salary payments raised.</span>
          <button type="button" className={hrBtnPrimary} disabled={busy} onClick={() => act.mutate(() => hrApi.approvePayroll(month, run.rev, run.fingerprint))}>{busy ? 'Approving…' : 'Yes, approve'}</button>
          <button type="button" className={hrBtnGhost} disabled={busy} onClick={back}>Not yet</button>
        </>
      );
    } else if (mode === 'unlock') {
      body = <ReasonForm id="unlock-reason" label="Why unlock?" cta="Unlock" busy={busy} onBack={back} onInvalid={setError} onSubmit={(r) => act.mutate(() => hrApi.unlockPayroll(month, run.rev, r))} />;
    } else {
      body = (
        <>
          <StatusChip tone="info">Sent to admin for approval</StatusChip>
          <button type="button" className={hrBtnGhost} disabled={busy} onClick={() => setMode('unlock')}>Unlock</button>
          {isAdmin && <button type="button" className={hrBtnPrimary} disabled={busy} onClick={() => setMode('approve')}><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Approve</button>}
        </>
      );
    }
  } else if (mode === 'reopen' && isAdmin) {
    body = <ReasonForm id="reopen-reason" label="Why re-open?" cta="Re-open" busy={busy} onBack={back} onInvalid={setError} onSubmit={(r) => act.mutate(() => hrApi.reopenPayroll(month, run.rev, r))} />;
  } else {
    const missing = run.payoutsCount < run.employeeCount;
    body = (
      <>
        <StatusChip tone={missing ? 'warn' : 'ok'}>
          {missing ? `Approved · ${run.payoutsCount} of ${run.employeeCount} salary payments raised` : 'Approved · salary payments are in Payments'}
        </StatusChip>
        {isAdmin && missing && (
          <button type="button" className={hrBtnPrimary} disabled={busy} onClick={() => act.mutate(() => hrApi.createPayouts(month))}>
            <Send className="h-4 w-4" aria-hidden="true" /> {busy ? 'Sending…' : 'Raise the missing payments'}
          </button>
        )}
        {isAdmin && run.payoutsCount === 0 && (
          <button type="button" className={hrBtnGhost} disabled={busy} onClick={() => setMode('reopen')}><RotateCcw className="h-4 w-4" aria-hidden="true" /> Re-open</button>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">{body}</div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

const KIND_TITLE: Record<PayslipLine['kind'], string> = { earning: 'Earnings', deduction: 'Deductions', employer: 'Paid by the company (not in take-home)' };

/** The lines of one payslip, each with the server's working ("4 marks → ½ day LOP"). */
export function PayslipExplain({ row }: { row: PayslipRow }) {
  const q = useQuery({ queryKey: hrKeys.payslip(row.id), queryFn: () => hrApi.payslip(row.employee, row.id), retry: false });
  if (q.isPending) return <HrLoading label="Loading payslip…" />;
  if (q.isError) return <HrErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data.payslip;
  const groups = (['earning', 'deduction', 'employer'] as const).map((k) => [k, p.lines.filter((l) => l.kind === k)] as const).filter(([, ls]) => ls.length);
  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">Payslip {p.number}</p>
        <a href={payslipPdfUrl(row.employee, row.id)} className={hrBtnGhost} target="_blank" rel="noopener noreferrer">
          <FileDown className="h-4 w-4" aria-hidden="true" /> Payslip PDF
        </a>
      </div>
      {groups.map(([kind, lines]) => (
        <div key={kind}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{KIND_TITLE[kind]}</p>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {lines.map((l) => (
              <li key={l.code} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium text-gray-900">{l.label}</span>
                  {l.calc && <span className="block text-xs text-gray-600">{l.calc}</span>}
                </span>
                <span className={`shrink-0 tabular-nums ${kind === 'deduction' ? 'text-red-700' : 'text-gray-900'}`}>{kind === 'deduction' ? '− ' : ''}{paise(l.amountPaise)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="flex justify-between border-t border-gray-200 pt-2 text-sm font-bold text-gray-900"><span>Take-home</span><span className="tabular-nums">{paise(p.netPaise)}</span></p>
    </div>
  );
}

function PayslipTable({ rows }: { rows: PayslipRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className={`${hrCard} overflow-x-auto`}>
      <table className={hrTable}>
        <thead>
          <tr>
            <th className={hrTh}>Employee</th><th className={`${hrTh} text-right`}>Gross</th><th className={`${hrTh} text-right`}>Deductions</th>
            <th className={`${hrTh} text-right`}>Take-home</th><th className={hrTh}>Check</th><th className={hrTh}><span className="sr-only">Details</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const isOpen = open === p.id;
            return [
              <tr key={p.id}>
                <td className={hrTd}><PersonCell name={p.name} sub={p.employeeCode} /></td>
                <td className={`${hrTd} text-right tabular-nums`}>{paise(p.grossPaise)}</td>
                <td className={`${hrTd} text-right tabular-nums`}>{paise(p.deductionsPaise)}</td>
                <td className={`${hrTd} text-right font-semibold tabular-nums`}>{paise(p.netPaise)}</td>
                <td className={hrTd}>{p.warnings.length ? <StatusChip tone="warn">{p.warnings.join(' · ')}</StatusChip> : <StatusChip tone="ok">OK</StatusChip>}</td>
                <td className={hrTd}>
                  <button type="button" className={hrBtnGhost} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.id)}>
                    {isOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />} Explain<span className="sr-only"> {p.name}</span>
                  </button>
                </td>
              </tr>,
              isOpen && (
                <tr key={`${p.id}-x`}><td colSpan={6} className="border-b border-gray-100 bg-gray-50"><PayslipExplain row={p} /></td></tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * `isAdmin` comes from the server layout's session check. It only decides
 * whether admin buttons show; the API refuses them for anyone else regardless.
 * Every rupee here is a server figure; nothing is added up in the browser.
 */
export default function PayrollMonth({ isAdmin = false }: { isAdmin?: boolean }) {
  // Payroll runs for a month that has ended, so open on last month.
  const [month, setMonth] = useState(() => shiftMonth(currentMonthIST(), -1));
  const q = useQuery({ queryKey: hrKeys.payrollMonth(month), queryFn: () => hrApi.payrollRun(month), retry: false });
  const run = q.data ?? null;
  const monthEnded = month < currentMonthIST();

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

      {q.isError ? <HrErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isPending ? <HrLoading /> : (
        <>
          <PayrollSteps status={run?.status ?? null} />
          <div className="mb-4 flex justify-end"><RunActions key={`${month}:${run?.rev ?? 'none'}`} month={month} run={run} isAdmin={isAdmin} monthEnded={monthEnded} /></div>
          {run && run.blockedCount > 0 && (
            <p role="status" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              {run.blockedCount} payslip(s) have deductions above earnings. Fix the adjustment, then recalculate. It cannot be locked until then.
            </p>
          )}
          {run && run.skipped.length > 0 && (
            <div role="status" className="mb-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
              <p className="font-semibold">Left out of this month</p>
              <ul className="mt-1 list-disc pl-5">{run.skipped.map((s) => <li key={s.employee}>{s.name}: {s.reason}</li>)}</ul>
            </div>
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
            <HrEmpty title={`${monthLabel(month)} isn't prepared yet`}>
              {monthEnded ? <>Prepare it to see each person&rsquo;s pay. Nothing is paid until admin approves.</> : 'Payroll can be prepared once this month is over.'}
            </HrEmpty>
          ) : !run.payslips.length ? (
            <HrEmpty title="No payslips in this run">Add a salary for each employee, then recalculate.</HrEmpty>
          ) : (
            <PayslipTable rows={run.payslips} />
          )}
        </>
      )}
      <p className="mt-3 text-xs text-gray-500">The server works out every number. Open &ldquo;Explain&rdquo; to see how each line was worked out.</p>
    </div>
  );
}
