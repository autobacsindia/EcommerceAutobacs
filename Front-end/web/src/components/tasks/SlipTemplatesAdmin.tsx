'use client';

/**
 * Admin → Slip templates. The slips a project offers under "Create slip"
 * (delivery slip, job card, driver authorisation, letter to the RTO, office
 * purchase…) live in the database, so a new one needs no code release.
 *
 * Every check is on the server (services/slipTemplateService.js) and its
 * plain-English refusal is shown as is; this screen only arranges the form.
 * "Preview" draws the draft as a PDF with [Labels] in place of real values,
 * saving nothing.
 */
import { useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowDown, ArrowUp, Eye, EyeOff, FileText, Loader2, Pencil, Plus, RotateCcw, Trash2, Undo2,
} from 'lucide-react';
import apiClient from '@/lib/api-client';
import { tokenManager } from '@/lib/http/tokenManager';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { isConflict } from './types';

// ── Shapes (as GET /admin/slip-templates sends them) ───────────────────────

export type SlipBoxType = 'text' | 'textarea' | 'phone' | 'date' | 'number' | 'money' | 'items';
export interface SlipBox { key: string; label: string; type: SlipBoxType; max?: number; upper?: boolean; placeholder?: string; notBefore?: string }
export type SlipBlock =
  | { type: 'section'; title?: string; keys: string[] }
  | { type: 'paragraph'; text: string; bold?: boolean }
  | { type: 'items'; key: string };
export interface SlipTemplate {
  id: string; key: string; label: string; title: string; forms: string[];
  fields: SlipBox[]; blocks: SlipBlock[]; needs: string[]; declaration: string; signatures: string[];
  active: boolean; isDefault: boolean; order: number; rev: number;
  archivedAt: string | null; updatedAt: string | null; updatedByName: string;
}
interface Named { key: string; label: string; type: string }
export interface SlipEditorOptions {
  forms: { key: string; label: string; fields: Named[] }[];
  computed: Named[];
  fieldTypes: SlipBoxType[];
  limits: { fields: number; blocks: number; signatures: number; templates: number };
}
interface ListResponse { templates: SlipTemplate[]; options: SlipEditorOptions }

const BASE = '/admin/slip-templates';
const TYPE_LABEL: Record<SlipBoxType, string> = {
  text: 'Short text', textarea: 'Long text', phone: 'Phone', date: 'Date', number: 'Number', money: 'Amount (₹)', items: 'Item list',
};
const input = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium';

type Draft = Omit<SlipTemplate, 'id' | 'isDefault' | 'rev' | 'archivedAt' | 'updatedAt' | 'updatedByName'>;
const BLANK: Draft = {
  key: '', label: '', title: '', forms: [], fields: [], blocks: [{ type: 'section', title: '', keys: [] }],
  needs: [], declaration: '', signatures: ['Authorised signatory'], active: true, order: 100,
};
const draftOf = (t: SlipTemplate): Draft => ({
  key: t.key, label: t.label, title: t.title, forms: [...t.forms], fields: t.fields.map((f) => ({ ...f })),
  blocks: t.blocks.map((b) => (b.type === 'section' ? { ...b, keys: [...b.keys] } : { ...b })),
  needs: [...t.needs], declaration: t.declaration, signatures: [...t.signatures], active: t.active, order: t.order,
});
/** What the server stores: drop empty optional bits so a blank box is not a value. */
const payloadOf = (d: Draft) => ({
  ...d,
  fields: d.fields.map((f) => ({
    key: f.key.trim(), label: f.label.trim(), type: f.type,
    ...(f.upper && { upper: true }),
    ...(f.placeholder?.trim() && { placeholder: f.placeholder.trim() }),
    ...(f.notBefore && f.type === 'date' && { notBefore: f.notBefore }),
  })),
  signatures: d.signatures.map((s) => s.trim()).filter(Boolean),
});

/** Puts a placeholder where the cursor is in the paragraph (the end when it is not in it). */
export const insertAt = (el: HTMLElement | null, text: string, piece: string) => {
  const ta = el instanceof HTMLTextAreaElement && document.activeElement === el ? el : null;
  const at = ta ? ta.selectionStart : text.length;
  const to = ta ? ta.selectionEnd : text.length;
  return `${text.slice(0, at)}${piece}${text.slice(to)}`;
};

