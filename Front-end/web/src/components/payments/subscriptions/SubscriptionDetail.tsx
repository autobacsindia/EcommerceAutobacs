'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Loader2, Paperclip, Pencil, Trash2, X } from 'lucide-react';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage, paymentKeys } from '../api';
import PaymentRequestDetail from '../PaymentRequestDetail';
import MarkPaidForm from './MarkPaidForm';
import SubscriptionForm from './SubscriptionForm';
import {
  approxText, archiveSubscription, billText, CYCLE_TONE, dayText, dueText, estimateText, getSubscription, invoiceHref, monthText, payText, perText,
  rejectSubscription, rupeeText, STATUS_TONE, subscriptionKeys, verifySubscription, type BillCycle, type Subscription,
} from './api';
import RichText from '@/components/ui/RichText';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50';

const ACTION_LABELS: Record<string, string> = {
  added: 'Added', edited: 'Edited', 'bill recorded': 'Bill recorded', verified: 'Verified', rejected: 'Rejected', archived: 'Deleted (archived)',
  'marked paid': 'Marked paid', approved: 'Approved by accounts', paid: 'Paid', 'payment rejected': 'Payment rejected',
};

/** "Waiting for accounts — PR-0912" etc., for the cycle due now. */
function CurrentCycle({ c, onOpenExpense }: { c: BillCycle; onOpenExpense: (id: string) => void }) {
  const tone = c.state === 'rejected' ? 'bg-red-50 text-red-800' : c.state === 'paid' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900';
  return (
    <div role="status" className={`rounded-lg p-3 text-sm ${tone}`}>
      <p>
        <strong>{c.state === 'rejected' ? 'Payment rejected' : c.stateLabel}</strong>
        {' — '}{billText(c)}{c.alreadyPaid && c.paidViaLabel ? `, paid by ${c.paidViaLabel.toLowerCase()} on ${dayText(c.paidOn)}` : c.alreadyPaid ? '' : ', not paid yet'}
        {' · marked by '}{c.paidByName}
        {c.expense && <> · <button type="button" className="font-medium underline" onClick={() => onOpenExpense(c.expense!.id)}>{c.expense.number}</button></>}
      </p>
      {c.state === 'rejected' && c.rejectReason && <p className="mt-1">“{c.rejectReason}” — fix it and mark it paid again.</p>}
    </div>
  );
}

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
  const [mode, setMode] = useState<null | 'edit' | 'reject' | 'delete' | 'paid'>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  // An expense opened from here (the cycle's PR-xxxx), over this panel.
  const [expense, setExpense] = useState<string | null>(null);

  const done = (s: Subscription) => {
    qc.invalidateQueries({ queryKey: [...subscriptionKeys.all, 'list'] });
    if (s.archived) { onClose(); return; }
    qc.invalidateQueries({ queryKey: subscriptionKeys.one(id) });
    setMode(null); setNote(''); setError('');
  };
  const marked = (s: Subscription) => {
    // The expense is new in Payments too.
    qc.invalidateQueries({ queryKey: paymentKeys.all });
    done(s);
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
              <p className="text-2xl font-bold text-gray-900">{billText(s)}<span className="text-base font-medium text-gray-600">{perText(s.kind)}{estimateText(s)}</span></p>
              {s.variableAmount && <p className="text-xs text-gray-600">Amount varies (usage-based) — the real bill is entered each {s.kind === 'yearly' ? 'year' : 'month'} before paying.</p>}
              {approxText(s.approxInr) && <p className="text-sm text-gray-600">{approxText(s.approxInr)} (rough guide)</p>}
              <p className={`text-sm font-medium ${s.overdue ? 'text-red-700' : 'text-gray-700'}`}>{dayText(s.dueDate)} · {dueText(s)}</p>
            </div>
            {s.current && <CurrentCycle c={s.current} onOpenExpense={setExpense} />}
            <dl>
              <Row k="What for" v={s.purpose} />
              <Row k="Paid by" v={payText(s.payment)} />
              <Row k="Billing page" v={s.billingUrl && (
                <a href={s.billingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">
                  Open <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )} />
              <Row k="Notes" v={s.notes ? <RichText value={s.notes} /> : null} />
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

            {s.cycles && s.cycles.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Bills paid</h3>
                <ul className="divide-y rounded-lg border border-gray-200" aria-label="Bills paid">
                    {[...s.cycles].reverse().map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                        <span className="w-20 font-medium text-gray-900">{monthText(c.dueDate)}</span>
                        <span className="font-semibold text-gray-900">{billText(c)}</span>
                        {c.currency !== 'INR' && c.rupees != null && <span className="text-xs text-gray-600">{rupeeText(c.rupees)}</span>}
                        {s.variableAmount && c.estimate != null && <span className="text-xs text-gray-500">estimate {billText({ amount: c.estimate, currency: c.currency })}</span>}
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CYCLE_TONE[c.state]}`}>
                          {c.state === 'paid' && <CheckCircle2 className="mr-0.5 inline h-3 w-3" />}{c.stateLabel}
                        </span>
                        {c.expense && (
                          <button type="button" onClick={() => setExpense(c.expense!.id)} className="text-xs font-medium text-blue-700 hover:underline">{c.expense.number}</button>
                        )}
                        <span className="text-xs text-gray-500">· {c.paidByName}, {formatDateTimeIST(c.paidAt)}</span>
                        {c.invoices.map((f, i) => (
                          <a key={f.id} href={invoiceHref(s.id, f.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">
                            <Paperclip className="h-3.5 w-3.5" /> Invoice{c.invoices.length > 1 ? ` ${i + 1}` : ''}
                          </a>
                        ))}
                        {c.amountReason && <span className="w-full text-xs text-gray-600">Differs from the plan: {c.amountReason}</span>}
                        {c.state === 'rejected' && c.rejectReason && <span className="w-full text-xs text-red-700">Rejected: “{c.rejectReason}”</span>}
                        {c.note && <span className="w-full text-xs italic text-gray-600">“{c.note}”</span>}
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {(s.can.edit || s.can.delete || s.can.verify || s.can.reject || s.can.markPaid) && (
              <div className="space-y-3 rounded-xl border border-gray-200 p-4">
                {mode === null && (
                  <div className="flex flex-wrap gap-2">
                    {s.can.markPaid && (
                      <button type="button" onClick={() => { setMode('paid'); setError(''); }} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
                        <CheckCircle2 className="h-4 w-4" /> Mark paid
                      </button>
                    )}
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
                {mode === 'paid' && <MarkPaidForm item={s} onCancel={() => setMode(null)} onDone={marked} />}
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
      {expense && (
        <div onClick={(e) => e.stopPropagation()}>
          <PaymentRequestDetail id={expense} onClose={() => { setExpense(null); qc.invalidateQueries({ queryKey: subscriptionKeys.one(id) }); }} />
        </div>
      )}
    </div>
  );
}
