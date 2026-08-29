'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import apiClient from '@/lib/api';
import { formatDateTimeIST } from '@/lib/datetime';
import { buildOrderLines } from '@/lib/orderLines';

/**
 * Printable packing slip.
 *
 * Deliberately a PRINT VIEW, not a generated PDF. The codebase has one pdfkit pipeline
 * (services/invoiceService.js) and it exists for a GST invoice — a legal financial
 * document with a monotonic number, Cloudinary storage and an idempotent email. A packing
 * slip needs none of that: it is a disposable sheet a human reads once at a shelf and
 * throws away. Building a second PDF service to produce it would add storage, numbering
 * and a delivery path for something that only ever needs `Cmd+P`.
 *
 * The Spin-to-Win goodie is the reason this page exists at all: the admin banner and the
 * packing queue both live on a screen, and the person picking stock is looking at paper.
 * So the goodie is printed FIRST, above the items, in a box that survives black-and-white.
 *
 * Money is deliberately absent. A packing slip that shows prices ends up in the customer's
 * parcel acting as an invoice, and this one carries a free item that was never charged for
 * — which is exactly how a "why was I billed for this?" support ticket gets created.
 */

interface SlipItem {
  name?: string;
  quantity: number;
  variantLabel?: string | null;
  product?: { name?: string; sku?: string } | string | null;
}

interface SlipOrder {
  _id: string;
  createdAt: string;
  status: string;
  items: SlipItem[];
  shippingAddress: {
    fullName: string; phone: string;
    addressLine1: string; addressLine2?: string;
    city: string; state: string; postalCode: string; country: string;
  };
  spinReward?: {
    name: string; sku: string | null; kind: string;
    fulfilledAt: string | null; voidedAt: string | null;
  } | null;
  shipments?: Array<{
    _id: string;
    sequence: number;
    status: 'packed' | 'shipped' | 'delivered' | 'lost';
    lines?: Array<{ itemId: string; quantity: number }>;
    includesReward?: boolean;
  }>;
}

export default function PackingSlipPage() {
  const { id } = useParams<{ id: string }>();
  /*
    `?shipment=<id>` prints the pick list for ONE parcel.

    Without it a split order printed its whole contents on every slip, so a packer
    building parcel 2 was handed a list including everything already sent in parcel 1 —
    they would either double-ship or have to work out the difference by hand. Omitted
    (the ordinary single-parcel case) still prints the whole order exactly as before.
  */
  const shipmentId = useSearchParams().get('shipment');
  const [order, setOrder] = useState<SlipOrder | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get<{ order: SlipOrder }>(`/orders/${id}`);
        setOrder(res.order);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>;
  if (!order) return <div className="p-8 text-gray-500">Order not found.</div>;

  const a = order.shippingAddress;
  /*
    Pick list = paid items + the won goodie, as one list.

    `audience: 'customer'` deliberately, even though this is an admin screen: it drops a
    VOIDED reward entirely, and a withdrawn gift must never be PRINTED as something to
    pack. (The on-screen order page uses 'admin' instead, where a do-not-pack line can
    still be read and understood. Paper cannot be un-read.)
  */
  const allLines = buildOrderLines(order, { audience: 'customer' });
  const parcel = shipmentId
    ? (order.shipments || []).find((sh) => String(sh._id) === String(shipmentId))
    : null;

  // Narrow to the parcel's own contents when one was requested. The gift is listed only
  // on the slip for the box that actually carries it.
  const lines = parcel
    ? (() => {
        const qty = new Map((parcel.lines || []).map((l) => [String(l.itemId), l.quantity]));
        const picked = allLines
          .filter((l) => l.kind === 'sale' && qty.has(String(l.itemId)))
          .map((l) => ({ ...l, quantity: qty.get(String(l.itemId)) as number }));
        if (parcel.includesReward) {
          const gift = allLines.find((l) => l.kind === 'reward');
          if (gift) picked.push(gift);
        }
        return picked;
      })()
    : allLines;

  // A parcel id that matches nothing must NOT silently fall back to the whole order —
  // that is exactly the double-ship this feature exists to prevent.
  if (shipmentId && !parcel) {
    return (
      <div className="p-8 text-gray-600">
        That parcel isn&apos;t on this order.{' '}
        <a href={`/admin/orders/${order._id}`} className="text-blue-600 hover:underline">Back to order</a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 text-black print:p-0">
      <style>{`
        @media print {
          /* Chrome prints backgrounds off by default; the reward box relies on its
             border and heavy type rather than fill, so it survives either way. */
          @page { size: A4; margin: 14mm; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print mb-6 flex items-center justify-between border-b pb-4">
        <a href={`/admin/orders/${order._id}`} className="text-sm text-blue-600 hover:underline">
          ← Back to order
        </a>
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          🖨 Print packing slip
        </button>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">PACKING SLIP</h1>
          <p className="mt-1 text-sm">
            Order <strong>#{order._id.slice(-8).toUpperCase()}</strong>
            {parcel && (
              <> · <strong>Parcel {parcel.sequence}</strong> of {(order.shipments || []).filter((sh) => sh.status !== 'lost').length}</>
            )}
          </p>
          <p className="text-xs text-gray-600">{formatDateTimeIST(order.createdAt)}</p>
        </div>
        <div className="text-right text-sm">
          <div className="font-bold">Autobacs India</div>
          <div className="text-xs text-gray-600">autobacsindia.com</div>
        </div>
      </div>

      <div className="mt-6 border-t border-b border-black py-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-600">Ship to</div>
        <div className="mt-1 text-sm leading-relaxed">
          <div className="font-semibold">{a.fullName}</div>
          <div>{a.addressLine1}{a.addressLine2 ? `, ${a.addressLine2}` : ''}</div>
          <div>{a.city}, {a.state} {a.postalCode}</div>
          <div>{a.country}</div>
          <div className="mt-1">📞 {a.phone}</div>
        </div>
      </div>

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-2">Item</th>
            <th className="py-2 w-20 text-center">Qty</th>
            <th className="py-2 w-16 text-center">✓</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const isReward = line.kind === 'reward';
            return (
              <tr
                key={line.itemId ?? `line-${i}`}
                className={isReward ? 'border-b-2 border-black' : 'border-b border-gray-300'}
              >
                <td className="py-2.5">
                  <div className={isReward ? 'text-base font-black' : 'font-medium'}>
                    {isReward && '★ '}{line.name || 'Item'}
                  </div>
                  {isReward && (
                    <div className="text-[11px] font-black uppercase tracking-[0.2em]">
                      Free gift — add to this parcel
                    </div>
                  )}
                  {line.variantLabel && <div className="text-xs text-gray-600">{line.variantLabel}</div>}
                  {line.sku && (
                    <div className="font-mono text-xs text-gray-600">SKU: {line.sku}</div>
                  )}
                  {isReward && !line.sku && (
                    <div className="text-xs font-bold">
                      No SKU on this prize — ask before packing.
                    </div>
                  )}
                </td>
                <td className="py-2.5 text-center font-bold">{line.quantity}</td>
                <td className="py-2.5 text-center">
                  <span className="inline-block h-4 w-4 border-2 border-black" aria-hidden />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-6 text-center text-[10px] text-gray-500">
        This is a packing slip, not a tax invoice. Prices are intentionally omitted.
      </p>
    </div>
  );
}
