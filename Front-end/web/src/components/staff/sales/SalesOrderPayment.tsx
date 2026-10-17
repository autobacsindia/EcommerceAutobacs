'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, Plus, Split, Trash2, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import CustomerBankCard from './CustomerBankCard';
import PaymentLinkCard from './PaymentLinkCard';
import { errorMessage, paymentRequestHref, rupees, type PaymentPart, type SalesOrder } from './types';

const PART_STATUS: Record<PaymentPart['status'], { text: string; cls: string }> = {
  paid: { text: 'Paid', cls: 'bg-green-100 text-green-800' },
  pending: { text: 'Waiting for payment', cls: 'bg-amber-100 text-amber-800' },
  expired: { text: 'Link expired', cls: 'bg-red-100 text-red-800' },
  cancelled: { text: 'Cancelled', cls: 'bg-gray-200 text-gray-700' },
};

const paise = (n: number) => Math.round(n * 100);

/** Split `amount` into `parts` near-equal rupee amounts (whole rupees; the last takes the rest). */
export function evenSplit(amount: number, parts: number): number[] {
  if (parts <= 1) return [amount];
  const each = Math.floor(amount / parts);
  const out = Array.from({ length: parts - 1 }, () => each);
  out.push(Math.round((amount - each * (parts - 1)) * 100) / 100);
  return out;
}

function RequestPayment({ order, onDone }: { order: SalesOrder; onDone: () => void }) {
  const toRequest = order.payment?.amountToRequest ?? order.totalAmount;
  const [amounts, setAmounts] = useState<string[]>([String(toRequest)]);
  const [error, setError] = useState('');

  const values = amounts.map((a) => Number(a));
  const entered = values.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  const left = (paise(toRequest) - paise(entered)) / 100;
  const invalid = values.some((v) => !Number.isFinite(v) || v < 1);

  const request = useMutation({
    mutationFn: () => apiClient.post(`/staff/sales/orders/${order.id}/payment-parts`, { amounts: values }),
    onSuccess: () => { setError(''); onDone(); },
    onError: (e) => setError(errorMessage(e, 'Could not create the payment links.')),
  });

  const splitInto = (n: number) => setAmounts(evenSplit(toRequest, n).map(String));

  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/50 p-5">
      <h2 className="text-sm font-semibold text-gray-900">Request payment — {rupees(toRequest)}</h2>
      <p className="mb-4 text-sm text-gray-600">
        One link for the whole amount, or split it into parts (for example to stay under Razorpay&apos;s per-payment limit). Each part is its own secure link; the order goes to Procurement when every part is paid.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-600">Split evenly:</span>
        {[1, 2, 3, 4].map((n) => (
          <button key={n} type="button" onClick={() => splitInto(n)}
            className="rounded-full border border-gray-300 bg-white px-3 py-1 font-medium text-gray-700 hover:border-blue-500 hover:text-blue-700">
            {n === 1 ? 'One payment' : `${n} parts`}
          </button>
        ))}
      </div>

      <ul className="space-y-2">
        {amounts.map((a, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-sm text-gray-700">Part {i + 1}</span>
            <div className="relative w-48">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">₹</span>
              <input
                aria-label={`Amount for part ${i + 1}`}
                inputMode="decimal"
                value={a}
                onChange={(e) => setAmounts(amounts.map((x, j) => (j === i ? e.target.value.replace(/[^\d.]/g, '') : x)))}
                className="w-full rounded-lg border border-gray-300 py-2 pl-7 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            {amounts.length > 1 && (
              <button type="button" aria-label={`Remove part ${i + 1}`} onClick={() => setAmounts(amounts.filter((_, j) => j !== i))}
                className="p-2 text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
            )}
          </li>
        ))}
      </ul>
      {amounts.length < 10 && (
        <button type="button" onClick={() => setAmounts([...amounts, left > 0 ? String(left) : ''])}
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-900">
          <Plus className="h-4 w-4" /> Add a part
        </button>
      )}

      <p className={`mt-3 text-sm ${left === 0 ? 'text-green-700' : 'font-medium text-red-700'}`} aria-live="polite">
        {left === 0 ? `Adds up to ${rupees(toRequest)} ✓` : left > 0 ? `${rupees(left)} still to assign` : `${rupees(-left)} too much`}
      </p>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button type="button" disabled={request.isPending || left !== 0 || invalid}
        onClick={() => request.mutate()}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
        {request.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Split className="h-4 w-4" />}
        {amounts.length === 1 ? 'Create payment link' : `Create ${amounts.length} payment links`}
      </button>
    </section>
  );
}

/**
 * A quotation-first order's payment: what is in, what is waiting, and the links to
 * send. Money is confirmed only by Razorpay (webhook / reconciliation) — nothing
 * on this screen marks anything paid.
 */
