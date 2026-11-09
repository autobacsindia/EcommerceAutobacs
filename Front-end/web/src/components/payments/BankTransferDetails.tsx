'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { FileText, Loader2, Package, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateIST, formatDateTimeIST } from '@/lib/datetime';
import { errorMessage, quotationHref, quotationPdfHref, rupees } from '@/components/staff/sales/types';

export type BankTransferStatus = 'pending' | 'confirmed' | 'rejected' | 'withdrawn';

export const BANK_TRANSFER_BADGE: Record<BankTransferStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  withdrawn: 'bg-gray-200 text-gray-700',
};

export const transferFileHref = (id: string, fileId: string) =>
  `/api/v1/staff/bank-transfers/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`;

type Address = { lines: string[]; phone: string } | null;
type Details = {
  id: string;
  orderId: string;
  orderNumber: string;
  customer: { name: string; city: string };
  salesPerson: string;
  amount: number;
  reference: string;
  paidOn: string;
  note: string;
  status: BankTransferStatus;
  statusLabel: string;
  recordedBy: string;
  recordedAt: string;
  reviewedBy: string;
  reviewedAt: string | null;
  reviewNote: string;
  files: { id: string; name: string; contentType: string }[];
  history: { at: string; by: string; action: string; note: string }[];
  canOpenOrder: boolean;
  order: {
    createdAt: string | null;
    status: string;
    paymentStatus: string;
    customer: { name: string; email: string; phone: string };
    shippingAddress: Address;
    billingAddress: Address;
    buyer: { legalName: string; gstin: string };
    items: { name: string; variantLabel: string; quantity: number; price: number; lineTotal: number; image: string }[];
    totals: { subtotal: number | null; shipping: number; tax: number; discount: number; couponCode: string; total: number | null };
    statusHistory: { status: string; at: string | null; by: string; reason: string }[];
  } | null;
  quotation: {
    number: string;
    date: string;
    validUntil: string;
    customer: { name: string; phone: string; address: string[] };
    lines: { n: number; name: string; quantity: number; listPrice: number; offerPrice: number; amount: number }[];
    subtotal: number;
    discount: number;
    shipping: number;
    total: number;
    totalInWords: string;
    pdf: { quotationId: string | null; orderId: string } | null;
  } | null;
};

const NA = 'Not available';
const words = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : NA);
const money = (n: number | null | undefined) => (n == null ? NA : rupees(n));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-gray-200 pt-4">
      <h3 className="mb-2 text-sm font-semibold text-gray-900">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-0.5 text-sm">
      <dt className="shrink-0 text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-right text-gray-900">{children || NA}</dd>
    </div>
  );
}

function AddressBlock({ label, address }: { label: string; address: Address }) {
  return (
    <div className="text-sm">
      <p className="text-gray-500">{label}</p>
      {address ? address.lines.map((l) => <p key={l} className="break-words text-gray-900">{l}</p>) : <p className="text-gray-900">{NA}</p>}
    </div>
  );
}

