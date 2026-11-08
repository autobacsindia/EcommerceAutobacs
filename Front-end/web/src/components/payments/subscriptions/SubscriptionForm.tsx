'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Paperclip, X } from 'lucide-react';
import { MAX_ATTACHMENTS, PHOTO_OR_PDF } from '@/lib/attachments';
import FilePicker from '../FilePicker';
import { errorMessage } from '../api';
import {
  approxText, getSubscriptionOptions, looksLikeCardNumber, saveSubscription, subscriptionKeys,
  type PayMethod, type Subscription, type SubscriptionKind,
} from './api';
import RichTextBox from '@/components/ui/RichTextBox';
import { richTextToPlain } from '@/lib/richText';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'block text-sm font-medium text-gray-800';
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50';

type Draft = {
  name: string; purpose: string; team: string; kind: SubscriptionKind; amount: string; currency: string; dueDate: string;
  method: PayMethod; cardLast4: string; autoDebit: boolean; billingUrl: string; notes: string;
};

const fromItem = (s?: Subscription): Draft => ({
  name: s?.name ?? '',
  purpose: s?.purpose ?? '',
  team: s?.team ?? '',
  kind: s?.kind ?? 'monthly',
  amount: s ? String(s.amount) : '',
  currency: s?.currency ?? 'USD',
  dueDate: s?.dueDate ?? '',
  method: s?.payment.method ?? 'card',
  cardLast4: s?.payment.cardLast4 ?? '',
  autoDebit: s?.payment.autoDebit ?? false,
  billingUrl: s?.billingUrl ?? '',
  notes: s?.notes ?? '',
});

/** Which of a Verified item's fields send it back to "waiting for check" (the server's CHECKED_FIELDS). */
const RECHECK: (keyof Draft)[] = ['amount', 'currency', 'dueDate', 'kind', 'method', 'cardLast4', 'autoDebit'];

/**
 * Add a tool / subscription, or edit one (`item`). An edit sends only what
 * changed, with the version on screen (`rev`). The server checks everything
 * again; the checks here only say what is wrong before sending.
 */
