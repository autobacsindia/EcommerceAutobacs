'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Package, Truck, CheckCircle2, Clock } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatLongDateIST } from '@/lib/datetime';

/**
 * Customer — "where are my things?" for an order that shipped in more than one box.
 *
 * Renders nothing for the ordinary single-parcel order: the existing tracking panel
 * already says everything there is to say, and a "Parcel 1 of 1" card would be noise.
 * It earns its place only when the honest answer is "some of it has shipped" — which is
 * exactly the case the old single-tracking-number model could not express, and the case
 * where a customer opening a short box otherwise assumes something was lost.
 */

interface ShipmentLine {
  itemId: string;
  quantity: number;
}

interface Shipment {
  _id: string;
  sequence: number;
  status: 'packed' | 'shipped' | 'delivered' | 'lost';
  lines: ShipmentLine[];
  includesReward: boolean;
  trackingNumber?: string;
  carrier?: { name?: string; trackingUrl?: string };
  estimatedDelivery?: string;
  deliveredAt?: string;
}

interface RemainingLine {
  itemId: string;
  name: string | null;
  quantity: number;
}

interface Summary {
  totalUnits: number;
  shippedUnits: number;
  parcelCount: number;
  owesGoodie: boolean;
  rewardShipped: boolean;
  fullyShipped: boolean;
  fullyDelivered: boolean;
  partial: boolean;
  label: string;
}

interface Props {
  orderId: string;
  itemNames: Record<string, string>;
  rewardName?: string | null;
  cardClass: string;
}

const STATUS_COPY: Record<Shipment['status'], { label: string; className: string }> = {
  packed:    { label: 'Getting ready',  className: 'text-ink-muted' },
  shipped:   { label: 'On its way',     className: 'text-gold' },
  delivered: { label: 'Delivered',      className: 'text-green-400' },
  lost:      { label: 'Delayed',        className: 'text-red-400' },
};

export default function OrderParcels({ orderId, itemNames, rewardName, cardClass }: Props) {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [remaining, setRemaining] = useState<RemainingLine[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<{ shipments: Shipment[]; remaining: RemainingLine[]; summary: Summary }>(
        API_ENDPOINTS.ORDER_SHIPMENTS(orderId))
      .then((res) => {
        if (cancelled) return;
        setShipments(res.shipments || []);
        setRemaining(res.remaining || []);
        setSummary(res.summary || null);
      })
      // Silent: this panel is additive. The order page must still render in full if
      // the fulfilment lookup fails.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [orderId]);

  // Only worth showing when the order genuinely arrives in pieces.
  const visible = shipments.filter((s) => s.status !== 'lost');
  if (visible.length < 2) return null;

  /*
    Contents as {key, label} rather than bare strings. The label alone was used as the
    React key, so two lines that happen to render identically (the same product name
    across two order lines — different variants, or a re-added item) would collide and
    React would drop one of them silently.
  */
  const contentsOf = (shipment: Shipment) => {
    const parts = shipment.lines.map((l) => ({
      key: String(l.itemId),
      label: `${itemNames[String(l.itemId)] || 'Item'} × ${l.quantity}`,
    }));
    if (shipment.includesReward && rewardName) {
      parts.push({ key: 'reward', label: `🎁 ${rewardName} × 1` });
    }
    return parts;
  };

  const stillComing = [
    ...remaining.map((l) => ({ key: String(l.itemId), label: `${l.name || 'Item'} × ${l.quantity}` })),
    ...(summary?.owesGoodie && !summary.rewardShipped && rewardName
      ? [{ key: 'reward', label: `🎁 ${rewardName} × 1` }]
      : []),
  ];

  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h3 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest">
          Your parcels
        </h3>
        {summary && (
          <span className="text-xs font-display text-gold uppercase tracking-widest">
            {summary.label}
          </span>
        )}
      </div>

      <p className="text-sm text-ink-muted mb-6">
        This order is arriving in {visible.length} separate parcels. Each one has its own
        tracking, so they may not turn up on the same day.
      </p>

      <div className="space-y-4">
        {visible.map((shipment, i) => {
          const copy = STATUS_COPY[shipment.status];
          /*
            Position among LIVE parcels, not `shipment.sequence`. Sequence is a permanent
            id assigned at creation; once a parcel is written off as lost, sequence 2 of
            two remaining boxes renders as the nonsense "Parcel 2 of 1".
          */
          const position = i + 1;
          return (
            <div key={shipment._id} className="border border-hairline rounded-sm p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-display font-bold text-ink text-sm uppercase tracking-widest">
                  Parcel {position} of {visible.length}
                </span>
                <span className={`flex items-center gap-1 text-xs font-display font-bold uppercase tracking-widest ${copy.className}`}>
                  {shipment.status === 'delivered' ? <CheckCircle2 className="h-3.5 w-3.5" />
                    : shipment.status === 'shipped' ? <Truck className="h-3.5 w-3.5" />
                    : <Clock className="h-3.5 w-3.5" />}
                  {copy.label}
                </span>
              </div>

              <ul className="mt-2 space-y-0.5">
                {contentsOf(shipment).map((line) => (
                  <li key={line.key} className="flex items-center gap-2 text-sm text-ink/70">
                    <Package className="h-3.5 w-3.5 text-ink-muted" />
                    {line.label}
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
                {shipment.trackingNumber && (
                  <span>
                    Tracking: {shipment.carrier?.trackingUrl ? (
                      <Link href={shipment.carrier.trackingUrl} target="_blank"
                            className="font-mono text-gold hover:underline">
                        {shipment.trackingNumber}
                      </Link>
                    ) : (
                      <span className="font-mono text-ink/70">{shipment.trackingNumber}</span>
                    )}
                    {shipment.carrier?.name ? ` · ${shipment.carrier.name}` : ''}
                  </span>
                )}
                {shipment.deliveredAt
                  ? <span className="text-green-400">Delivered {formatLongDateIST(shipment.deliveredAt)}</span>
                  : shipment.estimatedDelivery
                    ? <span>Expected {formatLongDateIST(shipment.estimatedDelivery)}</span>
                    : null}
              </div>
            </div>
          );
        })}

        {/*
          What has not been boxed yet. Without this the customer counts the parcels,
          finds an item missing from all of them, and contacts support.
        */}
        {stillComing.length > 0 && (
          <div className="border border-dashed border-hairline rounded-sm p-4">
            <p className="font-display font-bold text-ink-muted text-xs uppercase tracking-widest mb-2">
              Not shipped yet
            </p>
            <ul className="space-y-0.5">
              {stillComing.map((line) => (
                <li key={line.key} className="flex items-center gap-2 text-sm text-ink/70">
                  <Clock className="h-3.5 w-3.5 text-ink-muted" />
                  {line.label}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