/** Turns a label into a box code: "Driver name" → driverName. */
const codeOf = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : '')).replace(/^[^a-z]+/, '').slice(0, 40);

// ── The page ────────────────────────────────────────────────────────────────

export default function SlipTemplatesAdmin() {
  const list = useQuery({
    queryKey: taskKeys.slipTemplates(),
    queryFn: () => apiClient.get<ListResponse>(BASE),
    staleTime: 30_000,
  });
  const [editing, setEditing] = useState<SlipTemplate | 'new' | null>(null);

  if (editing && list.data) {
    return (
      <Editor
        template={editing === 'new' ? null : editing}
        options={list.data.options}
        onClose={() => setEditing(null)}
      />
    );
  }

  const templates = list.data?.templates ?? [];
  const live = templates.filter((t) => !t.archivedAt);
  const deleted = templates.filter((t) => t.archivedAt);
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-gray-900">Slip templates</h1>
          <p className="mt-1 text-sm text-gray-600">
            The slips a project can print from <b>Create slip</b>. Details already on the project fill themselves in;
            boxes added here are asked for when the slip is made. Changes apply to the next slip printed.
          </p>
        </div>
        <button onClick={() => setEditing('new')} disabled={!list.data} className={`${btn} bg-blue-600 font-semibold text-white hover:bg-blue-700 disabled:opacity-60`}>
          <Plus aria-hidden className="h-4 w-4" /> New slip
        </button>
      </header>

      {list.isLoading && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {list.isError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {errorMessage(list.error, 'Could not load the slip templates.')}{' '}
          <button onClick={() => list.refetch()} className="font-medium underline">Try again</button>
        </p>
      )}

      {list.data && (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          <li className="flex items-center gap-3 px-4 py-3 text-sm text-gray-600">
            <FileText aria-hidden className="h-4 w-4 shrink-0 text-gray-400" />
            <span><b className="text-gray-900">Project summary</b> — built in, on every project; prints whatever the project holds.</span>
          </li>
          {live.map((t) => <Row key={t.id} t={t} options={list.data.options} onEdit={() => setEditing(t)} />)}
        </ul>
      )}

      {deleted.length > 0 && (
        <section aria-label="Deleted">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Deleted</h2>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {deleted.map((t) => <Row key={t.id} t={t} options={list.data!.options} onEdit={() => setEditing(t)} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

function useChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ t, body, reset }: { t: SlipTemplate; body: Record<string, unknown>; reset?: boolean }) =>
      (reset
        ? apiClient.post<{ template: SlipTemplate }>(`${BASE}/${t.id}/reset`, { rev: t.rev, ...body })
        : apiClient.patch<{ template: SlipTemplate }>(`${BASE}/${t.id}`, { rev: t.rev, ...body })
      ).then((r) => r.template),
    onSettled: () => queryClient.invalidateQueries({ queryKey: taskKeys.slipTemplates() }),
    onError: (e) => toast.error(isConflict(e) ? 'Someone changed it just now — reloaded. Try again.' : errorMessage(e, 'That did not work.')),
  });
}

