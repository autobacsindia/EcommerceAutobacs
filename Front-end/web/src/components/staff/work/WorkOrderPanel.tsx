'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle2, Gift, Loader2, MessageCircle, Share2, Truck } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { tokenManager } from '@/lib/http/tokenManager';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { whatsappNumber } from '@/components/staff/sales/PaymentLinkCard';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import { shrinkPhoto, STAGE_TONE, type LineAction, type WorkOrder } from './types';

type OrderResponse = { success: boolean; order: WorkOrder };

const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50';
const primary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const secondary = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const danger = `${btn} border border-red-300 bg-white text-red-700 hover:bg-red-50`;
const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

const REFUND_STATUS: Record<string, string> = {
  pending: 'Waiting for admin to pay',
  processing: 'Refund in progress',
  completed: 'Refunded',
  failed: 'Refund failed — admin will retry',
  not_applicable: 'Nothing to refund',
};

/** Multipart POST (the JSON client can't send files), with the same CSRF header it uses. */
async function postForm<T>(endpoint: string, form: FormData): Promise<T> {
  await tokenManager.ensureCsrfToken();
  const headers = tokenManager.getHeaders() as Record<string, string>;
  delete headers['Content-Type']; // the browser sets the multipart boundary
  const res = await fetch(`/api/v1${endpoint}`, { method: 'POST', body: form, headers, credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.message || 'Upload failed'), { rawData: body });
  return body as T;
}

function shippedMessage(o: WorkOrder, parcel: WorkOrder['parcels'][number]) {
  const first = o.customer.name.trim().split(/\s+/)[0] || 'there';
  return [
    `Hi ${first}, your Autobacs India order ${o.orderNumber} has been shipped${parcel.courier ? ` via ${parcel.courier}` : ''}.`,
    parcel.trackingNumber ? `Tracking number: ${parcel.trackingNumber}` : null,
    'We have shared a photo of your parcel. Thank you for shopping with us!',
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
  const [supplierFor, setSupplierFor] = useState<string | null>(null);
  const [supplier, setSupplier] = useState('');
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
    onSuccess: (res) => { done(res); setSupplierFor(null); setSupplier(''); setNoteFor(null); setNote(''); },
    onError: (e) => setError(errorMessage(e, 'That did not work. Please try again.')),
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
        {has('ordered') && <button type="button" disabled={busy} className={secondary}
          onClick={() => { setSupplierFor(line.itemId); setSupplier(line.supplierName || ''); }}>Ordered from supplier</button>}
        {has('out_of_stock') && <button type="button" disabled={busy} className={danger}
          onClick={() => { if (window.confirm(`Mark "${line.name}" out of stock? The sales team will ask the customer to wait or take a refund.`)) act.mutate({ path: `${path}/stock`, body: { stock: 'out_of_stock' } }); }}>Out of stock</button>}
        {has('payment_initiated') && <button type="button" disabled={busy} className={primary}
          onClick={() => act.mutate({ path: `${path}/payment`, body: { initiated: true } })}>Payment initiated</button>}
        {has('payment_undo') && <button type="button" disabled={busy} className={secondary}
          onClick={() => { if (window.confirm(`Remove the "Payment initiated" mark from "${line.name}"?`)) act.mutate({ path: `${path}/payment`, body: { initiated: false } }); }}>Undo payment</button>}
        {has('wait') && <button type="button" disabled={busy} className={secondary}
          onClick={() => act.mutate({ path: `${path}/decision`, body: { decision: 'wait' } })}>Customer will wait</button>}
        {has('refund') && <button type="button" disabled={busy} className={danger}
          onClick={() => { if (window.confirm('The customer wants a refund for this item? Accounts will review it.')) act.mutate({ path: `${path}/decision`, body: { decision: 'refund' } }); }}>Customer wants refund</button>}
        {has('approve') && <button type="button" disabled={busy} className={primary}
          onClick={() => { if (window.confirm(`Approve the refund for "${line.name}"? It will be cancelled, and an admin will pay the refund.`)) act.mutate({ path: `${path}/refund`, body: { approve: true } }); }}>Approve refund</button>}
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
          <p className="break-all text-gray-700">{o.customer.email}</p>
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
                  <p className="font-medium text-gray-900">{line.name}{line.variantLabel ? ` — ${line.variantLabel}` : ''} <span className="font-normal text-gray-500">× {line.quantity}</span></p>
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
              {supplierFor === line.itemId && (
                <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); act.mutate({ path: `/lines/${line.itemId}/stock`, body: { stock: 'ordered', supplierName: supplier.trim() } }); }}>
                  <input className={`${input} max-w-xs`} autoFocus required maxLength={120} placeholder="Supplier name" value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label="Supplier name" />
                  <button type="submit" disabled={busy || !supplier.trim()} className={primary}>Save</button>
                  <button type="button" className={secondary} onClick={() => setSupplierFor(null)}>Cancel</button>
                </form>
              )}
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
                    <img src={p.photoUrl} alt={`Supplier photo for parcel ${p.sequence}`} className="h-28 w-28 rounded-lg border border-gray-200 object-cover" loading="lazy" />
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
                    {p.canMarkDelivered && (
                      <button type="button" disabled={busy} className={primary}
                        onClick={() => { if (window.confirm(`Mark parcel ${p.sequence} delivered? The customer will get the delivered email.`)) act.mutate({ path: '/delivered', body: { shipmentId: p.id } }); }}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Mark delivered
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Refunds */}
      {o.cancellations.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Refunds</p>
          <ul className="space-y-2">
            {o.cancellations.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-3">
                <span className="text-gray-800">{c.items.map((i) => `${i.name} × ${i.quantity}`).join(', ')}</span>
                <span className="text-xs font-medium text-gray-700">
                  {c.refundAmount != null && `${rupees(c.refundAmount)} · `}{REFUND_STATUS[c.refundStatus || ''] || c.refundStatus}
                </span>
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

/** Procurement: the supplier's photo (+ courier and tracking) → the order is shipped. */
function ShipForm({ order, onShipped, onError }: { order: WorkOrder; onShipped: (r: OrderResponse) => void; onError: (m: string) => void }) {
  const shippable = order.lines.filter((l) => l.actions.includes('ship') && l.unshipped > 0);
  const [selected, setSelected] = useState<string[]>(shippable.map((l) => l.itemId));
  const [file, setFile] = useState<File | null>(null);
  const [courier, setCourier] = useState('');
  const [tracking, setTracking] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { onError('Add the supplier\'s photo or screenshot.'); return; }
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
      <p className="flex items-center gap-2 font-semibold text-gray-900"><Truck className="h-4 w-4" /> Supplier has dispatched — upload proof</p>
      {shippable.length > 1 && (
        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs font-medium text-gray-700">Items in this parcel</legend>
          {shippable.map((l) => (
            <label key={l.itemId} className="flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" checked={selected.includes(l.itemId)}
                onChange={(e) => setSelected(e.target.checked ? [...selected, l.itemId] : selected.filter((x) => x !== l.itemId))} />
              {l.name}{l.variantLabel ? ` — ${l.variantLabel}` : ''} × {l.unshipped}
            </label>
          ))}
        </fieldset>
      )}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-700">Photo or screenshot from the supplier</span>
        <span className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-gray-500" />
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" aria-label="Supplier photo" />
        </span>
      </label>
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
      <button type="submit" disabled={busy || !file} className={primary}>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Upload proof &amp; mark shipped
      </button>
    </form>
  );
}
