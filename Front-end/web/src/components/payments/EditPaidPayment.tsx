'use client';

import { useState } from 'react';
import { Loader2, Paperclip } from 'lucide-react';
import { errorMessage, fileHref, postForm, type PaymentRequest, toLocalInput, fromLocalInput } from './api';
import FilePicker from './FilePicker';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';

/**
 * Admin: correct a PAID payment's record — how it was paid, the reference / UTR,
 * the payment screenshots, a note. The amount and who was paid are not here on
 * purpose: the money has left. A payment made in one transfer with others is
 * corrected together with them (the server does that).
 */
export default function EditPaidPayment({ r, onDone, onCancel }: { r: PaymentRequest; onDone: (r: PaymentRequest) => void; onCancel: () => void }) {
  const [method, setMethod] = useState(r.payment?.method || 'bank');
  const [reference, setReference] = useState(r.payment?.reference || '');
  const [at, setAt] = useState(toLocalInput(r.payment?.transactionAt || r.payment?.paidAt || new Date()));
  const [note, setNote] = useState('');
  const [remove, setRemove] = useState<string[]>([]);
  const [add, setAdd] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const proofs = r.files.filter((f) => f.kind === 'proof');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const form = new FormData();
    form.append('method', method);
    form.append('reference', reference.trim());
    if (at) form.append('transactionAt', fromLocalInput(at));
    if (note.trim()) form.append('note', note.trim());
    if (remove.length) form.append('removeFileIds', JSON.stringify(remove));
    for (const f of add) form.append('proof', f);
    setBusy(true);
    try {
      const res = await postForm<{ request: PaymentRequest }>(`/payment-requests/${encodeURIComponent(r.id)}/payment`, form, 'PUT');
      onDone(res.request);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the changes. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} aria-label="Edit payment record" className="space-y-3">
      <p className="rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
        Correct how this was paid. The amount and who was paid can&apos;t change — the money has already gone.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className={label} htmlFor="ep-method">Paid by</label>
          <select id="ep-method" className={input} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="bank">Bank transfer</option><option value="upi">UPI</option><option value="razorpay">Razorpay</option><option value="other">Other</option>
          </select></div>
        <div><label className={label} htmlFor="ep-ref">Reference / UTR</label>
          <input id="ep-ref" className={input} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" /></div>
        <div className="sm:col-span-2"><label className={label} htmlFor="ep-at">Transaction date &amp; time</label>
          <input id="ep-at" type="datetime-local" className={input} max={toLocalInput()} value={at} onChange={(e) => setAt(e.target.value)} /></div>
      </div>
      {proofs.length > 0 && (
        <fieldset>
          <legend className={label}>Payment screenshots</legend>
          <ul className="space-y-1">
            {proofs.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" aria-label={`Remove ${f.name || 'screenshot'}`} checked={remove.includes(f.id)}
                  onChange={(e) => setRemove(e.target.checked ? [...remove, f.id] : remove.filter((x) => x !== f.id))} />
                <a href={fileHref(r.id, f.id)} target="_blank" rel="noopener noreferrer" className={`text-blue-700 hover:underline ${remove.includes(f.id) ? 'line-through opacity-60' : ''}`}>{f.name || 'Screenshot'}</a>
                {remove.includes(f.id) && <span className="text-xs text-red-700">will be removed</span>}
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <div className="text-sm">
        <FilePicker files={add} onChange={setAdd} max={3} accept="image/jpeg,image/png,image/webp,application/pdf"
          label="Add payment screenshots" icon={<Paperclip className="h-4 w-4" />} onError={setError} />
      </div>
      <textarea aria-label="Why the change" className={input} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why the change (optional, kept in the history)" />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>
      </div>
    </form>
  );
}