function Row({ t, options, onEdit }: { t: SlipTemplate; options: SlipEditorOptions; onEdit: () => void }) {
  const change = useChange();
  const formNames = t.forms.length ? t.forms.map((k) => options.forms.find((f) => f.key === k)?.label || k).join(', ') : 'Every project';
  const busy = change.isPending;
  const del = !!t.archivedAt;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium text-gray-900">
          {t.label}
          {t.isDefault && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">Built in</span>}
          {!del && !t.active && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Hidden</span>}
        </p>
        <p className="text-xs text-gray-500">
          {formNames} · {t.fields.length ? `asks for ${t.fields.length} box${t.fields.length === 1 ? '' : 'es'}` : 'one click'}
          {t.updatedByName && ` · last changed by ${t.updatedByName}`}
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        {!del && (
          <>
            <button onClick={onEdit} className={`${btn} text-gray-700 hover:bg-gray-100`}><Pencil aria-hidden className="h-4 w-4" /> Edit</button>
            <button disabled={busy} onClick={() => change.mutate({ t, body: { ...draftOf(t), active: !t.active } })} className={`${btn} text-gray-700 hover:bg-gray-100 disabled:opacity-60`}>
              {t.active ? <><EyeOff aria-hidden className="h-4 w-4" /> Hide</> : <><Eye aria-hidden className="h-4 w-4" /> Show</>}
            </button>
            {t.isDefault && (
              <button
                disabled={busy}
                onClick={() => { if (window.confirm(`Put “${t.label}” back to how it came? Your changes to it are lost.`)) change.mutate({ t, body: {}, reset: true }); }}
                className={`${btn} text-gray-700 hover:bg-gray-100 disabled:opacity-60`}
              >
                <RotateCcw aria-hidden className="h-4 w-4" /> Reset
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => { if (window.confirm(`Delete “${t.label}”? It leaves the Create slip menu; you can restore it from Deleted.`)) change.mutate({ t, body: { archived: true } }); }}
              className={`${btn} text-red-700 hover:bg-red-50 disabled:opacity-60`}
            >
              <Trash2 aria-hidden className="h-4 w-4" /> Delete
            </button>
          </>
        )}
        {del && (
          <button disabled={busy} onClick={() => change.mutate({ t, body: { archived: false } })} className={`${btn} text-gray-700 hover:bg-gray-100 disabled:opacity-60`}>
            <Undo2 aria-hidden className="h-4 w-4" /> Restore
          </button>
        )}
      </div>
    </li>
  );
}

// ── The editor ──────────────────────────────────────────────────────────────

async function openPreview(draft: Draft) {
  // Opened inside the click so the browser allows it; filled once the PDF is back.
  const tab = window.open('about:blank', '_blank');
  try {
    await tokenManager.ensureCsrfToken();
    const headers = { ...(tokenManager.getHeaders() as Record<string, string>), 'Content-Type': 'application/json' };
    const res = await fetch(`/api/v1${BASE}/preview`, { method: 'POST', headers, credentials: 'include', body: JSON.stringify({ ...payloadOf(draft), key: draft.key || 'preview_draft' }) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.message || 'Could not draw the preview.');
    }
    const url = URL.createObjectURL(await res.blob());
    if (tab) {
      tab.location.href = url;
    } else {
      // Pop-ups blocked: download it rather than leave the page and lose the draft.
      const a = Object.assign(document.createElement('a'), { href: url, download: 'Slip-preview.pdf' });
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    toast.error(e instanceof Error ? e.message : 'Could not draw the preview.');
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
      {children(id)}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function Editor({ template, options, onClose }: { template: SlipTemplate | null; options: SlipEditorOptions; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [d, setD] = useState<Draft>(() => (template ? draftOf(template) : { ...BLANK, blocks: BLANK.blocks.map((b) => ({ ...b })) }));
  const [rev, setRev] = useState(template?.rev ?? 0);
  const [previewing, setPreviewing] = useState(false);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  // What this slip can print: its own boxes, its forms' details, worked-out values.
  const printable = useMemo(() => {
    const forms = options.forms.filter((f) => !d.forms.length || d.forms.includes(f.key));
    const seen = new Set<string>();
    const out: { group: string; items: Named[] }[] = [];
    const add = (group: string, items: Named[]) => {
      const fresh = items.filter((i) => i.key && !seen.has(i.key) && i.type !== 'items');
      fresh.forEach((i) => seen.add(i.key));
      if (fresh.length) out.push({ group, items: fresh });
    };
    add('This slip’s boxes', d.fields.map((f) => ({ key: f.key, label: f.label || f.key, type: f.type })));
    forms.forEach((f) => add(`${f.label} details`, f.fields));
    add('Worked out', options.computed);
    return out;
  }, [d.fields, d.forms, options]);
  const computedKeys = new Set(options.computed.map((c) => c.key));
  const itemBoxes = d.fields.filter((f) => f.type === 'items' && f.key);

  const save = useMutation({
    mutationFn: () => (template
      ? apiClient.patch<{ template: SlipTemplate }>(`${BASE}/${template.id}`, { rev, ...payloadOf(d), key: undefined })
      : apiClient.post<{ template: SlipTemplate }>(BASE, payloadOf(d))
    ).then((r) => r.template),
    onSuccess: (t) => {
      toast.success(template ? 'Saved — the next slip printed uses it.' : 'Added to Create slip.');
      void queryClient.invalidateQueries({ queryKey: taskKeys.slipTemplates() });
      setRev(t.rev);
      onClose();
    },
    onError: async (e) => {
      if (isConflict(e) && template) {
        // Keep the form; pick up the new rev so a second Save overwrites knowingly.
        const fresh = await queryClient.fetchQuery({ queryKey: taskKeys.slipTemplates(), queryFn: () => apiClient.get<ListResponse>(BASE) }).catch(() => null);
        const now = fresh?.templates.find((x) => x.id === template.id);
        if (now) setRev(now.rev);
        toast.error(`${now?.updatedByName || 'Someone'} changed this slip just now. Save again to replace their version with yours.`);
        return;
      }
      toast.error(errorMessage(e, 'Could not save the slip.'));
    },
  });

  const setBox = (i: number, patch: Partial<SlipBox>) => set({ fields: d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const setBlock = (i: number, b: SlipBlock) => set({ blocks: d.blocks.map((x, j) => (j === i ? b : x)) });
  const move = <T,>(arr: T[], i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= arr.length) return arr;
    const next = [...arr];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!save.isPending) save.mutate(); }} className="mx-auto max-w-4xl space-y-5 px-4 pt-4 sm:px-6 sm:pt-6">
      <header>
        <button type="button" onClick={onClose} className="text-sm font-medium text-blue-700 hover:underline">← All slip templates</button>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">{template ? `Edit “${template.label}”` : 'New slip'}</h1>
      </header>

      <section className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-2">
        <Field label="Name in the menu">{(id) => <input id={id} className={input} value={d.label} maxLength={60} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Gate pass" />}</Field>
        <Field label="Heading printed on the slip">{(id) => <input id={id} className={input} value={d.title} maxLength={40} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. GATE PASS" />}</Field>
        <Field label="Code" hint={template ? 'Fixed once made — saved answers are filed under it.' : 'Lowercase letters, digits or _, like rto_letter. Cannot change later.'}>
          {(id) => <input id={id} className={`${input} font-mono disabled:bg-gray-50 disabled:text-gray-500`} value={d.key} disabled={!!template} maxLength={40} onChange={(e) => set({ key: e.target.value.toLowerCase() })} placeholder="e.g. gate_pass" />}
        </Field>
        <Field label="Place in the menu" hint="Lower comes first.">{(id) => <input id={id} className={input} type="number" min={0} max={1000} value={d.order} onChange={(e) => set({ order: Number(e.target.value) })} />}</Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-xs font-medium text-gray-700">Offered on</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {options.forms.map((f) => (
              <label key={f.key} className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={d.forms.includes(f.key)} onChange={(e) => set({ forms: e.target.checked ? [...d.forms, f.key] : d.forms.filter((k) => k !== f.key) })} />
                {f.label} projects
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-500">Tick none to offer it on every project. A detail a project’s form does not have prints as a blank line.</p>
        </fieldset>
        <label className="inline-flex items-center gap-1.5 text-sm sm:col-span-2">
          <input type="checkbox" checked={d.active} onChange={(e) => set({ active: e.target.checked })} /> Show it in Create slip
        </label>
      </section>

      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-gray-900">Boxes asked when the slip is made</h2>
        <p className="text-sm text-gray-600">Only what the project does not already hold — like the driver, or the items bought. Leave empty for a one-click slip.</p>
        {d.fields.map((f, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-gray-100 p-2 sm:grid-cols-[minmax(0,1fr)_9rem_8rem_auto]">
            <input aria-label={`Box ${i + 1} name`} className={input} value={f.label} maxLength={60} placeholder="Box name"
              onChange={(e) => setBox(i, { label: e.target.value, ...((!f.key || f.key === codeOf(f.label)) && !template?.fields.some((o) => o.key === f.key) && { key: codeOf(e.target.value) }) })} />
            <select aria-label={`Box ${i + 1} kind`} className={input} value={f.type} onChange={(e) => setBox(i, { type: e.target.value as SlipBoxType })}>
              {options.fieldTypes.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>)}
            </select>
            <input aria-label={`Box ${i + 1} code`} className={`${input} font-mono`} value={f.key} maxLength={40} placeholder="code" onChange={(e) => setBox(i, { key: e.target.value })} />
            <div className="flex items-center gap-1">
              <button type="button" aria-label={`Move box ${i + 1} up`} onClick={() => set({ fields: move(d.fields, i, -1) })} className="rounded p-1.5 text-gray-500 hover:bg-gray-100"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" aria-label={`Remove box ${i + 1}`} onClick={() => set({ fields: d.fields.filter((_, j) => j !== i) })} className="rounded p-1.5 text-gray-500 hover:bg-gray-100"><Trash2 className="h-4 w-4" /></button>
            </div>
            {(f.type === 'text' || f.type === 'date') && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 sm:col-span-4">
                {f.type === 'text' && (
                  <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!f.upper} onChange={(e) => setBox(i, { upper: e.target.checked })} /> CAPITALS (registration, licence no.)</label>
                )}
                {f.type === 'date' && (
                  <label className="inline-flex items-center gap-1.5">Not before
                    <select className="rounded border border-gray-300 px-1.5 py-0.5" value={f.notBefore || ''} onChange={(e) => setBox(i, { notBefore: e.target.value || undefined })}>
                      <option value="">—</option>
                      {d.fields.filter((o) => o.type === 'date' && o.key && o.key !== f.key).map((o) => <option key={o.key} value={o.key}>{o.label || o.key}</option>)}
                    </select>
                  </label>
                )}
              </div>
            )}
          </div>
        ))}
        {d.fields.length < options.limits.fields && (
          <button type="button" onClick={() => set({ fields: [...d.fields, { key: '', label: '', type: 'text' }] })} className={`${btn} text-blue-700 hover:bg-blue-50`}>
            <Plus aria-hidden className="h-4 w-4" /> Add a box
          </button>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-gray-900">What is printed, top to bottom</h2>
        {d.blocks.map((b, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-gray-100 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label={`Block ${i + 1} kind`} className="rounded-lg border border-gray-300 px-2 py-1 text-sm" value={b.type}
                onChange={(e) => {
                  const type = e.target.value as SlipBlock['type'];
                  setBlock(i, type === 'section' ? { type, title: '', keys: [] } : type === 'paragraph' ? { type, text: '' } : { type, key: itemBoxes[0]?.key || '' });
                }}>
                <option value="section">Details (label — value rows)</option>
                <option value="paragraph">Paragraph</option>
                <option value="items">Item table</option>
              </select>
              <span className="flex-1" />
              <button type="button" aria-label={`Move block ${i + 1} up`} onClick={() => set({ blocks: move(d.blocks, i, -1) })} className="rounded p-1.5 text-gray-500 hover:bg-gray-100"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" aria-label={`Move block ${i + 1} down`} onClick={() => set({ blocks: move(d.blocks, i, 1) })} className="rounded p-1.5 text-gray-500 hover:bg-gray-100"><ArrowDown className="h-4 w-4" /></button>
              <button type="button" aria-label={`Remove block ${i + 1}`} onClick={() => set({ blocks: d.blocks.filter((_, j) => j !== i) })} className="rounded p-1.5 text-gray-500 hover:bg-gray-100"><Trash2 className="h-4 w-4" /></button>
            </div>
            {b.type === 'section' && (
              <>
                <input aria-label={`Block ${i + 1} title`} className={input} value={b.title || ''} maxLength={60} placeholder="Title (optional), like Vehicle" onChange={(e) => setBlock(i, { ...b, title: e.target.value })} />
                {printable.map((g) => (
                  <fieldset key={g.group}>
                    <legend className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{g.group}</legend>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      {g.items.map((it) => (
                        <label key={it.key} className="inline-flex items-center gap-1.5">
                          <input type="checkbox" checked={b.keys.includes(it.key)} onChange={(e) => setBlock(i, { ...b, keys: e.target.checked ? [...b.keys, it.key] : b.keys.filter((k) => k !== it.key) })} />
                          {it.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </>
            )}
            {b.type === 'paragraph' && (
              <>
                <textarea id={`slip-block-${i}`} aria-label={`Block ${i + 1} text`} className={input} rows={4} maxLength={2000} value={b.text} onChange={(e) => setBlock(i, { ...b, text: e.target.value })}
                  placeholder="We authorise {{driverName}} to drive vehicle {{vehicleReg}}…" />
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-xs text-gray-500">Insert:</span>
                  {printable.flatMap((g) => g.items).map((it) => (
                    <button key={it.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setBlock(i, { ...b, text: insertAt(document.getElementById(`slip-block-${i}`), b.text, `{{${it.key}}}`) })} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-200">
                      {it.label}
                    </button>
                  ))}
                </div>
                <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={!!b.bold} onChange={(e) => setBlock(i, { ...b, bold: e.target.checked })} /> Bold</label>
              </>
            )}
            {b.type === 'items' && (
              itemBoxes.length ? (
                <select aria-label={`Block ${i + 1} item list`} className={input} value={b.key} onChange={(e) => setBlock(i, { ...b, key: e.target.value })}>
                  <option value="">Pick an item-list box</option>
                  {itemBoxes.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
                </select>
              ) : <p className="text-sm text-amber-800">Add a box of kind “Item list” above first.</p>
            )}
          </div>
        ))}
        {d.blocks.length < options.limits.blocks && (
          <button type="button" onClick={() => set({ blocks: [...d.blocks, { type: 'section', title: '', keys: [] }] })} className={`${btn} text-blue-700 hover:bg-blue-50`}>
            <Plus aria-hidden className="h-4 w-4" /> Add a block
          </button>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-gray-900">Bottom of the slip</h2>
        <Field label="Closing line (optional)">{(id) => <textarea id={id} className={input} rows={2} maxLength={400} value={d.declaration} onChange={(e) => set({ declaration: e.target.value })} placeholder="Received the vehicle in good condition." />}</Field>
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-gray-700">Signature boxes (up to {options.limits.signatures})</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {d.signatures.map((s, i) => (
              <div key={i} className="flex gap-1">
                <input aria-label={`Signature box ${i + 1}`} className={input} value={s} maxLength={40} onChange={(e) => set({ signatures: d.signatures.map((x, j) => (j === i ? e.target.value : x)) })} />
                <button type="button" aria-label={`Remove signature box ${i + 1}`} onClick={() => set({ signatures: d.signatures.filter((_, j) => j !== i) })} className="rounded p-1.5 text-gray-500 hover:bg-gray-100"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          {d.signatures.length < options.limits.signatures && (
            <button type="button" onClick={() => set({ signatures: [...d.signatures, ''] })} className={`${btn} mt-1 text-blue-700 hover:bg-blue-50`}><Plus aria-hidden className="h-4 w-4" /> Add a signature box</button>
          )}
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-gray-700">Warn before printing if empty</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {printable.flatMap((g) => g.items).filter((it) => !computedKeys.has(it.key)).map((it) => (
              <label key={it.key} className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={d.needs.includes(it.key)} onChange={(e) => set({ needs: e.target.checked ? [...d.needs, it.key] : d.needs.filter((k) => k !== it.key) })} />
                {it.label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-500">The slip still prints, with a line to fill by hand.</p>
        </fieldset>
      </section>

      <div className="sticky bottom-0 z-20 -mx-4 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" disabled={previewing} onClick={async () => { setPreviewing(true); await openPreview(d); setPreviewing(false); }} className={`${btn} mr-auto border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-60`}>
            {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Preview PDF
          </button>
          <button type="button" onClick={onClose} className={`${btn} text-gray-700 hover:bg-gray-100`}>Cancel</button>
          <button type="submit" disabled={save.isPending} className={`${btn} bg-blue-600 font-semibold text-white hover:bg-blue-700 disabled:opacity-60`}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {template ? 'Save' : 'Add slip'}
          </button>
        </div>
      </div>
    </form>
  );
}
