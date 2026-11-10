'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST, formatIsoDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import { metaLeadDate, type MetaLead, type MetaLeadDetail, type MetaLeadYou } from './metaLeadTypes';

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

// "2026-08-01 02:00" → the "2026-08-01T02:00" a datetime-local input needs.
const toInput = (iso: string | null) => (iso ? formatIsoDateTimeIST(iso).replace(' ', 'T').slice(0, 16) : '');

/** Everything the sheet holds for one lead, to read. Follow-ups are on the card, not here. */
function ReadOnlyDetails({ base }: { base: MetaLeadDetail }) {
  const rows = [
    { label: 'Date', value: metaLeadDate(base) },
    ...TEXT_FIELDS.map((f) => ({ label: f.label, value: base[f.key] })),
    ...base.extras.map((x) => ({ label: x.label, value: x.value })),
  ].filter((r) => r.value);
  return (
    <dl className="divide-y divide-gray-100">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-1 gap-0.5 py-2 sm:grid-cols-3 sm:gap-3">
          <dt className="text-sm text-gray-500">{r.label}</dt>
          <dd className="break-words text-sm font-medium text-gray-900 sm:col-span-2">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function MetaLeadPanel({ lead, onClose }: { lead: MetaLead; onClose: () => void }) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: staffKeys.metaLeadOne(lead.id),
    queryFn: () => apiClient.get<{ lead: MetaLeadDetail; you: MetaLeadYou }>(`/staff/meta-leads/${encodeURIComponent(lead.id)}`),
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
    mutationFn: () => apiClient.patch<{ lead: MetaLeadDetail }>(`/staff/meta-leads/${encodeURIComponent(lead.id)}`, {
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
  const where = lead.removedFromSheet ? 'no longer in the sheet' : (lead.rowNumber ? `row ${lead.rowNumber}` : '');

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label={`Meta lead ${lead.name || 'details'}`}>
      <form
        className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl"
        onSubmit={(e) => { e.preventDefault(); if (base && dirty && canEdit && !save.isPending) { setError(''); save.mutate(); } }}
      >
        <div className="flex items-start justify-between border-b border-gray-200 p-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-gray-900">{lead.name || 'No name'}</h2>
            <p className="text-xs text-gray-500">{lead.tab}{where ? ` · ${where}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {detail.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
          {detail.isError && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{errorMessage(detail.error, 'Could not load this lead.')}</p>}
          {base && !canEdit && <ReadOnlyDetails base={base} />}
          {base && canEdit && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-gray-800 sm:col-span-2">
                  Date (India time)
                  <input type="datetime-local" className={inputClass} value={date ?? toInput(base.leadDate)} onChange={(e) => setDate(e.target.value)} />
                  {!base.leadDate && base.dateRaw && <span className="mt-1 block text-xs text-amber-700">In the sheet as: {base.dateRaw}</span>}
                </label>
                {TEXT_FIELDS.map((f) => (
                  <label key={f.key} className={`block text-sm font-medium text-gray-800 ${f.long ? 'sm:col-span-2' : ''}`}>
                    {f.label}
                    <input type="text" maxLength={2000} className={inputClass} value={changes[f.key] ?? base[f.key]}
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
                      <input type="text" maxLength={2000} disabled={x.readOnly} className={inputClass} value={extras[x.label] ?? x.value}
                        onChange={(e) => setExtras((c) => ({ ...c, [x.label]: e.target.value }))} />
                    </label>
                  ))}
                </fieldset>
              )}
            </>
          )}
          {base && base.edits.length > 0 && (
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
