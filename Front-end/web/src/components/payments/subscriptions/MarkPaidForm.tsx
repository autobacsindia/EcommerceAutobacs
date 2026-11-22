'use client';

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Paperclip } from 'lucide-react';
import { MAX_ATTACHMENTS, PHOTO_OR_PDF } from '@/lib/attachments';
import FilePicker from '../FilePicker';
import SlipReadStatus, { SlipFieldTag } from '../SlipReadStatus';
import { useSlipReader } from '../slipReader';
import { errorMessage } from '../api';
import { billText, dayText, looksLikeCardNumber, markPaid, type PaidVia, type Subscription } from './api';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-sm font-medium text-gray-800';
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50';

const VIA: { value: PaidVia; label: string }[] = [
  { value: 'card', label: 'Card' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'auto_debit', label: 'Auto-debit' },
];

/** Today in India, YYYY-MM-DD (the server checks the same day). */
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** The item's own way of paying, as a "Mark paid" choice. */
const defaultVia = (s: Subscription): PaidVia => (s.payment.autoDebit ? 'auto_debit'
  : s.payment.method === 'bank_transfer' ? 'bank' : s.payment.method);

/**
 * "Mark paid" for the cycle due now. Filled in from the item (amount, how it is
 * usually paid, today); the receipt is read as it is attached and fills the UTR
 * and date. Saving raises ONE expense in Payments for accounts to approve.
 *
 * The server decides the money: a fixed bill is its amount (a different figure
 * needs a reason); a usage-based bill needs this cycle's actual amount and its
 * invoice; a foreign bill paid already needs the rupees charged. The checks here
 * only save a round trip.
 */
export default function MarkPaidForm({ item: s, onCancel, onDone }: {
  item: Subscription;
  onCancel: () => void;
  onDone: (s: Subscription) => void;
}) {
  const foreign = s.currency !== 'INR';
  const [alreadyPaid, setAlreadyPaid] = useState(true);
  const [via, setVia] = useState<PaidVia>(defaultVia(s));
  const [paidOn, setPaidOn] = useState(todayIst());
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState(s.variableAmount ? '' : String(s.amount));
  const [reason, setReason] = useState('');
  const [rupees, setRupees] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  // One click, one expense: the server refuses a second anyway; this stops the second request.
  const sending = useRef(false);

  const slip = useSlipReader({
    files,
    onRead: (f) => {
      if (f.reference) setReference((r) => r.trim() || f.reference);
      if (f.date && f.date <= todayIst()) setPaidOn(f.date);
      if (foreign && f.amount) setRupees((r) => r.trim() || String(f.amount));
    },
  });

  const differs = !s.variableAmount && amount.trim() !== '' && Number(amount) !== s.amount;

  const save = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('rev', String(s.rev));
      form.append('alreadyPaid', String(alreadyPaid));
      if (alreadyPaid) {
        form.append('paidVia', via);
        form.append('paidOn', paidOn);
        if (reference.trim()) form.append('reference', reference.trim());
        if (foreign) form.append('rupees', rupees.replace(/,/g, '').trim());
      }
      if (s.variableAmount || differs) form.append('amount', amount.replace(/,/g, '').trim());
      if (differs) form.append('amountReason', reason.trim());
      if (note.trim()) form.append('note', note.trim());
      for (const f of files) form.append('invoice', f);
      return (await markPaid(s.id, form)).item;
    },
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e, 'Could not mark it paid. Refresh and try again.')),
    onSettled: () => { sending.current = false; },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (sending.current) return;
    if (!(Number(amount.replace(/,/g, '')) > 0)) { setError(s.variableAmount ? 'Enter the actual amount on this bill (more than 0).' : 'Enter the amount paid.'); return; }
    if (differs && reason.trim().length < 3) { setError(`The bill is ${billText(s)} — say why a different amount was paid (e.g. late fee).`); return; }
    if (s.variableAmount && !files.length) { setError('Attach the invoice for this bill.'); return; }
    if (alreadyPaid && foreign && !(Number(rupees.replace(/,/g, '')) > 0)) { setError(`Enter the rupees charged for this ${s.currency} bill (from the card or bank statement).`); return; }
    if (looksLikeCardNumber(reference) || looksLikeCardNumber(note)) { setError('That looks like a full card number. Never type card numbers here.'); return; }
    setError('');
    sending.current = true;
    save.mutate();
  };

  return (
    <form onSubmit={submit} aria-label="Mark paid" className="space-y-3">
      <p className="text-sm text-gray-800">
        {s.kind === 'one_time' ? 'Purchase' : 'Bill'} due <strong>{dayText(s.dueDate)}</strong>
        {s.variableAmount ? <> — estimate {billText(s)}. Enter the real amount from the invoice.</> : <> — {billText(s)}.</>}
        {' '}Saving sends one expense to accounts to approve.
      </p>

      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">Is it paid already?</legend>
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="sd-paid" checked={alreadyPaid} onChange={() => setAlreadyPaid(true)} />
          Paid already (card, UPI, auto-debit…)
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="sd-paid" checked={!alreadyPaid} onChange={() => setAlreadyPaid(false)} />
          Not paid yet — ask the admin to pay
        </label>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="sd-amount">{s.variableAmount ? `Actual amount (${s.currency})` : `Amount (${s.currency})`}</label>
          <input id="sd-amount" className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder={s.variableAmount ? `e.g. ${s.amount}` : undefined} />
        </div>
        {differs && (
          <div>
            <label className={label} htmlFor="sd-reason">Why is it different?</label>
            <input id="sd-reason" className={input} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. late fee, price went up" />
          </div>
        )}
        {alreadyPaid && (
          <>
            <div>
              <label className={label} htmlFor="sd-via">How was it paid?</label>
              <select id="sd-via" className={input} value={via} onChange={(e) => setVia(e.target.value as PaidVia)}>
                {VIA.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="sd-on">Paid on<SlipFieldTag source={slip.tag('date', paidOn)} /></label>
              <input id="sd-on" type="date" className={input} max={todayIst()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="sd-ref">Reference / UTR<SlipFieldTag source={slip.tag('reference', reference)} /></label>
              <input id="sd-ref" className={input} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
            </div>
            {foreign && (
              <div>
                <label className={label} htmlFor="sd-rupees">Rupees charged (₹)</label>
                <input id="sd-rupees" className={input} inputMode="decimal" value={rupees} onChange={(e) => setRupees(e.target.value)} placeholder="From the card / bank statement" />
              </div>
            )}
          </>
        )}
      </div>

      <FilePicker files={files} onChange={setFiles} max={MAX_ATTACHMENTS} accept={PHOTO_OR_PDF}
        label={s.variableAmount ? 'Attach invoice (required)' : 'Attach receipt'} icon={<Paperclip className="h-4 w-4" />} onError={setError} />
      {alreadyPaid && <SlipReadStatus slip={slip} />}

      <div>
        <label className={label} htmlFor="sd-mp-note">Note (optional)</label>
        <textarea id="sd-mp-note" className={input} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={save.isPending} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Send to accounts
        </button>
        <button type="button" onClick={onCancel} className={`${btn} text-gray-700 hover:bg-gray-100`}>Back</button>
      </div>
    </form>
  );
}
