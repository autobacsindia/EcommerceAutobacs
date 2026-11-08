'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import {
  categoryName, errorMessage, getExpenseOptions, money, paymentKeys, type PaymentRequest,
} from './api';
import BankCodeField, { bankCodePayload, bankCodeProblem, kindOf, type BankCodeKind } from './BankCodeField';
import { SupplierSuggestions, payLine } from './SupplierPicker';
import type { Supplier } from './suppliers';
import RichTextBox from '@/components/ui/RichTextBox';
import { richTextToPlain } from '@/lib/richText';

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
  // A foreign bill not yet paid has no rupee amount: empty, should it be switched to rupees.
  // Supplier credit used: the amounts typed here are the BILL; the credit comes off it (server-side).
  const creditUsed = r.credit?.amount || 0;
  const [amount, setAmount] = useState(r.rupeesPending ? '' : String(creditUsed && r.bill != null && (r.currency || 'INR') === 'INR' ? r.bill : r.amount));
  const [description, setDescription] = useState(r.description || '');
  const [category, setCategory] = useState(r.category);
  const [currency, setCurrency] = useState(r.currency || 'INR');
  const [foreignAmount, setForeignAmount] = useState(r.foreignAmount != null ? String(creditUsed && r.bill != null ? r.bill : r.foreignAmount) : '');
  const isExpense = r.kind === 'expense';
  const optionsQ = useQuery({
    queryKey: paymentKeys.options(r.team),
    queryFn: () => getExpenseOptions(r.team),
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
  const foreign = currency !== 'INR';
  // A part of a supplier deal stays in the deal's currency.
  const currencyLocked = Boolean(r.dealId || r.credit);
  const [method, setMethod] = useState<'upi' | 'bank'>(r.payee.method);
  const [payee, setPayee] = useState({
    name: r.payee.name, upiId: r.payee.upiId || '', accountName: r.payee.accountName || '',
    accountNumber: r.payee.accountNumber || '', ifsc: r.payee.ifsc || '', swift: r.payee.swift || '', bankName: r.payee.bankName || '', phone: r.payee.phone || '',
  });
  const [codeKind, setCodeKind] = useState<BankCodeKind>(kindOf(r.payee));
  const [picked, setPicked] = useState<Supplier | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof payee) => (e: React.ChangeEvent<HTMLInputElement>) => setPayee({ ...payee, [k]: e.target.value });
  // A masked number (someone who may not see it in full) cannot be resent as is.
  const masked = /^X+\d{4}$/.test(payee.accountNumber);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const codeProblem = !picked && method === 'bank' && !masked ? bankCodeProblem(codeKind, payee[codeKind]) : '';
    if (codeProblem) { setError(codeProblem); return; }
    if (noteRequired && richTextToPlain(description).trim().length < 3) { setError('Add details — say what it was for.'); return; }
    const body: Record<string, unknown> = { description: description.trim() };
    // A foreign bill sends only what was billed: its rupees are recorded when it is paid.
    if (foreign) Object.assign(body, currencyLocked ? { foreignAmount } : { currency, foreignAmount });
    else Object.assign(body, currencyLocked ? { amount } : { currency, amount });
    if (isExpense) body.category = category;
    if (picked) body.supplierId = picked.id;
    else if (!(method === 'bank' && masked)) {
      body.payee = method === 'upi'
        ? { name: payee.name.trim(), method, upiId: payee.upiId.trim(), phone: payee.phone.trim() }
        : { name: payee.name.trim(), method, accountName: payee.accountName.trim(), accountNumber: payee.accountNumber.replace(/\s+/g, ''), ...bankCodePayload(codeKind, payee[codeKind]), bankName: payee.bankName.trim(), phone: payee.phone.trim() };
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
          <div><label className={label} htmlFor="ed-amount">{creditUsed ? 'Bill amount (₹)' : 'Amount (₹)'}</label>
            <input id="ed-amount" className={input} required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {creditUsed > 0 && <p className="mt-1 text-xs text-emerald-800">{money(creditUsed, 'INR')} supplier credit comes off — transfer {money(Math.max(0, Math.round((Number(amount) - creditUsed) * 100) / 100), 'INR')}</p>}</div>
        )}
        {isExpense && (
          <div><label className={label} htmlFor="ed-cat">What for</label>
            <select id="ed-cat" className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
              {isOld && <option value={r.category}>{categoryName(r)}{options ? ' (old option)' : ''}</option>}
              {teamCategories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select></div>
        )}
        {!currencyLocked && currencyChoices.length > 1 && (
          <div><label className={label} htmlFor="ed-currency">Currency</label>
            <select id="ed-currency" className={input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencyChoices.map((c) => <option key={c.code} value={c.code}>{c.label ? `${c.code} — ${c.label}` : c.code}</option>)}
            </select></div>
        )}
      </div>

      {foreign && (
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="sm:w-1/2 sm:pr-1.5"><label className={label} htmlFor="ed-foreign">Bill amount ({currency})</label>
            <input id="ed-foreign" className={input} required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={foreignAmount} onChange={(e) => setForeignAmount(e.target.value)} />
            {creditUsed > 0 && <p className="mt-1 text-xs text-emerald-800">{money(creditUsed, currency)} supplier credit comes off — transfer {money(Math.max(0, Math.round((Number(foreignAmount) - creditUsed) * 100) / 100), currency)}</p>}</div>
          <p className="mt-2 text-sm text-gray-700">The rupee amount is what the bank debits — the admin records it when paying.</p>
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
              <input aria-label="Account number" className={input} required inputMode={codeKind === 'swift' ? 'text' : 'numeric'} value={payee.accountNumber} onChange={set('accountNumber')} placeholder="Account number" />
              {masked ? (
                <p className="self-center text-sm text-gray-600">{payee.swift ? `SWIFT ${payee.swift}` : `IFSC ${payee.ifsc}`}</p>
              ) : (
                <BankCodeField kind={codeKind} value={payee[codeKind]} onKind={setCodeKind} onChange={(v) => setPayee({ ...payee, [codeKind]: v })} inputClass={input} />
              )}
              <input aria-label="Bank name" className={`${input} sm:self-end`} value={payee.bankName} onChange={set('bankName')} placeholder="Bank (optional)" />
            </div>
          )}
        </>
      )}

      <div><label className={label} htmlFor="ed-desc">Details</label>
        <RichTextBox id="ed-desc" ariaLabel="Details" compact maxLength={2000} value={description} onChange={setDescription} /></div>
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
