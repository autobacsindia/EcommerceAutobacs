'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, Paperclip, X } from 'lucide-react';
import { formatDateTimeIST } from '@/lib/datetime';
import {
  actOn, errorMessage, fileHref, getRequest, paymentKeys, postForm, rupees, slipHref, STATUS_TONE, type PaymentRequest,
} from './api';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50';

const ACTION_LABELS: Record<string, string> = {
  submitted: 'Raised', approved: 'Approved by admin', declined: 'Declined by admin',
  on_hold: 'Put on hold by accounts', paid: 'Paid by accounts', cancelled: 'Cancelled',
};
const FILE_LABELS = { bill: 'Bill / invoice', qr: 'Payment QR', proof: 'Payment screenshot' } as const;

function Row({ k, v }: { k: string; v?: string | null }) {
  if (!v) return null;
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 py-1 text-sm">
      <dt className="text-gray-500">{k}</dt>
      <dd className="break-words text-gray-900">{v}</dd>
    </div>
  );
}

/**
 * One payment request with everything it carries, and the buttons this person
 * may press now (`request.can`, decided by the server). Used by the team panel
 * and the admin page.
 */
export default function PaymentRequestDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: paymentKeys.one(id), queryFn: () => getRequest(id) });
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<null | 'decline' | 'hold' | 'pay'>(null);
  const [pay, setPay] = useState({ method: 'razorpay', reference: '' });
  const [proof, setProof] = useState<File | null>(null);
  const [error, setError] = useState('');

  const done = (r: PaymentRequest) => {
    qc.setQueryData(paymentKeys.one(id), { request: r });
    qc.invalidateQueries({ queryKey: [...paymentKeys.all, 'list'] });
    if (r.order) qc.invalidateQueries({ queryKey: paymentKeys.forOrder(r.order.id) });
    setMode(null); setNote(''); setError(''); setProof(null);
  };
  const act = useMutation({
    mutationFn: async (a: 'approve' | 'decline' | 'hold' | 'cancel' | 'pay') => {
      if (a !== 'pay') return (await actOn(id, a, note)).request;
      const form = new FormData();
      form.append('method', pay.method);
      form.append('reference', pay.reference.trim());
      if (note.trim()) form.append('note', note.trim());
      if (proof) form.append('proof', proof);
      return (await postForm<{ request: PaymentRequest }>(`/payment-requests/${id}/pay`, form)).request;
    },
    onSuccess: done,
    onError: (e) => setError(errorMessage(e, 'That did not work. Refresh and try again.')),
  });

  const r = q.data?.request;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()} aria-label="Payment request">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{r ? r.number : 'Payment request'}</h2>
            {r && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[r.status]}`}>{r.statusLabel}</span>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
        {q.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(q.error, 'Could not load this request.')}</p>}
        {r && (
          <div className="space-y-5">
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">{r.kind === 'supplier' ? 'Supplier payment' : `${r.category} expense`} · {r.teamLabel}</p>
              <p className="text-2xl font-bold text-gray-900">{rupees(r.amount)}</p>
              <p className="text-sm text-gray-600">to {r.payee.name}</p>
            </div>

            <dl>
              <Row k="Raised by" v={`${r.requestedBy} · ${formatDateTimeIST(r.createdAt)}`} />
              <Row k="Order" v={r.order?.number} />
              <Row k="Items" v={r.itemNames.join(', ')} />
              <Row k="Customer" v={r.customer?.name ? [r.customer.name, r.customer.phone, r.customer.city].filter(Boolean).join(' · ') : null} />
              <Row k="Sale closed by" v={r.closedBy} />
              <Row k="Details" v={r.description} />
              <Row k="Pay by" v={r.payee.method === 'upi' ? `UPI · ${r.payee.upiId}` : `Bank · ${r.payee.accountName}, A/c ${r.payee.accountNumber}, IFSC ${r.payee.ifsc}${r.payee.bankName ? ` (${r.payee.bankName})` : ''}`} />
              <Row k="Payee phone" v={r.payee.phone} />
              {r.payment && <Row k="Paid" v={`${r.payment.method.toUpperCase()} · ref ${r.payment.reference} · ${formatDateTimeIST(r.payment.paidAt)} · by ${r.payment.paidByName}`} />}
              {r.decisionNote && ['declined', 'on_hold'].includes(r.status) && <Row k={r.status === 'declined' ? 'Reason' : 'On hold'} v={r.decisionNote} />}
            </dl>

            <div className="flex flex-wrap gap-2">
              <a href={slipHref(r.id)} target="_blank" rel="noopener noreferrer" className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>
                <FileText className="h-4 w-4 text-emerald-700" /> {r.status === 'paid' ? 'Payment receipt (PDF)' : 'Request slip (PDF)'}
              </a>
              {r.files.map((f) => (
                <a key={f.id} href={fileHref(r.id, f.id)} target="_blank" rel="noopener noreferrer" className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>
                  <Paperclip className="h-4 w-4" /> {FILE_LABELS[f.kind]}
                </a>
              ))}
            </div>

            {/* Actions — only what the server says this person may do now. */}
            {(r.can.approve || r.can.decline || r.can.pay || r.can.hold || r.can.cancel) && (
              <div className="space-y-3 rounded-xl border border-gray-200 p-4">
                {mode === null && (
                  <div className="flex flex-wrap gap-2">
                    {r.can.approve && <button type="button" disabled={act.isPending} onClick={() => act.mutate('approve')} className={`${btn} bg-green-600 text-white hover:bg-green-700`}>Approve</button>}
                    {r.can.pay && <button type="button" onClick={() => setMode('pay')} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>Record payment</button>}
                    {r.can.hold && <button type="button" onClick={() => setMode('hold')} className={`${btn} border border-orange-300 text-orange-800 hover:bg-orange-50`}>Put on hold</button>}
                    {r.can.decline && <button type="button" onClick={() => setMode('decline')} className={`${btn} border border-red-300 text-red-700 hover:bg-red-50`}>Decline</button>}
                    {r.can.cancel && (
                      <button type="button" disabled={act.isPending} onClick={() => { if (window.confirm(`Cancel ${r.number}?`)) act.mutate('cancel'); }}
                        className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>Cancel request</button>
                    )}
                  </div>
                )}
                {(mode === 'decline' || mode === 'hold') && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-800" htmlFor="pr-note">{mode === 'decline' ? 'Why is it declined? (the requester sees this)' : 'Why is it on hold? (e.g. funds arrive Friday)'}</label>
                    <textarea id="pr-note" className={input} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                    <div className="flex gap-2">
                      <button type="button" disabled={act.isPending} onClick={() => act.mutate(mode)} className={`${btn} ${mode === 'decline' ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-600 hover:bg-orange-700'} text-white`}>
                        {mode === 'decline' ? 'Decline' : 'Put on hold'}
                      </button>
                      <button type="button" onClick={() => setMode(null)} className={`${btn} text-gray-700 hover:bg-gray-100`}>Back</button>
                    </div>
                  </div>
                )}
                {mode === 'pay' && (
                  <div className="space-y-2">
                    <p className="text-sm text-gray-700">Pay <strong>{rupees(r.amount)}</strong> to {r.payee.name} from the company Razorpay / bank, then record it here.</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <select aria-label="Paid by" className={input} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                        <option value="razorpay">Razorpay</option>
                        <option value="bank">Bank transfer</option>
                        <option value="upi">UPI</option>
                        <option value="other">Other</option>
                      </select>
                      <input aria-label="Payment reference" className={input} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="Payout ID / UTR" />
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      <Paperclip className="h-4 w-4" /> {proof ? proof.name : 'Attach payment screenshot'}
                      <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" aria-label="Payment screenshot" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
                    </label>
                    <textarea aria-label="Note" className={input} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
                    <div className="flex gap-2">
                      <button type="button" disabled={act.isPending || pay.reference.trim().length < 4} onClick={() => act.mutate('pay')} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
                        {act.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Mark as paid
                      </button>
                      <button type="button" onClick={() => setMode(null)} className={`${btn} text-gray-700 hover:bg-gray-100`}>Back</button>
                    </div>
                  </div>
                )}
                {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
              </div>
            )}

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">History</h3>
              <ol className="space-y-2 border-l border-gray-200 pl-4">
                {r.history.map((h, i) => (
                  <li key={i} className="text-sm">
                    <p className="font-medium text-gray-900">{ACTION_LABELS[h.action] || h.action} <span className="font-normal text-gray-500">· {h.byName}</span></p>
                    <p className="text-xs text-gray-500">{formatDateTimeIST(h.at)}</p>
                    {h.note && <p className="text-xs italic text-gray-600">“{h.note}”</p>}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
