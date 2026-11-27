'use client';

import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hrApi } from '@/lib/hr/api';
import { hrKeys } from '@/lib/hr/keys';
import { describeHrError } from '@/lib/hr/errors';
import { currentMonthIST, monthLabel, paise } from '@/lib/hr/format';
import type { SalaryComponent, SalaryInput, SalaryStructure } from '@/lib/hr/types';
import StatusChip from './StatusChip';
import { useHrList } from './useHrList';
import { HrEmpty, HrErrorState, HrLoadMore, HrLoading, hrBtnGhost, hrBtnPrimary, hrCard, hrField, hrInput } from './HrStates';

type Draft = { code: string; label: string; kind: 'earning' | 'deduction'; rupees: string; prorate: boolean };

const START: Draft[] = [
  { code: 'basic', label: 'Basic', kind: 'earning', rupees: '', prorate: true },
  { code: 'hra', label: 'House rent allowance', kind: 'earning', rupees: '', prorate: true },
  { code: 'special', label: 'Special allowance', kind: 'earning', rupees: '', prorate: true },
];

/** Rupees as typed ("15000" / "15000.50") → integer paise, or null when not a clean amount. */
export function rupeesToPaise(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const [r, p = ''] = s.split('.');
  return Number(r) * 100 + Number(p.padEnd(2, '0'));
}

const fromRow = (r: SalaryStructure): Draft[] => r.components.map((c) => ({ ...c, rupees: String(c.monthlyPaise / 100) }));

function SalaryForm({ employeeId, latest, onDone }: { employeeId: string; latest: SalaryStructure | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState(currentMonthIST());
  const [rows, setRows] = useState<Draft[]>(latest ? fromRow(latest) : START);
  const [flags, setFlags] = useState({
    pfApplicable: latest?.pfApplicable ?? true,
    esiApplicable: latest?.esiApplicable ?? true,
    overtimeEligible: latest?.overtimeEligible ?? true,
    punctualityBonusEligible: latest?.punctualityBonusEligible ?? true,
  });
  const [tds, setTds] = useState(latest ? String(latest.tdsMonthlyPaise / 100) : '0');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (input: SalaryInput) => hrApi.addSalary(employeeId, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: hrKeys.salary(employeeId) }); onDone(); },
    onError: (err) => setError(describeHrError(err).message),
  });

  const setRow = (i: number, patch: Partial<Draft>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(from)) { setError('Choose the month this salary starts from.'); return; }
    const components: SalaryComponent[] = [];
    for (const r of rows) {
      const monthlyPaise = rupeesToPaise(r.rupees);
      if (!r.label.trim()) { setError('Every line needs a name.'); return; }
      if (monthlyPaise === null) { setError(`${r.label}: enter the monthly amount in rupees (up to 2 decimals).`); return; }
      components.push({ code: r.code.trim().toLowerCase(), label: r.label.trim(), kind: r.kind, monthlyPaise, prorate: r.prorate });
    }
    const tdsPaise = rupeesToPaise(tds || '0');
    if (tdsPaise === null) { setError('TDS: enter rupees, 0 if none.'); return; }
    if (reason.trim().length < 3) { setError('Say why (for example "Joining salary" or "Annual raise").'); return; }
    setError(null);
    save.mutate({
      effectiveFrom: from,
      components,
      pfApplicable: flags.pfApplicable,
      pfCapAtCeiling: latest?.pfCapAtCeiling ?? true,
      esiApplicable: flags.esiApplicable,
      ptState: latest?.ptState ?? '',
      overtimeEligible: flags.overtimeEligible,
      overtimeMultiplier: latest?.overtimeMultiplier ?? null,
      punctualityBonusEligible: flags.punctualityBonusEligible,
      tdsMonthlyPaise: tdsPaise,
      reason: reason.trim(),
    });
  };

  return (
    <form noValidate onSubmit={submit} className="mt-3 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3" aria-label="New salary">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-gray-700">Starts from month</span>
        <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} className={`${hrField} w-44`} />
      </label>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`sal-label-${i}`}>Line name</label>
            <input id={`sal-label-${i}`} value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} className={`${hrField} w-48`} />
            <label className="sr-only" htmlFor={`sal-code-${i}`}>Short code</label>
            <input id={`sal-code-${i}`} value={r.code} onChange={(e) => setRow(i, { code: e.target.value })} className={`${hrField} w-24`} placeholder="code" />
            <label className="sr-only" htmlFor={`sal-kind-${i}`}>Type</label>
            <select id={`sal-kind-${i}`} value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as Draft['kind'] })} className={hrField}>
              <option value="earning">Earning</option>
              <option value="deduction">Deduction</option>
            </select>
            <label className="sr-only" htmlFor={`sal-amt-${i}`}>{r.label} monthly ₹</label>
            <input id={`sal-amt-${i}`} inputMode="decimal" value={r.rupees} onChange={(e) => setRow(i, { rupees: e.target.value })} className={`${hrField} w-32`} placeholder="₹ a month" />
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <input type="checkbox" checked={r.prorate} onChange={(e) => setRow(i, { prorate: e.target.checked })} /> Cut for unpaid days
            </label>
            {rows.length > 1 && (
              <button type="button" className={hrBtnGhost} aria-label={`Remove ${r.label || 'line'}`} onClick={() => setRows((p) => p.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
            )}
          </div>
        ))}
        <button type="button" className={hrBtnGhost} onClick={() => setRows((p) => [...p, { code: '', label: '', kind: 'earning', rupees: '', prorate: true }])}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add line
        </button>
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        {([
          ['pfApplicable', 'PF applies'],
          ['esiApplicable', 'ESI applies (if under the limit)'],
          ['overtimeEligible', 'Gets paid overtime'],
          ['punctualityBonusEligible', 'Gets the punctuality bonus'],
        ] as const).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={flags[k]} onChange={(e) => setFlags((p) => ({ ...p, [k]: e.target.checked }))} /> {label}
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">TDS a month (₹)</span>
          <input inputMode="decimal" value={tds} onChange={(e) => setTds(e.target.value)} className={hrInput} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Why</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={hrInput} placeholder="Joining salary / Annual raise" />
        </label>
      </div>
      <p className="text-xs text-gray-500">PF, ESI and PT amounts are worked out by payroll. Past salaries are never changed: a raise is a new row from a later month.</p>
      <div className="flex items-center gap-2">
        <button type="submit" className={hrBtnPrimary} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save salary'}</button>
        <button type="button" className={hrBtnGhost} disabled={save.isPending} onClick={onDone}>Cancel</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </form>
  );
}

