'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle2, Gift, Loader2, MessageCircle, Pencil, Share2, Truck, Undo2, Warehouse } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { tokenManager } from '@/lib/http/tokenManager';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import CustomerBankCard from '@/components/staff/sales/CustomerBankCard';
import { whatsappNumber } from '@/components/staff/sales/PaymentLinkCard';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import { shrinkPhoto, STAGE_TONE, PARCEL_STEP_OPTIONS, type LineAction, type ParcelStepStatus, type WorkOrder } from './types';
import LineSupplierPayment, { useOrderSupplierPayments } from '@/components/payments/OrderSupplierPayments';
import { displayEmail } from '@/lib/internalEmail';
import ProductLink from '@/components/staff/ProductLink';
import ParcelEta from './ParcelEta';
import FilePicker from '@/components/payments/FilePicker';

/** Dispatch photos: what the server takes. Any size — shrinkPhoto brings it under the server's 8 MB. */
const PHOTO_TYPES = 'image/jpeg,image/png,image/webp';
const pickPhoto = (set: (f: File | null) => void) => (files: File[]) => set(files[0] ?? null);

type OrderResponse = { success: boolean; order: WorkOrder };

const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50';
const primary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const secondary = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const danger = `${btn} border border-red-300 bg-white text-red-700 hover:bg-red-50`;
const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

const REFUND_STATUS: Record<string, string> = {
  pending: 'Approved — not sent yet',
  processing: 'Refund sent — reaching the customer\'s bank',
  completed: 'Refunded',
  failed: 'Refund failed — retry it',
  not_applicable: 'Nothing to refund',
};

/** Multipart POST (the JSON client can't send files), with the same CSRF header it uses. */
async function postForm<T>(endpoint: string, form: FormData, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  await tokenManager.ensureCsrfToken();
  const headers = tokenManager.getHeaders() as Record<string, string>;
  delete headers['Content-Type']; // the browser sets the multipart boundary
  const res = await fetch(`/api/v1${endpoint}`, { method, body: form, headers, credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.message || 'Upload failed'), { rawData: body });
  return body as T;
}

function shippedMessage(o: WorkOrder, parcel: WorkOrder['parcels'][number]) {
  const first = o.customer.name.trim().split(/\s+/)[0] || 'there';
  return [
    `Hi ${first}, your Autobacs India order ${o.orderNumber} has been shipped${parcel.courier ? ` via ${parcel.courier}` : ''}.`,
    parcel.trackingNumber ? `Tracking number: ${parcel.trackingNumber}` : null,
    // Our-warehouse parcels may have no photo: only promise one that exists.
    parcel.photoUrl ? 'We have shared a photo of your parcel. Thank you for shopping with us!' : 'Thank you for shopping with us!',
  ].filter(Boolean).join('\n');
}

async function sharePhoto(url: string, name: string) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('Could not load the photo');
  const blob = await res.blob();
  const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * One order, as a team sees it: items with their stage and the buttons this person
 * may press (the server re-checks every one), the supplier-proof upload, parcels
 * with their photo, refunds and the history.
 */
