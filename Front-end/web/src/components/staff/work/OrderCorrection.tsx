'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, PencilLine } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { errorMessage } from '@/components/staff/sales/types';
import type { WorkOrder } from './types';

type OrderResponse = { success: boolean; order: WorkOrder };
type Action = 'dispatched' | 'delivered' | 'parcel' | 'back_to_new' | 'undeliver';

const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50';
const primary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const secondary = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-medium text-gray-700';

/** Same limits as the server (utils/orderCorrection.js). */
const MIN_REASON = 5;
const MAX_REASON = 300;

const ACTIONS: { id: Action; title: string; hint: string }[] = [
  { id: 'dispatched', title: 'Mark as dispatched', hint: 'It has already left — courier, tracking and date if you know them. No photo needed.' },
  { id: 'delivered', title: 'Mark as delivered', hint: 'The customer already has it.' },
  { id: 'parcel', title: 'Fix courier / tracking / dates', hint: 'On a dispatched or delivered parcel.' },
  { id: 'back_to_new', title: 'Move back to New Order', hint: 'A stock step was recorded by mistake.' },
  { id: 'undeliver', title: 'Delivered → back to Dispatched', hint: 'It was marked delivered by mistake.' },
];

/** Today in India, as the date inputs' upper limit. */
const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const dayOf = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10) : '');

/**
 * "Edit order" — procurement (and the admin) bring an order handled outside the panel
 * (on Google Chat, before the panel existed) up to date. Only what the server offers
 * (`order.corrections`) is shown, every change needs a reason, and the server refuses
 * it if the order changed since it was opened. The customer is not told.
 */
