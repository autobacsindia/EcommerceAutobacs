'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { formatDateTimeIST } from '@/lib/datetime';
import { rupees } from '@/components/staff/sales/types';

interface TimelineEvent { at: string; kind: string; what: string; who: string; note: string }
interface Money {
  orderTotal: number; gatewayOffer: number; extrasPaid: number; extrasWaiting: number; extrasRefundDue: number; totalWithExtras: number;
  received: number; refunded: number; refundInProgress: number; toCollect: number;
  supplierPaid: number; supplierWaiting: number; supplierNotPriced: number; expenses: number; leftAfterSupplier: number;
}
interface PaymentRow { id: string; label: string; amount: number; method: string; reference: string; status: string; at: string; refunded: number }
interface SupplierRow { id: string; number: string; kind: string; statusLabel: string; payee: string; items: string[]; amount: number; currency: string; foreignAmount: number | null; paidAt: string | null }
interface ReturnRow { id: string; statusLabel: string; createdAt: string; refundStatus: string | null; refundAmount: number | null }
export interface Overview {
  customer: { name: string; accountDeleted: boolean };
  money: Money;
  payments: PaymentRow[];
  supplierPayments: SupplierRow[];
  returns: ReturnRow[];
  linked: {
    source: string; invoiceNo: number | null; seller: string; quotation: { id: string; number: string; version: number } | null;
    lead: { id: string; name: string; status: string } | null; couponCode: string; couponDiscount: number; karmaDiscount: number; affiliate: string; onHold: boolean;
  };
  timeline: TimelineEvent[];
}

const TONE: Record<string, string> = {
  money: 'bg-green-500', extra: 'bg-indigo-500', supplier: 'bg-amber-500', delivery: 'bg-sky-500', work: 'bg-sky-500', return: 'bg-red-500', order: 'bg-gray-400', sales: 'bg-purple-500',
};
const SHOW_FIRST = 12;
const SOURCE: Record<string, string> = { web: 'Website', offline: 'GTM sale', woocommerce: 'Old website' };

