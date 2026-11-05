'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Factory, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import type { WorkOrder } from '@/components/staff/work/types';
import apiClient from '@/lib/api-client';
import { formatDateIST } from '@/lib/datetime';
import { errorMessage, paymentKeys, rupees, slipHref, STATUS_TONE, type OrderPayment, type SupplierDeal } from './api';
import PaymentRequestForm from './PaymentRequestForm';

type Line = WorkOrder['lines'][number];

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';
const primary = 'inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50';
const secondary = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50';

/** 'YYYY-MM-DD' → "8 Nov 2026" (a calendar day: no time zone shift). */
export const dayText = (d: string) => (d
  ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  : 'Not set');

const lineName = (l: Line) => (l.variantLabel ? `${l.name} — ${l.variantLabel}` : l.name);
const closedByOf = (o: WorkOrder) => (o.source === 'sales' ? `GTM lead: ${o.soldBy}` : 'Website');

function useRefresh(orderId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: paymentKeys.forOrder(orderId) });
    // The line's stage may have moved ("Payment Pending" / "Ordered From Supplier").
    qc.invalidateQueries({ predicate: (query) => JSON.stringify(query.queryKey).includes(orderId) });
  };
}

/**
 * Set up a supplier deal for a made-to-order item: the total agreed with the
 * supplier and their dates. The payments (advance, balance) are raised from the
 * deal afterwards, each approved by accounts and paid by the admin as usual.
 */
