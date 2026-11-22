'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  categoryName, errorMessage, fileHref, getExpenseOptions, money, paymentKeys, postForm, REIMBURSEMENT, type PaymentRequest,
} from './api';
import ReimbursementFields, { claimPayload, claimProblem, emptyClaim, type ClaimDraft } from './ReimbursementFields';
import BankCodeField, { bankCodePayload, bankCodeProblem, kindOf, type BankCodeKind } from './BankCodeField';
import CardFields, { cardPayload, last4Problem, type CardDetails, type PayMethod } from './CardFields';
import { SupplierSuggestions, payLine } from './SupplierPicker';
import type { Supplier } from './suppliers';
import RichTextBox from '@/components/ui/RichTextBox';
import { richTextToPlain } from '@/lib/richText';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';

/**
 * Correct a payment request before accounts approves it: amount, details, who is
 * paid (for a supplier payment, a saved supplier can be picked by typing its
 * name) and the attached bills / QR. A reason is required — accounts sees it with
 * the old → new values. The server decides who may edit and when; an on-hold or
 * declined request goes back to accounts when saved.
 *
 * Sent with the version it was opened on (`rev`): an approval or another edit in
 * between is refused, never overwritten. A one-time `formKey` makes a double
 * click save once.
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
  // A Reimbursement: edited as km (Fuel — the server recomputes km × the claim's own rate) or a typed amount.
  const [claim, setClaim] = useState<ClaimDraft>(() => (r.reimbursement
    ? { type: r.reimbursement.type, on: r.reimbursement.on, km: r.reimbursement.km != null ? String(r.reimbursement.km) : '', from: r.reimbursement.from, to: r.reimbursement.to }
    : emptyClaim()));
  const optionsQ = useQuery({
    queryKey: paymentKeys.options(r.team),
    queryFn: () => getExpenseOptions(r.team),
    staleTime: 10 * 60 * 1000,
  });
  const options = optionsQ.data?.options;
  const teamCategories = options?.categories ?? [];
  const isOld = !teamCategories.some((c) => c.value === r.category);
  // An option off the team's list was raised when details were required on every expense.
  const reimbursing = isExpense && category === REIMBURSEMENT && Boolean(options?.reimbursement);
  const noteRequired = isExpense && (reimbursing ? claim.type === 'other' : (teamCategories.find((c) => c.value === category)?.noteRequired ?? true));
  const currencies = options?.currencies ?? [];
  const currencyChoices = currencies.some((c) => c.code === (r.currency || 'INR'))
    ? currencies
    : [{ code: r.currency || 'INR', label: '' }, ...currencies];
  const foreign = !reimbursing && currency !== 'INR';
  // A part of a supplier deal stays in the deal's currency.
  const currencyLocked = Boolean(r.dealId || r.credit);
  // An expense's pay details are all optional (accounts fills them in); a supplier's are not.
  const optional = isExpense;
  const [method, setMethod] = useState<PayMethod>(r.payee.method || '');
  const [card, setCard] = useState<CardDetails>({
    cardType: r.payee.cardType || '', cardNetwork: r.payee.cardNetwork || '', cardLast4: r.payee.cardLast4 || '',
    cardName: r.payee.cardName || '', cardLabel: r.payee.cardLabel || '',
  });
  const [payee, setPayee] = useState({
    name: r.payee.name, upiId: r.payee.upiId || '', accountName: r.payee.accountName || '',
    accountNumber: r.payee.accountNumber || '', ifsc: r.payee.ifsc || '', swift: r.payee.swift || '', bankName: r.payee.bankName || '', phone: r.payee.phone || '',
  });
  const [codeKind, setCodeKind] = useState<BankCodeKind>(kindOf(r.payee));
  const [picked, setPicked] = useState<Supplier | null>(null);
  const [reason, setReason] = useState('');
  // Bills and the QR the requester attached (payment screenshots are the admin's, never edited here).
  const attached = r.files.filter((f) => f.kind !== 'proof');
  const [removed, setRemoved] = useState<string[]>([]);
  const [bills, setBills] = useState<File[]>([]);
  const [qr, setQr] = useState<File | null>(null);
  const [formKey] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`));
  const qrKept = attached.some((f) => f.kind === 'qr' && !removed.includes(f.id));
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
    if (!picked && method === 'card' && last4Problem(card.cardLast4)) { setError(last4Problem(card.cardLast4)); return; }
    if (reimbursing) {
      // The bills it will carry after this edit: kept ones plus new ones.
      const billCount = r.files.filter((f) => f.kind === 'bill' && !removed.includes(f.id)).length + bills.length;
      const problem = claimProblem(claim, options!.reimbursement!, { amount: Number(amount), details: richTextToPlain(description), bills: billCount });
      if (problem) { setError(problem); return; }
    }
    if (noteRequired && richTextToPlain(description).trim().length < 3) { setError('Add details — say what it was for.'); return; }
    if (reason.trim().length < 3) { setError('Say why you are changing it — accounts sees this.'); return; }
    if (qr && qrKept) { setError('Remove the old QR code before attaching a new one.'); return; }
    const body: Record<string, unknown> = { description: description.trim(), reason: reason.trim(), rev: r.rev ?? 0, formKey };
    // A foreign bill sends only what was billed: its rupees are recorded when it is paid.
    // A reimbursement is rupees; Fuel sends km only (never an amount).
    if (reimbursing) Object.assign(body, { reimbursement: claimPayload(claim) }, claim.type === 'fuel' ? {} : { amount });
    else if (foreign) Object.assign(body, currencyLocked ? { foreignAmount } : { currency, foreignAmount });
    else Object.assign(body, currencyLocked ? { amount } : { currency, amount });
    if (isExpense) body.category = category;
    if (picked) body.supplierId = picked.id;
    else if (!(method === 'bank' && masked)) {
      body.payee = method === 'upi'
        ? { name: payee.name.trim(), method, upiId: payee.upiId.trim(), phone: payee.phone.trim() }
        : method === 'card'
          ? { name: payee.name.trim(), method, ...cardPayload(card) }
          : method === 'bank'
            ? { name: payee.name.trim(), method, accountName: payee.accountName.trim(), accountNumber: payee.accountNumber.replace(/\s+/g, ''), ...bankCodePayload(codeKind, payee[codeKind]), bankName: payee.bankName.trim(), phone: payee.phone.trim() }
            : { name: payee.name.trim(), method: '' };
    }
    setBusy(true);
    try {
      const form = new FormData();
      for (const [k, v] of Object.entries(body)) form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      if (removed.length) form.append('removeFileIds', JSON.stringify(removed));
      for (const f of bills) form.append('bill', f);
      if (qr) form.append('qr', qr);
      const res = await postForm<{ request: PaymentRequest }>(`/payment-requests/${encodeURIComponent(r.id)}`, form, 'PUT');
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
        <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          {r.status === 'declined' ? 'Declined' : 'On hold'}: saving sends it back to accounts to approve again.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {!foreign && !reimbursing && (
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
        {!currencyLocked && !reimbursing && currencyChoices.length > 1 && (
          <div><label className={label} htmlFor="ed-currency">Currency</label>
            <select id="ed-currency" className={input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencyChoices.map((c) => <option key={c.code} value={c.code}>{c.label ? `${c.code} — ${c.label}` : c.code}</option>)}
            </select></div>
        )}
      </div>

      {reimbursing && options?.reimbursement && (
        <ReimbursementFields value={claim} onChange={setClaim} options={options.reimbursement} amount={amount} onAmount={setAmount}
          ratePerKm={r.reimbursement?.type === 'fuel' ? r.reimbursement.ratePerKm : null} />
      )}

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
            <input id="ed-payee" className={input} required={!optional} minLength={2} maxLength={120} value={payee.name} onChange={set('name')} autoComplete="off" />
            {r.kind === 'supplier' && <SupplierSuggestions query={payee.name} onPick={setPicked} />}</div>
          <div className="flex gap-2" role="radiogroup" aria-label="Payment method">
            {(optional ? (['upi', 'bank', 'card'] as const) : (['upi', 'bank'] as const)).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(optional && method === m ? '' : m)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${method === m ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700'}`}>
                {m === 'upi' ? 'UPI' : m === 'bank' ? 'Bank transfer' : 'Card'}
              </button>
            ))}
          </div>
          {method === 'card' && <CardFields value={card} onChange={setCard} inputClass={input} />}
          {method === 'upi' ? (
            <input aria-label="UPI ID" className={input} value={payee.upiId} onChange={set('upiId')} placeholder="UPI ID (optional if their QR is attached)" autoCapitalize="none" />
          ) : method === 'bank' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <input aria-label="Account holder" className={input} required={!optional} value={payee.accountName} onChange={set('accountName')} placeholder="Account holder name" />
              <input aria-label="Account number" className={input} required={!optional} inputMode={codeKind === 'swift' ? 'text' : 'numeric'} value={payee.accountNumber} onChange={set('accountNumber')} placeholder="Account number" />
              {masked ? (
                <p className="self-center text-sm text-gray-600">{payee.swift ? `SWIFT ${payee.swift}` : `IFSC ${payee.ifsc}`}</p>
              ) : (
                <BankCodeField kind={codeKind} value={payee[codeKind]} onKind={setCodeKind} onChange={(v) => setPayee({ ...payee, [codeKind]: v })} inputClass={input} optional={optional} />
              )}
              <input aria-label="Bank name" className={`${input} sm:self-end`} value={payee.bankName} onChange={set('bankName')} placeholder="Bank (optional)" />
            </div>
          ) : null}
        </>
      )}

      <div><label className={label} htmlFor="ed-desc">Details</label>
        <RichTextBox id="ed-desc" ariaLabel="Details" compact maxLength={2000} value={description} onChange={setDescription} /></div>
      <fieldset className="space-y-2">
        <legend className={label}>Attachments</legend>
        {attached.length > 0 && (
          <ul className="space-y-1 text-sm">
            {attached.map((f) => {
              const gone = removed.includes(f.id);
              return (
                <li key={f.id} className="flex items-center justify-between gap-2">
                  <a href={fileHref(r.id, f.id)} target="_blank" rel="noopener noreferrer" className={`truncate text-blue-700 ${gone ? 'line-through opacity-60' : ''}`}>
                    {f.kind === 'qr' ? 'Payment QR' : 'Bill'}{f.name ? ` — ${f.name}` : ''}
                  </a>
                  <button type="button" className="shrink-0 text-xs font-medium text-gray-700 hover:underline"
                    onClick={() => setRemoved(gone ? removed.filter((x) => x !== f.id) : [...removed, f.id])}>
                    {gone ? 'Keep' : 'Remove'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm text-gray-700">Add bill / invoice
            <input type="file" multiple accept="image/*,application/pdf" aria-label="Add bill" className="mt-1 block w-full text-xs"
              onChange={(e) => setBills(Array.from(e.target.files || []))} /></label>
          <label className="text-sm text-gray-700">{qrKept ? 'New payment QR (remove the old one first)' : 'Add payment QR'}
            <input type="file" accept="image/*" aria-label="Add payment QR" className="mt-1 block w-full text-xs"
              onChange={(e) => setQr(e.target.files?.[0] || null)} /></label>
        </div>
      </fieldset>

      <div><label className={label} htmlFor="ed-reason">Why are you changing it?</label>
        <textarea id="ed-reason" className={input} required minLength={3} maxLength={1000} rows={2} value={reason}
          onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong amount — the bill says ₹1,800" />
        <p className="mt-1 text-xs text-gray-500">Accounts sees this and what changed before approving.</p></div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {r.status === 'submitted' ? 'Save changes' : 'Save & send to accounts'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>
      </div>
    </form>
  );
}
