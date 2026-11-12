'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save } from 'lucide-react';
import apiClient from '@/lib/api';
import { incentiveKeys } from '@/hooks/queries/keys';
import { useIncentiveRules } from '@/hooks/queries/useIncentives';
import { currentMonthIST, shiftMonth, monthLabel, type Rules } from '@/lib/incentives';

/**
 * Every Roav Points rule, editable. Saving creates a NEW version that starts
 * next month at the earliest — the server refuses anything earlier, so a
 * month that is already earning points never changes under anyone.
 */
const input = 'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm';
const errorText = (e: unknown) => (e as { rawData?: { message?: string } })?.rawData?.message || 'Could not save the rules';

function Num({ label, value, onChange, step = 'any', hint }: { label: string; value: number | null; onChange: (v: number) => void; step?: string; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <input type="number" step={step} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} className={input} />
      {hint && <span className="text-xs text-gray-400">{hint}</span>}
    </label>
  );
}

export default function IncentiveRulesForm() {
  const qc = useQueryClient();
  const { data, isLoading } = useIncentiveRules();
  const [r, setR] = useState<Rules | null>(null);
  const [from, setFrom] = useState(() => shiftMonth(currentMonthIST(), 1));
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data && !r) setR(structuredClone((data.versions[0] || data.current).rules));
  }, [data, r]);

  if (isLoading || !r) return <p className="text-gray-400">Loading rules…</p>;
  const set = (patch: Partial<Rules>) => setR({ ...r, ...patch });
  const earliest = shiftMonth(currentMonthIST(), 1);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await apiClient.post<{ version: { version: number; effectiveFrom: string } }>('/incentives/rules', { rules: r, effectiveFrom: from, note });
      setMsg({ ok: true, text: `Saved as version ${res.version.version}, starting ${monthLabel(res.version.effectiveFrom)}.` });
      setNote('');
      await qc.invalidateQueries({ queryKey: incentiveKeys.rules() });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
        In force now: version {data?.current.version}. Changes you save here start from the month you pick (next month at the earliest) and never change a past month.
      </p>

      <section className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-3">
        <h2 className="text-base font-semibold sm:col-span-3">Order points</h2>
        <Num label="Points per ₹1 (ex-GST)" value={r.basePointsPerRupee} onChange={(v) => set({ basePointsPerRupee: v })} hint="0.0196 = 1,960 per ₹1,00,000" />
        <Num label="Points per paid order" value={r.perOrderBonus} onChange={(v) => set({ perOrderBonus: v })} step="1" />
        <Num label="… only if order value (ex-GST) is at least ₹" value={r.perOrderBonusMinValue ?? 0} onChange={(v) => set({ perOrderBonusMinValue: v })} step="1" hint="Stops ₹10 test orders earning the bonus" />
        <Num label="Special sourcing keeps (0–1)" value={r.specialSourcingKeep} onChange={(v) => set({ specialSourcingKeep: v })} hint="0.75 = 75%" />
        <Num label="GST rate (only for orders with no tax figure)" value={r.gstRate} onChange={(v) => set({ gstRate: v })} />
        <Num label="Dealer price = website price minus %" value={r.b2bDealerDiscountPercent} onChange={(v) => set({ b2bDealerDiscountPercent: v })} hint="B2B discounts are measured against this" />
        <Num label="Ignore discounts below %" value={r.discountTolerancePercent} onChange={(v) => set({ discountTolerancePercent: v })} />
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-base font-semibold">Invoice multipliers (by portion)</h2>
          {r.brackets.map((b, i) => (
            <div key={i} className="mb-2 flex items-end gap-2">
              <Num label={i === r.brackets.length - 1 ? 'Above (no limit)' : 'Up to ₹'} value={b.upTo} onChange={(v) => { const x = [...r.brackets]; x[i] = { ...b, upTo: i === r.brackets.length - 1 ? null : v }; set({ brackets: x }); }} step="1" />
              <Num label="×" value={b.multiplier} onChange={(v) => { const x = [...r.brackets]; x[i] = { ...b, multiplier: v }; set({ brackets: x }); }} />
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-base font-semibold">Discount keep</h2>
          {r.discountKeep.map((t, i) => (
            <div key={i} className="mb-2 flex items-end gap-2">
              <Num label={i === 0 ? 'No discount (0%)' : i === r.discountKeep.length - 1 ? 'Above' : 'Up to %'} value={t.maxPercent} onChange={(v) => { const x = [...r.discountKeep]; x[i] = { ...t, maxPercent: i === 0 ? 0 : i === r.discountKeep.length - 1 ? null : v }; set({ discountKeep: x }); }} />
              <Num label="Keeps (0–1)" value={t.keep} onChange={(v) => { const x = [...r.discountKeep]; x[i] = { ...t, keep: v }; set({ discountKeep: x }); }} />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">Priority products (points per unit)</h2>
          <button onClick={() => set({ priorityProducts: [...r.priorityProducts, { key: `group-${r.priorityProducts.length + 1}`, label: 'New group', productIds: [], b2c: 0, b2b: 0 }] })} className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs"><Plus className="h-3 w-3" /> Add group</button>
        </div>
        {r.priorityProducts.map((p, i) => {
          const upd = (patch: Partial<typeof p>) => { const x = [...r.priorityProducts]; x[i] = { ...p, ...patch }; set({ priorityProducts: x }); };
          return (
            <div key={p.key} className="mb-3 grid items-end gap-2 border-t border-gray-100 pt-3 sm:grid-cols-[2fr_1fr_1fr_3fr_auto]">
              <label className="text-sm"><span className="text-gray-700">Name</span><input value={p.label} onChange={(e) => upd({ label: e.target.value })} className={input} /></label>
              <Num label="B2C pts" value={p.b2c} onChange={(v) => upd({ b2c: v })} step="1" />
              <Num label="B2B pts" value={p.b2b} onChange={(v) => upd({ b2b: v })} step="1" />
              <label className="text-sm"><span className="text-gray-700">Product IDs (comma separated, from the product page URL in admin)</span>
                <input value={p.productIds.join(', ')} onChange={(e) => upd({ productIds: e.target.value.split(/[\s,]+/).filter(Boolean) })} className={`${input} font-mono text-xs`} />
              </label>
              <button aria-label="Remove group" onClick={() => set({ priorityProducts: r.priorityProducts.filter((_, j) => j !== i) })} className="rounded p-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
            </div>
          );
        })}
      </section>

      <section className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-3">
        <h2 className="text-base font-semibold sm:col-span-3">Returns and customer feedback</h2>
        <Num label="Return window (days after payment)" value={r.returnWindowDays} onChange={(v) => set({ returnWindowDays: v })} step="1" />
        <Num label="Penalty when returns exceed % of orders" value={r.returnRateThresholdPercent} onChange={(v) => set({ returnRateThresholdPercent: v })} />
        <Num label="Penalty multiplier" value={r.returnPenaltyMultiplier} onChange={(v) => set({ returnPenaltyMultiplier: v })} />
        <Num label="Minimum ratings in the month" value={r.rating.minCount} onChange={(v) => set({ rating: { ...r.rating, minCount: v } })} step="1" />
        <Num label="Average at or above (★)" value={r.rating.highAvg} onChange={(v) => set({ rating: { ...r.rating, highAvg: v } })} />
        <Num label="… gives ×" value={r.rating.highMultiplier} onChange={(v) => set({ rating: { ...r.rating, highMultiplier: v } })} />
        <span className="hidden sm:block" />
        <Num label="Average below (★)" value={r.rating.lowAvg} onChange={(v) => set({ rating: { ...r.rating, lowAvg: v } })} />
        <Num label="… gives ×" value={r.rating.lowMultiplier} onChange={(v) => set({ rating: { ...r.rating, lowMultiplier: v } })} />
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-base font-semibold">Slabs (the rate applies to ALL points; no ceiling)</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {r.slabs.map((s, i) => {
            const upd = (patch: Partial<typeof s>) => { const x = [...r.slabs]; x[i] = { ...s, ...patch }; set({ slabs: x }); };
            return (
              <div key={i} className="flex items-end gap-2 rounded border border-gray-100 p-2">
                <label className="text-sm"><span className="text-gray-700">Name</span><input value={s.name} onChange={(e) => upd({ name: e.target.value })} className={input} /></label>
                <Num label="From pts" value={s.minPoints} onChange={(v) => upd({ minPoints: v })} step="1" />
                <Num label="₹/pt" value={s.ratePerPoint} onChange={(v) => upd({ ratePerPoint: v })} />
              </div>
            );
          })}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="text-sm"><span className="text-gray-700">Invoice multipliers apply up to slab</span>
            <select value={r.multiplierSlabCap || ''} onChange={(e) => set({ multiplierSlabCap: e.target.value || null })} className={input}>
              <option value="">Every slab (formula as written)</option>
              {r.slabs.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
            <span className="text-xs text-gray-400">Open question: the PDF says &ldquo;up to TURBO&rdquo;.</span>
          </label>
          <Num label="Champion banner shows for (days)" value={r.championBannerDays} onChange={(v) => set({ championBannerDays: v })} step="1" />
        </div>
      </section>

      <section className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <label className="text-sm"><span className="text-gray-700">Starts from</span>
          <input type="month" min={earliest} value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
        </label>
        <label className="min-w-64 flex-1 text-sm"><span className="text-gray-700">Note (what changed and why)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={input} />
        </label>
        <button disabled={busy} onClick={save} className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"><Save className="h-4 w-4" /> Save new version</button>
        {msg && <p className={`w-full text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">History</h2>
        <ul className="space-y-1 text-sm text-gray-600">
          {data?.versions.map((v) => (
            <li key={v.version}>v{v.version} — from {monthLabel(v.effectiveFrom === '2000-01' ? currentMonthIST() : v.effectiveFrom)}{v.effectiveFrom === '2000-01' ? ' (the start)' : ''} · {v.createdByName || 'system'} · {v.note}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
