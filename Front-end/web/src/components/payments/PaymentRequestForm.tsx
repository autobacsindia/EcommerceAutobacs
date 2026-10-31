'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Paperclip, QrCode } from 'lucide-react';
import apiClient from '@/lib/api-client';
import {
  errorMessage, getExpenseOptions, getRequest, paymentKeys, postForm, previewRupees, rupees, type PaymentRequest,
} from './api';
import FilePicker from './FilePicker';
import { MAX_ATTACHMENTS, PHOTO_ONLY, PHOTO_OR_PDF } from '@/lib/attachments';
import SupplierPicker, { SupplierSuggestions } from './SupplierPicker';
import type { Supplier } from './suppliers';

/** The server takes up to five bills and one payee QR per request. */
const MAX_BILLS = MAX_ATTACHMENTS;

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
  sameAs,
  onDone,
  onCancel,
}: {
  /** Present for a supplier payment; absent for an expense. */
  supplier?: SupplierContext;
  /** The last supplier payment on this order: offers "Same supplier as …" to refill it. */
  sameAs?: { id: string; name: string };
  onDone: (r: PaymentRequest) => void;
  onCancel?: () => void;
}) {
  const [category, setCategory] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [foreignAmount, setForeignAmount] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [itemIds, setItemIds] = useState<string[]>(supplier ? supplier.lines.map((l) => l.itemId) : []);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<'upi' | 'bank'>('upi');
  const [payee, setPayee] = useState({ name: '', upiId: '', accountName: '', accountNumber: '', ifsc: '', bankName: '', phone: '' });
  const [bills, setBills] = useState<File[]>([]);
  const [qr, setQr] = useState<File[]>([]);
  const [picked, setPicked] = useState<Supplier | null>(null);
  const [saveSupplier, setSaveSupplier] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filling, setFilling] = useState(false);

  // An expense: this team's own options and currencies, from the server.
  const optionsQ = useQuery({
    queryKey: paymentKeys.options('mine'),
    queryFn: () => getExpenseOptions(),
    enabled: !supplier,
    staleTime: 10 * 60 * 1000,
  });
  const options = optionsQ.data?.options;
  const chosen = options?.categories.find((c) => c.value === category) ?? options?.categories[0];
  const noteRequired = !supplier && (chosen?.noteRequired ?? true);
  const foreign = !supplier && currency !== (options?.baseCurrency ?? 'INR');
  const comesTo = foreign ? previewRupees(foreignAmount, fxRate) : null;

  /** Refill from the previous payment: its saved supplier, or the details typed then. */
  async function fillSame() {
    if (!sameAs) return;
    setFilling(true);
    setError('');
    try {
      const { request: prev } = await getRequest(sameAs.id);
      if (prev.supplier?.id) {
        try {
          const { supplier: saved } = await apiClient.get<{ supplier: Supplier }>(`/suppliers/${encodeURIComponent(prev.supplier.id)}`);
          if (saved.active) { setPicked(saved); return; }
        } catch { /* fall back to the details on the payment */ }
      }
      const p = prev.payee;
      setPicked(null);
      setMethod(p.method);
      setPayee({
        name: p.name, upiId: p.upiId || '', accountName: p.accountName || '', accountNumber: /X/.test(p.accountNumber || '') ? '' : p.accountNumber || '',
        ifsc: p.ifsc || '', bankName: p.bankName || '', phone: p.phone || '',
      });
    } catch (err) {
      setError(errorMessage(err, 'Could not load the previous supplier.'));
    } finally {
      setFilling(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (supplier && itemIds.length === 0) { setError('Choose the item(s) this payment is for.'); return; }
    if (!picked && method === 'upi' && !payee.upiId.trim() && qr.length === 0) { setError('Enter their UPI ID, or attach their payment QR.'); return; }
    if (!supplier && !chosen) { setError('The options are still loading — try again in a moment.'); return; }
    const form = new FormData();
    // A foreign bill sends what was billed and the rate; the server works out the rupees.
    if (foreign) {
      form.append('currency', currency);
      form.append('foreignAmount', foreignAmount);
      form.append('fxRate', fxRate);
    } else {
      form.append('amount', amount);
    }
    form.append('description', description.trim());
    // A saved supplier is sent by id: the server copies its details itself.
    if (picked) form.append('supplierId', picked.id);
    else form.append('payee', JSON.stringify(method === 'upi'
      ? { name: payee.name.trim(), method, upiId: payee.upiId.trim(), phone: payee.phone.trim() }
      : { name: payee.name.trim(), method, accountName: payee.accountName.trim(), accountNumber: payee.accountNumber.replace(/\s+/g, ''), ifsc: payee.ifsc.trim().toUpperCase(), bankName: payee.bankName.trim(), phone: payee.phone.trim() }));
    if (supplier) {
      form.append('orderId', supplier.orderId);
      form.append('itemIds', JSON.stringify(itemIds));
      if (!picked && saveSupplier) form.append('saveSupplier', 'true');
    } else {
      form.append('category', chosen!.value);
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
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="pr-category">What for</label>
            {optionsQ.isError ? (
              <p role="alert" className="text-sm text-red-700">
                {errorMessage(optionsQ.error, 'Could not load the options.')}{' '}
                <button type="button" onClick={() => optionsQ.refetch()} className="font-medium underline">Try again</button>
              </p>
            ) : !options ? (
              <p className="flex items-center gap-2 py-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
            ) : (
              <select id="pr-category" className={input} value={chosen?.value ?? ''} onChange={(e) => setCategory(e.target.value)}>
                {options.categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            )}
          </div>
          {options && options.currencies.length > 1 && (
            <div>
              <label className={label} htmlFor="pr-currency">Currency</label>
              <select id="pr-currency" className={input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {options.currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {foreign && (
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="pr-foreign">Bill amount ({currency})</label>
              <input id="pr-foreign" className={input} required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={foreignAmount} onChange={(e) => setForeignAmount(e.target.value)} placeholder="e.g. 10000" />
            </div>
            <div>
              <label className={label} htmlFor="pr-rate">Rate (₹ for 1 {currency})</label>
              <input id="pr-rate" className={input} required inputMode="decimal" pattern="\d+(\.\d{1,6})?" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="From your bank / forex quote, e.g. 2.45" />
            </div>
          </div>
          <p className="mt-2 text-sm text-gray-700" aria-live="polite">
            {comesTo != null
              ? <>Comes to about <strong>{rupees(comesTo)}</strong>. Accounts approves the rupee amount; the website works it out from the bill and the rate.</>
              : 'Enter the bill amount and the rate from your quote — the rupee amount is worked out from them.'}
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {!foreign && (
          <div>
            <label className={label} htmlFor="pr-amount">Amount (₹)</label>
            <input id="pr-amount" className={input} required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1250" />
          </div>
        )}
        {!picked && (
          <div>
            <label className={label} htmlFor="pr-payee">{supplier ? 'Supplier' : 'Pay to'}</label>
            <input id="pr-payee" className={input} required minLength={2} maxLength={120} value={payee.name} onChange={set('name')} placeholder={supplier ? 'Type the supplier name' : 'Shop / person'} autoComplete="off" />
            {supplier && <SupplierSuggestions query={payee.name} onPick={setPicked} />}
          </div>
        )}
      </div>

      {supplier && sameAs && !picked && (
        <button type="button" disabled={filling} onClick={fillSame}
          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50">
          {filling && <Loader2 className="h-4 w-4 animate-spin" />} Same supplier as before ({sameAs.name})
        </button>
      )}

      {supplier && picked && (
        <div>
          <span className={label}>Saved supplier</span>
          <SupplierPicker picked={picked} onPick={setPicked} />
        </div>
      )}

      {!picked && (
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
            <input aria-label="UPI ID" className={input} value={payee.upiId} onChange={set('upiId')} placeholder="UPI ID (optional if you attach their QR)" autoCapitalize="none" />
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
        {supplier && (
          <label className="mt-2 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={saveSupplier} onChange={(e) => setSaveSupplier(e.target.checked)} />
            Save as a new supplier for next time
          </label>
        )}
      </div>
      )}

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <label className={label} htmlFor="pr-desc">Details</label>
          {!supplier && <span className="text-xs text-gray-500">{noteRequired ? 'Required' : 'Optional'}</span>}
        </div>
        <textarea id="pr-desc" className={input} rows={2} required={noteRequired} minLength={noteRequired ? 3 : 0} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder={supplier ? 'Supplier invoice number, anything accounts should know' : noteRequired ? 'Say what it was for (e.g. which tool, which month’s GST)' : 'What was bought / where you travelled, and why'} />
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <FilePicker files={bills} onChange={setBills} max={MAX_BILLS} accept={PHOTO_OR_PDF}
          label="Attach bills / invoices" icon={<Paperclip className="h-4 w-4" />} onError={setError} />
        <FilePicker files={qr} onChange={setQr} max={1} accept={PHOTO_ONLY}
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
