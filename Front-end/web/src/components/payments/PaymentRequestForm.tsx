'use client';

import CopyId from '@/components/ui/CopyId';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Paperclip, QrCode } from 'lucide-react';
import apiClient from '@/lib/api-client';
import {
  errorMessage, getExpenseOptions, getRequest, money, paymentKeys, postForm, type OrderMatch, type PaymentRequest,
} from './api';
import OrderPicker from './OrderPicker';
import FilePicker from './FilePicker';
import BankCodeField, { bankCodePayload, bankCodeProblem, kindOf, type BankCodeKind } from './BankCodeField';
import { MAX_ATTACHMENTS, PHOTO_ONLY, PHOTO_OR_PDF } from '@/lib/attachments';
import SupplierPicker, { SupplierSuggestions } from './SupplierPicker';
import type { Supplier } from './suppliers';
import RichTextBox from '@/components/ui/RichTextBox';
import { richTextToPlain } from '@/lib/richText';

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
  /**
   * One part of a supplier deal (made to order, paid in parts). The server pays
   * the deal's items and refuses an amount past the agreed total; these numbers
   * only guide the person typing.
   */
  deal?: { id: string; agreedTotal: number; leftToAsk: number; paid: number; currency: string };
  /**
   * Made to order, in one step: the supplier deal (total agreed, completion date)
   * and its advance, saved together — or neither. The advance-paid date is not
   * typed: it is the day the admin pays it.
   */
  setUpDeal?: boolean;
};

/**
 * Raise a payment request — an expense (any team) or a supplier
 * payment for an order's items (procurement). The server checks every field
 * again; this form only helps get it right first time.
 */
