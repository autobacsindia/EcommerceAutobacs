'use client';

import { useState } from 'react';
import { Loader2, Paperclip, QrCode } from 'lucide-react';
import { EXPENSE_CATEGORIES, errorMessage, postForm, type PaymentRequest } from './api';
import FilePicker from './FilePicker';

/** The server takes up to five bills and one payee QR per request. */
const MAX_BILLS = 5;

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';

export type SupplierContext = {
  orderId: string;
  orderNumber: string;
  customer: string;
  closedBy: string;
  /** Lines that can be paid for now (in stock / ordered, not shipped). */
  lines: { itemId: string; name: string }[];
};

/**
 * Raise a payment request — an expense (any team) or a supplier
 * payment for an order's items (procurement). The server checks every field
 * again; this form only helps get it right first time.
 */
export default function PaymentRequestForm({
  supplier,
  onDone,
  onCancel,
}: {
  /** Present for a supplier payment; absent for an expense. */
  supplier?: SupplierContext;
  onDone: (r: PaymentRequest) => void;
  onCancel?: () => void;
}) {
  const [category, setCategory] = useState<string>('fuel');
  const [itemIds, setItemIds] = useState<string[]>(supplier ? supplier.lines.map((l) => l.itemId) : []);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<'upi' | 'bank'>('upi');
  const [payee, setPayee] = useState({ name: '', upiId: '', accountName: '', accountNumber: '', ifsc: '', bankName: '', phone: '' });
  const [bills, setBills] = useState<File[]>([]);
  const [qr, setQr] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (supplier && itemIds.length === 0) { setError('Choose the item(s) this payment is for.'); return; }
    const form = new FormData();
    form.append('amount', amount);
    form.append('description', description.trim());
    form.append('payee', JSON.stringify(method === 'upi'
      ? { name: payee.name.trim(), method, upiId: payee.upiId.trim(), phone: payee.phone.trim() }
      : { name: payee.name.trim(), method, accountName: payee.accountName.trim(), accountNumber: payee.accountNumber.replace(/\s+/g, ''), ifsc: payee.ifsc.trim().toUpperCase(), bankName: payee.bankName.trim(), phone: payee.phone.trim() }));
    if (supplier) {
      form.append('orderId', supplier.orderId);
      form.append('itemIds', JSON.stringify(itemIds));
    } else {
      form.append('category', category);
    }
    for (const f of bills) form.append('bill', f);
    for (const f of qr) form.append('qr', f);
    setBusy(true);
    try {
      const res = await postForm<{ request: PaymentRequest }>(supplier ? '/payment-requests/supplier' : '/payment-requests/expenses', form);
      onDone(res.request);
    } catch (err) {
      setError(errorMessage(err, 'Could not send the request. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof payee) => (e: React.ChangeEvent<HTMLInputElement>) => setPayee({ ...payee, [k]: e.target.value });

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-gray-200 bg-white p-5" aria-label={supplier ? 'Supplier payment request' : 'Expense request'}>
      <div>
        <h3 className="text-base font-semibold text-gray-900">{supplier ? 'Request supplier payment' : 'New expense request'}</h3>
        <p className="text-xs text-gray-500">Accounts approves it, then the admin pays it. You can follow it in Payments and in team chat.</p>
      </div>

      {supplier ? (
        <div className="rounded-lg bg-gray-50 p-3 text-sm">
          <p className="text-gray-700">Order <strong>{supplier.orderNumber}</strong> · {supplier.customer} · sale closed by {supplier.closedBy}</p>
          <fieldset className="mt-2">
            <legend className={label}>For</legend>
            {supplier.lines.map((l) => (
              <label key={l.itemId} className="flex items-center gap-2 py-0.5 text-gray-800">
                <input type="checkbox" checked={itemIds.includes(l.itemId)}
                  onChange={(e) => setItemIds(e.target.checked ? [...itemIds, l.itemId] : itemIds.filter((x) => x !== l.itemId))} />
                {l.name}
              </label>
            ))}
          </fieldset>
        </div>
      ) : (
        <div>
          <label className={label} htmlFor="pr-category">What for</label>
          <select id="pr-category" className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="pr-amount">Amount (₹)</label>
          <input id="pr-amount" className={input} required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1250" />
        </div>
        <div>
          <label className={label} htmlFor="pr-payee">{supplier ? 'Supplier' : 'Pay to'}</label>
          <input id="pr-payee" className={input} required minLength={2} maxLength={120} value={payee.name} onChange={set('name')} placeholder={supplier ? 'Supplier name' : 'Shop / person'} />
        </div>
      </div>

      <div>
        <span className={label}>How to pay them</span>
        <div className="flex gap-2" role="radiogroup" aria-label="Payment method">
          {(['upi', 'bank'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${method === m ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700'}`}>
              {m === 'upi' ? 'UPI' : 'Bank transfer'}
            </button>
          ))}
        </div>
        {method === 'upi' ? (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <input aria-label="UPI ID" className={input} required value={payee.upiId} onChange={set('upiId')} placeholder="UPI ID, e.g. name@okaxis" autoCapitalize="none" />
            <input aria-label="Payee phone" className={input} value={payee.phone} onChange={set('phone')} placeholder="Phone (optional)" inputMode="tel" />
          </div>
        ) : (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <input aria-label="Account holder" className={input} required value={payee.accountName} onChange={set('accountName')} placeholder="Account holder name" />
            <input aria-label="Account number" className={input} required inputMode="numeric" value={payee.accountNumber} onChange={set('accountNumber')} placeholder="Account number" />
            <input aria-label="IFSC" className={input} required value={payee.ifsc} onChange={set('ifsc')} placeholder="IFSC, e.g. HDFC0001234" autoCapitalize="characters" />
            <input aria-label="Bank name" className={input} value={payee.bankName} onChange={set('bankName')} placeholder="Bank (optional)" />
          </div>
        )}
      </div>

      <div>
        <label className={label} htmlFor="pr-desc">Details</label>
        <textarea id="pr-desc" className={input} rows={2} required={!supplier} minLength={supplier ? 0 : 3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder={supplier ? 'Supplier invoice number, anything accounts should know' : 'What was bought / where you travelled, and why'} />
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <FilePicker files={bills} onChange={setBills} max={MAX_BILLS} accept="image/jpeg,image/png,image/webp,application/pdf"
          label="Attach bills / invoices" icon={<Paperclip className="h-4 w-4" />} onError={setError} />
        <FilePicker files={qr} onChange={setQr} max={1} accept="image/jpeg,image/png,image/webp"
          label="Attach their payment QR" icon={<QrCode className="h-4 w-4" />} onError={setError} />
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Send for approval
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>}
      </div>
    </form>
  );
}
