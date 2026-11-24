'use client';

/**
 * A project's "Job details" box, its editor, and the "Create slip" menu
 * (Back-end services/staffProjectDetailsService.js, projectSlipService.js).
 *
 * The form is drawn from the server's template list, and the server checks
 * every field again — this screen only helps fill it in. The balance on screen
 * and on every slip is the server's number, never worked out here. Nothing
 * shows as saved until the server says so.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ClipboardList, FileText, Link2, Loader2, Pencil, Plus, Printer, Trash2, TriangleAlert, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { Dialog } from './Overlays';
import { SlipMenu } from './SlipMenu';

export { slipHref, SlipMenu } from './SlipMenu';
import { LONG_TEXT_MAX, formatDueDay, isConflict, type Project, type ProjectDetails, type ProjectField, type ProjectTemplate, type ProjectTemplates } from './types';
import EntityLink from '@/components/ui/EntityLink';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** A stored value as the box shows it. */
export function shownValue(field: Pick<ProjectField, 'type'>, value: string | number | undefined): string {
  if (value === undefined || value === null || value === '') return '';
  if (field.type === 'money') return rupees(Number(value));
  if (field.type === 'date') return formatDueDay(String(value));
  if (field.type === 'number') return Number(value).toLocaleString('en-IN');
  return String(value);
}

export function useProjectTemplates(enabled = true) {
  return useQuery({
    queryKey: taskKeys.projectTemplates(),
    queryFn: () => apiClient.get<ProjectTemplates>('/staff/tasks/projects/templates'),
    staleTime: Infinity,
    enabled,
  });
}

// ── The box on the project page ─────────────────────────────────────────────