export default function PaymentRequestForm({
  supplier,
  sameAs,
  orderLink,
  onDone,
  onCancel,
}: {
  /** An expense raised from an order's page: linked to that order, which then shows it. */
  orderLink?: { orderId: string; orderNumber: string };
  /** Present for a supplier payment; absent for an expense. */
  supplier?: SupplierContext;
  /** The last supplier payment on this order: offers "Same supplier as …" to refill it. */
  sameAs?: { id: string; name: string };
  onDone: (r: PaymentRequest) => void;
  onCancel?: () => void;
}) {
  const [category, setCategory] = useState('');
  // A part of a supplier deal is in the deal's currency; it cannot be changed here.
  const [currency, setCurrency] = useState(supplier?.deal?.currency || 'INR');
  const [agreedTotal, setAgreedTotal] = useState('');
  const [completionDate, setCompletionDate] = useState('');
  const [linked, setLinked] = useState<OrderMatch | null>(null);
  const [itemIds, setItemIds] = useState<string[]>(supplier ? supplier.lines.map((l) => l.itemId) : []);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<'upi' | 'bank'>('upi');
  const [payee, setPayee] = useState({ name: '', upiId: '', accountName: '', accountNumber: '', ifsc: '', swift: '', bankName: '', phone: '' });
  // IFSC or SWIFT: whatever the person picked, else SWIFT for a foreign-currency bill.
  const [codeChoice, setCodeChoice] = useState<BankCodeKind | null>(null);
  const [bills, setBills] = useState<File[]>([]);
  const [qr, setQr] = useState<File[]>([]);
  const [picked, setPicked] = useState<Supplier | null>(null);
  const [saveSupplier, setSaveSupplier] = useState(false);
  // Supplier credit to take off this bill (what the picked supplier owes us, same currency).
  const [creditToUse, setCreditToUse] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filling, setFilling] = useState(false);

  // The team's options and currencies, from the server. A supplier payment is
  // procurement's (an admin raising one names the team; staff get their own).
  const optionsQ = useQuery({
    queryKey: paymentKeys.options(supplier ? 'procurement' : 'mine'),
    queryFn: () => getExpenseOptions(supplier ? 'procurement' : undefined),
    staleTime: 10 * 60 * 1000,
  });
  const options = optionsQ.data?.options;
  const chosen = options?.categories.find((c) => c.value === category) ?? options?.categories[0];
  const noteRequired = !supplier && (chosen?.noteRequired ?? true);
  const base = options?.baseCurrency ?? 'INR';
  const foreign = currency !== base;
  const setup = Boolean(supplier?.setUpDeal);
  const deal = supplier?.deal;
  // The currency can be chosen everywhere except a deal part (fixed to the deal's).
  const chooseCurrency = !deal && Boolean(options && options.currencies.length > 1);
  const unit = foreign ? currency : '₹';
  const codeKind: BankCodeKind = codeChoice ?? (foreign ? 'swift' : 'ifsc');
  // What the picked supplier owes us in this bill's currency (the server re-checks under a lock).
  const available = supplier && picked ? (picked.credit || []).find((b) => b.currency === currency && b.owed > 0) : undefined;
  const creditNum = available && Number(creditToUse) > 0 ? Number(creditToUse) : 0;

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
      setCodeChoice(kindOf(p));
      setPayee({
        name: p.name, upiId: p.upiId || '', accountName: p.accountName || '', accountNumber: /^X+\d{4}$/.test(p.accountNumber || '') ? '' : p.accountNumber || '',
        ifsc: p.ifsc || '', swift: p.swift || '', bankName: p.bankName || '', phone: p.phone || '',
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
    if (picked?.payment.method === 'none') { setError(`Add how we pay ${picked.name} (bank or UPI) in Suppliers first.`); return; }
    if (!picked && method === 'upi' && !payee.upiId.trim() && qr.length === 0) { setError('Enter their UPI ID, or attach their payment QR.'); return; }
    if (!supplier && !chosen) { setError('The options are still loading — try again in a moment.'); return; }
    if (setup && Number(amount) > Number(agreedTotal)) { setError(`The advance cannot be more than the agreed total (${money(Number(agreedTotal), currency)}).`); return; }
    const codeProblem = !picked && method === 'bank' ? bankCodeProblem(codeKind, payee[codeKind]) : '';
    if (codeProblem) { setError(codeProblem); return; }
    if (noteRequired && richTextToPlain(description).trim().length < 3) { setError('Add details — say what it was for.'); return; }
    const form = new FormData();
    // A foreign bill sends only what was billed: the rupees are recorded when it is paid.
    form.append('currency', currency);
    if (setup) {
      form.append('agreedTotal', agreedTotal);
      form.append('advance', amount);
      form.append('completionDate', completionDate);
      form.append('note', richTextToPlain(description).trim());
    } else if (foreign) {
      form.append('foreignAmount', amount);
    } else {
      form.append('amount', amount);
    }
    form.append('description', description.trim());
    // A saved supplier is sent by id: the server copies its details itself.
    if (picked) form.append('supplierId', picked.id);
    if (picked && creditNum > 0) form.append('creditToUse', String(creditNum));
    if (!picked) form.append('payee', JSON.stringify(method === 'upi'
      ? { name: payee.name.trim(), method, upiId: payee.upiId.trim(), phone: payee.phone.trim() }
      : { name: payee.name.trim(), method, accountName: payee.accountName.trim(), accountNumber: payee.accountNumber.replace(/\s+/g, ''), ...bankCodePayload(codeKind, payee[codeKind]), bankName: payee.bankName.trim(), phone: payee.phone.trim() }));
    if (supplier) {
      form.append('orderId', supplier.orderId);
      if (deal) form.append('dealId', deal.id);
      else form.append('itemIds', JSON.stringify(itemIds));
      if (!picked && saveSupplier) form.append('saveSupplier', 'true');
    } else {
      form.append('category', chosen!.value);
      const link = orderLink?.orderId ?? linked?.id;
      if (link) form.append('orderId', link);
    }
    for (const f of bills) form.append('bill', f);
    for (const f of qr) form.append('qr', f);
    setBusy(true);
    try {
      const endpoint = setup ? '/payment-requests/deals' : supplier ? '/payment-requests/supplier' : '/payment-requests/expenses';
      const res = await postForm<{ request: PaymentRequest }>(endpoint, form);
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
        <h3 className="text-base font-semibold text-gray-900">{setup ? 'Made to order — pay in parts' : deal ? 'Request next supplier payment' : supplier ? 'Request supplier payment' : orderLink ? `Expense for order ${orderLink.orderNumber}` : 'New expense request'}</h3>
        <p className="text-xs text-gray-500">
          {setup
            ? 'Enter the supplier, the total agreed with them, the advance and when they will finish. The advance goes to accounts to approve; the date it is paid is recorded by itself.'
            : 'Accounts approves it, then the admin pays it. You can follow it in Payments and in team chat.'}
        </p>
      </div>

      {supplier ? (
        <div className="rounded-lg bg-gray-50 p-3 text-sm">
          <p className="text-gray-700">Order <strong>{supplier.orderNumber}</strong><CopyId value={supplier.orderNumber} label="Order number" className="ml-0.5" /> · {supplier.customer} · sale closed by {supplier.closedBy}</p>
          {deal || setup ? (
            <div className="mt-2">
              <p className={label}>For</p>
              <p className="text-gray-800">{supplier.lines.map((l) => l.name).join(', ')}</p>
              {deal && (
                <p className="mt-1 text-gray-700">
                  Agreed with supplier <strong>{money(deal.agreedTotal, deal.currency)}</strong> · paid {money(deal.paid, deal.currency)} ·{' '}
                  <strong>up to {money(deal.leftToAsk, deal.currency)}</strong> can be asked for now.
                </p>
              )}
            </div>
          ) : (
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
          )}
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
          {!orderLink && (
            <div className="sm:col-span-2">
              <label className={label} htmlFor="pr-order">Order (optional)</label>
              <OrderPicker id="pr-order" picked={linked} onPick={setLinked} />
              <p className="mt-1 text-xs text-gray-500">If this cost was for a customer’s order, link it — it then shows on that order.</p>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {chooseCurrency && options && (
          <div>
            <label className={label} htmlFor="pr-currency">Currency</label>
            <select id="pr-currency" className={input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {options.currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
            </select>
          </div>
        )}
        {setup && (
          <div>
            <label className={label} htmlFor="pr-total">Total agreed with supplier ({unit})</label>
            <input id="pr-total" className={input} required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={agreedTotal} onChange={(e) => setAgreedTotal(e.target.value)} placeholder="e.g. 29000" />
          </div>
        )}
        <div>
          <label className={label} htmlFor="pr-amount">{setup ? `Advance now (${unit})` : foreign ? `Bill amount (${currency})` : 'Amount (₹)'}</label>
          <input id="pr-amount" className={input} required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder={deal ? `e.g. 10000 (at most ${deal.leftToAsk})` : setup ? 'e.g. 10000' : foreign ? 'e.g. 22950' : 'e.g. 1250'} />
          {deal && (
            <button type="button" className="mt-1 text-xs font-medium text-blue-700 hover:underline" onClick={() => setAmount(String(deal.leftToAsk))}>
              Pay the full balance ({money(deal.leftToAsk, deal.currency)})
            </button>
          )}
          {setup && Number(agreedTotal) > 0 && Number(amount) > 0 && Number(amount) <= Number(agreedTotal) && (
            <p className="mt-1 text-xs text-gray-600">Balance after the advance: {money(Number(agreedTotal) - Number(amount), currency)}</p>
          )}
        </div>
        {setup && (
          <div>
            <label className={label} htmlFor="pr-completion">Supplier finishes making it on</label>
            <input id="pr-completion" type="date" className={input} required value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} />
          </div>
        )}
      </div>

      {foreign && (
        <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
          Accounts approves it in {currency}. The rupee amount is what the bank actually debits — the admin records it when paying.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
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
          <SupplierPicker picked={picked} onPick={(p) => { setPicked(p); setCreditToUse(''); }} />
          {available && (
            <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" aria-label="Supplier credit">
              <p>{picked.name} owes us <strong>{available.owedText}</strong>. Use some of it on this bill?</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-emerald-800" htmlFor="pr-credit">Credit to use ({unit})</label>
                <input id="pr-credit" className={`${input} max-w-[10rem]`} inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={creditToUse}
                  onChange={(e) => setCreditToUse(e.target.value)} placeholder="0" />
                <button type="button" className="text-xs font-medium text-emerald-800 hover:underline"
                  onClick={() => setCreditToUse(String(Math.max(0, Math.min(available.owed, Number(amount) > 0 ? Math.round(Number(amount) * 100 - 1) / 100 : available.owed))))}>
                  Use as much as possible
                </button>
              </div>
              {creditNum > 0 && Number(amount) > 0 && (
                <p className="mt-2">
                  Bill {money(Number(amount), currency)} − credit {money(creditNum, currency)} = <strong>transfer {money(Math.round((Number(amount) - creditNum) * 100) / 100, currency)}</strong>
                </p>
              )}
            </div>
          )}
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
            <input aria-label="Account number" className={input} required inputMode={codeKind === 'swift' ? 'text' : 'numeric'} value={payee.accountNumber} onChange={set('accountNumber')} placeholder="Account number" />
            <BankCodeField kind={codeKind} value={payee[codeKind]} onKind={setCodeChoice} onChange={(v) => setPayee({ ...payee, [codeKind]: v })} inputClass={input} />
            <input aria-label="Bank name" className={`${input} sm:self-end`} value={payee.bankName} onChange={set('bankName')} placeholder="Bank (optional)" />
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
        <RichTextBox id="pr-desc" ariaLabel="Details" compact maxLength={2000} value={description} onChange={setDescription}
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
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {setup ? 'Save and send advance for approval' : 'Send for approval'}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>}
      </div>
    </form>
  );
}