export default function WorkOrderPanel({ orderId }: { orderId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const supplierPayments = useOrderSupplierPayments(orderId);
  const [editParcel, setEditParcel] = useState<string | null>(null);
  const [parcelFix, setParcelFix] = useState({ courier: '', tracking: '' });
  const [parcelPhoto, setParcelPhoto] = useState<File | null>(null);
  // Operations: the courier step being added to one parcel.
  const [stepFor, setStepFor] = useState<{ parcelId: string; status: ParcelStepStatus | ''; note: string } | null>(null);
  const [noteFor, setNoteFor] = useState<{ itemId: string; kind: 'reject' } | null>(null);
  const [note, setNote] = useState('');

  const q = useQuery({
    queryKey: staffKeys.workOrder(orderId),
    queryFn: () => apiClient.get<OrderResponse>(`/staff/work/orders/${orderId}`),
  });

  const done = (res: OrderResponse) => {
    setError('');
    queryClient.setQueryData(staffKeys.workOrder(orderId), res);
    // Refresh the lists (an action moves the order between them) — but not this
    // order: the reply above IS its fresh state, so refetching it would be waste.
    const self = staffKeys.workOrder(orderId);
    queryClient.invalidateQueries({
      queryKey: staffKeys.orders(),
      predicate: (query) => JSON.stringify(query.queryKey) !== JSON.stringify(self),
    });
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      apiClient.post<OrderResponse>(`/staff/work/orders/${orderId}${path}`, body),
    onSuccess: (res) => { done(res); setNoteFor(null); setNote(''); setStepFor(null); },
    onError: (e) => setError(errorMessage(e, 'That did not work. Please try again.')),
  });
  // Correct a parcel's dispatch details (any time while it is in transit).
  const editParcelMutation = useMutation({
    mutationFn: async (shipmentId: string) => {
      const form = new FormData();
      form.append('courierName', parcelFix.courier.trim());
      form.append('trackingNumber', parcelFix.tracking.trim());
      if (parcelPhoto) form.append('photo', await shrinkPhoto(parcelPhoto), 'proof.jpg');
      return postForm<OrderResponse>(`/staff/work/orders/${orderId}/parcels/${shipmentId}`, form, 'PUT');
    },
    onSuccess: (res) => { done(res); setEditParcel(null); setParcelPhoto(null); },
    onError: (e) => setError(errorMessage(e, 'Could not save the dispatch details.')),
  });

  // Expected delivery date on a parcel in transit (server re-checks the date and who may set it).
  const etaMutation = useMutation({
    mutationFn: ({ shipmentId, date, previousDate }: { shipmentId: string; date: string; previousDate: string }) =>
      apiClient.put<OrderResponse>(`/staff/work/orders/${orderId}/parcels/${shipmentId}/eta`, { date, previousDate }),
    onSuccess: done,
    onError: (e) => setError(errorMessage(e, 'Could not save the expected delivery date.')),
  });

  if (q.isPending) return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (q.isError) return <p role="alert" className="text-sm text-red-700">{errorMessage(q.error, 'Could not load this order.')}</p>;
  const o = q.data.order;
  const a = o.shippingAddress;
  const busy = act.isPending;

  function lineButtons(line: WorkOrder['lines'][number]) {
    const has = (x: LineAction) => line.actions.includes(x);
    const path = `/lines/${line.itemId}`;
    return (
      <div className="flex flex-wrap gap-2">
        {has('in_stock') && <button type="button" disabled={busy} className={secondary}
          onClick={() => act.mutate({ path: `${path}/stock`, body: { stock: 'in_stock' } })}>In stock</button>}
        {has('own_stock') && <button type="button" disabled={busy} className={secondary} title="We have it ourselves — no supplier, no supplier payment"
          onClick={() => act.mutate({ path: `${path}/stock`, body: { stock: 'own_stock' } })}>
          <Warehouse className="h-3.5 w-3.5" /> Our warehouse
        </button>}
        {/* "Ordered from supplier" is now part of "Request supplier payment" on the line (LineSupplierPayment). */}
        {has('out_of_stock') && <button type="button" disabled={busy} className={danger}
          onClick={() => { if (window.confirm(`Mark "${line.name}" out of stock? The sales team will ask the customer to wait or take a refund.`)) act.mutate({ path: `${path}/stock`, body: { stock: 'out_of_stock' } }); }}>Out of stock</button>}
        {has('stock_undo') && <button type="button" disabled={busy} className={secondary} title="Undo this stock decision"
          onClick={() => { if (window.confirm(`Undo the stock decision on "${line.name}"? It goes back to New Order.`)) act.mutate({ path: `${path}/undo-stock`, body: {} }); }}>
          <Undo2 className="h-3.5 w-3.5" /> Undo
        </button>}
        {has('decision_undo') && <button type="button" disabled={busy} className={secondary} title="Until accounts acts on it"
          onClick={() => { if (window.confirm(`Undo the customer's decision on "${line.name}"?`)) act.mutate({ path: `${path}/undo-decision`, body: {} }); }}>
          <Undo2 className="h-3.5 w-3.5" /> Undo decision
        </button>}
        {has('wait') && <button type="button" disabled={busy} className={secondary}
          onClick={() => act.mutate({ path: `${path}/decision`, body: { decision: 'wait' } })}>Customer will wait</button>}
        {has('refund') && <button type="button" disabled={busy} className={danger}
          onClick={() => { if (window.confirm('The customer wants a refund for this item? Accounts will review it.')) act.mutate({ path: `${path}/decision`, body: { decision: 'refund' } }); }}>Customer wants refund</button>}
        {has('approve') && <button type="button" disabled={busy} className={primary}
          onClick={() => { if (window.confirm(`Approve the refund for "${line.name}"? It will be cancelled and the refund sent to the customer now.`)) act.mutate({ path: `${path}/refund`, body: { approve: true } }); }}>Approve refund</button>}
        {has('reject') && <button type="button" disabled={busy} className={secondary}
          onClick={() => { setNoteFor({ itemId: line.itemId, kind: 'reject' }); setNote(''); }}>Send back</button>}
      </div>
    );
  }

  return (
    <div className="space-y-5 text-sm">
      {/* Customer + delivery */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Customer</p>
          <p className="text-gray-900">{o.customer.name}</p>
          <p className="text-gray-700">{o.customer.phone}</p>
          {displayEmail(o.customer.email, { label: false }) && <p className="break-all text-gray-700">{o.customer.email}</p>}
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
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Sold by</p>
          <p className="text-gray-900">{o.soldBy}</p>
          <p className="text-gray-700">{rupees(o.totalAmount)} paid</p>
          {o.payment?.razorpayPaymentId && <p className="font-mono text-xs text-gray-500">{o.payment.razorpayPaymentId}</p>}
        </div>
      </div>

      {o.owesGoodie && (
        <p className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          <Gift className="h-4 w-4 shrink-0" /> This order includes a free gift. The supplier does not send it — admin sends it separately.
        </p>
      )}

      {/* Items */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Items</p>
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {o.lines.map((line) => (
            <li key={line.itemId} className="space-y-2 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-gray-900">
                    <ProductLink product={line.productId} variantId={line.variantId}>{line.name}{line.variantLabel ? ` — ${line.variantLabel}` : ''}</ProductLink>{' '}
                    <span className="font-normal text-gray-500">× {line.quantity}</span>
                  </p>
                  {line.supplierName && line.stage === 'with_supplier' && <p className="text-xs text-gray-500">Supplier: {line.supplierName}</p>}
                  {line.paymentInitiatedAt && line.stage === 'to_ship' && (
                    <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      <CheckCircle2 className="h-3 w-3" /> Supplier payment initiated · {formatDateTimeIST(line.paymentInitiatedAt)}
                    </p>
                  )}
                </div>
                {line.stage && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STAGE_TONE[line.stage]}`}>{line.stageLabel}</span>}
              </div>
              {line.actions.length > 0 && lineButtons(line)}
              <LineSupplierPayment order={o} line={line} requests={supplierPayments.data?.requests ?? []} />
              {noteFor?.itemId === line.itemId && (
                <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); act.mutate({ path: `/lines/${line.itemId}/refund`, body: { approve: false, note: note.trim() } }); }}>
                  <textarea className={input} rows={2} required maxLength={500} placeholder="Why are you sending it back? (sales will see this)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Reason" />
                  <div className="flex gap-2">
                    <button type="submit" disabled={busy || !note.trim()} className={primary}>Send back to sales</button>
                    <button type="button" className={secondary} onClick={() => setNoteFor(null)}>Cancel</button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      </div>

      {o.canDispatchOwn && (
        <OwnStockForm key={`own-${o.lines.map((l) => `${l.itemId}:${l.stage}`).join('|')}`} order={o} onShipped={done} onError={setError} />
      )}

      {o.canShip && (
        // Keyed on the lines' stages so the form starts fresh whenever the order moves.
        <ShipForm key={o.lines.map((l) => `${l.itemId}:${l.stage}`).join('|')} order={o} onShipped={done} onError={setError} />
      )}

      {/* Parcels */}
      {o.parcels.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Parcels</p>
          <ul className="space-y-3">
            {o.parcels.map((p) => (
              <li key={p.id} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3 sm:flex-row">
                {p.photoUrl && (
                  <a href={p.photoUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.photoUrl} alt={`Dispatch photo for parcel ${p.sequence}`} className="h-28 w-28 rounded-lg border border-gray-200 object-cover" loading="lazy" />
                  </a>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium text-gray-900">
                    Parcel {p.sequence} · <span className={p.status === 'delivered' ? 'text-green-700' : p.status === 'lost' ? 'text-red-700' : 'text-sky-700'}>{p.status === 'shipped' ? 'In transit' : p.status[0].toUpperCase() + p.status.slice(1)}</span>
                  </p>
                  <p className="text-gray-700">{[p.courier, p.trackingNumber && `Tracking ${p.trackingNumber}`].filter(Boolean).join(' · ') || 'No tracking details'}</p>
                  <p className="text-xs text-gray-500">{p.items.map((i) => `${i.name} × ${i.quantity}`).join(', ')}</p>
                  <p className="text-xs text-gray-500">
                    {p.shippedAt && `Shipped ${formatDateTimeIST(p.shippedAt)}`}{p.deliveredAt && ` · Delivered ${formatDateTimeIST(p.deliveredAt)}`}
                  </p>
                  {p.status === 'shipped' && (
                    <ParcelEta parcel={p} saving={etaMutation.isPending}
                      onSave={(date, previousDate) => etaMutation.mutate({ shipmentId: p.id, date, previousDate })} />
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {o.canContactCustomer && o.customer.phone && p.status !== 'lost' && (
                      <a className={`${btn} bg-[#25D366] text-white hover:bg-[#1ebe5b]`} target="_blank" rel="noopener noreferrer"
                        href={`https://wa.me/${whatsappNumber(o.customer.phone)}?text=${encodeURIComponent(shippedMessage(o, p))}`}>
                        <MessageCircle className="h-3.5 w-3.5" /> Send to customer
                      </a>
                    )}
                    {p.photoUrl && (
                      <button type="button" className={secondary}
                        onClick={() => sharePhoto(p.photoUrl!, `Autobacs-${o.orderNumber}-parcel-${p.sequence}.jpg`).catch((e) => setError((e as Error).message))}>
                        <Share2 className="h-3.5 w-3.5" /> Share photo
                      </button>
                    )}
                    {p.canEdit && editParcel !== p.id && (
                      <button type="button" className={secondary} title="While the parcel is in transit"
                        onClick={() => { setEditParcel(p.id); setParcelFix({ courier: p.courier, tracking: p.trackingNumber }); setParcelPhoto(null); }}>
                        <Pencil className="h-3.5 w-3.5" /> Edit dispatch details
                      </button>
                    )}
                    {p.canMarkDelivered && (
                      <button type="button" disabled={busy} className={primary}
                        onClick={() => { if (window.confirm(`Mark parcel ${p.sequence} delivered? The customer will get the delivered email.`)) act.mutate({ path: '/delivered', body: { shipmentId: p.id } }); }}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Mark delivered
                      </button>
                    )}
                    {p.canUndoDelivered && (
                      <button type="button" disabled={busy} className={secondary}
                        onClick={() => { if (window.confirm(`Put parcel ${p.sequence} back in transit? Use this only if it was marked delivered by mistake. The customer keeps the email they already got; their loyalty points are not taken back, and no second points are given when it is delivered again.`)) act.mutate({ path: '/undo-delivered', body: { shipmentId: p.id } }); }}>
                        <Undo2 className="h-3.5 w-3.5" /> Undo delivered
                      </button>
                    )}
                  </div>
                  {(p.steps?.length ?? 0) > 0 && (
                    <ol className="space-y-0.5 border-l-2 border-sky-200 pl-2 pt-1" aria-label={`Updates for parcel ${p.sequence}`}>
                      {p.steps!.map((s, i) => (
                        <li key={`${s.at}-${i}`} className={`text-xs ${i === 0 ? 'font-medium text-gray-900' : 'text-gray-600'}`}>
                          {s.label}{s.note && ` · ${s.note}`}
                          <span className="font-normal text-gray-500"> — {formatDateTimeIST(s.at)}{s.by && ` · ${s.by}`}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {p.canAddStep && (
                    <form className="flex flex-wrap items-center gap-2 pt-1" aria-label={`Update parcel ${p.sequence}`}
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (stepFor?.parcelId !== p.id || !stepFor.status) return;
                        act.mutate({ path: `/parcels/${p.id}/steps`, body: { status: stepFor.status, note: stepFor.note.trim(), expectedSteps: p.stepCount ?? 0 } });
                      }}>
                      <select className={`${input} max-w-[11rem]`} aria-label={`Parcel ${p.sequence} status`}
                        value={stepFor?.parcelId === p.id ? stepFor.status : ''}
                        onChange={(e) => setStepFor({ parcelId: p.id, status: e.target.value as ParcelStepStatus | '', note: stepFor?.parcelId === p.id ? stepFor.note : '' })}>
                        <option value="">Update status…</option>
                        {PARCEL_STEP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      {stepFor?.parcelId === p.id && stepFor.status && (
                        <>
                          <input className={`${input} max-w-[14rem]`} maxLength={120} aria-label={`Parcel ${p.sequence} note`}
                            placeholder={stepFor.status === 'delivery_failed' ? 'Why? (e.g. customer not at home)' : 'Note (optional, e.g. city)'}
                            value={stepFor.note} onChange={(e) => setStepFor({ ...stepFor, note: e.target.value })} />
                          <button type="submit" disabled={busy} className={secondary}>Save update</button>
                        </>
                      )}
                    </form>
                  )}
                  {editParcel === p.id && (
                    <form className="space-y-2 pt-2" aria-label={`Edit dispatch details for parcel ${p.sequence}`}
                      onSubmit={(e) => { e.preventDefault(); editParcelMutation.mutate(p.id); }}>
                      <div className="flex flex-wrap gap-2">
                        <input className={`${input} max-w-[12rem]`} aria-label="Courier" maxLength={80} value={parcelFix.courier} onChange={(e) => setParcelFix({ ...parcelFix, courier: e.target.value })} placeholder="Courier" />
                        <input className={`${input} max-w-[12rem]`} aria-label="Tracking number" maxLength={80} value={parcelFix.tracking} onChange={(e) => setParcelFix({ ...parcelFix, tracking: e.target.value })} placeholder="Tracking number" />
                      </div>
                      <FilePicker files={parcelPhoto ? [parcelPhoto] : []} onChange={pickPhoto(setParcelPhoto)} max={1} accept={PHOTO_TYPES}
                        maxBytes={Infinity} label="Replace the photo (optional)" icon={<Camera className="h-4 w-4" />} onError={setError} />
                      <div className="flex gap-2">
                        <button type="submit" disabled={editParcelMutation.isPending} className={primary}>Save</button>
                        <button type="button" className={secondary} onClick={() => setEditParcel(null)}>Cancel</button>
                      </div>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {o.canSeeCustomerBank && <CustomerBankCard kind="order" id={o.id} />}

      {/* Refunds */}
      {o.cancellations.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Refunds</p>
          <ul className="space-y-2">
            {o.cancellations.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-3">
                <span className="text-gray-800">{c.items.map((i) => `${i.name} × ${i.quantity}`).join(', ')}</span>
                <span className={`text-xs font-medium ${c.refundStatus === 'failed' ? 'text-red-700' : 'text-gray-700'}`}>
                  {c.refundAmount != null && `${rupees(c.refundAmount)} · `}{REFUND_STATUS[c.refundStatus || ''] || c.refundStatus}
                </span>
                {c.refundFailure && <p className="w-full text-xs text-red-700">{c.refundFailure}</p>}
                {c.canSendRefund && (
                  <button type="button" className={primary} disabled={busy}
                    onClick={() => {
                      const amount = c.refundAmount != null ? `${rupees(c.refundAmount)} ` : '';
                      if (window.confirm(`Send the ${amount}refund to the customer now?`)) act.mutate({ path: `/refunds/${c.id}/send`, body: {} });
                    }}>
                    {c.refundStatus === 'failed' ? 'Retry refund' : 'Send refund'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* History */}
      {o.history.length > 0 && (
        <details className="rounded-lg border border-gray-200">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">History</summary>
          <ol className="space-y-2 border-t border-gray-100 p-3">
            {o.history.map((h, i) => (
              <li key={i} className="text-xs text-gray-700">
                <span className="text-gray-500">{formatDateTimeIST(h.at)}</span> — <span className="font-medium">{h.action}</span>
                {h.item && ` · ${h.item}`}{h.note && ` · ${h.note}`}
                <span className="text-gray-500"> · {h.by}{h.team && ` (${h.team})`}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/**
 * Procurement (or admin): the supplier's photo (+ courier and tracking) → the chosen items
 * are shipped. Starts with every item ticked — "ship all" — since one box is the common
 * case; untick to send part now. Items not stock-checked yet may go too: the server
 * records them in stock. Out-of-stock and refunded items never show here.
 */
function ShipForm({ order, onShipped, onError }: { order: WorkOrder; onShipped: (r: OrderResponse) => void; onError: (m: string) => void }) {
  const shippable = order.lines.filter((l) => l.actions.includes('ship') && l.unshipped > 0);
  const [selected, setSelected] = useState<string[]>(shippable.map((l) => l.itemId));
  const [file, setFile] = useState<File | null>(null);
  const [courier, setCourier] = useState('');
  const [tracking, setTracking] = useState('');
  const [busy, setBusy] = useState(false);
  const allChosen = shippable.every((l) => selected.includes(l.itemId));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { onError('Add a photo of the parcel, the courier receipt, or the supplier\'s screenshot.'); return; }
    if (!selected.length) { onError('Choose at least one item in this parcel.'); return; }
    setBusy(true);
    try {
      const photo = await shrinkPhoto(file);
      const form = new FormData();
      form.append('photo', photo, 'proof.jpg');
      form.append('itemIds', JSON.stringify(selected));
      if (courier.trim()) form.append('courierName', courier.trim());
      if (tracking.trim()) form.append('trackingNumber', tracking.trim());
      onShipped(await postForm<OrderResponse>(`/staff/work/orders/${order.id}/ship`, form));
      setFile(null); setCourier(''); setTracking('');
    } catch (err) {
      onError(errorMessage(err, 'Could not upload the proof. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (!shippable.length) return null;
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      <p className="flex items-center gap-2 font-semibold text-gray-900"><Truck className="h-4 w-4" /> Ready to dispatch — from the supplier</p>
      <p className="text-xs text-gray-600">Add the supplier&apos;s photo or the courier receipt and it is marked dispatched. Items from our own warehouse: press &ldquo;Our warehouse&rdquo; on the item instead.</p>
      {shippable.length > 1 && (
        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs font-medium text-gray-700">Items in this parcel</legend>
          <label className="flex items-center gap-2 border-b border-blue-100 pb-1 text-sm font-medium text-gray-900">
            <input type="checkbox" checked={allChosen}
              onChange={(e) => setSelected(e.target.checked ? shippable.map((l) => l.itemId) : [])} />
            All items
          </label>
          {shippable.map((l) => (
            <label key={l.itemId} className="flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" checked={selected.includes(l.itemId)}
                onChange={(e) => setSelected(e.target.checked ? [...selected, l.itemId] : selected.filter((x) => x !== l.itemId))} />
              <span>
                {l.name}{l.variantLabel ? ` — ${l.variantLabel}` : ''} × {l.unshipped}
                {l.stage === 'stock_check' && <span className="ml-1 text-xs text-gray-500">(not stock-checked — will be marked in stock)</span>}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div>
        <p className="mb-1 text-xs font-medium text-gray-700">Photo of the parcel / courier receipt, or the supplier&apos;s screenshot</p>
        <FilePicker files={file ? [file] : []} onChange={pickPhoto(setFile)} max={1} accept={PHOTO_TYPES} maxBytes={Infinity}
          label="Add photo" inputLabel="Dispatch photo" icon={<Camera className="h-4 w-4" />} onError={onError} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">Courier (if known)</span>
          <input className={input} maxLength={80} placeholder="e.g. Delhivery" value={courier} onChange={(e) => setCourier(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">Tracking number (if on the photo)</span>
          <input className={input} maxLength={80} value={tracking} onChange={(e) => setTracking(e.target.value)} />
        </label>
      </div>
      <button type="submit" disabled={busy || !file || !selected.length} className={primary}>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {shippable.length > 1 && allChosen ? 'Upload proof & ship all items'
          : shippable.length > 1 ? `Upload proof & ship ${selected.length} of ${shippable.length} items` : 'Upload proof & mark shipped'}
      </button>
    </form>
  );
}

/**
 * Procurement (or admin): items from our own warehouse. No supplier, so no supplier
 * payment: the courier and tracking number (and, if wanted, a photo of the packed
 * parcel) and the chosen items are dispatched — operations follows them from there.
 * Starts with every "Our Warehouse" item ticked, like the supplier form.
 */
function OwnStockForm({ order, onShipped, onError }: { order: WorkOrder; onShipped: (r: OrderResponse) => void; onError: (m: string) => void }) {
  const ours = order.lines.filter((l) => l.actions.includes('dispatch_own') && l.unshipped > 0);
  const [selected, setSelected] = useState<string[]>(ours.map((l) => l.itemId));
  const [file, setFile] = useState<File | null>(null);
  const [courier, setCourier] = useState('');
  const [tracking, setTracking] = useState('');
  const [busy, setBusy] = useState(false);
  const allChosen = ours.every((l) => selected.includes(l.itemId));
  const ready = !!courier.trim() && !!tracking.trim() && selected.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!courier.trim() || !tracking.trim()) { onError('Enter the courier name and the tracking number.'); return; }
    if (!selected.length) { onError('Choose at least one item in this parcel.'); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('courierName', courier.trim());
      form.append('trackingNumber', tracking.trim());
      form.append('itemIds', JSON.stringify(selected));
      if (file) form.append('photo', await shrinkPhoto(file), 'parcel.jpg');
      onShipped(await postForm<OrderResponse>(`/staff/work/orders/${order.id}/dispatch-own`, form));
    } catch (err) {
      onError(errorMessage(err, 'Could not dispatch. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (!ours.length) return null;
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-teal-200 bg-teal-50/40 p-4" aria-label="Dispatch from our warehouse">
      <p className="flex items-center gap-2 font-semibold text-gray-900"><Warehouse className="h-4 w-4" /> Dispatch from our warehouse</p>
      <p className="text-xs text-gray-600">Our own stock: no supplier and no supplier payment. Add the courier and tracking number — Operations follows it to delivery.</p>
      {order.owesGoodie && <p className="text-xs text-amber-900">Put the free gift in this box — it is recorded as sent with it.</p>}
      {ours.length > 1 && (
        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs font-medium text-gray-700">Items in this parcel</legend>
          <label className="flex items-center gap-2 border-b border-teal-100 pb-1 text-sm font-medium text-gray-900">
            <input type="checkbox" checked={allChosen}
              onChange={(e) => setSelected(e.target.checked ? ours.map((l) => l.itemId) : [])} />
            All items
          </label>
          {ours.map((l) => (
            <label key={l.itemId} className="flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" checked={selected.includes(l.itemId)}
                onChange={(e) => setSelected(e.target.checked ? [...selected, l.itemId] : selected.filter((x) => x !== l.itemId))} />
              <span>{l.name}{l.variantLabel ? ` — ${l.variantLabel}` : ''} × {l.unshipped}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">Courier</span>
          <input className={input} required maxLength={80} placeholder="e.g. Delhivery" value={courier} onChange={(e) => setCourier(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">Tracking number</span>
          <input className={input} required maxLength={80} value={tracking} onChange={(e) => setTracking(e.target.value)} />
        </label>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-gray-700">Photo of the packed parcel (optional)</p>
        <FilePicker files={file ? [file] : []} onChange={pickPhoto(setFile)} max={1} accept={PHOTO_TYPES} maxBytes={Infinity}
          label="Add photo" inputLabel="Parcel photo (optional)" icon={<Camera className="h-4 w-4" />} onError={onError} />
      </div>
      <button type="submit" disabled={busy || !ready} className={primary}>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {ours.length > 1 && allChosen ? 'Dispatch all items'
          : ours.length > 1 ? `Dispatch ${selected.length} of ${ours.length} items` : 'Dispatch'}
      </button>
    </form>
  );
}
