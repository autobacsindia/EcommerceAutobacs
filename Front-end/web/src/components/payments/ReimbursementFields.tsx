'use client';

/**
 * The Reimbursement part of the expense form (and its edit form): what kind,
 * when, and — for Fuel — the kilometres, with the amount shown as km × rate.
 *
 * The amount shown for Fuel is a PREVIEW: the browser never sends it. The
 * server works it out from the km and the rate (Back-end services/reimbursement.js),
 * so what accounts approves is always km × rate.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import type { Task, TaskPage } from '@/components/tasks/types';
import { fuelPreview, kmText, rupees, type ReimbursementOptions, type ReimbursementType } from './api';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';

export type ClaimDraft = { type: ReimbursementType; on: string; km: string; from: string; to: string };

/** Today in India, for the date box. */
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const emptyClaim = (): ClaimDraft => ({ type: 'fuel', on: todayIST(), km: '', from: '', to: '' });

/** What the server needs: never an amount for Fuel. */
export const claimPayload = (c: ClaimDraft) => ({
  type: c.type,
  on: c.on,
  ...(c.type === 'fuel' ? { km: c.km.trim() } : {}),
  from: c.from.trim(),
  to: c.to.trim(),
});

/** Checks the server also makes, so the common mistakes are caught before sending. '' when fine. */
export function claimProblem(c: ClaimDraft, o: ReimbursementOptions, { amount, details, bills }: { amount: number; details: string; bills: number }) {
  if (!c.on) return 'Pick the date of the expense.';
  if (c.on > todayIST()) return 'The date of the expense cannot be in the future.';
  if (c.type === 'fuel') {
    const km = Number(c.km);
    if (!c.km.trim() || !Number.isFinite(km) || km <= 0) return 'Enter the kilometres driven (more than 0).';
    if (km > o.maxKm) return `That is more than ${o.maxKm.toLocaleString('en-IN')} km for one claim — check it, or split it into separate trips.`;
    return '';
  }
  if (c.type === 'other' && details.trim().length < 3) return 'Add details — say what this “Others” reimbursement was for.';
  if (amount > o.billRequiredAbove && bills === 0) return `Attach the bill — claims above ₹${o.billRequiredAbove} need one.`;
  return '';
}

export default function ReimbursementFields({ value, onChange, options, amount, onAmount, ratePerKm }: {
  value: ClaimDraft;
  onChange: (c: ClaimDraft) => void;
  options: ReimbursementOptions;
  /** The typed amount (Food / Transportation / Others). */
  amount: string;
  onAmount: (v: string) => void;
  /** An existing Fuel claim's own rate (an edit); otherwise today's. */
  ratePerKm?: number | null;
}) {
  const set = (k: keyof ClaimDraft) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  const rate = ratePerKm && ratePerKm > 0 ? ratePerKm : options.fuelRatePerKm;
  const km = Number(value.km);
  const fuel = value.type === 'fuel';
  return (
    <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
      <div role="radiogroup" aria-label="Kind of reimbursement" className="flex flex-wrap gap-2">
        {options.types.map((t) => (
          <button key={t.value} type="button" role="radio" aria-checked={value.type === t.value} onClick={() => onChange({ ...value, type: t.value })}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${value.type === t.value ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="rb-on">Date of expense</label>
          <input id="rb-on" type="date" className={input} required max={todayIST()} value={value.on} onChange={set('on')} />
        </div>
        {fuel ? (
          <div>
            <label className={label} htmlFor="rb-km">Kilometres driven</label>
            <input id="rb-km" className={input} required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={value.km} onChange={set('km')} placeholder="e.g. 42" />
          </div>
        ) : (
          <div>
            <label className={label} htmlFor="pr-amount">Amount (₹)</label>
            <input id="pr-amount" className={input} required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={amount} onChange={(e) => onAmount(e.target.value)} placeholder="e.g. 250" />
            <p className="mt-1 text-xs text-gray-500">Above ₹{options.billRequiredAbove}, attach the bill.</p>
          </div>
        )}
      </div>
      {fuel && (
        <p className="rounded-lg bg-white px-3 py-2 text-sm text-gray-800" aria-live="polite" data-testid="fuel-amount">
          {km > 0
            ? <>{kmText(km)} km × {rupees(rate)} = <strong>{rupees(fuelPreview(km, rate))}</strong></>
            : <>Amount = km × {rupees(rate)} per km — worked out for you.</>}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="rb-from">From (optional)</label>
          <input id="rb-from" className={input} maxLength={120} value={value.from} onChange={set('from')} placeholder="e.g. Warehouse, Peenya" />
        </div>
        <div>
          <label className={label} htmlFor="rb-to">To (optional)</label>
          <input id="rb-to" className={input} maxLength={120} value={value.to} onChange={set('to')} placeholder="e.g. Supplier, Whitefield" />
        </div>
      </div>
    </div>
  );
}

/** The typed text, once typing pauses. */
function useSettled(v: string, ms = 300) {
  const [s, setS] = useState(v);
  useEffect(() => { const t = setTimeout(() => setS(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return s;
}

export type PickedTask = { id: string; code: string; title: string };

/**
 * Pick one of your own open tasks this cost was for (or type a task ID like T-42).
 * The server checks the task exists and that you can see it.
 */
export function TaskPicker({ picked, onPick, id = 'pr-task' }: { picked: PickedTask | null; onPick: (t: PickedTask | null) => void; id?: string }) {
  const [text, setText] = useState('');
  const q = useSettled(text.trim());
  const params = { view: 'mine', state: 'open', ...(q ? { q } : {}) };
  const list = useQuery({
    queryKey: [...taskKeys.list(params), 'pick'],
    queryFn: () => apiClient.get<TaskPage>(`/staff/tasks?${new URLSearchParams(params)}`),
    enabled: !picked,
    staleTime: 30 * 1000,
  });
  if (picked) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
        <span className="min-w-0 truncate"><strong>{picked.code}</strong> {picked.title}</span>
        <button type="button" onClick={() => onPick(null)} aria-label="Remove the task" className="rounded p-0.5 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
      </div>
    );
  }
  const typedId = /^\s*t-?\d{1,9}\s*$/i.test(text) ? text.trim().toUpperCase().replace(/^T-?/, 'T-') : '';
  const tasks: Task[] = (list.data?.tasks ?? []).slice(0, 8);
  return (
    <div>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
        <input id={id} className={`${input} pl-8`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Search your open tasks, or type T-42" autoComplete="off" />
      </div>
      <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-100 bg-white text-sm" aria-label="Your open tasks">
        {list.isPending ? (
          <li className="flex items-center gap-2 px-3 py-2 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</li>
        ) : list.isError ? (
          <li className="px-3 py-2 text-gray-500">Could not load your tasks — you can still type a task ID like T-42.</li>
        ) : tasks.length === 0 && !typedId ? (
          <li className="px-3 py-2 text-gray-500">{q ? 'No open task of yours matches.' : 'You have no open tasks.'}</li>
        ) : null}
        {typedId && !tasks.some((t) => t.code === typedId) && (
          <li><button type="button" className="w-full px-3 py-2 text-left hover:bg-gray-50" onClick={() => onPick({ id: typedId, code: typedId, title: '' })}>Use {typedId}</button></li>
        )}
        {tasks.map((t) => (
          <li key={t.id}>
            <button type="button" className="w-full truncate px-3 py-2 text-left hover:bg-gray-50" onClick={() => onPick({ id: t.id, code: t.code, title: t.title })}>
              <strong>{t.code}</strong> {t.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