function Box({ label, value, hint, strong }: { label: string; value: number; hint?: string; strong?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${strong ? 'border-gray-400 bg-gray-50' : 'border-gray-200'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-900">{rupees(value)}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section aria-label={title} className="rounded-lg bg-white p-4 shadow">
    <h2 className="mb-3 text-base font-semibold text-gray-900">{title}</h2>
    {children}
  </section>
);
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-3 py-1 text-sm"><dt className="text-gray-500">{label}</dt><dd className="text-right font-medium text-gray-900">{children}</dd></div>
);
const amountOf = (r: SupplierRow) => (r.amount > 0 || r.currency === 'INR' ? rupees(r.amount) : `${r.currency} ${r.foreignAmount ?? ''}`);

/** Admin: the whole order, top of the page. Read-only; the server does every sum. */
export default function OrderOverview({ orderId }: { orderId: string }) {
  const [everything, setEverything] = useState(false);
  const q = useQuery({
    queryKey: ['admin', 'order-overview', orderId],
    queryFn: () => apiClient.get<{ overview: Overview }>(`/orders/${encodeURIComponent(orderId)}/overview`),
    retry: false,
  });
  if (q.isLoading) return <p className="mb-6 text-sm text-gray-500">Loading the order summary…</p>;
  if (!q.data?.overview) return <p role="alert" className="mb-6 rounded-lg bg-red-50 p-3 text-sm text-red-700">Could not load the order summary. The details below are still correct.</p>;

  const { money: m, customer, payments, supplierPayments, returns, linked, timeline } = q.data.overview;
  const newestFirst = [...timeline].reverse();
  const shown = everything ? newestFirst : newestFirst.slice(0, SHOW_FIRST);
  const facts = [linked.invoiceNo, linked.seller, linked.quotation, linked.lead, linked.couponCode, linked.karmaDiscount, linked.affiliate].some(Boolean);

  return (
    <div className="mb-6 space-y-4">
      <Card title="Money in this order">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Box label="Order total" value={m.orderTotal} hint="Fixed when the order was placed" />
          <Box label="Extras paid" value={m.extrasPaid} hint={m.extrasWaiting > 0 ? `${rupees(m.extrasWaiting)} more waiting` : undefined} />
          <Box label="Total with extras" value={m.totalWithExtras} strong />
          <Box label="Received from customer" value={m.received} hint={m.gatewayOffer > 0 ? `After ${rupees(m.gatewayOffer)} card offer` : undefined} />
          <Box label="Refunded" value={m.refunded} hint={m.refundInProgress > 0 ? `${rupees(m.refundInProgress)} on its way` : m.extrasRefundDue > 0 ? `${rupees(m.extrasRefundDue)} extra to refund` : undefined} />
          <Box label="Still to collect" value={m.toCollect} />
          <Box label="Paid to suppliers" value={m.supplierPaid} hint={m.supplierWaiting > 0 ? `${rupees(m.supplierWaiting)} more asked for` : m.supplierNotPriced > 0 ? `${m.supplierNotPriced} paid abroad, not counted` : undefined} />
          <Box label="Left after supplier" value={m.leftAfterSupplier} hint="Received − refunded − supplier" strong />
        </div>
        {customer.accountDeleted && <p className="mt-3 text-xs text-amber-800">This customer no longer has an account. The name comes from the shipping address.</p>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="What happened">
          {!shown.length && <p className="text-sm text-gray-500">Nothing recorded yet.</p>}
          <ol className="space-y-3">
            {shown.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex gap-3">
                <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE[e.kind] ?? 'bg-gray-400'}`} />
                <div className="min-w-0">
                  <p className="text-sm text-gray-900">{e.what}</p>
                  <p className="text-xs text-gray-500">{formatDateTimeIST(e.at)}{e.who ? ` · ${e.who}` : ''}</p>
                  {e.note && <p className="mt-0.5 whitespace-pre-line break-words text-xs text-gray-600">{e.note}</p>}
                </div>
              </li>
            ))}
          </ol>
          {newestFirst.length > SHOW_FIRST && (
            <button type="button" className="mt-3 text-xs font-semibold text-blue-700" onClick={() => setEverything((v) => !v)}>
              {everything ? 'Show fewer' : `Show all ${newestFirst.length}`}
            </button>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Payments received">
            {!payments.length && <p className="text-sm text-gray-500">No payment recorded.</p>}
            <ul className="divide-y divide-gray-100">
              {payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0"><p className="font-medium text-gray-900">{p.label} · {p.method}</p><p className="break-all text-xs text-gray-500">{p.reference || '—'} · {p.status} · {formatDateTimeIST(p.at)}</p></div>
                  <div className="shrink-0 text-right font-medium">{rupees(p.amount)}{p.refunded > 0 && <p className="text-xs font-normal text-red-700">{rupees(p.refunded)} refunded</p>}</div>
                </li>
              ))}
            </ul>
          </Card>

          {supplierPayments.length > 0 && (
            <Card title="Supplier payments and expenses">
              <ul className="divide-y divide-gray-100">
                {supplierPayments.map((r) => (
                  <li key={r.id} className="flex justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0"><p className="font-medium text-gray-900">{r.number} · {r.payee}</p><p className="text-xs text-gray-500">{r.statusLabel}{r.items.length ? ` · ${r.items.join(', ')}` : ''}</p></div>
                    <span className="shrink-0 font-medium">{amountOf(r)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {returns.length > 0 && (
            <Card title="Returns">
              <ul className="divide-y divide-gray-100">
                {returns.map((r) => (
                  <li key={r.id} className="flex justify-between gap-3 py-2 text-sm">
                    <span>{r.statusLabel} · {formatDateTimeIST(r.createdAt)}</span>
                    {r.refundAmount != null && <span className="shrink-0">{rupees(r.refundAmount)}{r.refundStatus ? ` · ${r.refundStatus}` : ''}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {(facts || linked.onHold) && (
            <Card title="Linked to this order">
              <dl>
                <Row label="Came from">{SOURCE[linked.source] ?? linked.source}</Row>
                {linked.seller && <Row label="Sold by">{linked.seller}</Row>}
                {linked.invoiceNo != null && <Row label="Invoice number">{linked.invoiceNo}</Row>}
                {linked.quotation && <Row label="Quotation">{linked.quotation.number} (version {linked.quotation.version})</Row>}
                {linked.lead && <Row label="Lead">{linked.lead.name || '—'}{linked.lead.status ? ` · ${linked.lead.status}` : ''}</Row>}
                {linked.couponCode && <Row label="Coupon">{linked.couponCode} · {rupees(linked.couponDiscount)} off</Row>}
                {linked.karmaDiscount > 0 && <Row label="Karma points used">{rupees(linked.karmaDiscount)} off</Row>}
                {linked.affiliate && <Row label="Affiliate">{linked.affiliate}</Row>}
                {linked.onHold && <Row label="On hold">Customer thinking</Row>}
              </dl>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
