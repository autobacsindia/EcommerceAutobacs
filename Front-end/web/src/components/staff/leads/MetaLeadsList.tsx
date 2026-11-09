'use client';

import { useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Pencil, Phone, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateIST, formatDateTimeIST, formatIsoDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import { useListParams } from '@/lib/hooks/useListParams';
import { ListClear, ListSearch, ListSelect } from '@/components/panel/ListControls';

export type MetaLead = {
  id: string; tab: string; rowNumber: number | null; leadDate: string | null; dateRaw: string; dateHasTime: boolean;
  name: string; phone: string; email: string; product: string; campaign: string;
  salesPerson: string; status: string; followUp1: string; followUp2: string; revision: number;
};
type Extra = { label: string; value: string; readOnly: boolean };
type Edit = { at: string; who: string; changes: { field: string; from: string; to: string }[] };
type Detail = MetaLead & { extras: Extra[]; edits: Edit[] };
type Sync = { lastSuccessAt: string | null; connected: boolean; stale: boolean };
type Page = { leads: MetaLead[]; nextCursor: string | null; tabs: { name: string; rows: number }[]; sync: Sync; you: { canEdit: boolean } };
type TextField = 'name' | 'phone' | 'email' | 'product' | 'campaign' | 'salesPerson' | 'status' | 'followUp1' | 'followUp2';

const TEXT_FIELDS: { key: TextField; label: string; long?: boolean }[] = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'E-mail' },
  { key: 'salesPerson', label: 'Sales person' },
  { key: 'status', label: 'Status' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'product', label: 'Product / form', long: true },
  { key: 'followUp1', label: 'Follow-up 1', long: true },
  { key: 'followUp2', label: 'Follow-up 2', long: true },
];
const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-100 disabled:text-gray-600';

/** The date as the team should read it: India time, or the cell as typed when it could not be read. */
function dateText(l: MetaLead): string {
  if (!l.leadDate) return l.dateRaw || '—';
  return l.dateHasTime ? formatDateTimeIST(l.leadDate) : formatDateIST(l.leadDate);
}

// "2026-08-01 02:00" → the "2026-08-01T02:00" a datetime-local input needs.
const toInput = (iso: string | null) => (iso ? formatIsoDateTimeIST(iso).replace(' ', 'T').slice(0, 16) : '');

