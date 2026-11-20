'use client';

import CopyId from '@/components/ui/CopyId';
import { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { errorMessage, money, paymentKeys, type SupplierRefund } from './api';
import {
  creditKeys, creditReportHref, decideCredit, editCredit, getOwing, getPendingCredit, getSupplierCredit, istToday, newFormKey,
  claimRefund, recordRepayment, writeOff, type CreditBalance, type CreditEditInput, type CreditEntry,
} from './credit';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');

const STATUS_STYLE: Record<CreditEntry['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  declined: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-200 text-gray-700',
};

/** "Owes us ₹15,000" — one chip per currency with anything owed or waiting. */
export function OwesBadge({ balances }: { balances?: CreditBalance[] }) {
  if (!balances?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {balances.map((b) => (
        <span key={b.currency} className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
          Owes us {b.owedText}{b.pending ? ` · ${b.pendingText} waiting` : ''}
        </span>
      ))}
    </span>
  );
}

/**
 * On a paid supplier payment whose items the customer cancelled — or whose supplier
 * procurement changed (staff/work/SupplierParts): "Supplier must refund"
 * (procurement), or where the claim stands. Accounts approves it on the Supplier credit tab.
 */
export function SupplierRefundLine({ requestId, refund, currency, bill }: {
  requestId: string; refund: SupplierRefund; currency: string; bill: number;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(bill));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = refund.why === 'supplier_changed';
  const after = changed ? 'Supplier changed after paying' : 'Cancelled after paying';
  if (refund.claim) {
    return (
      <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        Supplier must refund {money(refund.claim.amount, refund.claim.currency)} ·{' '}
        {refund.claim.status === 'approved' ? 'approved — counted as supplier credit' : 'waiting for accounts'}
      </p>
    );
  }
  if (!refund.savedSupplier) {
    return <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{after}. Save this supplier in the directory to record the refund they owe.</p>;
  }
  if (!refund.canClaim) return <p className="text-sm text-gray-600">{after} — procurement records what the supplier owes.</p>;
  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError('');
    try {
      await claimRefund({ paymentRequestId: requestId, amount: Number(amount), note });
      await Promise.all([qc.invalidateQueries({ queryKey: paymentKeys.all }), qc.invalidateQueries({ queryKey: creditKeys.all })]);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err, 'Could not save it. Please try again.'));
    } finally {
      setBusy(false);
    }
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-900 hover:bg-emerald-100">
        Supplier must refund
      </button>
    );
  }
  return (
    <form onSubmit={submit} aria-label="Supplier must refund" className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
      <p className="text-emerald-900">{changed ? 'We changed supplier after paying this one.' : 'The customer cancelled after we paid.'} How much must the supplier give back? (at most {money(bill, currency)})</p>
      <div className="flex flex-wrap gap-2">
        <input aria-label={`Refund amount (${currency})`} className={`${input} max-w-[10rem]`} required type="number" min="0.01" max={bill} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input aria-label="Note" className={`${input} flex-1`} maxLength={1000} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Send to accounts</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-100">Cancel</button>
      </div>
    </form>
  );
}