export default function SalesOrderPayment({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const q = useQuery({
    queryKey: staffKeys.salesOrder(id),
    queryFn: () => apiClient.get<{ order: SalesOrder }>(`/staff/sales/orders/${encodeURIComponent(id)}`),
    // Payments land from the customer's phone — keep it fresh while open.
    refetchInterval: 20_000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: staffKeys.orders() });
  const cancelPart = useMutation({
    mutationFn: (partId: string) => apiClient.post(`/staff/sales/orders/${encodeURIComponent(id)}/payment-parts/${partId}/cancel`, {}),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(errorMessage(e, 'Could not cancel that link.')),
  });
  const cancelOrder = useMutation({
    mutationFn: () => apiClient.post(`/staff/sales/orders/${encodeURIComponent(id)}/cancel`, {}),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(errorMessage(e, 'Could not cancel the order.')),
  });

  if (q.isPending) return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading order…</p>;
  if (q.isError || !q.data) return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load this order.')}</p>;

  const o = q.data.order;
  const pay = o.payment;
  const parts = pay?.parts ?? [];
  const paid = o.paymentStatus === 'paid' || o.paymentStatus === 'refunded';
  const open = o.status === 'awaiting_payment' && !paid;
  const received = pay?.amountPaid ?? (paid ? o.totalAmount : 0);
  const pct = o.totalAmount > 0 ? Math.min(100, Math.round((received / o.totalAmount) * 100)) : 0;
  const anyPaid = parts.some((p) => p.status === 'paid');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Order</p>
          <h1 className="text-2xl font-bold text-gray-900">{o.orderNumber}</h1>
          <p className="text-sm text-gray-500">{o.customer.name} · {o.customer.phone}</p>
        </div>
        <Link href="/team/sales" className="text-sm font-medium text-blue-700 hover:text-blue-900">← All orders</Link>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div><p className="text-xs text-gray-500">Order total</p><p className="text-lg font-bold text-gray-900">{rupees(o.totalAmount)}</p></div>
          <div><p className="text-xs text-gray-500">Received</p><p className="text-lg font-bold text-green-700">{rupees(received)}</p></div>
          <div><p className="text-xs text-gray-500">Still to pay</p><p className="text-lg font-bold text-gray-900">{rupees(Math.max(0, o.totalAmount - received))}</p></div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Paid so far">
          <div className="h-full bg-green-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
        {paid && <p className="mt-3 text-sm font-medium text-green-800">Fully paid — the order is with Procurement.</p>}
        {o.status === 'cancelled' && <p className="mt-3 text-sm font-medium text-gray-600">This order was cancelled.</p>}
      </section>

      {open && pay && pay.amountToRequest > 0 && <RequestPayment key={pay.amountToRequest} order={o} onDone={refresh} />}

      {parts.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Payment links</h2>
            <a href={paymentRequestHref(o.id)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
              <FileText className="h-4 w-4 text-emerald-700" /> Payment request PDF
            </a>
          </div>
          <ul className="space-y-3">
            {parts.map((p) => (
              <li key={p.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">Payment {p.n} · {rupees(p.amount)}</p>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${PART_STATUS[p.status].cls}`}>{PART_STATUS[p.status].text}</span>
                    {open && (p.status === 'pending' || p.status === 'expired') && (
                      <button type="button" disabled={cancelPart.isPending}
                        onClick={() => {
                          if (window.confirm(`Cancel the ${rupees(p.amount)} link? You can then request that amount again.`)) cancelPart.mutate(p.id);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:border-red-300 hover:text-red-700 disabled:opacity-50">
                        <X className="h-3.5 w-3.5" /> Cancel link
                      </button>
                    )}
                  </div>
                </div>
                {p.status === 'paid' && p.paidAt && <p className="mt-1 text-xs text-gray-500">Received {formatDateTimeIST(p.paidAt)}</p>}
                {p.status === 'expired' && <p className="mt-1 text-xs text-red-700">Not paid in time. Cancel it, then request this amount again.</p>}
                {p.status === 'pending' && p.url && (
                  <div className="mt-3 rounded-lg bg-gray-50 p-4">
                    <PaymentLinkCard
                      url={p.url}
                      orderNumber={`${o.orderNumber} (payment ${p.n} of ${parts.filter((x) => x.status !== 'cancelled').length})`}
                      amount={p.amount}
                      customerName={o.customer.name}
                      customerPhone={o.customer.phone}
                      expiresAt={p.expiresAt}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <CustomerBankCard kind="order" id={o.id} />

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {open && !anyPaid && (
        <button type="button" disabled={cancelOrder.isPending}
          onClick={() => { if (window.confirm(`Cancel order ${o.orderNumber}? Every waiting payment link stops working.`)) cancelOrder.mutate(); }}
          className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
          {cancelOrder.isPending ? 'Cancelling…' : 'Cancel order'}
        </button>
      )}
    </div>
  );
}
