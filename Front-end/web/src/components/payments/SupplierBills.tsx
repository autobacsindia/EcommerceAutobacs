'use client';

import EntityLink from '@/components/ui/EntityLink';
import { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Plus } from 'lucide-react';
import { errorMessage, money, paymentKeys, type OrderMatch } from './api';
import { istToday, newFormKey } from './credit';
import OrderPicker from './OrderPicker';
import SupplierPicker, { SupplierSuggestions } from './SupplierPicker';
import type { Supplier } from './suppliers';
import {
  addBill, billFileHref, billKeys, cancelBill, dueText, editBill, getBill, getOwedBySupplier, listBills, payBill,
  type BillFilters, type SupplierBill,
} from './supplierBillsApi';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';
const primary = 'inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60';
const secondary = 'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50';
const day = (ymd: string) => (ymd ? new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

const STATE_STYLE: Record<SupplierBill['state'], string> = {
  unpaid: 'bg-gray-100 text-gray-800',
  part_paid: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-200 text-gray-600',
};

const FILTERS: { key: string; label: string; f: Pick<BillFilters, 'show' | 'due'> }[] = [
  { key: 'owed', label: 'Still owed', f: { show: 'owed', due: '' } },
  { key: 'overdue', label: 'Overdue', f: { show: 'owed', due: 'overdue' } },
  { key: 'week', label: 'Due this week', f: { show: 'owed', due: 'week' } },
  { key: 'paid', label: 'Paid', f: { show: 'paid', due: '' } },
  { key: 'cancelled', label: 'Cancelled', f: { show: 'cancelled', due: '' } },
];

/**
 * "We owe suppliers": the supplier bills we pay later — what we owe each supplier,
 * when it is due, and what is overdue. "Pay" raises an ordinary supplier payment
 * (all or part of the bill) that accounts approves and the admin pays.
 * `canAdd`: procurement (the server decides on every call).
 */
export default function SupplierBillsTab({ canAdd }: { canAdd: boolean }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('owed');
  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const f: BillFilters = { ...(FILTERS.find((x) => x.key === filter) ?? FILTERS[0]).f, supplier: supplier?.id ?? '' };

  const owed = useQuery({ queryKey: billKeys.bySupplier(), queryFn: getOwedBySupplier });
  const list = useInfiniteQuery({
    queryKey: billKeys.list(f),
    queryFn: ({ pageParam }) => listBills(f, pageParam),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const bills = list.data?.pages.flatMap((p) => p.bills) ?? [];
  const summary = list.data?.pages[0]?.summary;
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: billKeys.all }),
    qc.invalidateQueries({ queryKey: paymentKeys.all }),
  ]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
        Add a supplier&apos;s bill when it arrives. When it is time to pay, press <strong>Pay</strong> — that sends an ordinary
        supplier payment to accounts (all of the bill, or a part). Paid and overdue amounts update by themselves.
      </div>

      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

      <OwedSummary data={owed.data} loading={owed.isLoading} error={owed.isError} picked={supplier?.id ?? ''}
        onPick={(s) => setSupplier((cur) => (cur?.id === s.id ? null : s))} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Which bills" className="flex flex-wrap gap-2">
          {FILTERS.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={filter === x.key} onClick={() => setFilter(x.key)}
              className={`rounded-full px-3 py-1 text-sm ${filter === x.key ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
              {x.label}
            </button>
          ))}
          {supplier && (
            <button type="button" onClick={() => setSupplier(null)} className="rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-900">
              {supplier.name} ✕
            </button>
          )}
        </div>
        {canAdd && !adding && (
          <button type="button" className={primary} onClick={() => { setAdding(true); setNotice(''); }}>
            <Plus className="h-4 w-4" /> Add a bill
          </button>
        )}
      </div>

      {adding && (
        <BillForm
          onCancel={() => setAdding(false)}
          onDone={async (b) => { setAdding(false); setNotice(`${b.number} added — ${money(b.amount)} owed to ${b.supplier.name}, due ${day(b.dueDate)}.`); await refresh(); }}
        />
      )}

      {summary && (
        <p className="text-sm text-gray-600">
          {summary.capped ? `${summary.count}+` : summary.count} bill{summary.count === 1 ? '' : 's'}
          {f.show === 'owed' && summary.owed != null ? ` · ${money(summary.owed)} owed` : ''}
        </p>
      )}
      {list.isLoading && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading bills…</p>}
      {list.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(list.error, 'Could not load the bills.')}</p>}
      {!list.isLoading && !list.isError && !bills.length && <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">No bills here.</p>}

      <ul className="space-y-3">
        {bills.map((b) => <BillRow key={b.id} bill={b} onChanged={refresh} onNotice={setNotice} />)}
      </ul>
      {list.hasNextPage && (
        <button type="button" className={secondary} disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
          {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function OwedSummary({ data, loading, error, picked, onPick }: {
  data?: Awaited<ReturnType<typeof getOwedBySupplier>>; loading: boolean; error: boolean; picked: string;
  onPick: (s: { id: string; name: string }) => void;
}) {
  if (loading) return null;
  if (error || !data) return <p role="alert" className="text-sm text-red-700">Could not load what we owe.</p>;
  return (
    <section aria-label="What we owe" className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold text-gray-900">We owe {money(data.total.owed)}</h2>
        {data.total.overdue > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
            <AlertTriangle className="h-3.5 w-3.5" /> {money(data.total.overdue)} overdue
          </span>
        )}
      </div>
      {data.suppliers.length > 0 && (
        <ul className="mt-2 divide-y divide-gray-100">
          {data.suppliers.map((s) => (
            <li key={s.id}>
              <button type="button" aria-pressed={picked === s.id} onClick={() => onPick({ id: s.id, name: s.name })}
                className={`flex w-full flex-wrap items-center justify-between gap-2 px-1 py-2 text-left text-sm hover:bg-gray-50 ${picked === s.id ? 'bg-blue-50' : ''}`}>
                <span className="font-medium text-gray-900">{s.name} <span className="font-normal text-gray-500">· {s.bills} bill{s.bills === 1 ? '' : 's'}</span></span>
                <span className="flex items-center gap-2">
                  {s.overdue > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">{money(s.overdue)} overdue</span>}
                  <span className="font-semibold">{money(s.owed)}</span>
                  {s.overdue === 0 && <span className="text-xs text-gray-500">next due {day(s.nextDue)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BillRow({ bill: b, onChanged, onNotice }: { bill: SupplierBill; onChanged: () => Promise<unknown>; onNotice: (s: string) => void }) {
  const [open, setOpen] = useState<'' | 'pay' | 'edit' | 'cancel' | 'details'>('');
  const due = dueText(b);
  return (
    <li className={`rounded-xl border bg-white p-3 ${b.overdue ? 'border-red-300' : 'border-gray-200'}`} aria-label={`${b.billNumber ? `Bill ${b.billNumber}` : `Bill ${b.number}`} from ${b.supplier.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900">{b.supplier.name} <span className="font-normal text-gray-500">· {b.billNumber ? `bill ${b.billNumber}` : 'no bill number yet'} · {b.number}</span></p>
          <p className="text-sm text-gray-600">
            Due {day(b.dueDate)}
            {due && <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${b.overdue ? 'bg-red-100 text-red-800' : 'bg-amber-50 text-amber-800'}`}>{due}</span>}
            {b.order && <> · for order <EntityLink type="order" id={b.order.id} value={b.order.number} label="Order number" newTab /></>}
          </p>
          {b.description && <p className="mt-1 text-sm text-gray-700">{b.description}</p>}
        </div>
        <div className="text-right text-sm">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_STYLE[b.state]}`}>{b.stateLabel}</span>
          <p className="mt-1 text-gray-900"><span className="font-semibold">{money(b.owed)}</span> owed of {money(b.amount)}</p>
          {b.paid > 0 && <p className="text-gray-600">{money(b.paid)} paid</p>}
          {b.waiting > 0 && <p className="text-gray-600">{money(b.waiting)} waiting for approval / payment</p>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {b.can.pay && <button type="button" className={primary} onClick={() => setOpen(open === 'pay' ? '' : 'pay')}>Pay</button>}
        <button type="button" className={secondary} onClick={() => setOpen(open === 'details' ? '' : 'details')}>
          {open === 'details' ? 'Hide' : 'Payments & bill'}
        </button>
        {b.can.edit && <button type="button" className={secondary} onClick={() => setOpen(open === 'edit' ? '' : 'edit')}>Edit</button>}
        {b.can.cancel && <button type="button" className={secondary} onClick={() => setOpen(open === 'cancel' ? '' : 'cancel')}>Cancel bill</button>}
      </div>
      {open === 'pay' && (
        <PayForm bill={b} onCancel={() => setOpen('')}
          onDone={async (number) => { setOpen(''); onNotice(`${number} sent to accounts for approval.`); await onChanged(); }} />
      )}
      {open === 'edit' && <BillForm bill={b} onCancel={() => setOpen('')} onDone={async () => { setOpen(''); await onChanged(); }} />}
      {open === 'cancel' && <CancelForm bill={b} onCancel={() => setOpen('')} onDone={async () => { setOpen(''); await onChanged(); }} />}
      {open === 'details' && <BillDetails id={b.id} />}
    </li>
  );
}

function BillDetails({ id }: { id: string }) {
  const q = useQuery({ queryKey: billKeys.one(id), queryFn: () => getBill(id) });
  if (q.isLoading) return <p className="mt-2 text-sm text-gray-500">Loading…</p>;
  if (q.isError || !q.data) return <p role="alert" className="mt-2 text-sm text-red-700">Could not load this bill.</p>;
  const b = q.data.bill;
  return (
    <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 text-sm">
      {b.billDate && <p className="text-gray-600">Bill date {day(b.billDate)} · added by {b.createdByName}</p>}
      {b.files.length > 0 && (
        <p className="flex flex-wrap gap-2">
          {b.files.map((f) => <a key={f.id} href={billFileHref(b.id, f.id)} target="_blank" rel="noreferrer" className="text-blue-700 underline">{f.name}</a>)}
        </p>
      )}
      {b.payments.length ? (
        <ul aria-label="Payments on this bill" className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {b.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
              <span><span className="font-medium">{p.number}</span> · {p.statusLabel}</span>
              <span className="font-medium">{money(p.amount)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-gray-500">No payments yet.</p>}
    </div>
  );
}

function PayForm({ bill, onCancel, onDone }: { bill: SupplierBill; onCancel: () => void; onDone: (number: string) => Promise<void> }) {
  const [amount, setAmount] = useState(String(bill.leftToAsk));
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // One key per form: a double click raises one payment.
  const [clientId] = useState(newFormKey);
  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const n = Number(amount);
    if (!(n > 0)) { setError('Type the amount to pay now.'); return; }
    if (n > bill.leftToAsk) { setError(`Only ${money(bill.leftToAsk)} is left to pay on this bill.`); return; }
    setBusy(true);
    setError('');
    try {
      const { request } = await payBill(bill.id, { amount, description, clientId }, files);
      await onDone(request.number);
    } catch (err) {
      setError(errorMessage(err, 'Could not send it. Please try again.'));
    } finally {
      setBusy(false);
    }
  }
  const id = `pay-${bill.id}`;
  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3" aria-label="Pay this bill">
      <p className="text-sm text-gray-700">
        Pays <strong>{bill.supplier.name}</strong> from their saved bank / UPI details. {money(bill.leftToAsk)} is left to pay — pay it all, or a part now.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-amount`} className={label}>Amount to pay now (₹)</label>
          <input id={`${id}-amount`} className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-note`} className={label}>Note for accounts (optional)</label>
          <input id={`${id}-note`} className={input} value={description} placeholder={bill.billNumber ? `Bill ${bill.billNumber} (${bill.number})` : `Supplier bill ${bill.number}`} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-file`} className={label}>Bill photo / PDF for accounts (optional)</label>
        <input id={`${id}-file`} type="file" accept="image/*,application/pdf" multiple onChange={(e) => setFiles([...(e.target.files ?? [])])} className="text-sm" />
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className={primary} disabled={busy}>{busy ? 'Sending…' : 'Send for approval'}</button>
        <button type="button" className={secondary} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function BillForm({ bill, onCancel, onDone }: { bill?: SupplierBill; onCancel: () => void; onDone: (b: SupplierBill) => Promise<void> }) {
  const editing = Boolean(bill);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [typed, setTyped] = useState('');
  const [billNumber, setBillNumber] = useState(bill?.billNumber ?? '');
  const [billDate, setBillDate] = useState(bill?.billDate ?? '');
  const [dueDate, setDueDate] = useState(bill?.dueDate ?? '');
  const [amount, setAmount] = useState(bill ? String(bill.amount) : '');
  const [description, setDescription] = useState(bill?.description ?? '');
  const [order, setOrder] = useState<OrderMatch | null>(bill?.order ? { id: bill.order.id, number: bill.order.number, customer: '', total: null, createdAt: '' } : null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clientId] = useState(newFormKey);
  const today = istToday();

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!editing && !supplier) { setError('Pick the supplier from the list (add them in Suppliers first if they are new).'); return; }
    if (!dueDate) { setError('Pick the day this bill is due.'); return; }
    if (!(Number(amount) > 0)) { setError('Type the bill amount in rupees.'); return; }
    setBusy(true);
    setError('');
    try {
      const fields = { billNumber, billDate, dueDate, amount, description, orderId: order?.id ?? null };
      const { bill: saved } = bill
        ? await editBill(bill.id, { ...fields, rev: bill.rev }, files)
        : await addBill({ ...fields, supplierId: supplier!.id, clientId }, files);
      await onDone(saved);
    } catch (err) {
      setError(errorMessage(err, 'Could not save it. Please try again.'));
    } finally {
      setBusy(false);
    }
  }
  const id = bill ? `bill-${bill.id}` : 'bill-new';
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4" aria-label={editing ? 'Edit bill' : 'Add a bill'}>
      <h3 className="text-base font-semibold text-gray-900">{editing ? `Edit ${bill!.number}` : 'Add a supplier bill'}</h3>
      {!editing && (
        <div>
          <label htmlFor={`${id}-supplier`} className={label}>Supplier</label>
          {supplier ? <SupplierPicker picked={supplier} onPick={(s) => { setSupplier(s); setTyped(''); }} /> : (
            <>
              <input id={`${id}-supplier`} className={input} value={typed} autoComplete="off" placeholder="Start typing the supplier's name" onChange={(e) => setTyped(e.target.value)} />
              <SupplierSuggestions query={typed} onPick={(s) => setSupplier(s)} />
            </>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-number`} className={label}>Bill number (optional)</label>
          <input id={`${id}-number`} className={input} value={billNumber} placeholder="As printed — add it later if the bill has not come" onChange={(e) => setBillNumber(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-amount`} className={label}>Bill amount (₹)</label>
          <input id={`${id}-amount`} className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-billdate`} className={label}>Bill date (optional)</label>
          <input id={`${id}-billdate`} type="date" max={today} className={input} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-due`} className={label}>Pay by (due date)</label>
          <input id={`${id}-due`} type="date" className={input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-details`} className={label}>What is it for (optional)</label>
        <input id={`${id}-details`} className={input} value={description} placeholder="e.g. 40 floor mats for stock" onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <span className={label}>Customer order (optional)</span>
        <OrderPicker id={`${id}-order`} picked={order} onPick={setOrder} />
      </div>
      <div>
        <label htmlFor={`${id}-file`} className={label}>{editing ? 'Add bill photo / PDF' : 'Bill photo / PDF'}</label>
        <input id={`${id}-file`} type="file" accept="image/*,application/pdf" multiple onChange={(e) => setFiles([...(e.target.files ?? [])])} className="text-sm" />
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className={primary} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add bill'}</button>
        <button type="button" className={secondary} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function CancelForm({ bill, onCancel, onDone }: { bill: SupplierBill; onCancel: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (reason.trim().length < 3) { setError('Say why this bill is being cancelled.'); return; }
    setBusy(true);
    setError('');
    try {
      await cancelBill(bill.id, reason.trim());
      await onDone();
    } catch (err) {
      setError(errorMessage(err, 'Could not cancel it. Please try again.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-lg border border-gray-200 p-3" aria-label="Cancel this bill">
      <label htmlFor={`cancel-${bill.id}`} className={label}>Why cancel it? (e.g. added twice)</label>
      <input id={`cancel-${bill.id}`} className={input} value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className={secondary} disabled={busy}>{busy ? 'Cancelling…' : 'Cancel bill'}</button>
        <button type="button" className={secondary} onClick={onCancel}>Keep it</button>
      </div>
    </form>
  );
}