/** Salary history for one employee (newest first) and the form to add the next row. */
export default function SalaryPanel({ employeeId, readOnly = false }: { employeeId: string; readOnly?: boolean }) {
  const [adding, setAdding] = useState(false);
  const list = useHrList<SalaryStructure>(hrKeys.salary(employeeId), (cursor) => hrApi.salaryRows(employeeId, cursor));
  const latest = list.rows[0] ?? null;
  return (
    <section className={`${hrCard} p-4`} aria-labelledby="hr-salary">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="hr-salary" className="font-bold text-gray-900">Salary</h2>
        {!adding && !readOnly && !list.isError && !list.isPending && (
          <button type="button" className={hrBtnGhost} onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" /> {latest ? 'New salary' : 'Add salary'}</button>
        )}
      </div>
      {adding && <SalaryForm employeeId={employeeId} latest={latest} onDone={() => setAdding(false)} />}
      {list.isError ? <HrErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isPending ? <HrLoading /> : !list.rows.length ? (
        !adding && <HrEmpty title="No salary yet">Payroll leaves this person out until a salary is added.</HrEmpty>
      ) : (
        <ul className="mt-2 space-y-2">
          {list.rows.map((r, i) => (
            <li key={r.id} className="rounded-lg border border-gray-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-gray-900">From {monthLabel(r.effectiveFrom)} {i === 0 && <StatusChip tone="ok">Latest</StatusChip>}</p>
                <p className="font-semibold tabular-nums text-gray-900">{paise(r.grossMonthlyPaise)} gross a month</p>
              </div>
              <p className="mt-1 text-gray-600">{r.components.map((c) => `${c.label} ${paise(c.monthlyPaise)}${c.kind === 'deduction' ? ' (deduction)' : ''}`).join(' · ')}</p>
              <p className="text-xs text-gray-500">
                {[r.pfApplicable ? 'PF' : 'No PF', r.esiApplicable ? 'ESI' : 'No ESI', r.overtimeEligible ? 'OT paid' : 'No OT', r.punctualityBonusEligible ? 'Bonus' : 'No bonus'].join(' · ')}
                {r.reason && ` · ${r.reason}`}
              </p>
            </li>
          ))}
        </ul>
      )}
      <HrLoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
    </section>
  );
}
