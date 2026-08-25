'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import apiClient from '@/lib/api';
import { formatDateTimeIST } from '@/lib/datetime';

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
}

export default function PackingSlipPage() {
  const { id } = useParams<{ id: string }>();
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
  // A physical goodie that is still owed. Coupons and karma need no picking, and a voided
  // reward must never be printed as something to pack.
  const reward = order.spinReward && !order.spinReward.voidedAt && order.spinReward.kind === 'goodie'
    ? order.spinReward
    : null;

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

      {/*
        Printed ABOVE the items, not below. A picker works top-to-bottom and stops when the
        list is satisfied; anything after the last item is the thing that gets missed.
      */}
      {reward && (
        <div className="mt-5 border-[3px] border-black p-4">
          <div className="text-[11px] font-black uppercase tracking-[0.2em]">
            ★ Free gift — add to this parcel
          </div>
          <div className="mt-1.5 text-xl font-bold">{reward.name}</div>
          {reward.sku && (
            <div className="mt-0.5 text-sm">
              SKU: <span className="font-mono font-bold">{reward.sku}</span>
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="inline-block h-4 w-4 border-2 border-black" aria-hidden />
            <span>Tick when the gift is in the box</span>
          </div>
        </div>
      )}

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-2">Item</th>
            <th className="py-2 w-20 text-center">Qty</th>
            <th className="py-2 w-16 text-center">✓</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, i) => {
            const product = typeof item.product === 'object' && item.product ? item.product : null;
            return (
              <tr key={i} className="border-b border-gray-300">
                <td className="py-2.5">
                  <div className="font-medium">{item.name || product?.name || 'Item'}</div>
                  {item.variantLabel && <div className="text-xs text-gray-600">{item.variantLabel}</div>}
                  {product?.sku && <div className="font-mono text-xs text-gray-600">{product.sku}</div>}
                </td>
                <td className="py-2.5 text-center font-bold">{item.quantity}</td>
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