/** Approve / decline (accounts) or cancel (whoever raised it) a waiting entry. */
function EntryActions({ e }: { e: CreditEntry }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!e.can.approve && !e.can.decline && !e.can.cancel) return null;
  async function act(action: 'approve' | 'decline' | 'cancel') {
    let note = '';
    if (action === 'decline') {
      note = window.prompt('Why is it declined? (procurement sees this)') || '';
      if (!note.trim()) return;
    }
    setBusy(true);
    setError('');
    try {
      // The version on screen: if it was edited since, the server says "check it again".
      await decideCredit(e.id, action, note, e.rev);
      // ['suppliers'] covers the credit lists and the directory's "Owes us" chip.
      await Promise.all([qc.invalidateQueries({ queryKey: ['suppliers'] }), qc.invalidateQueries({ queryKey: paymentKeys.all })]);
    } catch (err) {
      setError(errorMessage(err, 'Could not save that. Please try again.'));
    } finally {
      setBusy(false);
    }
  }
  const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {e.can.approve && <button type="button" disabled={busy} onClick={() => act('approve')} className={`${btn} bg-green-600 text-white hover:bg-green-700`}>Approve</button>}
      {e.can.decline && <button type="button" disabled={busy} onClick={() => act('decline')} className={`${btn} border border-red-300 text-red-700 hover:bg-red-50`}>Decline</button>}
      {e.can.cancel && <button type="button" disabled={busy} onClick={() => act('cancel')} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>Cancel</button>}
      {busy && <Loader2 className="h-4 w-4 animate-spin text-gray-500" />}
      {error && <p role="alert" className="w-full text-sm text-red-700">{error}</p>}
    </div>
  );
}

/**
 * Edit an entry. Waiting for accounts: changed in place. Approved: the note / reference
 * in place, and a new amount becomes a correction that accounts approves. A reason always.
 */