export default function SubscriptionForm({ item, onCancel, onDone }: {
  item?: Subscription;
  onCancel: () => void;
  onDone: (s: Subscription) => void;
}) {
  const opts = useQuery({ queryKey: subscriptionKeys.options(), queryFn: getSubscriptionOptions, staleTime: 5 * 60_000 });
  const o = opts.data?.options;
  const [d, setD] = useState<Draft>(() => fromItem(item));
  const [files, setFiles] = useState<File[]>([]);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const original = fromItem(item);
  const changed = (k: keyof Draft) => !item || d[k] !== original[k];
  const resetsCheck = item?.status === 'verified' && RECHECK.some(changed);

  const rate = o?.currencies.find((c) => c.code === d.currency)?.approxInrPerUnit;
  const approx = d.currency !== 'INR' && rate && Number(d.amount) > 0 ? Math.round((Number(d.amount) * rate) / 10) * 10 : null;

  function problem(): string {
    if (d.name.trim().length < 2) return 'Enter the name of the tool or bill (e.g. Railway).';
    if (!item && d.purpose.trim().length < 3) return 'Say what it is for.';
    if (!(Number(d.amount) > 0)) return 'Enter the amount on the bill.';
    if (!d.dueDate) return 'Enter the next due date.';
    if (d.method === 'card' && !/^\d{4}$/.test(d.cardLast4)) return 'Enter the last 4 digits of the card — only 4 digits.';
    if (d.billingUrl.trim() && !/^https:\/\//i.test(d.billingUrl.trim())) return 'The billing page link must start with https://';
    if ([d.name, d.purpose, richTextToPlain(d.notes)].some(looksLikeCardNumber)) {
      return 'That looks like a full card number. Never type card numbers here — the card is its last 4 digits only.';
    }
    if (o?.teams.length && !item && !d.team && !o.team) return 'Choose the team this is for.';
    return '';
  }

  const save = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      const put = (k: string, v: string) => form.append(k, v);
      if (item) put('rev', String(item.rev));
      if (changed('name')) put('name', d.name.trim());
      if (changed('purpose')) put('purpose', d.purpose.trim());
      if (d.team && changed('team')) put('team', d.team);
      if (changed('kind')) put('kind', d.kind);
      if (changed('amount')) put('amount', d.amount.trim());
      if (changed('currency')) put('currency', d.currency);
      if (changed('dueDate')) put('dueDate', d.dueDate);
      if (changed('method') || changed('cardLast4') || changed('autoDebit')) {
        put('payment', JSON.stringify({ method: d.method, cardLast4: d.method === 'card' ? d.cardLast4 : '', autoDebit: d.autoDebit }));
      }
      if (changed('billingUrl')) put('billingUrl', d.billingUrl.trim());
      if (changed('notes')) put('notes', d.notes.trim());
      if (removeIds.length) put('removeFileIds', JSON.stringify(removeIds));
      for (const f of files) form.append('invoice', f);
      return (await saveSubscription(form, item?.id)).item;
    },
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e, 'Could not save. Refresh and try again.')),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = problem();
    if (p) { setError(p); return; }
    setError('');
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-gray-200 bg-white p-4" aria-label={item ? `Edit ${item.name}` : 'Add a subscription'}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-900">{item ? `Edit ${item.name}` : 'Add a tool, subscription or bill'}</h2>
        <button type="button" onClick={onCancel} aria-label="Close" className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
      </div>
      <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
        Never type a full card number, CVV or password anywhere here. The card is its <strong>last 4 digits</strong> only.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Name
          <input className={`${input} mt-1`} value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Railway" maxLength={80} />
        </label>
        {o && o.teams.length > 0 && (
          <label className={label}>Team
            <select className={`${input} mt-1`} value={d.team || o.team || ''} onChange={(e) => set({ team: e.target.value })}>
              {!o.team && <option value="">Choose…</option>}
              {o.teams.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
        )}
        <label className={`${label} sm:col-span-2`}>What it&apos;s for
          <input className={`${input} mt-1`} value={d.purpose} onChange={(e) => set({ purpose: e.target.value })} placeholder="e.g. Hosts the website backend" maxLength={300} />
        </label>
        <label className={label}>Type
          <select className={`${input} mt-1`} value={d.kind} onChange={(e) => set({ kind: e.target.value as SubscriptionKind })}>
            {(o?.kinds ?? [{ value: 'monthly', label: 'Monthly subscription' }]).map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className={label}>{d.kind === 'one_time' ? 'Due date' : 'Next due date'}
          <input type="date" className={`${input} mt-1`} value={d.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
        </label>
        <div className="grid grid-cols-[1fr_auto] gap-2 sm:col-span-2">
          <label className={label}>Amount on the bill
            <input className={`${input} mt-1`} inputMode="decimal" value={d.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="e.g. 20" />
          </label>
          <label className={label}>Currency
            <select className={`${input} mt-1`} value={d.currency} onChange={(e) => set({ currency: e.target.value })}>
              {(o?.currencies ?? [{ code: d.currency, label: d.currency }]).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </label>
          {approx && <p className="col-span-2 text-xs text-gray-500">{approxText(approx)} — a rough guide only; what you actually pay is what the bank debits.</p>}
        </div>
      </div>

      <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3">
        <legend className="px-1 text-sm font-medium text-gray-800">How it&apos;s paid</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {(o?.methods ?? [{ value: 'card', label: 'Card' }]).map((m) => (
            <label key={m.value} className="inline-flex items-center gap-1.5">
              <input type="radio" name="method" value={m.value} checked={d.method === m.value} onChange={() => set({ method: m.value })} /> {m.label}
            </label>
          ))}
        </div>
        {d.method === 'card' && (
          <label className={label}>Card — last 4 digits only
            <input className={`${input} mt-1 max-w-[8rem] tracking-widest`} inputMode="numeric" autoComplete="off" maxLength={4}
              value={d.cardLast4} onChange={(e) => set({ cardLast4: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="4007" />
          </label>
        )}
        <label className="inline-flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={d.autoDebit} onChange={(e) => set({ autoDebit: e.target.checked })} /> Auto-debit (charged automatically)
        </label>
      </fieldset>

      <label className={label}>Billing page link (optional)
        <input className={`${input} mt-1`} type="url" value={d.billingUrl} onChange={(e) => set({ billingUrl: e.target.value })} placeholder="https://…" maxLength={500} />
      </label>
      <div className={label}>Notes (optional)
        <div className="mt-1">
          <RichTextBox ariaLabel="Notes (optional)" compact maxLength={1000} value={d.notes} onChange={(notes) => set({ notes })}
            placeholder="e.g. The card needs international payments turned on" />
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <p className="font-medium text-gray-800">Invoice (optional)</p>
        {item && item.files.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {item.files.filter((f) => !removeIds.includes(f.id)).map((f) => (
              <li key={f.id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-1 pl-3 pr-1 text-xs text-gray-800">
                <span className="truncate">{f.name || 'Invoice'}</span>
                <button type="button" aria-label={`Remove ${f.name || 'invoice'}`} onClick={() => setRemoveIds((x) => [...x, f.id])} className="rounded-full p-0.5 text-gray-500 hover:bg-gray-200">
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <FilePicker files={files} onChange={setFiles} max={MAX_ATTACHMENTS} accept={PHOTO_OR_PDF}
          label="Attach invoice" icon={<Paperclip className="h-4 w-4" />} onError={setError} />
      </div>

      {resetsCheck && (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          This item is verified. Changing the amount, currency, due date, type or payment sends it back to accounts to check again.
        </p>
      )}
      {item?.status === 'rejected' && (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Saving sends it back to accounts to check again.</p>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={save.isPending} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {item ? 'Save changes' : 'Add'}
        </button>
        <button type="button" onClick={onCancel} className={`${btn} text-gray-700 hover:bg-gray-100`}>Cancel</button>
      </div>
    </form>
  );
}
