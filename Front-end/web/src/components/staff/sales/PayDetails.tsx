'use client';

import { useState } from 'react';
import { AlertTriangle, Copy, FileText, Loader2, MessageCircle, Pencil, QrCode } from 'lucide-react';
import { postForm } from '@/components/payments/api';
import FilePicker from '@/components/payments/FilePicker';
import { whatsappNumber } from './PaymentLinkCard';
import {
  errorMessage, paymentRequestHref, payDetailsMessage, payDetailsQrHref, QR_LIMIT, QR_LIMIT_NOTE, rupees,
  type PayDetails, type PayMethod, type SalesOrder,
} from './types';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';
const METHODS: { value: PayMethod; text: string }[] = [
  { value: 'bank', text: 'Bank transfer' },
  { value: 'upi_qr', text: 'GPay / UPI QR' },
  { value: 'other', text: 'Other' },
];

/**
 * How the customer pays: bank details, a GPay / UPI QR, or another way. The
 * server checks every field and saves it only on an unpaid order; nothing here
 * marks anything paid — the payment is recorded later with its UTR and accounts
 * confirms it.
 */
export function PayDetailsForm({ order, onDone, onCancel }: { order: SalesOrder; onDone: () => void; onCancel?: () => void }) {
  const was = order.payDetails;
  const [method, setMethod] = useState<PayMethod>(was?.method ?? 'bank');
  const [bank, setBank] = useState({
    accountName: was?.bank?.accountName ?? '', accountNumber: was?.bank?.accountNumber ?? '',
    ifsc: was?.bank?.ifsc ?? '', bankName: was?.bank?.bankName ?? '',
  });
  const [upiId, setUpiId] = useState(was?.upiId ?? '');
  const [note, setNote] = useState(was?.note ?? '');
  const [qr, setQr] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const over = order.totalAmount > QR_LIMIT;
  const hasBank = Object.values(bank).some((v) => v.trim());
  const set = (k: keyof typeof bank) => (e: React.ChangeEvent<HTMLInputElement>) => setBank({ ...bank, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (method === 'upi_qr' && !qr.length && !was?.hasQr) { setError('Attach the GPay / UPI QR image.'); return; }
    const form = new FormData();
    form.append('method', method);
    if (method !== 'other' && (method === 'bank' || hasBank)) {
      form.append('bank', JSON.stringify({ ...bank, accountNumber: bank.accountNumber.replace(/\s+/g, ''), ifsc: bank.ifsc.trim().toUpperCase() }));
    }
    if (method === 'upi_qr') form.append('upiId', upiId.trim());
    form.append('note', note.trim());
    for (const f of qr) form.append('qr', f);
    setBusy(true);
    try {
      await postForm(`/staff/sales/orders/${encodeURIComponent(order.id)}/pay-details`, form);
      onDone();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the payment details. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  const bankFields = (required: boolean) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <input aria-label="Account holder" className={input} required={required} value={bank.accountName} onChange={set('accountName')} placeholder="Account holder name" />
      <input aria-label="Account number" className={input} required={required} inputMode="numeric" value={bank.accountNumber} onChange={set('accountNumber')} placeholder="Account number" />
      <input aria-label="IFSC" className={input} required={required} value={bank.ifsc} onChange={set('ifsc')} placeholder="IFSC, e.g. HDFC0001234" autoCapitalize="characters" />
      <input aria-label="Bank name" className={input} value={bank.bankName} onChange={set('bankName')} placeholder="Bank (optional)" />
    </div>
  );

  return (
    <form onSubmit={save} aria-label="Payment details" className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">How the customer pays — {rupees(order.totalAmount)}</h2>
        <p className="text-xs text-gray-500">Goes on the payment request PDF and the WhatsApp message. Accounts is told the exact details.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Payment method">
        {METHODS.map((m) => (
          <button key={m.value} type="button" role="radio" aria-checked={method === m.value} onClick={() => setMethod(m.value)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${method === m.value ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700'}`}>
            {m.text}
          </button>
        ))}
      </div>

      {method === 'bank' && bankFields(true)}

      {method === 'upi_qr' && (
        <div className="space-y-3">
          {over && (
            <p role="status" className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>This order is above {rupees(QR_LIMIT)}. The customer will be told: “{QR_LIMIT_NOTE}” Add the bank details below so they can.</span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {was?.hasQr && !qr.length && (
              // eslint-disable-next-line @next/next/no-img-element -- a private image from our API, not a public asset
              <img src={payDetailsQrHref(order.id)} alt="Saved QR" className="h-24 w-24 rounded-lg border border-gray-200 object-contain" />
            )}
            <FilePicker files={qr} onChange={setQr} max={1} accept="image/jpeg,image/png,image/webp"
              label={was?.hasQr ? 'Replace the QR image' : 'Attach the GPay / UPI QR'} icon={<QrCode className="h-4 w-4" />} onError={setError} />
          </div>
          <input aria-label="UPI ID" className={input} value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="UPI ID (optional), e.g. autobacs@okhdfcbank" autoCapitalize="none" />
          <div>
            <span className={label}>Bank details {over ? '(needed above ₹50,000)' : '(optional)'}</span>
            {bankFields(false)}
          </div>
        </div>
      )}

      <div>
        <label className={label} htmlFor="pd-note">{method === 'other' ? 'How should the customer pay?' : 'Note for the customer (optional)'}</label>
        <textarea id="pd-note" className={input} rows={2} maxLength={500} required={method === 'other'} minLength={method === 'other' ? 3 : 0}
          value={note} onChange={(e) => setNote(e.target.value)} placeholder={method === 'other' ? 'e.g. Cash at our Kochi office' : 'e.g. Please mention the order number'} />
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save payment details
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>}
      </div>
    </form>
  );
}

/** The saved details, ready to share: PDF, WhatsApp, copy. */
export function PayDetailsCard({ order, details, canChange, onChange }: { order: SalesOrder; details: PayDetails; canChange: boolean; onChange: () => void }) {
  const [copied, setCopied] = useState(false);
  const message = payDetailsMessage(order, details, rupees);
  const b = details.bank;
  return (
    <section className="space-y-3 rounded-xl border border-emerald-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            {details.method === 'bank' ? 'Bank transfer' : details.method === 'upi_qr' ? 'GPay / UPI QR' : 'Other payment'} — shared with the customer
          </h2>
          {details.setBy && <p className="text-xs text-gray-500">Set by {details.setBy}</p>}
        </div>
        {canChange && (
          <button type="button" onClick={onChange} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            <Pencil className="h-3.5 w-3.5" /> Change
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-gray-800">
        {details.method === 'upi_qr' && details.hasQr && (
          // eslint-disable-next-line @next/next/no-img-element -- a private image from our API
          <img src={payDetailsQrHref(order.id)} alt="GPay / UPI QR" className="h-28 w-28 rounded-lg border border-gray-200 object-contain" />
        )}
        <div className="space-y-0.5">
          {details.upiId && <p>UPI ID: <strong>{details.upiId}</strong></p>}
          {b && <p>{b.accountName} · A/c <strong>{b.accountNumber}</strong> · IFSC {b.ifsc}{b.bankName ? ` · ${b.bankName}` : ''}</p>}
          {details.note && <p className="text-gray-600">{details.note}</p>}
          {details.method === 'upi_qr' && order.totalAmount > QR_LIMIT && (
            <p className="font-medium text-amber-800">Tells the customer: “{QR_LIMIT_NOTE}”</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={paymentRequestHref(order.id)} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
          <FileText className="h-4 w-4 text-emerald-700" /> Payment request PDF
        </a>
        {order.customer.phone && (
          <a href={`https://wa.me/${whatsappNumber(order.customer.phone)}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
            <MessageCircle className="h-4 w-4 text-green-600" /> Share on WhatsApp
          </a>
        )}
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(message); setCopied(true); } catch { /* ignore */ } }}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
          <Copy className="h-4 w-4" /> {copied ? 'Copied' : 'Copy message'}
        </button>
      </div>
      {details.method === 'upi_qr' && <p className="text-xs text-gray-500">Send the QR image with the message (it is on the PDF too).</p>}
    </section>
  );
}
