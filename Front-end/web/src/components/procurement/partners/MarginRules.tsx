'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCategories } from '@/hooks/queries/useCategories';
import { deleteMarginRule, errorMessage, getMarginRules, partnerKeys, pct, setMarginRule, suggestPrice, rupees, type MarginRules as Rules } from './api';
import { Loading, LoadError, btn } from './ui';

/**
 * Margin rules: the margin price suggestions aim for, and the lowest margin we
 * sell at without a reason. One default; a category can have its own.
 */
export default function MarginRules() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: partnerKeys.marginRules(), queryFn: getMarginRules });
  const categories = useCategories();
  const save = useMutation({
    mutationFn: setMarginRule,
    onSuccess: (rules) => { qc.setQueryData(partnerKeys.marginRules(), rules); qc.invalidateQueries({ queryKey: partnerKeys.all }); },
  });
  const remove = useMutation({
    mutationFn: deleteMarginRule,
    onSuccess: (rules) => { qc.setQueryData(partnerKeys.marginRules(), rules); qc.invalidateQueries({ queryKey: partnerKeys.all }); },
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} retry={() => q.refetch()} what="margin rules" />;
  const rules: Rules = q.data;
  const def = rules.default ?? { targetBp: rules.builtIn.targetBp, floorBp: rules.builtIn.floorBp };
  const used = new Set(rules.categories.map((c) => c.categoryId));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        <p><strong>Margin</strong> = our profit ÷ the selling price without GST.</p>
        <p className="mt-1">Example: supplier price ₹1,800 + 18% GST. At a 30% target we suggest ₹{suggestPrice(180000, 18, 3000).toLocaleString('en-IN')};
          a price below the lowest allowed margin needs a reason; below the supplier&apos;s price is never allowed.</p>
      </div>
      {(save.error || remove.error) && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(save.error || remove.error, 'Could not save.')}</p>}

      <RuleEditor title="Default (every category without its own rule)" targetBp={def.targetBp} floorBp={def.floorBp} busy={save.isPending}
        onSave={(targetPct, floorPct) => save.mutate({ categoryId: null, targetPct, floorPct })} />

      <section className="space-y-2">
        <h3 className="font-semibold text-gray-900">Category rules</h3>
        {rules.categories.length === 0 && <p className="text-sm text-gray-500">None — every category uses the default.</p>}
        {rules.categories.map((c) => (
          <RuleEditor key={c.key} title={c.categoryName} targetBp={c.targetBp} floorBp={c.floorBp} busy={save.isPending}
            onSave={(targetPct, floorPct) => save.mutate({ categoryId: c.categoryId, targetPct, floorPct })}
            onRemove={() => remove.mutate(c.categoryId!)} />
        ))}
        <AddCategoryRule categories={(categories.data ?? []).filter((c) => !used.has(c._id))} busy={save.isPending}
          onAdd={(categoryId, targetPct, floorPct) => save.mutate({ categoryId, targetPct, floorPct })} />
      </section>
    </div>
  );
}

const toPct = (bp: number) => String(bp / 100);

function RuleEditor({ title, targetBp, floorBp, busy, onSave, onRemove }: {
  title: string; targetBp: number; floorBp: number; busy: boolean; onSave: (t: string, f: string) => void; onRemove?: () => void;
}) {
  const [t, setT] = useState(toPct(targetBp));
  const [f, setF] = useState(toPct(floorBp));
  const invalid = !(Number(t) >= 0 && Number(t) <= 90 && Number(f) >= 0 && Number(f) <= 90 && Number(f) <= Number(t));
  const changed = t !== toPct(targetBp) || f !== toPct(floorBp);
  return (
    <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
      <p className="font-medium text-gray-900">{title}</p>
      <p className="text-xs text-gray-500">Now: aim {pct(targetBp)}, never below {pct(floorBp)} · ₹1,800 + 18% GST → {rupees(suggestPrice(180000, 18, targetBp))}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Target margin %<input aria-label={`${title} target margin`} inputMode="decimal" value={t} onChange={(e) => setT(e.target.value)} className="mt-1 block w-24 rounded-lg border border-gray-300 px-3 py-2" /></label>
        <label className="text-sm">Lowest allowed %<input aria-label={`${title} lowest margin`} inputMode="decimal" value={f} onChange={(e) => setF(e.target.value)} className="mt-1 block w-24 rounded-lg border border-gray-300 px-3 py-2" /></label>
        <button type="button" className={btn.primary} disabled={busy || invalid || !changed} onClick={() => onSave(t, f)}>Save</button>
        {onRemove && <button type="button" className={btn.secondary} disabled={busy} onClick={onRemove}>Use the default instead</button>}
      </div>
      {invalid && <p className="text-xs text-red-700">Use 0–90%, and the lowest allowed cannot be above the target.</p>}
    </div>
  );
}

function AddCategoryRule({ categories, busy, onAdd }: {
  categories: { _id: string; name: string }[]; busy: boolean; onAdd: (id: string, t: string, f: string) => void;
}) {
  const [cat, setCat] = useState('');
  const [t, setT] = useState('30');
  const [f, setF] = useState('10');
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-gray-300 p-4">
      <label className="text-sm">Category
        <select aria-label="Category for a new rule" value={cat} onChange={(e) => setCat(e.target.value)} className="mt-1 block rounded-lg border border-gray-300 px-3 py-2">
          <option value="">Pick…</option>
          {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
      </label>
      <label className="text-sm">Target %<input inputMode="decimal" value={t} onChange={(e) => setT(e.target.value)} className="mt-1 block w-20 rounded-lg border border-gray-300 px-3 py-2" /></label>
      <label className="text-sm">Lowest %<input inputMode="decimal" value={f} onChange={(e) => setF(e.target.value)} className="mt-1 block w-20 rounded-lg border border-gray-300 px-3 py-2" /></label>
      <button type="button" className={btn.secondary} disabled={busy || !cat} onClick={() => { onAdd(cat, t, f); setCat(''); }}>Add category rule</button>
    </div>
  );
}
