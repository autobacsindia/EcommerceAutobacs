'use client';

/**
 * "Create slip" on a project: the slips the admin set up (Admin → Slip
 * templates) for this project's form, then the project summary.
 *
 *   - a slip with no boxes of its own (delivery slip, job card) opens at once
 *   - a slip with its own boxes (the driver for an authorisation, the items of
 *     an office purchase) asks for them first, filled in with last time's
 *     answers; "Create slip" saves them on the project and opens the PDF
 *
 * The PDF is drawn by the server from what is saved; amounts on an item list
 * are worked out there, never here.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FileText, Loader2, Plus, Printer, Trash2, TriangleAlert, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { Dialog } from './Overlays';
import { isConflict, type Project, type ProjectSlip, type SlipField, type SlipItem } from './types';

/** Where a slip opens: the server renders it as a PDF to print or save. */
export const slipHref = (projectId: string, key: string) =>
  `/api/v1/staff/tasks/projects/${encodeURIComponent(projectId)}/slip/${encodeURIComponent(key)}`;

const SUMMARY: ProjectSlip = { key: 'summary', label: 'Project summary', missing: [], fields: [], values: {} };
const inputClass = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

export function SlipMenu({ p }: { p: Project }) {
  const [open, setOpen] = useState(false);
  const [filling, setFilling] = useState<ProjectSlip | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const slips = p.slips?.length ? p.slips : [SUMMARY];
  const canFill = !!p.can.editDetails;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={menuId}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gray-900 px-2.5 text-sm font-semibold text-white hover:bg-gray-800"
      >
        <Printer aria-hidden className="h-3.5 w-3.5" /> Create slip
      </button>
      {open && (
        <ul id={menuId} aria-label="Slips" className="absolute right-0 z-30 mt-1 max-h-[60vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {slips.map((s) => {
            // Its own boxes are asked for next, so only details missing from the project warn here.
            const asks = s.fields.length > 0 && canFill;
            const blank = asks ? s.missing.filter((m) => !s.fields.some((f) => f.label === m)) : s.missing;
            const body = (
              <>
                <FileText aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                <span className="min-w-0">
                  <span className="block font-medium text-gray-900">{s.label}</span>
                  {asks && <span className="block text-xs text-gray-500">Asks for: {s.fields.map((f) => f.label).slice(0, 3).join(', ')}{s.fields.length > 3 ? '…' : ''}</span>}
                  {blank.length > 0 && (
                    <span className="mt-0.5 flex gap-1 text-xs text-amber-800">
                      <TriangleAlert aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>Blank to fill by hand: {blank.join(', ')}</span>
                    </span>
                  )}
                </span>
              </>
            );
            return (
              <li key={s.key}>
                {asks ? (
                  <button onClick={() => { setOpen(false); setFilling(s); }} className="flex w-full gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50">{body}</button>
                ) : (
                  <a href={slipHref(p.id, s.key)} target="_blank" rel="noopener" onClick={() => setOpen(false)} className="flex gap-2 px-3 py-2 text-sm hover:bg-gray-50">{body}</a>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={!!filling} onClose={() => setFilling(null)} label={filling?.label || 'Slip'}>
        {filling && <SlipBoxesForm p={p} slip={filling} onDone={() => setFilling(null)} />}
      </Dialog>
    </div>
  );
}

// ── A slip's own boxes ──────────────────────────────────────────────────────

type Draft = Record<string, string | SlipItem[]>;
const toDraft = (slip: ProjectSlip): Draft => Object.fromEntries(slip.fields.map((f) => {
  const v = slip.values[f.key];
  if (f.type === 'items') return [f.key, Array.isArray(v) ? v.map((r) => ({ name: r.name, qty: String(r.qty), rate: String(r.rate) })) : [{ name: '', qty: '', rate: '' }]];
  return [f.key, v === undefined || v === null ? '' : String(v)];
}));

function Box({ f, value, onChange }: { f: SlipField; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const common = { id, value, placeholder: f.placeholder, onChange: (e: { target: { value: string } }) => onChange(e.target.value), className: inputClass };
  return (
    <label htmlFor={id} className={`block min-w-0 ${f.type === 'textarea' ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block text-xs font-medium text-gray-700">{f.label}</span>
      {f.type === 'textarea' ? <textarea {...common} rows={f.key === 'message' ? 6 : 3} maxLength={f.max ?? 1000} />
        : f.type === 'date' ? <input {...common} type="date" />
          : (
            <input
              {...common}
              type={f.type === 'phone' ? 'tel' : 'text'}
              inputMode={f.type === 'money' || f.type === 'number' ? 'decimal' : f.type === 'phone' ? 'tel' : undefined}
              maxLength={f.max ?? (f.type === 'phone' ? 20 : 120)}
              autoCapitalize={f.upper ? 'characters' : undefined}
            />
          )}
    </label>
  );
}

function ItemsBox({ f, rows, onChange }: { f: SlipField; rows: SlipItem[]; onChange: (rows: SlipItem[]) => void }) {
  const set = (i: number, patch: Partial<SlipItem>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="min-w-0 sm:col-span-2">
      <legend className="mb-1 text-xs font-medium text-gray-700">{f.label}</legend>
      <div className="space-y-2">
        <div className="hidden grid-cols-[minmax(0,1fr)_5rem_6rem_2rem] gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 sm:grid">
          <span>Item</span><span>Qty</span><span>Rate (₹)</span><span />
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_2rem] gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_6rem_2rem]">
            <input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Item" aria-label={`Item ${i + 1}`} maxLength={80} className={inputClass} />
            <input value={String(r.qty)} onChange={(e) => set(i, { qty: e.target.value })} placeholder="Qty" aria-label={`Item ${i + 1} quantity`} inputMode="decimal" className={inputClass} />
            <input value={String(r.rate)} onChange={(e) => set(i, { rate: e.target.value })} placeholder="Rate" aria-label={`Item ${i + 1} rate`} inputMode="decimal" className={inputClass} />
            <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove item ${i + 1}`} className="rounded p-1.5 text-gray-500 hover:bg-gray-100"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        {rows.length < 50 && (
          <button type="button" onClick={() => onChange([...rows, { name: '', qty: '', rate: '' }])} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">
            <Plus aria-hidden className="h-4 w-4" /> Add an item
          </button>
        )}
        <p className="text-xs text-gray-500">Amounts and the total are worked out on the slip.</p>
      </div>
    </fieldset>
  );
}

export function SlipBoxesForm({ p, slip, onDone }: { p: Project; slip: ProjectSlip; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => toDraft(slip));
  const save = useMutation({
    mutationFn: () => apiClient.put<{ project: Project }>(`/staff/tasks/projects/${encodeURIComponent(p.id)}/slips/${encodeURIComponent(slip.key)}`, {
      rev: p.rev,
      values: Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Array.isArray(v) ? v.filter((r) => r.name.trim() || String(r.qty).trim() || String(r.rate).trim()) : v.trim()])),
    }).then((r) => r.project),
  });

  const submit = () => {
    if (save.isPending) return;
    // Opened now, inside the click, so the browser lets it through; pointed at the PDF once saved.
    const tab = window.open('about:blank', '_blank');
    save.mutate(undefined, {
      onSuccess: (project) => {
        queryClient.setQueryData(taskKeys.project(project.id), project);
        void queryClient.invalidateQueries({ queryKey: taskKeys.projects() });
        const href = slipHref(p.id, slip.key);
        if (tab) tab.location.href = href; else window.location.assign(href);
        onDone();
      },
      onError: (e) => {
        tab?.close();
        if (isConflict(e)) {
          toast.error('Someone changed this project just now — reloaded. Your answers are still here: try again.');
          void queryClient.invalidateQueries({ queryKey: taskKeys.project(p.id) });
        } else {
          toast.error(errorMessage(e, 'Could not save the slip.'));
        }
      },
    });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex max-h-[84vh] flex-col overflow-hidden rounded-xl bg-white shadow-xl">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate font-semibold text-gray-900">{slip.label} — {p.name}</h2>
        <button type="button" onClick={onDone} aria-label="Close" className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid gap-3 overflow-y-auto px-4 py-3 sm:grid-cols-2">
        <p className="text-sm text-gray-600 sm:col-span-2">The rest comes from the project’s details. These answers are kept for next time.</p>
        {slip.fields.map((f) => (f.type === 'items' ? (
          <ItemsBox key={f.key} f={f} rows={(draft[f.key] as SlipItem[]) || []} onChange={(rows) => setDraft((d) => ({ ...d, [f.key]: rows }))} />
        ) : (
          <Box key={f.key} f={f} value={(draft[f.key] as string) ?? ''} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
        )))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">
        <a href={slipHref(p.id, slip.key)} target="_blank" rel="noopener" className="mr-auto text-sm font-medium text-gray-600 hover:underline">Print last saved</a>
        <button type="button" onClick={onDone} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
        <button type="submit" disabled={save.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Create slip
        </button>
      </div>
    </form>
  );
}