export function SetUpDealForm({ order, line, onDone, onCancel }: { order: WorkOrder; line: Line; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ supplierName: line.supplierName || '', agreedTotal: '', startDate: '', completionDate: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiClient.post('/payment-requests/deals', { orderId: order.id, itemIds: [line.itemId], ...form });
      onDone();
    } catch (err) {
      setError(errorMessage(err, 'Could not set up the supplier deal.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4" aria-label="Set up supplier deal">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Paid in parts — {lineName(line)}</h3>
        <p className="text-xs text-gray-500">For an item the supplier makes for this order: enter the total agreed with them and their dates. Then raise the advance, and the balance when it is ready.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="deal-supplier">Supplier</label>
          <input id="deal-supplier" className={input} required minLength={2} maxLength={120} value={form.supplierName} onChange={set('supplierName')} placeholder="Who is making it" />
        </div>
        <div>
          <label className={label} htmlFor="deal-total">Agreed total with supplier (₹)</label>
          <input id="deal-total" className={input} required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={form.agreedTotal} onChange={set('agreedTotal')} placeholder="e.g. 29000" />
        </div>
        <div>
          <label className={label} htmlFor="deal-start">Manufacturing start</label>
          <input id="deal-start" type="date" className={input} value={form.startDate} onChange={set('startDate')} />
        </div>
        <div>
          <label className={label} htmlFor="deal-end">Completion date</label>
          <input id="deal-end" type="date" className={input} min={form.startDate || undefined} value={form.completionDate} onChange={set('completionDate')} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="deal-note">Note (optional)</label>
        <input id="deal-note" className={input} maxLength={500} value={form.note} onChange={set('note')} placeholder="e.g. quote number, colour, size" />
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primary}>Save deal</button>
        <button type="button" onClick={onCancel} className={secondary}>Cancel</button>
      </div>
    </form>
  );
}

/** Change the agreed total or the dates — a reason is required and kept in the history. */
function EditDealForm({ deal, onDone, onCancel }: { deal: SupplierDeal; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ agreedTotal: String(deal.agreedTotal), startDate: deal.startDate, completionDate: deal.completionDate, note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const asked = deal.paid + deal.waiting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiClient.put(`/payment-requests/deals/${encodeURIComponent(deal.id)}`, form);
      onDone();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the change.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-gray-200 bg-white p-3" aria-label="Change supplier deal">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="deal-edit-total">Agreed total (₹)</label>
          <input id="deal-edit-total" className={input} required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={form.agreedTotal} onChange={set('agreedTotal')} />
          {asked > 0 && <p className="mt-1 text-xs text-gray-500">At least {rupees(asked)} (already asked for)</p>}
        </div>
        <div>
          <label className={label} htmlFor="deal-edit-start">Manufacturing start</label>
          <input id="deal-edit-start" type="date" className={input} value={form.startDate} onChange={set('startDate')} />
        </div>
        <div>
          <label className={label} htmlFor="deal-edit-end">Completion date</label>
          <input id="deal-edit-end" type="date" className={input} min={form.startDate || undefined} value={form.completionDate} onChange={set('completionDate')} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="deal-edit-note">Why did it change?</label>
        <input id="deal-edit-note" className={input} required minLength={3} maxLength={500} value={form.note} onChange={set('note')} placeholder="e.g. supplier delayed by a week" />
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primary}>Save change</button>
        <button type="button" onClick={onCancel} className={secondary}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * A supplier deal on its order line: what was agreed, what is paid, the balance
 * due, the supplier's dates and every payment in order. "Request next payment"
 * raises the next part; the server refuses anything past the agreed total.
 */
export default function SupplierDealCard({ order, deal, requests }: { order: WorkOrder; deal: SupplierDeal; requests: OrderPayment[] }) {
  const refresh = useRefresh(order.id);
  const [mode, setMode] = useState<'view' | 'pay' | 'edit'>('view');
  const [error, setError] = useState('');
  const previous = [...requests].filter((r) => r.dealId === deal.id && r.status !== 'declined' && r.status !== 'cancelled')
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
  const dateChanges = deal.history.filter((h) => h.action === 'changed');

  async function remove() {
    if (!window.confirm('Remove this supplier deal? Its item goes back to a normal supplier payment.')) return;
    try {
      await apiClient.post(`/payment-requests/deals/${encodeURIComponent(deal.id)}/remove`, { note: 'Removed from the order page' });
      refresh();
    } catch (err) {
      setError(errorMessage(err, 'Could not remove the deal.'));
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 text-sm" aria-label={`Supplier deal for ${deal.itemNames.join(', ')}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Factory className="h-4 w-4 text-indigo-700" />
        <p className="font-semibold text-gray-900">Made to order · {deal.supplierName}</p>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${deal.fullyPaid ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>
          {deal.fullyPaid ? 'Supplier paid in full' : `Balance due ${rupees(deal.balanceDue)}`}
        </span>
        {deal.can.edit && mode === 'view' && (
          <button type="button" onClick={() => setMode('edit')} className="ml-auto inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            <Pencil className="h-3 w-3" /> Change total / dates
          </button>
        )}
        {deal.can.remove && mode === 'view' && (
          <button type="button" onClick={remove} aria-label="Remove supplier deal" className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-50">
            <Trash2 className="h-3 w-3" /> Remove
          </button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Supplier cost', rupees(deal.agreedTotal)],
          ['Paid so far', rupees(deal.paid)],
          ['Waiting', rupees(deal.waiting)],
          ['Balance due', rupees(deal.balanceDue)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-white px-3 py-2">
            <dt className="text-xs text-gray-500">{k}</dt>
            <dd className="font-semibold text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-700">
        <CalendarClock className="h-4 w-4 text-gray-500" />
        <span>Manufacturing start: <strong>{dayText(deal.startDate)}</strong></span>
        <span>Completion: <strong>{dayText(deal.completionDate)}</strong></span>
        {dateChanges.length > 0 && <span className="text-xs text-amber-800">changed {dateChanges.length}×</span>}
      </p>

      {deal.payments.length > 0 && (
        <ol className="space-y-1" aria-label="Payment timeline">
          {deal.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-1.5">
              <span className="font-medium text-gray-900">{p.partLabel}</span>
              <span className="text-gray-700">{rupees(p.amount)}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[p.status]}`}>{p.statusLabel}</span>
              <span className="text-xs text-gray-500">
                {p.number} · raised {formatDateIST(p.createdAt)}
                {p.approvedAt ? ` · approved ${formatDateIST(p.approvedAt)}` : ''}
                {p.paidAt ? ` · paid ${formatDateIST(p.paidAt)}` : ''}
              </span>
              <a href={slipHref(p.id)} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-gray-600 hover:underline">
                <FileText className="h-3.5 w-3.5" /> {p.status === 'paid' ? 'Receipt' : 'Slip'}
              </a>
            </li>
          ))}
        </ol>
      )}

      {dateChanges.length > 0 && (
        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer">What changed</summary>
          <ul className="mt-1 space-y-0.5">
            {dateChanges.map((h, i) => <li key={i}>{formatDateIST(h.at)} · {h.byName}: {h.note}</li>)}
          </ul>
        </details>
      )}

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {mode === 'view' && deal.can.raise && (
        <button type="button" onClick={() => setMode('pay')} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-200">
          <Plus className="h-4 w-4" /> {deal.payments.some((p) => p.status !== 'declined' && p.status !== 'cancelled') ? 'Request next payment' : 'Request advance'}
        </button>
      )}
      {mode === 'view' && !deal.can.raise && deal.waiting > 0 && !deal.fullyPaid && (
        <p className="text-xs text-gray-500">The next payment can be raised once this one is paid.</p>
      )}
      {mode === 'edit' && <EditDealForm deal={deal} onCancel={() => setMode('view')} onDone={() => { setMode('view'); refresh(); }} />}
      {mode === 'pay' && (
        <PaymentRequestForm
          supplier={{
            orderId: order.id,
            orderNumber: order.orderNumber,
            customer: order.customer.name,
            closedBy: closedByOf(order),
            lines: order.lines.filter((l) => deal.itemIds.includes(l.itemId)).map((l) => ({ itemId: l.itemId, name: lineName(l) })),
            deal: { id: deal.id, agreedTotal: deal.agreedTotal, leftToAsk: deal.leftToAsk, paid: deal.paid },
          }}
          sameAs={previous ? { id: previous.id, name: previous.payee } : undefined}
          onCancel={() => setMode('view')}
          onDone={() => { setMode('view'); refresh(); }}
        />
      )}
    </section>
  );
}
