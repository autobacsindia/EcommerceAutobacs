'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Package, Truck, CheckCircle2, AlertTriangle } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatLongDateIST } from '@/lib/datetime';
import { OTHER_CARRIER_CODE } from '@/lib/orderStatusUpdate';

/**
 * Admin — the parcels an order left in.
 *
 * An order can ship in several boxes (stock arrives at different times, an oversized
 * item goes by another courier). This panel is where an admin builds each one: pick
 * what goes in it, give it a courier and an AWB, and mark it delivered when it lands.
 *
 * ⚠️ The order's overall status is DERIVED from these parcels server-side
 * (Back-end/server/utils/orderFulfilment.js) — this screen never sets it directly. That
 * is also why the won goodie appears here as a line you can tick into a box: until it
 * is in one, the order cannot reach "delivered", which is what replaced the old
 * "don't forget the goodie" banner.
 */

interface Carrier {
  name: string;
  code: string;
  estimatedDeliveryDays?: number;
  custom?: boolean;
}

interface ShipmentLine {
  itemId: string;
  quantity: number;
}

export interface Shipment {
  _id: string;
  sequence: number;
  status: 'packed' | 'shipped' | 'delivered' | 'lost';
  lines: ShipmentLine[];
  includesReward: boolean;
  trackingNumber?: string;
  carrier?: { name?: string; code?: string; trackingUrl?: string };
  estimatedDelivery?: string;
  shippedAt?: string;
  deliveredAt?: string;
  notes?: string;
}

interface RemainingLine {
  itemId: string;
  name: string | null;
  quantity: number;
}

interface FulfilmentSummary {
  totalUnits: number;
  shippedUnits: number;
  deliveredUnits: number;
  parcelCount: number;
  owesGoodie: boolean;
  rewardShipped: boolean;
  fullyShipped: boolean;
  fullyDelivered: boolean;
  partial: boolean;
  label: string;
}

interface Props {
  /**
   * Bumped by the parent when the admin picks "Shipped" from the status dropdown.
   * A counter rather than a boolean so a second pick re-opens the form even if it was
   * closed in between — a boolean would latch and the second attempt would do nothing.
   */
  openFormSignal?: number;
  orderId: string;
  /** Order line names, so a parcel can show what is in it rather than raw ids. */
  itemNames: Record<string, string>;
  /** Name of the won goodie, when the order owes one. */
  rewardName?: string | null;
  /** Called after any change, so the parent can refetch the order's derived status. */
  onChanged?: () => void;
}

const STATUS_STYLE: Record<Shipment['status'], string> = {
  packed: 'bg-gray-100 text-gray-800',
  shipped: 'bg-purple-100 text-purple-800',
  delivered: 'bg-green-100 text-green-800',
  lost: 'bg-red-100 text-red-800',
};