export function ProjectDetailsPanel({ p }: { p: Project }) {
  const [editing, setEditing] = useState(false);
  const d = p.details;
  const templates = useProjectTemplates();
  const template = templates.data?.templates?.find((t) => t.key === d?.template);
  const canEdit = !!p.can.editDetails;

  return (
    <section aria-label="Job details" className="rounded-xl border border-gray-200 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardList aria-hidden className="h-4 w-4 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-900">Job details</h3>
        {d && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-700">{d.templateLabel}</span>}
        {d?.order && <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-800"><Link2 aria-hidden className="h-3 w-3" />Order <EntityLink type="order" id={d.order.id} value={d.order.number} label="Order number" /></span>}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <SlipMenu p={p} />
          {canEdit && d && (
            <button onClick={() => setEditing(true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Pencil aria-hidden className="h-3.5 w-3.5" /> Edit details
            </button>
          )}
        </span>
      </div>

      {!d ? (
        <div className="mt-3 flex flex-col items-start gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-600">
          <p>Nothing here yet. Keep the job’s facts in one place — for a sale: the customer, the vehicle, the date it came in, the work and the price.</p>
          {canEdit && (
            <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">
              <Plus aria-hidden className="h-4 w-4" /> Add details
            </button>
          )}
        </div>
      ) : (
        <DetailsView d={d} template={template} />
      )}

      <Dialog open={editing} onClose={() => setEditing(false)} label="Job details">
        {editing && <DetailsForm p={p} onDone={() => setEditing(false)} />}
      </Dialog>
    </section>
  );
}

function DetailsView({ d, template }: { d: ProjectDetails; template?: ProjectTemplate }) {
  const groups = template ? Object.entries(template.groups) : [];
  const filled = (f: ProjectField) => shownValue(f, d.values[f.key]) !== '';
  const anything = (template?.fields.some(filled) ?? false) || d.custom.length > 0;
  if (!anything) return <p className="mt-2 text-sm text-gray-500">No details filled in yet.</p>;
  return (
    <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {groups.map(([g, title]) => {
        const fields = template!.fields.filter((f) => f.group === g && filled(f));
        if (!fields.length) return null;
        return (
          <div key={g} className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</p>
            <dl className="mt-1 space-y-1 text-sm">
              {fields.map((f) => (
                <div key={f.key} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2">
                  <dt className="text-gray-500">{f.label.replace(/\s*\(₹\)$/, '')}</dt>
                  <dd className="whitespace-pre-line break-words text-gray-900">{shownValue(f, d.values[f.key])}</dd>
                </div>
              ))}
              {g === 'money' && d.balance !== null && (
                <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2">
                  <dt className="font-medium text-gray-700">Balance due</dt>
                  <dd className="font-semibold tabular-nums text-gray-900">{rupees(d.balance)}</dd>
                </div>
              )}
            </dl>
          </div>
        );
      })}
      {d.custom.length > 0 && (
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Other details</p>
          <dl className="mt-1 space-y-1 text-sm">
            {d.custom.map((c, i) => (
              <div key={`${c.label}-${i}`} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2">
                <dt className="truncate text-gray-500" title={c.label}>{c.label}</dt>
                <dd className="whitespace-pre-line break-words text-gray-900">{c.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {d.updatedByName && d.updatedAt && (
        <p className="text-xs text-gray-500 sm:col-span-2">Last changed by {d.updatedByName}</p>
      )}
    </div>
  );
}

// ── The editor ──────────────────────────────────────────────────────────────

type Draft = { template: string; values: Record<string, string>; custom: { label: string; value: string }[]; orderId?: string | null; orderNumber?: string };

const toDraft = (d: ProjectDetails | null, fallback: string): Draft => ({
  template: d?.template || fallback,
  values: Object.fromEntries(Object.entries(d?.values || {}).map(([k, v]) => [k, String(v)])),
  custom: d?.custom.map((c) => ({ ...c })) || [],
  orderNumber: d?.order?.number,
});

const inputClass = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

function FieldInput({ f, value, onChange }: { f: ProjectField; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const common = { id, value, placeholder: f.placeholder, onChange: (e: { target: { value: string } }) => onChange(e.target.value), className: inputClass };
  return (
    <label htmlFor={id} className={`block min-w-0 ${f.type === 'textarea' ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block text-xs font-medium text-gray-700">{f.label}</span>
      {f.type === 'textarea' ? (
        <textarea {...common} rows={3} maxLength={LONG_TEXT_MAX} />
      ) : f.type === 'date' ? (
        <input {...common} type="date" />
      ) : (
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

export function DetailsForm({ p, onDone }: { p: Project; onDone: () => void }) {
  const queryClient = useQueryClient();
  const templates = useProjectTemplates();
  const list = templates.data?.templates ?? [];
  // A new project starts on the sales form when a sales or operations team is in it.
  const guess = p.teams.some((t) => t.value === 'sales' || t.value === 'operations') ? 'sales' : 'general';
  const [draft, setDraft] = useState<Draft>(() => toDraft(p.details ?? null, guess));
  const [orderQuery, setOrderQuery] = useState('');
  const template = list.find((t) => t.key === draft.template);
  const limits = templates.data?.limits;

  const setValue = (k: string, v: string) => setDraft((d) => ({ ...d, values: { ...d.values, [k]: v } }));
  const changeTemplate = (key: string) => {
    const next = list.find((t) => t.key === key);
    const keep = new Set(next?.fields.map((f) => f.key));
    const lost = Object.entries(draft.values).filter(([k, v]) => v.trim() && !keep.has(k));
    if (lost.length && !window.confirm(`The ${next?.label} form has no place for ${lost.length} filled-in field${lost.length === 1 ? '' : 's'}. They will be cleared when you save. Switch anyway?`)) return;
    setDraft((d) => ({ ...d, template: key, values: Object.fromEntries(Object.entries(d.values).filter(([k]) => keep.has(k))) }));
  };

  const fromOrder = useMutation({
    mutationFn: (q: string) => apiClient.get<{ order: { id: string; number: string }; values: Record<string, string> }>(
      `/staff/tasks/projects/${encodeURIComponent(p.id)}/details/from-order?q=${encodeURIComponent(q)}`,
    ),
    onSuccess: (r) => {
      setDraft((d) => ({ ...d, template: d.template === 'general' ? 'sales' : d.template, orderId: r.order.id, orderNumber: r.order.number, values: { ...d.values, ...r.values } }));
      setOrderQuery('');
      toast.success(`Filled from order ${r.order.number} — check and save`);
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not find that order.')),
  });

  const save = useMutation({
    mutationFn: () => apiClient.put<{ project: Project }>(`/staff/tasks/projects/${encodeURIComponent(p.id)}/details`, {
      rev: p.rev,
      template: draft.template,
      values: Object.fromEntries(Object.entries(draft.values).filter(([, v]) => v.trim() !== '')),
      custom: draft.custom.filter((c) => c.label.trim() || c.value.trim()),
      ...(draft.orderId !== undefined && { orderId: draft.orderId }),
    }).then((r) => r.project),
    onSuccess: (project) => {
      queryClient.setQueryData(taskKeys.project(project.id), project);
      toast.success('Details saved');
      onDone();
      return queryClient.invalidateQueries({ queryKey: taskKeys.projects() });
    },
    onError: (e) => {
      if (isConflict(e)) {
        toast.error('Someone changed this project just now — reloaded. Your changes are still here: save again.');
        void queryClient.invalidateQueries({ queryKey: taskKeys.project(p.id) });
      } else {
        toast.error(errorMessage(e, 'Could not save the details.'));
      }
    },
  });

  if (templates.isPending) return <div className="rounded-xl bg-white p-6 text-sm text-gray-600"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading the form…</div>;
  if (templates.isError) return <div role="alert" className="rounded-xl bg-white p-6 text-sm text-red-700">{errorMessage(templates.error, 'Could not load the form.')}</div>;

  const groups = template ? Object.entries(template.groups) : [];
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!save.isPending) save.mutate(); }}
      className="flex max-h-[84vh] flex-col overflow-hidden rounded-xl bg-white shadow-xl"
    >
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate font-semibold text-gray-900">Job details — {p.name}</h2>
        <button type="button" onClick={onDone} aria-label="Close" className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-4 overflow-y-auto px-4 py-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">Form</span>
          <select value={draft.template} onChange={(e) => changeTemplate(e.target.value)} className={inputClass}>
            {list.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          {template?.hint && <span className="mt-1 block text-xs text-gray-500">{template.hint}</span>}
        </label>

        {p.can.fillFromOrder && (
          <div className="rounded-lg bg-blue-50/60 p-2.5">
            <p className="text-xs font-medium text-gray-700">Fill the customer from an order</p>
            <div className="mt-1.5 flex gap-2">
              <input
                value={orderQuery}
                onChange={(e) => setOrderQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (orderQuery.trim()) fromOrder.mutate(orderQuery.trim()); } }}
                placeholder="Order number like #AB12CD34, or its link"
                aria-label="Order number or link"
                className={inputClass}
              />
              <button type="button" disabled={!orderQuery.trim() || fromOrder.isPending} onClick={() => fromOrder.mutate(orderQuery.trim())} className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50">
                {fromOrder.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Fill'}
              </button>
            </div>
            {draft.orderNumber && (
              <p className="mt-1.5 flex items-center gap-2 text-xs text-blue-900">
                <Link2 aria-hidden className="h-3 w-3" /> Linked to order {draft.orderNumber}
                <button type="button" onClick={() => setDraft((d) => ({ ...d, orderId: null, orderNumber: undefined }))} className="font-medium underline">Unlink</button>
              </p>
            )}
          </div>
        )}

        {groups.map(([g, title]) => (
          <fieldset key={g} className="min-w-0">
            <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {template!.fields.filter((f) => f.group === g).map((f) => (
                <FieldInput key={f.key} f={f} value={draft.values[f.key] ?? ''} onChange={(v) => setValue(f.key, v)} />
              ))}
            </div>
          </fieldset>
        ))}

        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Other details</legend>
          <div className="space-y-2">
            {draft.custom.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={c.label}
                  onChange={(e) => setDraft((d) => ({ ...d, custom: d.custom.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))}
                  placeholder="Name, e.g. Key tag"
                  aria-label={`Extra field ${i + 1} name`}
                  maxLength={limits?.customLabel ?? 40}
                  className={`${inputClass} w-2/5`}
                />
                <input
                  value={c.value}
                  onChange={(e) => setDraft((d) => ({ ...d, custom: d.custom.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) }))}
                  placeholder="Value"
                  aria-label={`Extra field ${i + 1} value`}
                  maxLength={limits?.customValue ?? LONG_TEXT_MAX}
                  className={inputClass}
                />
                <button type="button" onClick={() => setDraft((d) => ({ ...d, custom: d.custom.filter((_, j) => j !== i) }))} aria-label={`Remove extra field ${i + 1}`} className="shrink-0 rounded p-1.5 text-gray-500 hover:bg-gray-100">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {draft.custom.length < (limits?.customFields ?? 20) && (
              <button type="button" onClick={() => setDraft((d) => ({ ...d, custom: [...d.custom, { label: '', value: '' }] }))} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">
                <Plus aria-hidden className="h-4 w-4" /> Add a field
              </button>
            )}
          </div>
        </fieldset>
      </div>
      <div className="flex justify-end gap-2 border-t border-gray-100 px-4 py-3">
        <button type="button" onClick={onDone} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
        <button type="submit" disabled={save.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save details
        </button>
      </div>
    </form>
  );
}
