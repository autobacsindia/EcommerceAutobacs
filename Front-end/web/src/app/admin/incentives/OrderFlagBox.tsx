'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import apiClient from '@/lib/api';
import { describeRow, type LedgerRow } from '@/lib/incentives';

/**
 * Mark one order as special sourcing (air-urgent or sub-dealer → 75% of its
 * order points). No order field records this, so it is an admin toggle. A
 * change after the order already earned is applied by the server as "reverse
 * the old points, earn the new" — nothing is overwritten.
 */
interface Flag { specialSourcing: boolean; rev: number; note?: string; setByName?: string }
const OID = /^[a-f0-9]{24}$/i;

export default function OrderFlagBox() {
  const [id, setId] = useState('');
  const [flag, setFlag] = useState<Flag | null>(null);
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setMsg('');
    if (!OID.test(id.trim())) { setMsg('Paste the order ID (24 letters/numbers from the admin order page address).'); return; }
    setBusy(true);
    try {
      const res = await apiClient.get<{ flag: Flag | null; rows: LedgerRow[] }>(`/incentives/orders/${id.trim()}`);
      setFlag(res.flag); setRows(res.rows);
    } catch {
      setMsg('Could not load that order');
    } finally { setBusy(false); }
  }

  async function toggle(value: boolean) {
    setBusy(true); setMsg('');
    try {
      const res = await apiClient.put<{ changed: boolean }>(`/incentives/orders/${id.trim()}/flag`, { specialSourcing: value, note });
      setMsg(res.changed ? 'Saved. The order’s points were recalculated.' : 'No change.');
      await load();
    } catch {
      setMsg('Could not save');
    } finally { setBusy(false); }
  }

  const on = flag?.specialSourcing ?? false;
  const total = (rows || []).reduce((a, r) => a + r.points, 0);
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex gap-2">
        <input value={id} onChange={(e) => setId(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} placeholder="Order ID" className="flex-1 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm" />
        <button disabled={busy} onClick={load} className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"><Search className="h-4 w-4" /> Look up</button>
      </div>
      {rows && (
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">Special sourcing (air-urgent / sub-dealer, earns 75%): <b>{on ? 'Yes' : 'No'}</b></span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note (optional)" className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
            <button disabled={busy} onClick={() => toggle(!on)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{on ? 'Turn off' : 'Turn on'}</button>
          </div>
          <table className="min-w-full text-xs">
            <thead className="text-left text-gray-500"><tr><th className="py-1 pr-3">Month</th><th className="py-1 pr-3">Seller</th><th className="py-1 pr-3">What</th><th className="py-1 text-right">Points</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-t border-gray-100">
                  <td className="py-1 pr-3">{r.month}</td>
                  <td className="py-1 pr-3">{r.earnerName}</td>
                  <td className="py-1 pr-3">{describeRow(r)}</td>
                  <td className={`py-1 text-right ${r.points < 0 ? 'text-red-600' : ''}`}>{r.points.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={4} className="py-2 text-gray-400">This order has no points (not a verified-paid sales order, or not swept yet).</td></tr>}
            </tbody>
            {rows.length > 0 && <tfoot><tr className="border-t border-gray-300 font-semibold"><td colSpan={3} className="py-1">Net</td><td className="py-1 text-right">{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td></tr></tfoot>}
          </table>
        </div>
      )}
      {msg && <p className="text-sm text-gray-700" role="status">{msg}</p>}
    </div>
  );
}