export default function OrderShipments({ orderId, itemNames, rewardName, onChanged, openFormSignal = 0 }: Props) {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [remaining, setRemaining] = useState<RemainingLine[]>([]);
  const [summary, setSummary] = useState<FulfilmentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Create-parcel form
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [withReward, setWithReward] = useState(false);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [carrierCode, setCarrierCode] = useState('');
  const [carrierName, setCarrierName] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [eta, setEta] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{
        shipments: Shipment[]; remaining: RemainingLine[]; summary: FulfilmentSummary;
      }>(API_ENDPOINTS.ORDER_SHIPMENTS(orderId));
      setShipments(res.shipments || []);
      setRemaining(res.remaining || []);
      setSummary(res.summary || null);
      // Default the form to "everything that's left" — the common case is shipping
      // the remainder, and pre-filling it makes the zero-thought path the fast one.
      setQty(Object.fromEntries((res.remaining || []).map((l) => [l.itemId, l.quantity])));
      setWithReward(Boolean(res.summary?.owesGoodie) && !res.summary?.rewardShipped);
    } catch {
      /* the panel simply shows nothing; the order page still works */
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  // Opening on the signal, not on mount, so the panel stays collapsed for the ordinary
  // "just looking at the order" visit.
  useEffect(() => {
    // Only if there is actually something left to put in a box. Opening an empty picker
    // on a fully-shipped order would look broken rather than informative.
    if (openFormSignal > 0 && (remaining.length > 0 || (summary?.owesGoodie && !summary.rewardShipped))) {
      setOpen(true);
    }
  }, [openFormSignal, remaining.length, summary?.owesGoodie, summary?.rewardShipped]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiClient
      .get<{ carriers: Carrier[] }>('/orders/tracking/carriers')
      .then((res) => { if (!cancelled) setCarriers(res.carriers || []); })
      .catch(() => { /* the admin can still pick "Other" and type a name */ });
    return () => { cancelled = true; };
  }, [open]);

  const carrierOptions = carriers.some((c) => c.code === OTHER_CARRIER_CODE)
    ? carriers
    : [...carriers, { name: 'Other courier', code: OTHER_CARRIER_CODE, custom: true }];
  const isOtherCarrier = carrierCode === OTHER_CARRIER_CODE;

  const chosenLines = remaining
    .map((l) => ({ itemId: l.itemId, quantity: Number(qty[l.itemId] || 0) }))
    .filter((l) => l.quantity > 0);

  const handleCreate = async () => {
    if (!chosenLines.length && !withReward) {
      toast.error('Pick at least one item for this parcel.');
      return;
    }
    if (!trackingNumber.trim()) {
      toast.error('A tracking number is required.');
      return;
    }
    if (!carrierCode) {
      toast.error('Choose a courier.');
      return;
    }

    setSaving(true);
    try {
      await apiClient.post(API_ENDPOINTS.ORDER_SHIPMENTS(orderId), {
        lines: chosenLines,
        includesReward: withReward,
        trackingNumber: trackingNumber.trim(),
        carrierCode,
        carrierName: isOtherCarrier ? carrierName.trim() : undefined,
        estimatedDelivery: eta || undefined,
      });
      toast.success('Parcel created — the customer has been emailed.');
      setOpen(false);
      setTrackingNumber('');
      setEta('');
      await load();
      onChanged?.();
    } catch (err: any) {
      toast.error(err?.message || 'Could not create the parcel.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Hand a packed parcel to the courier. Without this a `packed` parcel is a dead end:
   * its units are already consumed from the remaining-to-ship pool, so they cannot go in
   * another box, and nothing else moves it on.
   */
  const handleDispatch = async (shipment: Shipment) => {
    setBusyId(shipment._id);
    try {
      await apiClient.patch(API_ENDPOINTS.ORDER_SHIPMENT_DISPATCH(orderId, shipment._id), {});
      toast.success(`Parcel ${shipment.sequence} dispatched — the customer has been emailed.`);
      await load();
      onChanged?.();
    } catch (err: any) {
      toast.error(err?.message || 'Could not dispatch the parcel.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelivered = async (shipment: Shipment) => {
    setBusyId(shipment._id);
    try {
      await apiClient.patch(API_ENDPOINTS.ORDER_SHIPMENT_DELIVERED(orderId, shipment._id), {});
      toast.success(`Parcel ${shipment.sequence} marked delivered.`);
      await load();
      onChanged?.();
    } catch (err: any) {
      toast.error(err?.message || 'Could not mark the parcel delivered.');
    } finally {
      setBusyId(null);
    }
  };

  /*
    {key, label} rather than bare strings: the label was being used as the React key, so
    two order lines that render identically (same product name, different variant) would
    collide and React would silently drop one from the parcel's contents.
  */
  const describe = (shipment: Shipment) => {
    const parts = shipment.lines.map((l) => ({
      key: String(l.itemId),
      label: `${itemNames[String(l.itemId)] || 'Item'} × ${l.quantity}`,
    }));
    if (shipment.includesReward && rewardName) {
      parts.push({ key: 'reward', label: `🎁 ${rewardName} × 1` });
    }
    return parts;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="h-5 w-32 animate-pulse rounded bg-gray-200" />
      </div>
    );
  }

  // Nothing to show and nothing to ship: an order that never reached fulfilment.
  if (!shipments.length && !remaining.length && !summary?.owesGoodie) return null;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex flex-wrap items-center gap-3 border-b p-6">
        <h2 className="text-xl font-semibold">Parcels</h2>
        {summary && (
          <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
            {summary.label}
          </span>
        )}
        {/*
          The goodie gets its own warning because it is the one thing that blocks the
          order from ever reaching "delivered" while it sits on a shelf.
        */}
        {summary?.owesGoodie && !summary.rewardShipped && (
          <span className="flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            Goodie not yet in a parcel
          </span>
        )}
        {(remaining.length > 0 || (summary?.owesGoodie && !summary.rewardShipped)) && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {open ? 'Cancel' : '+ New parcel'}
          </button>
        )}
      </div>

      {open && (
        <div className="border-b bg-gray-50 p-6">
          <p className="mb-3 text-sm font-medium text-gray-700">What goes in this parcel?</p>
          <div className="space-y-2">
            {remaining.map((line) => (
              <div key={line.itemId} className="flex items-center gap-3">
                <input
                  type="number"
                  aria-label={`Quantity of ${line.name || 'item'} in this parcel`}
                  min={0}
                  max={line.quantity}
                  value={qty[line.itemId] ?? 0}
                  onChange={(e) =>
                    setQty((q) => ({
                      ...q,
                      // Clamp here as well as server-side: the server is the authority
                      // on over-shipping, but there is no reason to let someone type 99
                      // and only find out after a round trip.
                      [line.itemId]: Math.max(0, Math.min(line.quantity, Number(e.target.value) || 0)),
                    }))
                  }
                  className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                />
                <span className="text-sm">
                  {line.name || 'Item'}
                  <span className="text-gray-500"> · {line.quantity} left to ship</span>
                </span>
              </div>
            ))}

            {summary?.owesGoodie && !summary.rewardShipped && (
              <label className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm">
                <input
                  type="checkbox"
                  checked={withReward}
                  onChange={(e) => setWithReward(e.target.checked)}
                />
                <span>🎁 Put the goodie{rewardName ? ` (${rewardName})` : ''} in this parcel</span>
              </label>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="parcel-courier" className="mb-1 block text-xs font-medium text-gray-600">Courier</label>
              <select
                id="parcel-courier"
                value={carrierCode}
                onChange={(e) => setCarrierCode(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select a courier…</option>
                {carrierOptions.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </div>
            {isOtherCarrier && (
              <div>
                <label htmlFor="parcel-courier-name" className="mb-1 block text-xs font-medium text-gray-600">Courier name</label>
                <input
                  id="parcel-courier-name"
                  value={carrierName}
                  maxLength={60}
                  onChange={(e) => setCarrierName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            )}
            <div>
              <label htmlFor="parcel-tracking" className="mb-1 block text-xs font-medium text-gray-600">Tracking number</label>
              <input
                id="parcel-tracking"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="parcel-eta" className="mb-1 block text-xs font-medium text-gray-600">
                Estimated delivery <span className="text-gray-400">(optional)</span>
              </label>
              <input
                id="parcel-eta"
                type="date"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={saving}
            className="mt-4 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create parcel & notify customer'}
          </button>
        </div>
      )}

      <div className="divide-y">
        {shipments.map((shipment) => (
          <div key={shipment._id} className="p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">Parcel {shipment.sequence}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[shipment.status]}`}>
                {shipment.status}
              </span>
              {shipment.includesReward && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">
                  🎁 carries the goodie
                </span>
              )}
              {/* Per-parcel pick list — prints only what belongs in THIS box. */}
              <a
                href={`/admin/orders/${orderId}/packing-slip?shipment=${shipment._id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                🖨 Slip
              </a>
              {shipment.status === 'packed' && (
                <button
                  onClick={() => handleDispatch(shipment)}
                  disabled={busyId === shipment._id}
                  className="flex items-center gap-1 rounded-lg border border-purple-300 px-3 py-1.5 text-xs font-medium text-purple-800 hover:bg-purple-50 disabled:opacity-50"
                >
                  <Truck className="h-4 w-4" />
                  {busyId === shipment._id ? 'Saving…' : 'Dispatch'}
                </button>
              )}
              {shipment.status === 'shipped' && (
                <button
                  onClick={() => handleDelivered(shipment)}
                  disabled={busyId === shipment._id}
                  className="flex items-center gap-1 rounded-lg border border-green-300 px-3 py-1.5 text-xs font-medium text-green-800 hover:bg-green-50 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {busyId === shipment._id ? 'Saving…' : 'Mark delivered'}
                </button>
              )}
            </div>

            <ul className="mt-2 space-y-0.5 text-sm text-gray-700">
              {describe(shipment).map((line) => (
                <li key={line.key} className="flex items-center gap-2">
                  <Package className="h-3.5 w-3.5 text-gray-400" />
                  {line.label}
                </li>
              ))}
            </ul>

            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
              {shipment.trackingNumber && (
                <span className="flex items-center gap-1">
                  <Truck className="h-3.5 w-3.5" />
                  {shipment.carrier?.name ? `${shipment.carrier.name} · ` : ''}
                  {shipment.carrier?.trackingUrl ? (
                    <a href={shipment.carrier.trackingUrl} target="_blank" rel="noopener noreferrer"
                       className="font-mono text-blue-600 hover:underline">
                      {shipment.trackingNumber}
                    </a>
                  ) : (
                    <span className="font-mono">{shipment.trackingNumber}</span>
                  )}
                </span>
              )}
              {shipment.shippedAt && <span>Shipped {formatLongDateIST(shipment.shippedAt)}</span>}
              {shipment.estimatedDelivery && !shipment.deliveredAt && (
                <span>ETA {formatLongDateIST(shipment.estimatedDelivery)}</span>
              )}
              {shipment.deliveredAt && (
                <span className="text-green-700">Delivered {formatLongDateIST(shipment.deliveredAt)}</span>
              )}
            </div>
          </div>
        ))}

        {!shipments.length && (
          <p className="p-6 text-sm text-gray-500">
            Nothing has shipped yet. Create a parcel to send part or all of this order.
          </p>
        )}
      </div>
    </div>
  );
}