function QuotationBlock({ q }: { q: NonNullable<Details['quotation']> }) {
  return (
    <>
      <dl>
        <Row label="Quotation no.">{q.number}</Row>
        <Row label="Date">{formatDateIST(q.date)}</Row>
        <Row label="Valid until">{formatDateIST(q.validUntil)}</Row>
      </dl>
      <div className="mt-2 text-sm">
        <p className="text-gray-500">Quotation for</p>
        <p className="font-medium text-gray-900">{q.customer.name || NA}</p>
        {q.customer.address.map((l) => <p key={l} className="break-words text-gray-900">{l}</p>)}
        {q.customer.phone && <p className="text-gray-900">Phone: {q.customer.phone}</p>}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="py-1 pr-2 font-medium">#</th>
              <th className="py-1 pr-2 font-medium">Item</th>
              <th className="py-1 pr-2 text-right font-medium">Qty</th>
              <th className="py-1 pr-2 text-right font-medium">Price</th>
              <th className="py-1 pr-2 text-right font-medium">Offer price</th>
              <th className="py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {q.lines.map((l) => (
              <tr key={l.n} className="border-b border-gray-100 align-top text-gray-900">
                <td className="py-1 pr-2">{l.n}</td>
                <td className="py-1 pr-2 break-words">{l.name}</td>
                <td className="py-1 pr-2 text-right">{l.quantity}</td>
                <td className="py-1 pr-2 text-right">{rupees(l.listPrice)}</td>
                <td className="py-1 pr-2 text-right">{rupees(l.offerPrice)}</td>
                <td className="py-1 text-right font-medium">{rupees(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="mt-2">
        <Row label="Subtotal">{rupees(q.subtotal)}</Row>
        {q.discount > 0 && <Row label="Discount">−{rupees(q.discount)}</Row>}
        <Row label="Delivery">{q.shipping > 0 ? rupees(q.shipping) : 'Extra, as applicable'}</Row>
        <Row label="Total"><strong>{rupees(q.total)}</strong></Row>
      </dl>
      {q.totalInWords && <p className="mt-1 text-right text-sm text-gray-600">{q.totalInWords}</p>}
      {q.pdf && (
        <a href={q.pdf.quotationId ? quotationPdfHref(q.pdf.quotationId) : quotationHref(q.pdf.orderId)} target="_blank" rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
          <FileText className="h-4 w-4 text-emerald-700" aria-hidden /> View quotation
        </a>
      )}
    </>
  );
}

function Body({ d }: { d: Details }) {
  const o = d.order;
  const fileLabel = (f: Details['files'][number], i: number) =>
    `${f.contentType === 'application/pdf' ? 'PDF' : 'Screenshot'}${d.files.length > 1 ? ` ${i + 1}` : ''}`;
  return (
    <div className="space-y-4">
      <Section title="Customer">
        <dl>
          <Row label="Name">{o?.customer.name || d.customer.name}</Row>
          <Row label="Phone">{o?.customer.phone}</Row>
          <Row label="Email">{o?.customer.email}</Row>
          {o?.buyer.legalName && <Row label="Company">{o.buyer.legalName}</Row>}
          {o?.buyer.gstin && <Row label="GSTIN">{o.buyer.gstin}</Row>}
        </dl>
        {o ? (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <AddressBlock label="Shipping address" address={o.shippingAddress} />
            <AddressBlock label="Billing address" address={o.billingAddress} />
          </div>
        ) : (
          <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">The order linked to this payment could not be found, so only the payment record is shown.</p>
        )}
      </Section>

      {o && (
        <Section title="Products">
          {o.items.length === 0 ? <p className="text-sm text-gray-500">{NA}</p> : (
            <ul className="space-y-3">
              {o.items.map((item, i) => (
                <li key={`${item.name}-${i}`} className="flex gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                    {item.image
                      ? <Image src={item.image} alt="" width={48} height={48} unoptimized className="h-12 w-12 object-cover" />
                      : <Package className="h-5 w-5 text-gray-400" aria-hidden />}
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="break-words font-medium text-gray-900">{item.name}</p>
                    {item.variantLabel && <p className="text-gray-500">{item.variantLabel}</p>}
                    <p className="text-gray-500">{item.quantity} × {rupees(item.price)}</p>
                  </div>
                  <p className="shrink-0 text-sm font-medium text-gray-900">{rupees(item.lineTotal)}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {o && (
        <Section title="Order">
          <dl>
            <Row label="Order status">{words(o.status)}</Row>
            <Row label="Payment status">{words(o.paymentStatus)}</Row>
            <Row label="Sold by">{d.salesPerson}</Row>
            <Row label="Order date">{o.createdAt ? formatDateTimeIST(o.createdAt) : NA}</Row>
            <Row label="Subtotal">{money(o.totals.subtotal)}</Row>
            <Row label="Shipping">{money(o.totals.shipping)}</Row>
            <Row label="Tax">{money(o.totals.tax)}</Row>
            {o.totals.discount > 0 && <Row label={o.totals.couponCode ? `Discount (${o.totals.couponCode})` : 'Discount'}>−{rupees(o.totals.discount)}</Row>}
            <Row label="Total"><strong>{money(o.totals.total)}</strong></Row>
          </dl>
        </Section>
      )}

      <Section title="Quotation">
        {d.quotation ? <QuotationBlock q={d.quotation} /> : <p className="text-sm text-gray-500">No quotation for this order.</p>}
      </Section>

      <Section title="Payment">
        <dl>
          <Row label="Amount">{money(d.amount)}</Row>
          <Row label="UTR / reference"><span className="font-mono">{d.reference}</span></Row>
          <Row label="Date paid">{formatDateIST(d.paidOn)}</Row>
          <Row label="Recorded">{[d.recordedBy, formatDateTimeIST(d.recordedAt)].filter(Boolean).join(', ')}</Row>
          {d.reviewedAt && <Row label={d.status === 'rejected' ? 'Rejected' : 'Confirmed'}>{[d.reviewedBy, formatDateTimeIST(d.reviewedAt)].filter(Boolean).join(', ')}</Row>}
        </dl>
        {d.note && <p className="mt-2 rounded-lg bg-gray-50 p-2 text-sm text-gray-700">GTM: {d.note}</p>}
        {d.reviewNote && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">Reason: {d.reviewNote}</p>}
        {d.files.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {d.files.map((f, i) => (
              <a key={f.id} href={transferFileHref(d.id, f.id)} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
                <FileText className="h-4 w-4 text-emerald-700" aria-hidden /> {fileLabel(f, i)}
              </a>
            ))}
          </div>
        )}
      </Section>

      {(d.history.length > 0 || (o?.statusHistory.length ?? 0) > 0) && (
        <Section title="History">
          <ul className="space-y-1 text-sm text-gray-700">
            {d.history.map((h, i) => (
              <li key={`p${i}`}>Payment {h.action}{h.by ? ` by ${h.by}` : ''}, {formatDateTimeIST(h.at)}{h.note ? ` — ${h.note}` : ''}</li>
            ))}
            {o?.statusHistory.map((h, i) => (
              <li key={`o${i}`}>Order: {words(h.status)}{h.by ? ` by ${h.by}` : ''}{h.at ? `, ${formatDateTimeIST(h.at)}` : ''}{h.reason ? ` — ${h.reason}` : ''}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** Read-only popup: everything about one bank transfer. Full screen on a phone. */
export default function BankTransferDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const q = useQuery({
    queryKey: staffKeys.bankTransferDetails(id),
    queryFn: () => apiClient.get<{ transfer: Details }>(`/staff/bank-transfers/${encodeURIComponent(id)}/details`),
    staleTime: 0, // Someone else may have just checked this transfer.
  });
  const d = q.data?.transfer;

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      returnTo?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Bank transfer details" className="flex w-full flex-col bg-white sm:max-h-[90vh] sm:max-w-2xl sm:rounded-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900">{d ? `${d.orderNumber || 'Bank transfer'} · ${money(d.amount)}` : 'Bank transfer details'}</h2>
            {d && <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${BANK_TRANSFER_BADGE[d.status]}`}>{d.statusLabel}</span>}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
          {q.isError && !d && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load the details. Please try again.')}</p>}
          {d && <Body d={d} />}
          {d?.canOpenOrder && (
            <Link href={`/admin/orders/${encodeURIComponent(d.orderId)}`} className="mt-4 inline-block rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
              Open full order
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
