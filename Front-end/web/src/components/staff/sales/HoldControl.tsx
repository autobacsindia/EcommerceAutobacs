'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Hourglass, Loader2, Play } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { formatDateIST } from '@/lib/datetime';
import { errorMessage, type SalesHold } from './types';

/** YYYY-MM-DD for today + `days`, in the browser's (the salesman's) own calendar. */
export function dayFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * "On hold — customer thinking" for a quotation or an unpaid order. Parking it
 * changes nothing about price or payment; it only takes it out of the active
 * list until the follow-up date, so the salesman can get on with other
 * customers. `base` is the record's API path, e.g. /staff/sales/quotations/<id>.
 */
export default function HoldControl({ base, hold, onDone, what }: {
  base: string;
  hold: SalesHold | null | undefined;
  onDone: () => void;
  /** "quotation" or "order", for the wording. */
  what: 'quotation' | 'order';
}) {
  const [editing, setEditing] = useState(false);
  const [until, setUntil] = useState(() => dayFromToday(3));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => apiClient.post(`${base}/hold`, { until, note: note.trim() }),
    onSuccess: () => { setError(''); setEditing(false); onDone(); },
    onError: (e) => setError(errorMessage(e, 'Could not put it on hold.')),
  });
  const resume = useMutation({
    mutationFn: () => apiClient.post(`${base}/resume`, {}),
    onSuccess: () => { setError(''); onDone(); },
    onError: (e) => setError(errorMessage(e, 'Could not resume it.')),
  });
  const busy = save.isPending || resume.isPending;

  if (editing) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">On hold — customer thinking</p>
        <p className="mb-3 text-sm text-amber-800">
          The {what} moves to your On hold list until the follow-up date, then comes back to remind you. Prices{what === 'order' ? ' and payment links' : ''} stay as they are.
        </p>
        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-800">Follow up on</span>
            <input type="date" value={until} min={dayFromToday(0)} max={dayFromToday(60)} onChange={(e) => setUntil(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-800">Note <span className="font-normal text-gray-500">(optional)</span></span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="For example: checking with his family"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
          </label>
        </div>
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy || !until} onClick={() => save.mutate()}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hourglass className="h-4 w-4" />} Put on hold
          </button>
          <button type="button" disabled={busy} onClick={() => { setEditing(false); setError(''); }}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Back
          </button>
        </div>
      </div>
    );
  }

  if (hold) {
    return (
      <div className={`rounded-lg border p-4 ${hold.due ? 'border-orange-300 bg-orange-50' : 'border-amber-200 bg-amber-50'}`} role="status">
        <p className={`text-sm font-semibold ${hold.due ? 'text-orange-900' : 'text-amber-900'}`}>
          {hold.due ? `Follow up now — the customer was thinking until ${formatDateIST(hold.until)}` : `On hold — customer thinking. Follow up on ${formatDateIST(hold.until)}.`}
        </p>
        {(hold.note || hold.by) && (
          <p className="mt-1 text-sm text-gray-700">{hold.note}{hold.note && hold.by ? ' · ' : ''}{hold.by ? `by ${hold.by}` : ''}</p>
        )}
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => resume.mutate()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {resume.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Resume
          </button>
          <button type="button" disabled={busy} onClick={() => setEditing(true)}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Change follow-up date
          </button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" onClick={() => setEditing(true)}
      className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50">
      <Hourglass className="h-4 w-4" /> On hold – customer thinking
    </button>
  );
}
