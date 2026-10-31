'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import {
  categoryName, errorMessage, getExpenseOptions, paymentKeys, previewRupees, rupees, type PaymentRequest,
} from './api';
import { SupplierSuggestions, payLine } from './SupplierPicker';
import type { Supplier } from './suppliers';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';

/**
 * Correct a payment request: amount, details, who is paid (for a supplier
 * payment, a saved supplier can be picked by typing its name). The server
 * decides who may edit and until when, and says when an edit sends it back to
 * accounts.
 *
 * An expense offers its team's options; one raised with an option the team no
 * longer has (from before per-team lists) keeps it, marked "old option", and
 * the server only checks the list if it is changed.
 */
export default function EditPaymentRequest({ r, onDone, onCancel }: {
  r: PaymentRequest;
  onDone: (r: PaymentRequest) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(String(r.amount));
  const [description, setDescription] = useState(r.description || '');
  const [category, setCategory] = useState(r.category);
  const [currency, setCurrency] = useState(r.currency || 'INR');
  const [foreignAmount, setForeignAmount] = useState(r.foreignAmount != null ? String(r.foreignAmount) : '');
  const [fxRate, setFxRate] = useState(r.fxRate != null ? String(r.fxRate) : '');
  const isExpense = r.kind === 'expense';
  const optionsQ = useQuery({
    queryKey: paymentKeys.options(r.team),
    queryFn: () => getExpenseOptions(r.team),
    enabled: isExpense,
    staleTime: 10 * 60 * 1000,
  });
  const options = optionsQ.data?.options;
  const teamCategories = options?.categories ?? [];
  const isOld = !teamCategories.some((c) => c.value === r.category);
  // An option off the team's list was raised when details were required on every expense.
  const noteRequired = isExpense && (teamCategories.find((c) => c.value === category)?.noteRequired ?? true);
  const currencies = options?.currencies ?? [];
  const currencyChoices = currencies.some((c) => c.code === (r.currency || 'INR'))
    ? currencies
    : [{ code: r.currency || 'INR', label: '' }, ...currencies];
  const foreign = isExpense && currency !== 'INR';
  const comesTo = foreign ? previewRupees(foreignAmount, fxRate) : null;
  const [method, setMethod] = useState<'upi' | 'bank'>(r.payee.method);
  const [payee, setPayee] = useState({
    name: r.payee.name, upiId: r.payee.upiId || '', accountName: r.payee.accountName || '',
    accountNumber: r.payee.accountNumber || '', ifsc: r.payee.ifsc || '', bankName: r.payee.bankName || '', phone: r.payee.phone || '',
  });
  const [picked, setPicked] = useState<Supplier | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof payee) => (e: React.ChangeEvent<HTMLInputElement>) => setPayee({ ...payee, [k]: e.target.value });
  // A masked number (someone who may not see it in full) cannot be resent as is.
  const masked = /X/.test(payee.accountNumber);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const body: Record<string, unknown> = { description: description.trim() };
    // A foreign bill sends what was billed and the rate; the server works out the rupees.
    if (foreign) Object.assign(body, { currency, foreignAmount, fxRate });
    else Object.assign(body, isExpense ? { currency, amount } : { amount });
    if (isExpense) body.category = category;
    if (picked) body.supplierId = picked.id;
    else if (!(method === 'bank' && masked)) {
      body.payee = method === 'upi'
        ? { name: payee.name.trim(), method, upiId: payee.upiId.trim(), phone: payee.phone.trim() }
        : { name: payee.name.trim(), method, accountName: payee.accountName.trim(), accountNumber: payee.accountNumber.replace(/\s+/g, ''), ifsc: payee.ifsc.trim().toUpperCase(), bankName: payee.bankName.trim(), phone: payee.phone.trim() };
    }
    setBusy(true);
    try {
      const res = await apiClient.put<{ request: PaymentRequest }>(`/payment-requests/${encodeURIComponent(r.id)}`, body);
      onDone(res.request);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the changes. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} aria-label="Edit payment request" className="space-y-3">
      {r.status !== 'submitted' && (
        <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Already approved: changing the amount or who is paid sends it back to accounts to approve again.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {!foreign && (
          <div><label className={label} htmlFor="ed-amount">Amount (₹)</label>
            <input id="ed-amount" className={input} required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        )}
        {isExpense && (
          <div><label className={label} htmlFor="ed-cat">What for</label>
            <select id="ed-cat" className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
              {isOld && <option value={r.category}>{categoryName(r)}{options ? ' (old option)' : ''}</option>}
              {teamCategories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select></div>
        )}
        {isExpense && currencyChoices.length > 1 && (
          <div><label className={label} htmlFor="ed-currency">Currency</label>
            <select id="ed-currency" className={input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencyChoices.map((c) => <option key={c.code} value={c.code}>{c.label ? `${c.code} — ${c.label}` : c.code}</option>)}
            </select></div>
        )}
      </div>

      {foreign && (
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={label} htmlFor="ed-foreign">Bill amount ({currency})</label>
              <input id="ed-foreign" className={input} required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={foreignAmount} onChange={(e) => setForeignAmount(e.target.value)} /></div>
            <div><label className={label} htmlFor="ed-rate">Rate (₹ for 1 {currency})</label>
              <input id="ed-rate" className={input} required inputMode="decimal" pattern="\d+(\.\d{1,6})?" value={fxRate} onChange={(e) => setFxRate(e.target.value)} /></div>
          </div>
          <p className="mt-2 text-sm text-gray-700" aria-live="polite">
            {comesTo != null ? <>Comes to about <strong>{rupees(comesTo)}</strong> — worked out from the bill and the rate.</> : 'Enter the bill amount and the rate.'}
          </p>
        </div>
      )}

      {picked ? (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
          <div><p className="font-semibold text-gray-900">{picked.name}</p><p className="text-gray-700">{payLine(picked)}</p></div>
          <button type="button" onClick={() => setPicked(null)} className="text-sm font-medium text-blue-700">Change</button>
        </div>
      ) : (
        <>
          <div><label className={label} htmlFor="ed-payee">{r.kind === 'supplier' ? 'Supplier' : 'Pay to'}</label>
            <input id="ed-payee" className={input} required minLength={2} maxLength={120} value={payee.name} onChange={set('name')} autoComplete="off" />
            {r.kind === 'supplier' && <SupplierSuggestions query={payee.name} onPick={setPicked} />}</div>
          <div className="flex gap-2" role="radiogroup" aria-label="Payment method">
            {(['upi', 'bank'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${method === m ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700'}`}>
                {m === 'upi' ? 'UPI' : 'Bank transfer'}
              </button>
            ))}
          </div>
          {method === 'upi' ? (
            <input aria-label="UPI ID" className={input} value={payee.upiId} onChange={set('upiId')} placeholder="UPI ID (optional if their QR is attached)" autoCapitalize="none" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <input aria-label="Account holder" className={input} required value={payee.accountName} onChange={set('accountName')} placeholder="Account holder name" />
              <input aria-label="Account number" className={input} required inputMode="numeric" value={payee.accountNumber} onChange={set('accountNumber')} placeholder="Account number" />
              <input aria-label="IFSC" className={input} required value={payee.ifsc} onChange={set('ifsc')} placeholder="IFSC" autoCapitalize="characters" />
              <input aria-label="Bank name" className={input} value={payee.bankName} onChange={set('bankName')} placeholder="Bank (optional)" />
            </div>
          )}
        </>
      )}

      <div><label className={label} htmlFor="ed-desc">Details</label>
        <textarea id="ed-desc" className={input} rows={2} required={noteRequired} minLength={noteRequired ? 3 : 0} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
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