function EditEntryForm({ e, onDone, onCancel }: { e: CreditEntry; onDone: (msg: string) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [formKey] = useState(newFormKey);
  const approved = e.status === 'approved';
  const repaid = e.kind === 'repaid';
  const startAmount = approved && e.correctedAmount != null ? e.correctedAmount : e.amount;
  const [amount, setAmount] = useState(String(startAmount));
  const [currency, setCurrency] = useState(e.currency);
  const [date, setDate] = useState(e.date);
  const [reference, setReference] = useState(e.reference);
  const [note, setNote] = useState(e.note);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = (f: string) => `cr-edit-${f}-${e.id}`;

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError('');
    const body: CreditEditInput = { reason, rev: e.rev, formKey, note };
    if (Number(amount) !== startAmount) body.amount = Number(amount);
    if (repaid) body.reference = reference;
    if (!approved && repaid) { body.currency = currency; body.date = date; }
    try {
      const res = await editCredit(e.id, body);
      await Promise.all([qc.invalidateQueries({ queryKey: ['suppliers'] }), qc.invalidateQueries({ queryKey: paymentKeys.all })]);
      onDone(res.correction
        ? `Correction of ${res.correction.amountText} sent to accounts to approve.`
        : approved ? 'Saved.' : 'Saved — still waiting for accounts.');
    } catch (err) {
      setError(errorMessage(err, 'Could not save it. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label={`Edit ${e.kindLabel}`} className="mt-2 space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
      {approved && (
        <p className="text-blue-900">
          This entry is approved, so it is not rewritten. A new amount becomes a <strong>correction</strong> for the difference, which accounts approves.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {!approved && repaid && (
          <div>
            <label className={label} htmlFor={id('cur')}>Currency</label>
            <input id={id('cur')} className={input} required maxLength={3} value={currency} onChange={(ev) => setCurrency(ev.target.value.toUpperCase())} />
          </div>
        )}
        <div>
          <label className={label} htmlFor={id('amt')}>{approved ? 'Correct amount' : 'Amount'} ({e.currency})</label>
          <input id={id('amt')} className={input} required inputMode="decimal" type="number" min={approved ? '0' : '0.01'} step="0.01" value={amount} onChange={(ev) => setAmount(ev.target.value)} />
          {approved && <p className="mt-1 text-xs text-gray-500">Now {e.correctedAmountText || e.amountText}. 0 cancels it out.</p>}
        </div>
        {!approved && repaid && (
          <div>
            <label className={label} htmlFor={id('date')}>Date received</label>
            <input id={id('date')} className={input} required type="date" max={istToday()} value={date} onChange={(ev) => setDate(ev.target.value)} />
          </div>
        )}
      </div>
      {repaid && (
        <div>
          <label className={label} htmlFor={id('ref')}>UTR / reference</label>
          <input id={id('ref')} className={input} maxLength={120} value={reference} onChange={(ev) => setReference(ev.target.value)} />
        </div>
      )}
      <div>
        <label className={label} htmlFor={id('note')}>Note</label>
        <input id={id('note')} className={input} maxLength={1000} value={note} onChange={(ev) => setNote(ev.target.value)} />
      </div>
      <div>
        <label className={label} htmlFor={id('why')}>Why are you changing it?</label>
        <input id={id('why')} className={input} required maxLength={1000} placeholder="e.g. Supplier's credit note says ₹25,000" value={reason} onChange={(ev) => setReason(ev.target.value)} />
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {approved ? 'Save' : 'Save changes'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-gray-700 hover:bg-gray-100">Cancel</button>
      </div>
    </form>
  );
}

/** "Changes": who changed this entry, when, why, and old → new. */
function EditHistory({ edits }: { edits: CreditEntry['edits'] }) {
  if (!edits?.length) return null;
  return (
    <details className="mt-1 text-xs text-gray-600">
      <summary className="cursor-pointer select-none text-blue-700">Changes ({edits.length})</summary>
      <ul className="mt-1 space-y-1">
        {edits.map((x, i) => (
          <li key={i} className="rounded bg-gray-50 p-2">
            <p className="font-medium text-gray-800">{x.byName} · {new Date(x.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</p>
            {x.changes.map((c) => <p key={c.field}>{c.field}: {c.from || '—'} → {c.to || '—'}</p>)}
            <p className="italic">Reason: {x.reason}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** One ledger row: what, how much (+ / −), why, who, and its trail. */
export function EntryRow({ e, showSupplier = false }: { e: CreditEntry; showSupplier?: boolean }) {
  const plus = e.signedAmount > 0;
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3" aria-label={`${e.kindLabel} ${e.amountText}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {showSupplier && <span>{e.supplier.name} · </span>}{e.kindLabel}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[e.status]}`}>{e.statusLabel}</span>
          </p>
          <p className="flex flex-wrap items-center gap-x-1 text-xs text-gray-600">
            {[
              e.paymentRequest && `payment ${e.paymentRequest.number}`,
              e.order?.number && `order ${e.order.number}`,
              e.date && `repaid ${day(e.date)}`,
              e.reference && `ref ${e.reference}`,
            ].filter(Boolean).join(' · ')}
            {e.order?.number && <CopyId value={e.order.number} label="Order number" />}
          </p>
          {e.correctionOf && <p className="text-xs text-gray-600">Corrects a “{e.correctionOf.kindLabel}” entry</p>}
          {e.note && <p className="text-sm text-gray-700">{e.note}</p>}
          {e.correctedAmountText && <p className="text-xs font-medium text-blue-800">Corrected to {e.correctedAmountText}</p>}
          {e.correctionPending && <p className="text-xs text-amber-700">A correction is waiting for accounts</p>}
          <p className="text-xs text-gray-500">
            {e.createdByName || 'System'} · {day(e.createdAt)}
            {e.decidedByName && e.status !== 'pending' && ` · ${e.statusLabel.toLowerCase()} by ${e.decidedByName}`}
            {e.decisionNote && ` — “${e.decisionNote}”`}
          </p>
        </div>
        <p className={`text-sm font-semibold tabular-nums ${e.status !== 'approved' ? 'text-gray-500' : plus ? 'text-emerald-700' : 'text-gray-900'}`}>
          {plus ? '+' : '−'}{e.amountText}
        </p>
      </div>
      <EditHistory edits={e.edits} />
      {notice && <p role="status" className="mt-1 text-sm text-green-800">{notice}</p>}
      {editing
        ? <EditEntryForm e={e} onDone={(m) => { setEditing(false); setNotice(m); }} onCancel={() => setEditing(false)} />
        : (
          <>
            <EntryActions e={e} />
            {e.can.edit && (
              <button type="button" onClick={() => { setEditing(true); setNotice(''); }} className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                Edit
              </button>
            )}
          </>
        )}
    </li>
  );
}

/** Record a repayment (procurement) or a write-off (admin) — the server re-checks the balance. */
function MoneyForm({ supplierId, balances, kind, onDone, onCancel }: {
  supplierId: string;
  balances: CreditBalance[];
  kind: 'repayment' | 'writeoff';
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [formKey] = useState(newFormKey);
  const [currency, setCurrency] = useState(balances[0]?.currency || 'INR');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(istToday);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const owed = balances.find((b) => b.currency === currency);
  const repay = kind === 'repayment';

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = repay
        ? await recordRepayment(supplierId, { currency, amount: Number(amount), date, reference, note, formKey })
        : await writeOff(supplierId, { currency, amount: Number(amount), note, formKey });
      await qc.invalidateQueries({ queryKey: ['suppliers'] });
      onDone(repay ? `${res.entry.amountText} repayment sent to accounts to approve.` : `${res.entry.amountText} written off.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not save it. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label={repay ? 'Record a repayment' : 'Write off'} className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="text-sm font-semibold text-gray-900">{repay ? 'The supplier paid money back' : 'Write off what the supplier owes'}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor={`cr-cur-${kind}`}>Currency</label>
          <select id={`cr-cur-${kind}`} className={input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {balances.map((b) => <option key={b.currency} value={b.currency}>{b.currency}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor={`cr-amt-${kind}`}>Amount</label>
          <input id={`cr-amt-${kind}`} className={input} required inputMode="decimal" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {owed && <p className="mt-1 text-xs text-gray-500">Owes us {owed.owedText}</p>}
        </div>
        {repay && (
          <div>
            <label className={label} htmlFor="cr-date">Date received</label>
            <input id="cr-date" className={input} required type="date" max={istToday()} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        )}
      </div>
      {repay && (
        <div>
          <label className={label} htmlFor="cr-ref">UTR / reference</label>
          <input id="cr-ref" className={input} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      )}
      <div>
        <label className={label} htmlFor={`cr-note-${kind}`}>{repay ? 'Note' : 'Why it is written off'}</label>
        <input id={`cr-note-${kind}`} className={input} maxLength={1000} required={!repay} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {repay ? 'Send to accounts' : 'Write off'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>
      </div>
    </form>
  );
}

/** One supplier's credit: what they owe us (per currency), the actions, and the full history. */
export function SupplierCreditPanel({ supplierId }: { supplierId: string }) {
  const [form, setForm] = useState<'repayment' | 'writeoff' | null>(null);
  const [notice, setNotice] = useState('');
  const q = useInfiniteQuery({
    queryKey: creditKeys.supplier(supplierId),
    queryFn: ({ pageParam }) => getSupplierCredit(supplierId, pageParam),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextAfter || undefined,
  });
  if (q.isPending) return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading credit…</p>;
  if (q.isError) return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load supplier credit.')}</p>;
  const first = q.data.pages[0];
  const balances = first.balances || [];
  const owing = balances.filter((b) => b.owed > 0);
  const entries = q.data.pages.flatMap((p) => p.entries);

  return (
    <section aria-label={`Supplier credit — ${first.supplier.name}`} className="mt-3 space-y-3 border-t border-gray-100 pt-3">
      <div>
        <p className="text-sm font-semibold text-gray-900">Supplier credit</p>
        {balances.length ? (
          <ul className="mt-1 space-y-0.5 text-sm text-gray-800">
            {balances.map((b) => (
              <li key={b.currency}>
                Owes us <strong>{b.owedText}</strong>
                {b.pending !== 0 && <span className="text-amber-700"> · {b.pending > 0 ? `+${b.pendingText}` : `−${b.pendingText}`} waiting for accounts</span>}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-gray-500">Owes us nothing.</p>}
        <p className="mt-1 text-xs text-gray-500">Credit is used on this supplier&apos;s next payment, in the same currency.</p>
      </div>
      {notice && <p role="status" className="rounded-lg bg-green-50 p-2 text-sm text-green-800">{notice}</p>}
      {!form && owing.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {first.can.propose && (
            <button type="button" onClick={() => { setForm('repayment'); setNotice(''); }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Record a repayment</button>
          )}
          {first.can.writeOff && (
            <button type="button" onClick={() => { setForm('writeoff'); setNotice(''); }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Write off</button>
          )}
        </div>
      )}
      {form && (
        <MoneyForm supplierId={supplierId} balances={owing} kind={form}
          onDone={(m) => { setForm(null); setNotice(m); }} onCancel={() => setForm(null)} />
      )}
      {entries.length > 0 && (
        <div>
          <p className={label}>History</p>
          <ul className="space-y-2">{entries.map((e) => <EntryRow key={e.id} e={e} />)}</ul>
          {q.hasNextPage && (
            <button type="button" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}
              className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {q.isFetchingNextPage ? 'Loading…' : 'Show older'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The Payments page's "Supplier credit" tab: what is waiting for accounts, every
 * supplier who owes us, and the report (CSV) for a date range.
 */
export default function SupplierCreditTab() {
  const pending = useInfiniteQuery({
    queryKey: creditKeys.pending(),
    queryFn: ({ pageParam }) => getPendingCredit(pageParam),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextAfter || undefined,
  });
  const owing = useQuery({ queryKey: creditKeys.owing(), queryFn: getOwing });
  const monthStart = `${istToday().slice(0, 8)}01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(istToday);
  const waiting = pending.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <div className="space-y-6">
      <section aria-label="Waiting for accounts" className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Waiting for accounts</h2>
        <p className="text-sm text-gray-500">Refunds procurement says a supplier owes us, and money suppliers paid back. Approve what matches the bank statement.</p>
        {pending.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
        {pending.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(pending.error, 'Could not load.')}</p>}
        {pending.isSuccess && !waiting.length && <p className="rounded-xl border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500">Nothing waiting.</p>}
        <ul className="space-y-2">{waiting.map((e) => <EntryRow key={e.id} e={e} showSupplier />)}</ul>
        {pending.hasNextPage && (
          <button type="button" disabled={pending.isFetchingNextPage} onClick={() => pending.fetchNextPage()}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {pending.isFetchingNextPage ? 'Loading…' : 'Show more'}
          </button>
        )}
      </section>

      <section aria-label="Suppliers who owe us" className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Suppliers who owe us</h2>
        {owing.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(owing.error, 'Could not load.')}</p>}
        {owing.isSuccess && !owing.data.suppliers.length && <p className="text-sm text-gray-500">No supplier owes us anything.</p>}
        {owing.isSuccess && owing.data.suppliers.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-gray-500"><th className="py-1">Supplier</th><th className="py-1 text-right">Owes us</th><th className="py-1 text-right">Waiting</th></tr></thead>
            <tbody>
              {owing.data.suppliers.map((s) => (
                <tr key={`${s.supplier.id}-${s.currency}`} className="border-t border-gray-100">
                  <td className="py-1.5">{s.supplier.name}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{s.owedText}</td>
                  <td className="py-1.5 text-right tabular-nums text-amber-700">{s.pending ? `${s.pending > 0 ? '+' : '−'}${s.pendingText}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label="Supplier credit report" className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Report</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className={label} htmlFor="cr-from">From</label><input id="cr-from" type="date" className={input} value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className={label} htmlFor="cr-to">To</label><input id="cr-to" type="date" className={input} value={to} min={from} max={istToday()} onChange={(e) => setTo(e.target.value)} /></div>
          <a href={creditReportHref(from, to)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Download className="h-4 w-4" /> Download CSV
          </a>
        </div>
      </section>
    </div>
  );
}