export default function OrderCorrection({ order, onDone }: { order: WorkOrder; onDone: (res: OrderResponse) => void }) {
  const c = order.corrections;
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [items, setItems] = useState<string[]>([]);
  const [parcels, setParcels] = useState<string[]>([]);
  const [courier, setCourier] = useState('');
  const [tracking, setTracking] = useState('');
  const [shippedOn, setShippedOn] = useState('');
  const [deliveredOn, setDeliveredOn] = useState('');
  const [gift, setGift] = useState(true);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => apiClient.post<OrderResponse>(`/staff/work/orders/${order.id}/correct`, {
      action,
      reason: reason.trim(),
      itemIds: items,
      shipmentIds: parcels,
      // What this screen showed: the server refuses the change if any of it moved since.
      expectedStages: Object.fromEntries(order.lines.map((l) => [l.itemId, l.stage])),
      expectedParcels: Object.fromEntries(order.parcels.map((p) => [p.id, p.status])),
      ...((action === 'dispatched' || action === 'delivered' || action === 'parcel') && { courierName: courier.trim(), trackingNumber: tracking.trim() }),
      ...(shippedOn && { shippedOn }),
      ...(deliveredOn && { deliveredOn }),
      ...(order.owesGoodie && { includesGift: gift }),
    }),
    onSuccess: (res) => { reset(); setOpen(false); onDone(res); },
    onError: (e) => setError(errorMessage(e, 'Could not save the correction. Please try again.')),
  });

  if (!c) return null;

  const available: Record<Action, boolean> = {
    dispatched: c.dispatch.length > 0,
    delivered: c.dispatch.length > 0 || c.inTransit.length > 0,
    parcel: c.parcels.length > 0,
    back_to_new: c.back.length > 0,
    undeliver: c.delivered.length > 0,
  };
  const name = (itemId: string) => {
    const l = order.lines.find((x) => x.itemId === itemId);
    return l ? `${l.name}${l.variantLabel ? ` — ${l.variantLabel}` : ''} × ${l.quantity}` : 'Item';
  };
  const stageOf = (itemId: string) => order.lines.find((x) => x.itemId === itemId)?.stageLabel || '';
  const parcel = (id: string) => order.parcels.find((p) => p.id === id);
  const parcelText = (id: string) => {
    const p = parcel(id);
    return p ? `Parcel ${p.sequence}: ${p.items.map((i) => `${i.name} × ${i.quantity}`).join(', ')}${p.courier || p.trackingNumber ? ` · ${[p.courier, p.trackingNumber].filter(Boolean).join(' ')}` : ''}` : 'Parcel';
  };

  function reset() {
    setAction(null); setItems([]); setParcels([]); setCourier(''); setTracking('');
    setShippedOn(''); setDeliveredOn(''); setGift(true); setReason(''); setError('');
  }

  function choose(next: Action) {
    reset();
    setAction(next);
    // Dispatch / deliver start with everything ticked (the usual case: the whole order went);
    // going back starts with nothing, so it is always a deliberate choice.
    if (next === 'dispatched') setItems(c!.dispatch);
    if (next === 'delivered') { setItems(c!.dispatch); setParcels(c!.inTransit); }
    if (next === 'parcel' && c!.parcels.length === 1) pickParcel(c!.parcels[0]);
    if (next === 'undeliver' && c!.delivered.length === 1) setParcels(c!.delivered);
  }

  function pickParcel(id: string) {
    const p = parcel(id);
    setParcels([id]);
    setCourier(p?.courier || '');
    setTracking(p?.trackingNumber || '');
    setShippedOn(dayOf(p?.shippedAt ?? null));
    setDeliveredOn(p?.status === 'delivered' ? dayOf(p.deliveredAt) : '');
  }

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const newParcel = (action === 'dispatched' || action === 'delivered') && items.length > 0;
  const chosen = action === 'parcel' || action === 'undeliver' ? parcels.length === 1 : items.length + parcels.length > 0;
  const ready = !!action && chosen && reason.trim().length >= MIN_REASON;
  const today = todayIST();
  // Nothing can have left before the order was placed (the server refuses it too).
  const first = dayOf(order.createdAt);
  const fixing = action === 'parcel' ? parcel(parcels[0] ?? '') : undefined;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" className={secondary} onClick={() => setOpen(true)}>
          <PencilLine className="h-3.5 w-3.5" /> Edit order
        </button>
        <span className="text-xs text-gray-500">For orders handled outside this panel, e.g. on Google Chat.</span>
      </div>
    );
  }

  const checkbox = (id: string, text: string, list: string[], set: (v: string[]) => void, sub?: string) => (
    <label key={id} className="flex items-start gap-2 text-sm text-gray-800">
      <input type="checkbox" className="mt-0.5" checked={list.includes(id)} onChange={() => toggle(list, set, id)} />
      <span>{text}{sub && <span className="ml-1 text-xs text-gray-500">({sub})</span>}</span>
    </label>
  );
  const radio = (id: string, text: string, onPick: () => void) => (
    <label key={id} className="flex items-start gap-2 text-sm text-gray-800">
      <input type="radio" className="mt-0.5" name={`correct-parcel-${order.id}`} checked={parcels[0] === id} onChange={onPick} />
      <span>{text}</span>
    </label>
  );

  return (
    <form
      className="space-y-4 rounded-lg border border-gray-300 bg-gray-50 p-4"
      aria-label="Edit order"
      onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}
    >
      <div>
        <p className="flex items-center gap-2 font-semibold text-gray-900"><PencilLine className="h-4 w-4" /> Edit order</p>
        <p className="text-xs text-gray-600">
          Bring an order handled outside this panel up to date. The customer is not messaged.
          Payments and refunds are never changed here.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className={label}>What do you want to change?</legend>
        {ACTIONS.filter((x) => available[x.id]).map((x) => (
          <label key={x.id} className="flex items-start gap-2 text-sm text-gray-900">
            <input type="radio" className="mt-0.5" name={`correct-action-${order.id}`} checked={action === x.id} onChange={() => choose(x.id)} />
            <span><span className="font-medium">{x.title}</span> <span className="text-xs text-gray-500">— {x.hint}</span></span>
          </label>
        ))}
      </fieldset>

      {(action === 'dispatched' || action === 'delivered' || action === 'back_to_new') && (action !== 'delivered' || c.dispatch.length > 0) && (
        <fieldset className="space-y-1">
          <legend className={label}>{action === 'back_to_new' ? 'Items to move back to New Order' : 'Items not yet dispatched here'}</legend>
          {(action === 'back_to_new' ? c.back : c.dispatch).map((id) => checkbox(id, name(id), items, setItems, stageOf(id)))}
        </fieldset>
      )}

      {action === 'delivered' && c.inTransit.length > 0 && (
        <fieldset className="space-y-1">
          <legend className={label}>Parcels on their way</legend>
          {c.inTransit.map((id) => checkbox(id, parcelText(id), parcels, setParcels))}
        </fieldset>
      )}

      {action === 'parcel' && (
        <fieldset className="space-y-1">
          <legend className={label}>Which parcel?</legend>
          {c.parcels.map((id) => radio(id, `${parcelText(id)}${parcel(id)?.status === 'delivered' ? ' · delivered' : ' · on its way'}`, () => pickParcel(id)))}
        </fieldset>
      )}

      {action === 'undeliver' && (
        <fieldset className="space-y-1">
          <legend className={label}>Which parcel?</legend>
          {c.delivered.map((id) => radio(id, parcelText(id), () => setParcels([id])))}
        </fieldset>
      )}

      {(newParcel || (action === 'parcel' && fixing)) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Courier{action !== 'parcel' && ' (if known)'}</span>
            <input className={input} maxLength={80} placeholder="e.g. Delhivery" value={courier} onChange={(e) => setCourier(e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>Tracking number{action !== 'parcel' && ' (if known)'}</span>
            <input className={input} maxLength={80} value={tracking} onChange={(e) => setTracking(e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>Dispatch date{action !== 'parcel' && ' (if known)'}</span>
            <input type="date" className={input} min={first} max={today} value={shippedOn} onChange={(e) => setShippedOn(e.target.value)} />
          </label>
          {action === 'parcel' && fixing?.status === 'delivered' && (
            <label className="block">
              <span className={label}>Delivery date</span>
              <input type="date" className={input} min={first} max={today} value={deliveredOn} onChange={(e) => setDeliveredOn(e.target.value)} />
            </label>
          )}
        </div>
      )}

      {action === 'delivered' && chosen && (
        <label className="block sm:max-w-[50%] sm:pr-1.5">
          <span className={label}>Delivery date</span>
          <input type="date" className={input} min={first} max={today} value={deliveredOn} onChange={(e) => setDeliveredOn(e.target.value)} />
          <span className="mt-1 block text-xs text-gray-500">Leave empty for today. The customer&apos;s return window counts from this date.</span>
        </label>
      )}

      {newParcel && order.owesGoodie && (
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} />
          The free gift went in this parcel
        </label>
      )}

      {action && (
        <label className="block">
          <span className={label}>Why? (kept in the order history with your name)</span>
          <textarea className={input} rows={2} maxLength={MAX_REASON} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Sent via Google Chat on 3 March" />
        </label>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!ready || save.isPending} className={primary}>
          {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save correction
        </button>
        <button type="button" className={secondary} onClick={() => { reset(); setOpen(false); }}>Cancel</button>
      </div>
    </form>
  );
}
