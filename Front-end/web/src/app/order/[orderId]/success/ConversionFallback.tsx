'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle } from 'lucide-react';
import orderService from '@/lib/services/orderService';
import { GOOGLE_ADS_PURCHASE_SEND_TO } from '@/lib/googleAds';
import { buildPurchasePayload } from './purchase';
import PurchaseTracker, { type PurchasePayload } from './PurchaseTracker';

/**
 * Client-side fallback when the server render couldn't fetch the order.
 *
 * The server component forwards the httpOnly access token as a Bearer header and
 * cannot refresh it if it has expired — a real risk in the moment right after
 * payment. Rather than redirect away (which silently drops the conversion), we
 * re-fetch through the browser API client, which DOES refresh + resend cookies,
 * then fire the (payment-gated) conversion. Reuses the same payload builder and
 * tracker as the happy path, so units/gating stay identical.
 */
export default function ConversionFallback({ orderId }: { orderId: string }) {
  const [payload, setPayload] = useState<PurchasePayload | null>(null);
  const [meta, setMeta] = useState<{ paymentStatus?: string; status?: string }>({});

  useEffect(() => {
    let active = true;
    orderService
      .getOrderById(orderId)
      .then((order) => {
        if (!active) return;
        const o = order as unknown as { paymentStatus?: string; status?: string };
        setPayload(buildPurchasePayload(order as never, GOOGLE_ADS_PURCHASE_SEND_TO));
        setMeta({ paymentStatus: o.paymentStatus, status: o.status });
      })
      .catch(() => {
        // Still unauthorized / not the owner / not found — just show the link.
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  return (
    <div className="min-h-screen bg-obsidian-deep py-16">
      {payload && (
        <PurchaseTracker
          orderId={orderId}
          purchase={payload}
          paymentStatus={meta.paymentStatus}
          orderStatus={meta.status}
        />
      )}
      <div className="max-w-2xl mx-auto px-4 text-center">
        <div className="bg-green-500/10 border border-green-500/30 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
          <CheckCircle className="h-12 w-12 text-green-400" />
        </div>
        <h1 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-3">
          Thank you for your order
        </h1>
        <p className="text-ink/70 font-display mb-8">Your order is confirmed and being processed.</p>
        <Link
          href={`/orders/${orderId}`}
          className="bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors"
        >
          View Order Details
        </Link>
      </div>
    </div>
  );
}
