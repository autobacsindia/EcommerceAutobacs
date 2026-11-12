'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Lock, CheckCircle2, RotateCcw, Download, RefreshCw, Trophy } from 'lucide-react';
import apiClient from '@/lib/api';
import { incentiveKeys } from '@/hooks/queries/keys';
import { useIncentiveMonth, useIncentiveRows } from '@/hooks/queries/useIncentives';
import { currentMonthIST, shiftMonth, monthLabel, points, rupees, describeRow, type Statement } from '@/lib/incentives';
import IncentiveRulesForm from './IncentiveRulesForm';
import OrderFlagBox from './OrderFlagBox';

/**
 * Roav Points — month close (lock → review → approve → CSV for payroll), the
 * statement behind each person, the rules, and the per-order special-sourcing
 * flag. Every number on this screen comes from the server.
 */
const errorText = (e: unknown, fallback: string) =>
  (e as { rawData?: { message?: string } })?.rawData?.message || fallback;

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700',
  locked: 'bg-amber-50 text-amber-800',
  approved: 'bg-green-50 text-green-700',
};
const STATUS_TEXT: Record<string, string> = {
  open: 'Open — points still coming in',
  locked: 'Locked — waiting for your review',
  approved: 'Approved — ready for payroll',
};

export default function AdminIncentivesPage() {
  const [tab, setTab] = useState<'month' | 'rules' | 'order'>('month');
  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Roav Points</h1>
        <p className="text-sm text-gray-500">Sales incentives: points from verified-paid orders, monthly slabs and payout.</p>
      </div>
      <div className="flex gap-2 border-b border-gray-200" role="tablist">
        {([['month', 'Month & statements'], ['rules', 'Rules'], ['order', 'Order flag']] as const).map(([k, label]) => (
          <button
            key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
          >{label}</button>
        ))}
      </div>
      {tab === 'month' && <MonthPanel />}
      {tab === 'rules' && <IncentiveRulesForm />}
      {tab === 'order' && <OrderFlagBox />}
    </div>
  );
}

