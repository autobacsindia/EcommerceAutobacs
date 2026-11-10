'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, FileDown, Link2, Paperclip } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import FilePicker from '@/components/payments/FilePicker';
import { postForm } from '@/components/payments/api';
import { MAX_ATTACHMENTS, PHOTO_OR_PDF } from '@/lib/attachments';
import { extraKeys, extraUrl, receiptHref, toneOf, type ExtraCharge } from './api';

const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50';
const primary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const secondary = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const danger = `${btn} border border-red-300 bg-white text-red-700 hover:bg-red-50`;
const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

type Panel = null | 'edit' | 'bank' | 'offline';
const todayIso = () => new Date().toISOString().slice(0, 10);

/** One extra charge and whatever this person may do to it next. The server decides what `can` says. */
export default function ExtraChargeCard({ extra, showOrder = false, orderBase }: { extra: ExtraCharge; showOrder?: boolean; orderBase?: string }) {
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState(String(extra.amount));
  const [reason, setReason] = useState(extra.reason);
  const [utr, setUtr] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso);
  const [files, setFiles] = useState<File[]>([]);
  const [offlineMethod, setOfflineMethod] = useState('bank_transfer');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const refresh = () => {
    setError('');
    setPanel(null);
    queryClient.invalidateQueries({ queryKey: extraKeys.all });
    queryClient.invalidateQueries({ queryKey: staffKeys.orders() });
  };
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e, 'That did not work. Please try again.')),
  });
  const post = (action: string, body: object = {}) => run.mutate(() => apiClient.post(extraUrl(extra.id, action), body));
  const busy = run.isPending;
  const can = extra.can;

  const recordBank = (e: React.FormEvent) => {
    e.preventDefault();
    if (!files.length) { setError('Add the payment screenshot or receipt from the customer.'); return; }
    const form = new FormData();
    form.append('amount', String(extra.amount));
    form.append('reference', utr.trim());
    form.append('paidOn', paidOn);
    if (note.trim()) form.append('note', note.trim());
    files.forEach((f) => form.append('proof', f));
    run.mutate(() => postForm(extraUrl(extra.id, 'bank-transfer'), form));
  };
  const refundRazorpay = () => {
    if (window.confirm(`Send ${rupees(extra.amount)} back to the customer through Razorpay?`)) post('refund');
  };

  return (
    <li className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {showOrder && (orderBase
              ? <Link href={`${orderBase}/${extra.orderId}`} className="underline-offset-2 hover:underline">{extra.orderNumber} · </Link>
              : <span>{extra.orderNumber} · </span>)}
            Extra {extra.sequence} · {rupees(extra.amount)}
          </p>
          {showOrder && (
            <p className="text-xs text-gray-500">{extra.customer.name}{extra.customer.city ? ` · ${extra.customer.city}` : ''}{extra.salesPerson ? ` · sold by ${extra.salesPerson}` : ''}</p>
          )}
          <p className="mt-1 whitespace-pre-line text-sm text-gray-700">{extra.reason}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${toneOf(extra.statusLabel)}`}>{extra.statusLabel}</span>
      </div>

      <ul className="space-y-0.5 text-xs text-gray-500">
        <li>Asked by {extra.requestedBy} · {formatDateTimeIST(extra.requestedAt)} · customer confirmed</li>
        {extra.decidedAt && (
          <li>{extra.status === 'rejected' ? 'Rejected' : 'Approved'} by {extra.decidedBy} · {formatDateTimeIST(extra.decidedAt)}{extra.decisionNote ? ` — ${extra.decisionNote}` : ''}</li>
        )}
        {extra.paidAt && <li>Paid {formatDateTimeIST(extra.paidAt)} by {extra.paidVia === 'bank_transfer' ? 'bank transfer' : 'Razorpay'}</li>}
        {extra.refund?.dueReason && <li>Refund: {extra.refund.dueReason}</li>}
        {extra.refund?.failureReason && <li className="text-red-700">{extra.refund.failureReason}</li>}
        {extra.refund?.status === 'completed' && <li>Refunded {extra.refund.completedAt ? formatDateTimeIST(extra.refund.completedAt) : ''}{extra.refund.reference ? ` · ${extra.refund.reference}` : ''}</li>}
      </ul>

      {extra.payUrl && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-blue-50 p-2 text-xs text-blue-900">
          <Link2 className="h-3.5 w-3.5" /><span className="break-all">{extra.payUrl}</span>
          <button type="button" className={secondary} onClick={() => { navigator.clipboard?.writeText(extra.payUrl as string); setCopied(true); }}>
            <Copy className="h-3 w-3" /> {copied ? 'Copied' : 'Copy'}
          </button>
          {extra.payBy && <span>Valid until {formatDateTimeIST(extra.payBy)}</span>}
        </p>
      )}

      {can.decide && (
        <div className="space-y-2 rounded-lg bg-gray-50 p-2">
          <textarea className={input} rows={2} maxLength={500} placeholder="Note for GTM (needed if you reject)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note for GTM" />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} className={primary} onClick={() => post('approve', { note: note.trim() })}>Approve {rupees(extra.amount)}</button>
            <button type="button" disabled={busy || note.trim().length < 3} className={danger} onClick={() => post('reject', { note: note.trim() })}>Reject</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {can.sendLink && <button type="button" disabled={busy} className={primary} onClick={() => post('payment-link')}>Send Razorpay link</button>}
        {can.recordBank && <button type="button" disabled={busy} className={secondary} onClick={() => setPanel('bank')}>Customer paid by bank</button>}
        {can.edit && <button type="button" disabled={busy} className={secondary} onClick={() => setPanel('edit')}>Edit</button>}
        {can.cancel && <button type="button" disabled={busy} className={danger} onClick={() => { if (window.confirm('Cancel this extra charge?')) post('cancel'); }}>Cancel</button>}
        {can.refund && extra.paidVia === 'razorpay' && <button type="button" disabled={busy} className={danger} onClick={refundRazorpay}>Refund by Razorpay</button>}
        {can.refund && <button type="button" disabled={busy} className={secondary} onClick={() => setPanel('offline')}>Record refund paid outside</button>}
        {extra.status === 'paid' && <a className={secondary} href={receiptHref(extra.id)}><FileDown className="h-3.5 w-3.5" /> Receipt</a>}
      </div>

      {panel === 'edit' && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run.mutate(() => apiClient.put(extraUrl(extra.id), { amount: Number(amount), reason: reason.trim() })); }}>
          <input className={input} type="number" min={1} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in rupees" />
          <textarea className={input} rows={2} required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
          <button type="submit" disabled={busy} className={primary}>Save</button>
        </form>
      )}
      {panel === 'bank' && (
        <form className="space-y-2" onSubmit={recordBank} aria-label="Record bank transfer for this extra">
          <input className={input} required placeholder="UTR / bank reference" value={utr} onChange={(e) => setUtr(e.target.value)} aria-label="UTR" />
          <input className={input} type="date" required value={paidOn} onChange={(e) => setPaidOn(e.target.value)} aria-label="Date the customer paid" />
          <FilePicker files={files} onChange={setFiles} max={MAX_ATTACHMENTS} accept={PHOTO_OR_PDF} label="Attach receipt (PDF or photo)" icon={<Paperclip className="h-4 w-4" />} onError={setError} />
          <button type="submit" disabled={busy} className={primary}>Send to Accounts to check — {rupees(extra.amount)}</button>
        </form>
      )}
      {panel === 'offline' && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); post('refund', { method: 'offline', offlineMethod, reference: utr.trim() }); }}>
          <select className={input} value={offlineMethod} onChange={(e) => setOfflineMethod(e.target.value)} aria-label="How the money went back">
            <option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option>
          </select>
          <input className={input} required minLength={3} placeholder="UTR, cheque or receipt number" value={utr} onChange={(e) => setUtr(e.target.value)} aria-label="Refund reference" />
          <button type="submit" disabled={busy} className={danger}>Record refund of {rupees(extra.amount)}</button>
        </form>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
    </li>
  );
}