function EditPanel({ lead, onClose }: { lead: MetaLead; onClose: () => void }) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: staffKeys.metaLeadOne(lead.id),
    queryFn: () => apiClient.get<{ lead: Detail; you: { canEdit: boolean } }>(`/staff/meta-leads/${encodeURIComponent(lead.id)}`),
    gcTime: 0,
  });
  const base = detail.data?.lead;
  const canEdit = detail.data?.you.canEdit ?? false;
  // Only what the person actually changes is sent; the rest stays untouched and unlocked.
  const [changes, setChanges] = useState<Partial<Record<TextField, string>>>({});
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [date, setDate] = useState<string | null>(null);
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => apiClient.patch<{ lead: Detail }>(`/staff/meta-leads/${encodeURIComponent(lead.id)}`, {
      revision: base!.revision,
      changes: { ...changes, ...(date !== null ? { leadDate: date ? `${date}:00+05:30` : null } : {}) },
      extras,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: staffKeys.metaLeads() });
      onClose();
    },
    onError: (e: unknown) => {
      setError(errorMessage(e, 'Could not save. Please try again.'));
      // Someone else saved first: load their version, and drop this form's stale edits.
      if ((e as { rawData?: { outcome?: string } })?.rawData?.outcome === 'changed') {
        setChanges({}); setExtras({}); setDate(null);
        detail.refetch();
      }
    },
  });
  const dirty = Object.keys(changes).length > 0 || Object.keys(extras).length > 0 || date !== null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label={`Meta lead ${lead.name || 'details'}`}>
      <form
        className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl"
        onSubmit={(e) => { e.preventDefault(); if (base && dirty && canEdit && !save.isPending) { setError(''); save.mutate(); } }}
      >
        <div className="flex items-start justify-between border-b border-gray-200 p-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-gray-900">{lead.name || 'No name'}</h2>
            <p className="text-xs text-gray-500">{lead.tab}{lead.rowNumber ? ` · row ${lead.rowNumber}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {detail.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
          {detail.isError && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{errorMessage(detail.error, 'Could not load this lead.')}</p>}
          {base && (
            <>
              {!canEdit && <p className="rounded-lg bg-blue-50 p-2.5 text-sm text-blue-900">You can view this lead. The GTM head, Marketing head and admin can edit it.</p>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-gray-800 sm:col-span-2">
                  Date (India time)
                  <input type="datetime-local" disabled={!canEdit} className={inputClass} value={date ?? toInput(base.leadDate)} onChange={(e) => setDate(e.target.value)} />
                  {!base.leadDate && base.dateRaw && <span className="mt-1 block text-xs text-amber-700">In the sheet as: {base.dateRaw}</span>}
                </label>
                {TEXT_FIELDS.map((f) => (
                  <label key={f.key} className={`block text-sm font-medium text-gray-800 ${f.long ? 'sm:col-span-2' : ''}`}>
                    {f.label}
                    <input type="text" maxLength={2000} disabled={!canEdit} className={inputClass} value={changes[f.key] ?? base[f.key]}
                      onChange={(e) => setChanges((c) => ({ ...c, [f.key]: e.target.value }))} />
                  </label>
                ))}
              </div>
              {base.extras.length > 0 && (
                <fieldset className="space-y-3 border-t border-gray-200 pt-4">
                  <legend className="pr-2 text-sm font-semibold text-gray-900">Everything else from the sheet</legend>
                  {base.extras.map((x) => (
                    <label key={x.label} className="block text-sm font-medium text-gray-800">
                      {x.label}
                      <input type="text" maxLength={2000} disabled={!canEdit || x.readOnly} className={inputClass} value={extras[x.label] ?? x.value}
                        onChange={(e) => setExtras((c) => ({ ...c, [x.label]: e.target.value }))} />
                    </label>
                  ))}
                </fieldset>
              )}
              {base.edits.length > 0 && (
                <section className="border-t border-gray-200 pt-4">
                  <h3 className="text-sm font-semibold text-gray-900">Changes</h3>
                  <ol className="mt-2 space-y-2 text-sm">
                    {base.edits.map((e, i) => (
                      <li key={i} className="text-gray-700">
                        <span className="font-medium text-gray-900">{e.who || 'Someone'}</span> <span className="text-gray-500">· {formatDateTimeIST(e.at)}</span>
                        {e.changes.map((c, n) => <p key={n} className="break-words text-xs text-gray-600">{c.field}: {c.from || '(empty)'} → {c.to || '(empty)'}</p>)}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          )}
        </div>

        {error && <p role="alert" className="mx-4 mb-2 rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2 border-t border-gray-200 p-4">
          {canEdit && (
            <button type="submit" disabled={!dirty || save.isPending || !base} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">{canEdit ? 'Cancel' : 'Close'}</button>
        </div>
      </form>
    </div>
  );
}

const cell = 'border-b border-gray-100 px-3 py-2 align-top text-sm text-gray-800';
const COLUMNS = ['Date', 'Name', 'Phone', 'Tab', 'Product / form', 'Sales person', 'Status', 'Follow-up 1', 'Follow-up 2', ''];

/** Rows from the sales lead sheet. The server decides who may edit; filters live in the address. Wrap in <Suspense>. */
export default function MetaLeadsList() {
  const { values: v, set, clear } = useListParams({ tab: '', q: '' });
  const [editing, setEditing] = useState<MetaLead | null>(null);
  const params: Record<string, string> = { ...(v.tab ? { tab: v.tab } : {}), ...(v.q ? { q: v.q } : {}) };
  const filtered = !!(v.tab || v.q);

  const q = useInfiniteQuery({
    queryKey: staffKeys.metaLeadList(params),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ ...params, ...(pageParam ? { cursor: pageParam } : {}) });
      return apiClient.get<Page>(`/staff/meta-leads?${qs}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const rows = q.data?.pages.flatMap((p) => p.leads) ?? [];
  const first = q.data?.pages[0];
  const canEdit = first?.you.canEdit ?? false;
  const sync = first?.sync;
  const action = canEdit ? 'Edit' : 'View';

  return (
    <div className="space-y-4">
      <div role="search" aria-label="Search and filter Meta leads" className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <ListSearch value={v.q} onChange={(text) => set({ q: text.trim() })} label="Search Meta leads" placeholder="Search name, phone, product or status" />
        <ListSelect label="Tab" value={v.tab} onChange={(x) => set({ tab: x })} allLabel="All tabs"
          options={(first?.tabs ?? []).map((t) => ({ value: t.name, label: `${t.name} (${t.rows})` }))} />
        {filtered && <ListClear onClear={() => clear([])} />}
      </div>

      {sync && !sync.connected && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">The sales lead sheet is not connected yet.</p>}
      {sync?.connected && sync.stale && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Could not update from the sheet since {formatDateTimeIST(sync.lastSuccessAt)}. New leads may be missing here — check the sheet until this clears.
        </p>
      )}
      {sync?.connected && !sync.stale && <p className="text-xs text-gray-500">Updated from the sheet at {formatDateTimeIST(sync.lastSuccessAt)}</p>}

      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {q.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load Meta leads.')}</p>}
      {q.isSuccess && rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">{filtered ? 'No leads match — try fewer words or clear the filters.' : 'No Meta leads yet.'}</p>
      )}

      {rows.length > 0 && (
        <div className={q.isPlaceholderData ? 'opacity-60' : ''}>
          <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
            <table className="w-full min-w-[1100px] border-collapse">
              <thead className="bg-gray-50">
                <tr>{COLUMNS.map((c, i) => <th key={c || i} scope="col" className="border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">{c || <span className="sr-only">Actions</span>}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50" data-testid="meta-lead-row">
                    <td className={`${cell} whitespace-nowrap`}>{dateText(l)}</td>
                    <td className={`${cell} font-medium text-gray-900`}>{l.name || '—'}</td>
                    <td className={`${cell} whitespace-nowrap`}>{l.phone ? <a className="text-blue-700 hover:underline" href={`tel:${l.phone}`}>{l.phone}</a> : '—'}</td>
                    <td className={cell}>{l.tab}</td>
                    <td className={`${cell} max-w-xs break-words`}>{l.product || '—'}</td>
                    <td className={cell}>{l.salesPerson || '—'}</td>
                    <td className={cell}>{l.status || '—'}</td>
                    <td className={`${cell} max-w-[12rem] break-words`}>{l.followUp1 || '—'}</td>
                    <td className={`${cell} max-w-[12rem] break-words`}>{l.followUp2 || '—'}</td>
                    <td className={cell}>
                      <button type="button" onClick={() => setEditing(l)} aria-label={`${action} ${l.name || 'lead'}`} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50">
                        <Pencil className="h-3.5 w-3.5" aria-hidden /> {action}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {rows.map((l) => (
              <li key={l.id} className="rounded-xl border border-gray-200 bg-white p-4" data-testid="meta-lead-card">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-words text-base font-semibold text-gray-900">{l.name || 'No name'}</p>
                  <button type="button" onClick={() => setEditing(l)} className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1 text-sm font-medium text-gray-700">{action}</button>
                </div>
                <p className="text-xs text-gray-500">{dateText(l)} · {l.tab}</p>
                {l.product && <p className="mt-1 break-words text-sm text-gray-800">{l.product}</p>}
                {l.phone && <a href={`tel:${l.phone}`} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-blue-700"><Phone className="h-4 w-4" aria-hidden /> {l.phone}</a>}
                <dl className="mt-2 space-y-0.5 text-sm text-gray-700">
                  {l.salesPerson && <div><dt className="inline text-gray-500">Sales person: </dt><dd className="inline">{l.salesPerson}</dd></div>}
                  {l.status && <div><dt className="inline text-gray-500">Status: </dt><dd className="inline">{l.status}</dd></div>}
                  {l.followUp1 && <div><dt className="inline text-gray-500">Follow-up 1: </dt><dd className="inline">{l.followUp1}</dd></div>}
                  {l.followUp2 && <div><dt className="inline text-gray-500">Follow-up 2: </dt><dd className="inline">{l.followUp2}</dd></div>}
                </dl>
              </li>
            ))}
          </ul>
        </div>
      )}

      {q.hasNextPage && (
        <button type="button" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}

      {editing && <EditPanel key={editing.id} lead={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