function MonthPanel() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => currentMonthIST());
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const { data, isLoading, error: loadError } = useIncentiveMonth(month);
  const isPast = month < currentMonthIST();

  async function act(action: 'lock' | 'recompute' | 'approve' | 'reopen') {
    setBusy(true); setError('');
    try {
      await apiClient.post(`/incentives/months/${month}/${action}`, action === 'reopen' ? { reason } : {});
      setReason('');
      await qc.invalidateQueries({ queryKey: incentiveKeys.all });
    } catch (e) {
      setError(errorText(e, 'That did not work, please try again'));
    } finally {
      setBusy(false);
    }
  }

  async function downloadCsv() {
    setError('');
    const res = await fetch(`/api/v1/incentives/months/${month}/export.csv`, { credentials: 'include' });
    if (!res.ok) { setError('Approve the month before exporting it'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `roav-points-${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const statements = data?.statements || [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button aria-label="Previous month" onClick={() => { setMonth(shiftMonth(month, -1)); setOpen(null); }} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-36 text-center font-semibold text-gray-900">{monthLabel(month)}</span>
          <button aria-label="Next month" disabled={month >= currentMonthIST()} onClick={() => { setMonth(shiftMonth(month, 1)); setOpen(null); }} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
        </div>
        {data && <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLE[data.status]}`}>{STATUS_TEXT[data.status]}</span>}
        {data && <span className="text-sm text-gray-500">Rules v{data.rulesVersion}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          {data?.status === 'open' && isPast && (
            <button disabled={busy} onClick={() => act('lock')} className="flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"><Lock className="h-4 w-4" /> Lock month</button>
          )}
          {data?.status === 'locked' && (
            <>
              <button disabled={busy} onClick={() => act('recompute')} className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"><RefreshCw className="h-4 w-4" /> Recompute</button>
              <button disabled={busy} onClick={() => act('approve')} className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Approve</button>
            </>
          )}
          {data?.status === 'approved' && (
            <button onClick={downloadCsv} className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"><Download className="h-4 w-4" /> Payroll CSV</button>
          )}
        </div>
      </div>

      {data && data.status !== 'open' && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <span className="text-gray-600">Re-open this month (needs a reason, recorded in the audit log):</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Why?" className="min-w-48 flex-1 rounded-lg border border-gray-300 px-3 py-1.5" />
          <button disabled={busy || reason.trim().length < 5} onClick={() => act('reopen')} className="flex items-center gap-1 rounded-lg border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50 disabled:opacity-40"><RotateCcw className="h-4 w-4" /> Re-open</button>
        </div>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {loadError && <p className="text-sm text-red-600" role="alert">{errorText(loadError, 'Could not load this month')}</p>}

      {data?.champion && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm">
          <Trophy className="h-5 w-5 text-yellow-600" />
          <span><b>Incentive Champion:</b> {data.champion.name} — {points(data.champion.finalPoints)} pts, {rupees(data.champion.payout)}</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-3 py-3">#</th><th className="px-3 py-3">Name</th><th className="px-3 py-3 text-right">Orders</th>
              <th className="px-3 py-3 text-right">Returns</th><th className="px-3 py-3 text-right">Rating</th>
              <th className="px-3 py-3 text-right">Ledger pts</th><th className="px-3 py-3 text-right">Factors</th>
              <th className="px-3 py-3 text-right">Final pts</th><th className="px-3 py-3">Slab</th><th className="px-3 py-3 text-right">Incentive</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
            ) : statements.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">No points this month yet.</td></tr>
            ) : statements.map((s: Statement, i: number) => (
              <StatementRow key={s.earnerKey} s={s} rank={i + 1} month={month} open={open === s.earnerKey} onToggle={() => setOpen(open === s.earnerKey ? null : s.earnerKey)} />
            ))}
          </tbody>
          {statements.length > 0 && (
            <tfoot className="bg-gray-50 font-semibold"><tr><td colSpan={9} className="px-3 py-3 text-right">Total company cost</td><td className="px-3 py-3 text-right">{rupees(data?.totalPayout || 0)}</td></tr></tfoot>
          )}
        </table>
      </div>
      {data?.history && data.history.length > 0 && (
        <ul className="space-y-1 text-xs text-gray-500">
          {data.history.map((h, i) => (
            <li key={i}>{new Date(h.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} — {h.action} by {h.byName}{h.reason ? `: “${h.reason}”` : ''}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatementRow({ s, rank, month, open, onToggle }: { s: Statement; rank: number; month: string; open: boolean; onToggle: () => void }) {
  const factors = [s.returnFactor !== 1 ? `returns ×${s.returnFactor}` : null, s.ratingFactor !== 1 ? `rating ×${s.ratingFactor}` : null].filter(Boolean).join(', ') || '—';
  return (
    <>
      <tr className="cursor-pointer hover:bg-gray-50" onClick={onToggle} aria-expanded={open}>
        <td className="px-3 py-3 text-gray-400">{rank}</td>
        <td className="px-3 py-3 font-medium text-gray-900">{s.name || s.earnerKey}</td>
        <td className="px-3 py-3 text-right">{s.orders}</td>
        <td className="px-3 py-3 text-right">{s.returnedOrders}</td>
        <td className="px-3 py-3 text-right">{s.ratingAvg != null ? `${s.ratingAvg}★ (${s.ratingCount})` : '—'}</td>
        <td className="px-3 py-3 text-right">{points(s.ledgerPoints)}</td>
        <td className="px-3 py-3 text-right text-gray-500">{factors}</td>
        <td className="px-3 py-3 text-right font-semibold">{points(s.finalPoints)}</td>
        <td className="px-3 py-3">{s.slab || <span className="text-gray-400">Below Crank</span>}{s.next ? <span className="block text-xs text-gray-400">{points(s.next.pointsToGo)} to {s.next.name}</span> : null}</td>
        <td className="px-3 py-3 text-right font-semibold">{rupees(s.payout)}</td>
      </tr>
      {open && <tr><td colSpan={10} className="bg-gray-50 px-3 py-3"><StatementOrders earnerKey={s.earnerKey} month={month} /></td></tr>}
    </>
  );
}

function StatementOrders({ earnerKey, month }: { earnerKey: string; month: string }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1];
  const { data, isLoading } = useIncentiveRows(earnerKey, month, cursor);
  if (isLoading) return <p className="text-gray-400">Loading orders…</p>;
  if (!data?.rows.length) return <p className="text-gray-400">No rows.</p>;
  return (
    <div className="space-y-2">
      <table className="min-w-full text-xs">
        <thead className="text-left text-gray-500"><tr><th className="py-1 pr-3">Order</th><th className="py-1 pr-3">What</th><th className="py-1 pr-3 text-right">Value ex-GST</th><th className="py-1 pr-3 text-right">Discount</th><th className="py-1 pr-3">Notes</th><th className="py-1 text-right">Points</th></tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r._id} className="border-t border-gray-200">
              <td className="py-1 pr-3 font-mono">{r.orderNumber}</td>
              <td className="py-1 pr-3">{describeRow(r)}</td>
              <td className="py-1 pr-3 text-right">{r.inputs?.valueExGst != null ? rupees(r.inputs.valueExGst) : ''}</td>
              <td className="py-1 pr-3 text-right">{r.inputs?.discountPercent != null ? `${r.inputs.discountPercent.toFixed(2)}% (keeps ${Math.round((r.inputs.discountKeep ?? 1) * 100)}%)` : ''}</td>
              <td className="py-1 pr-3 text-gray-500">{[r.inputs?.isB2B ? 'B2B' : null, r.inputs?.specialSourcing ? 'special sourcing 75%' : null, r.inputs?.landedLate ? 'paid after month lock' : null].filter(Boolean).join(', ')}</td>
              <td className={`py-1 text-right font-medium ${r.points < 0 ? 'text-red-600' : ''}`}>{r.points.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        {cursors.length > 1 && <button onClick={() => setCursors(cursors.slice(0, -1))} className="rounded border border-gray-300 px-2 py-1 text-xs">Newer</button>}
        {data.nextCursor && <button onClick={() => setCursors([...cursors, data.nextCursor])} className="rounded border border-gray-300 px-2 py-1 text-xs">Older</button>}
      </div>
    </div>
  );
}
