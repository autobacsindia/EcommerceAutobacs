'use client';

import { useState } from 'react';
import { Landmark, Loader2, Paperclip } from 'lucide-react';
import FilePicker from '@/components/payments/FilePicker';
import { postForm } from '@/components/payments/api';
import { errorMessage, rupees, type SalesOrder } from './types';

/** Same as the server's MAX_TRANSFER_FILES (services/bankTransferService.js). */
export const MAX_TRANSFER_FILES = 3;

/** Today as YYYY-MM-DD in the browser's (the salesman's) own calendar. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The customer paid by bank transfer instead of the link. Recording it does NOT
 * mark the order paid: the server cancels the payment links (so the customer
 * cannot pay twice) and accounts confirms once the money is in the bank. The
 * amount is always the full order total; the server checks it again.
 */
export default function BankTransferForm({ order, onDone }: { order: SalesOrder; onDone: () => void }) {
  const [openForm, setOpenForm] = useState(false);
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!openForm) {
    return (
      <button type="button" onClick={() => setOpenForm(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
        <Landmark className="h-4 w-4 text-emerald-700" /> Customer paid by bank transfer
      </button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!files.length) { setError('Add the payment screenshot from the customer.'); return; }
    if (!window.confirm(`Record a bank transfer of ${rupees(order.totalAmount)}? The payment links for ${order.orderNumber} will be cancelled, and accounts will check the bank.`)) return;
    const form = new FormData();
    form.append('amount', String(order.totalAmount));
    form.append('reference', reference.trim());
    form.append('paidOn', paidOn);
    if (note.trim()) form.append('note', note.trim());
    for (const f of files) form.append('proof', f);
    setBusy(true);
    try {
      await postForm(`/staff/sales/orders/${encodeURIComponent(order.id)}/bank-transfer`, form);
      setOpenForm(false);
      onDone();
    } catch (err) {
      setError(errorMessage(err, 'Could not record the bank transfer. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100';

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-5" aria-label="Record a bank transfer">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Customer paid by bank transfer — {rupees(order.totalAmount)}</h2>
        <p className="mt-1 text-sm text-gray-600">
          The order stays unpaid until accounts finds the money in the bank and confirms it. Recording this cancels the payment links, so the customer cannot pay twice.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-800">UTR / bank reference</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} required maxLength={40}
            placeholder="From the customer's screenshot" autoComplete="off" className={input} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-800">Date paid</span>
          <input type="date" value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} required className={input} />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-gray-800">Note for accounts <span className="font-normal text-gray-500">(optional)</span></span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2}
          placeholder="For example: paid from his company account" className={input} />
      </label>

      <div className="text-sm">
        <p className="mb-1 font-medium text-gray-800">Payment screenshot</p>
        <FilePicker files={files} onChange={setFiles} max={MAX_TRANSFER_FILES} accept="image/jpeg,image/png,image/webp,application/pdf"
          label="Attach screenshot" icon={<Paperclip className="h-4 w-4" />} onError={setError} />
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />}
          Send to accounts
        </button>
        <button type="button" disabled={busy} onClick={() => { setOpenForm(false); setError(''); }}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  );
}
