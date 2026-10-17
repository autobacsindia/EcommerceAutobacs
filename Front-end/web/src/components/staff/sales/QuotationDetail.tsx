'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Loader2, MessageCircle, Pencil, XCircle } from 'lucide-react';
import { useState } from 'react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { whatsappNumber } from './PaymentLinkCard';
import { errorMessage, quotationPdfHref, rupees, type Quotation } from './types';

export const QUOTATION_STATUS: Record<Quotation['status'], { text: string; cls: string }> = {
  open: { text: 'Shared — waiting for the client', cls: 'bg-blue-100 text-blue-800' },
  expired: { text: 'Expired — edit to refresh', cls: 'bg-amber-100 text-amber-800' },
  accepted: { text: 'Accepted — order created', cls: 'bg-green-100 text-green-800' },
  cancelled: { text: 'Cancelled', cls: 'bg-gray-200 text-gray-700' },
};

/** WhatsApp text for sharing a quotation (the PDF is attached by hand from the download). */
export function quotationMessage(q: Quotation) {
  const first = q.customer.name.trim().split(/\s+/)[0] || 'there';
  return [
    `Hi ${first}, thank you for your interest in Autobacs India.`,
    `Please find our quotation ${q.number} for ${rupees(q.totalAmount)}.`,
    `Prices are held until ${formatDateTimeIST(q.validUntil)}.`,
    'Once you confirm, we will share the secure payment link.',
  ].join('\n');
}

/**
 * One quotation: share it, edit it (a new version), cancel it, or — when the
 * client agrees — turn it into the order and move on to requesting payment.
 */
export default function QuotationDetail({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const q = useQuery({
    queryKey: staffKeys.quotation(id),
    queryFn: () => apiClient.get<{ quotation: Quotation }>(`/staff/sales/quotations/${encodeURIComponent(id)}`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: staffKeys.quotations() });

  const accept = useMutation({
    mutationFn: () => apiClient.post<{ orderId: string }>(`/staff/sales/quotations/${encodeURIComponent(id)}/accept`, {}),
    onSuccess: (res) => {
      refresh();
      queryClient.invalidateQueries({ queryKey: staffKeys.orders() });
      router.push(`/team/sales/orders/${res.orderId}`);
    },
    onError: (e) => setError(errorMessage(e, 'Could not create the order.')),
  });
  const cancel = useMutation({
    mutationFn: () => apiClient.post(`/staff/sales/quotations/${encodeURIComponent(id)}/cancel`, {}),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(errorMessage(e, 'Could not cancel the quotation.')),
  });

  if (q.isPending) return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading quotation…</p>;
  if (q.isError || !q.data) return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load this quotation.')}</p>;

  const quote = q.data.quotation;
  const status = QUOTATION_STATUS[quote.status];
  const open = quote.status === 'open';
  const editable = quote.status === 'open' || quote.status === 'expired';
  const a = quote.shippingAddress;
  const busy = accept.isPending || cancel.isPending;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Quotation</p>
          <h1 className="text-2xl font-bold text-gray-900">{quote.number}</h1>
          <p className="text-sm text-gray-500">
            {quote.version > 1 ? `Version ${quote.version} · ` : ''}Valid until {formatDateTimeIST(quote.validUntil)}
            {quote.salesPerson ? ` · ${quote.salesPerson}` : ''}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${status.cls}`}>{status.text}</span>
      </div>

      {/* What to do next */}
      {quote.status !== 'cancelled' && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap gap-2">
            <a href={quotationPdfHref(quote.id)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
              <FileText className="h-4 w-4" /> Quotation PDF
            </a>
            {quote.customer.phone && (
              <a href={`https://wa.me/${whatsappNumber(quote.customer.phone)}?text=${encodeURIComponent(quotationMessage(quote))}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
                <MessageCircle className="h-4 w-4 text-green-600" /> Share on WhatsApp
              </a>
            )}
            {editable && (
              <Link href={`/team/sales/quotations/${quote.id}/edit`}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
                <Pencil className="h-4 w-4" /> Edit
              </Link>
            )}
            {editable && (
              <button type="button" disabled={busy}
                onClick={() => { if (window.confirm(`Cancel quotation ${quote.number}?`)) cancel.mutate(); }}
                className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                <XCircle className="h-4 w-4" /> Cancel quotation
              </button>
            )}
          </div>

          {open && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="text-sm font-semibold text-green-900">Has the client agreed?</p>
              <p className="mb-3 text-sm text-green-800">
                This creates the order at these prices (stock and prices are re-checked first). You then send the payment link — in one go or split into parts.
              </p>
              <button type="button" disabled={busy}
                onClick={() => {
                  if (window.confirm(`Create the order for ${rupees(quote.totalAmount)} from ${quote.number}?`)) accept.mutate();
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50">
                {accept.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Client accepted — create order
              </button>
            </div>
          )}
          {quote.status === 'expired' && (
            <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              This quotation has passed its validity date. Edit it to re-check prices and stock, share the new version, then accept it.
            </p>
          )}
          {quote.status === 'accepted' && quote.orderId && (
            <Link href={`/team/sales/orders/${quote.orderId}`}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              Go to the order &amp; payment →
            </Link>
          )}
          {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </section>
      )}

      <section className="grid gap-4 rounded-xl border border-gray-200 bg-white p-5 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Customer</p>
          <p className="text-gray-900">{quote.customer.name}</p>
          <p className="text-gray-700">{quote.customer.phone}</p>
          {quote.customer.email && <p className="break-all text-gray-700">{quote.customer.email}</p>}
        </div>
        {a && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Deliver to</p>
            <p className="text-gray-700">
              {[a.addressLine1, a.addressLine2].filter(Boolean).join(', ')}<br />
              {[a.city, a.state, a.postalCode].filter(Boolean).join(', ')}
            </p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white">
        <ul className="divide-y divide-gray-100">
          {quote.items.map((l, i) => (
            <li key={i} className="flex items-start justify-between gap-4 p-4 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{l.variantLabel ? `${l.name} — ${l.variantLabel}` : l.name}</p>
                <p className="text-xs text-gray-500">
                  {l.quantity} × {rupees(l.price)}
                  {l.listPrice ? <span className="ml-1 line-through">{rupees(l.listPrice)}</span> : null}
                  {l.custom ? <span className="ml-2 text-emerald-700">Custom item</span> : null}
                </p>
              </div>
              <p className="shrink-0 font-semibold text-gray-900">{rupees(l.price * l.quantity)}</p>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-gray-200 p-4">
          <p className="text-sm text-gray-500">Total</p>
          <p className="text-xl font-bold text-gray-900">{rupees(quote.totalAmount)}</p>
        </div>
      </section>

      {quote.notes && (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700"><span className="font-medium">Note: </span>{quote.notes}</p>
      )}
      {quote.revisions.length > 0 && (
        <p className="text-xs text-gray-500">
          Earlier versions: {quote.revisions.map((r) => `v${r.version} ${rupees(r.totalAmount)}`).join(' · ')}
        </p>
      )}
    </div>
  );
}
