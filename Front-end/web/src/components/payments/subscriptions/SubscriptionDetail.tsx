'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, Paperclip, Pencil, Trash2, X } from 'lucide-react';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '../api';
import SubscriptionForm from './SubscriptionForm';
import {
  approxText, archiveSubscription, billText, dayText, dueText, getSubscription, invoiceHref, payText, perText,
  rejectSubscription, STATUS_TONE, subscriptionKeys, verifySubscription, type Subscription,
} from './api';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50';

const ACTION_LABELS: Record<string, string> = {
  added: 'Added', edited: 'Edited', verified: 'Verified', rejected: 'Rejected', archived: 'Deleted (archived)',
};

function Row({ k, v }: { k: string; v?: React.ReactNode }) {
  if (!v) return null;
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 py-1 text-sm">
      <dt className="text-gray-500">{k}</dt>
      <dd className="break-words text-gray-900">{v}</dd>
    </div>
  );
}

/**
 * One tool / subscription with its history, and the buttons this person may
 * press now (`item.can`, decided by the server).
 */
export default function SubscriptionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: subscriptionKeys.one(id), queryFn: () => getSubscription(id) });
  const [mode, setMode] = useState<null | 'edit' | 'reject' | 'delete'>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const done = (s: Subscription) => {
    qc.invalidateQueries({ queryKey: [...subscriptionKeys.all, 'list'] });
    if (s.archived) { onClose(); return; }
    qc.invalidateQueries({ queryKey: subscriptionKeys.one(id) });
    setMode(null); setNote(''); setError('');
  };
  const act = useMutation({
    mutationFn: async (a: 'verify' | 'reject' | 'delete') => {
      const s = q.data!.item;
      if (a === 'verify') return (await verifySubscription(s)).item;
      if (a === 'reject') return (await rejectSubscription(s, note.trim())).item;
      return (await archiveSubscription(s, note.trim())).item;
    },
    onSuccess: done,
    onError: (e) => setError(errorMessage(e, 'That did not work. Refresh and try again.')),
  });

  const s = q.data?.item;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()} aria-label="Subscription">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{s ? `${s.name} · ${s.number}` : 'Subscription'}</h2>
            {s && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[s.status]}`}>{s.statusLabel}</span>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
        {q.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(q.error, 'Could not load this item. It may have been deleted.')}</p>}
        {s && mode === 'edit' && (
          <SubscriptionForm item={s} onCancel={() => setMode(null)} onDone={done} />
        )}
        {s && mode !== 'edit' && (
          <div className="space-y-5">
            {s.status === 'rejected' && s.rejectReason && (
              <p role="status" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
                <strong>Rejected by accounts:</strong> “{s.rejectReason}”. {s.can.edit ? 'Fix it with Edit and save — it goes back for check.' : ''}
              </p>
            )}
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">{s.kindLabel} · {s.teamLabel}</p>
              <p className="text-2xl font-bold text-gray-900">{billText(s)}<span className="text-base font-medium text-gray-600">{perText(s.kind)}</span></p>
              {approxText(s.approxInr) && <p className="text-sm text-gray-600">{approxText(s.approxInr)} (rough guide)</p>}
              <p className={`text-sm font-medium ${s.overdue ? 'text-red-700' : 'text-gray-700'}`}>{dayText(s.dueDate)} · {dueText(s)}</p>
            </div>
            <dl>
              <Row k="What for" v={s.purpose} />
              <Row k="Paid by" v={payText(s.payment)} />
              <Row k="Billing page" v={s.billingUrl && (
                <a href={s.billingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">
                  Open <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )} />
              <Row k="Notes" v={s.notes} />
              <Row k="Added by" v={`${s.addedByName} · ${formatDateTimeIST(s.createdAt)}`} />
              {s.status === 'verified' && <Row k="Verified by" v={`${s.verifiedByName}${s.verifiedAt ? ` · ${formatDateTimeIST(s.verifiedAt)}` : ''}`} />}
            </dl>

            {s.files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {s.files.map((f, i) => (
                  <a key={f.id} href={invoiceHref(s.id, f.id)} target="_blank" rel="noopener noreferrer" title={f.name || undefined}
                    className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>
                    <Paperclip className="h-4 w-4" /> Invoice{s.files.length > 1 ? ` ${i + 1}` : ''}{f.contentType === 'application/pdf' ? ' (PDF)' : ''}
                  </a>
                ))}
              </div>
            )}

            {(s.can.edit || s.can.delete || s.can.verify || s.can.reject) && (
              <div className="space-y-3 rounded-xl border border-gray-200 p-4">
                {mode === null && (
                  <div className="flex flex-wrap gap-2">
                    {s.can.verify && (
                      <button type="button" disabled={act.isPending} onClick={() => act.mutate('verify')} className={`${btn} bg-green-600 text-white hover:bg-green-700`}>
                        {act.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Verify
                      </button>
                    )}
                    {s.can.reject && <button type="button" onClick={() => setMode('reject')} className={`${btn} border border-red-300 text-red-700 hover:bg-red-50`}>Reject</button>}
                    {s.can.edit && (
                      <button type="button" onClick={() => setMode('edit')} className={`${btn} border border-gray-300 text-gray-800 hover:bg-gray-50`}>
                        <Pencil className="h-4 w-4" /> Edit
                      </button>
                    )}
                    {s.can.delete && (
                      <button type="button" onClick={() => setMode('delete')} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>
                        <Trash2 className="h-4 w-4" /> Delete
                      </button>
                    )}
                  </div>
                )}
                {(mode === 'reject' || mode === 'delete') && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-800" htmlFor="sd-note">
                      {mode === 'reject' ? 'Why is it rejected? (the team sees this and fixes it)' : 'Why delete it? (optional — e.g. we stopped using it)'}
                    </label>
                    {mode === 'delete' && (
                      <p className="text-xs text-gray-600">It disappears from the list. The record and its history are kept.</p>
                    )}
                    <textarea id="sd-note" className={input} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                    <div className="flex gap-2">
                      <button type="button" disabled={act.isPending} onClick={() => act.mutate(mode)} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>
                        {act.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {mode === 'reject' ? 'Reject' : 'Delete'}
                      </button>
                      <button type="button" onClick={() => { setMode(null); setError(''); }} className={`${btn} text-gray-700 hover:bg-gray-100`}>Back</button>
                    </div>
                  </div>
                )}
                {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
              </div>
            )}

            {s.history && s.history.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">History</h3>
                <ol className="space-y-2 border-l border-gray-200 pl-4">
                  {s.history.map((h, i) => (
                    <li key={i} className="text-sm">
                      <p className="font-medium text-gray-900">{ACTION_LABELS[h.action] || h.action} <span className="font-normal text-gray-500">· {h.byName}</span></p>
                      <p className="text-xs text-gray-500">{formatDateTimeIST(h.at)}</p>
                      {h.note && <p className="text-xs italic text-gray-600">“{h.note}”</p>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
