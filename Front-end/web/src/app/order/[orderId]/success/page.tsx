import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { CheckCircle, Package, Truck } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { GOOGLE_ADS_PURCHASE_SEND_TO } from '@/lib/googleAds';
import PurchaseTracker, { type PurchasePayload } from './PurchaseTracker';

// Transactional, per-user page — never index it.
export const metadata: Metadata = {
  title: 'Order Confirmed',
  robots: { index: false, follow: false },
};

// Order details change (payment confirmation lands async via webhook), so this
// page must render per-request with the live auth cookie — never statically.
export const dynamic = 'force-dynamic';

// ── Minimal shape of GET /orders/:id we rely on here ────────────────────────
// NOTE: all money fields are in RUPEES (not paise) — see Order model. The gtag
// value therefore uses the amounts as-is, with NO /100 conversion.
interface OrderItem {
  _id?: string;
  product?: { _id?: string; name?: string; images?: Array<{ url: string }> } | string | null;
  name?: string;
  image?: string;
  price: number; // rupees
  quantity: number;
}

interface OrderResponse {
  success: boolean;
  order: {
    _id: string;
    orderNumber?: string;
    status: string;
    totalAmount: number; // rupees
    items: OrderItem[];
    estimatedDelivery?: string;
    createdAt: string;
  };
}

const inr = (rupees: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(
    rupees || 0,
  );

function itemProductId(item: OrderItem): string {
  if (item.product && typeof item.product === 'object') return item.product._id ?? '';
  if (typeof item.product === 'string') return item.product;
  return '';
}

function itemProductName(item: OrderItem): string {
  if (item.product && typeof item.product === 'object' && item.product.name) return item.product.name;
  return item.name ?? 'Item';
}

export default async function OrderSuccessPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  // Auth is an httpOnly `accessToken` cookie. The backend's protect middleware
  // also accepts it as a Bearer token, which is how serverFetch forwards it.
  const accessToken = (await cookies()).get('accessToken')?.value;
  if (!accessToken) {
    redirect(`/login?redirect=/order/${orderId}/success`);
  }

  let data: OrderResponse;
  try {
    data = await serverFetch<OrderResponse>(`/orders/${orderId}`, {
      token: accessToken,
      // Never cache a user's order response.
      cache: 'no-store',
    });
  } catch {
    // Token expired, not the owner, or not found — fall back to the canonical
    // order page, which handles auth refresh / login redirects client-side.
    redirect(`/orders/${orderId}`);
  }

  const order = data.order;

  // Build the Google Ads purchase payload server-side (single home for the
  // rupee math) and hand it to the client tracker to fire once.
  const purchase: PurchasePayload = {
    // Routes the conversion to the specific Google Ads "Purchase" action.
    // Omitted when not configured (Preview/local) so the event stays a harmless
    // generic purchase and never counts against the live conversion action.
    ...(GOOGLE_ADS_PURCHASE_SEND_TO ? { send_to: GOOGLE_ADS_PURCHASE_SEND_TO } : {}),
    transaction_id: order._id,
    value: order.totalAmount, // already rupees — do NOT divide by 100
    currency: 'INR',
    items: order.items.map((item) => ({
      item_id: itemProductId(item),
      item_name: itemProductName(item),
      price: item.price, // already rupees — do NOT divide by 100
      quantity: item.quantity,
    })),
  };

  const estimatedDelivery = order.estimatedDelivery
    ? new Date(order.estimatedDelivery).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'Typically delivered in 5–7 business days';

  return (
    <div className="min-h-screen bg-obsidian-deep py-16">
      {/* Client child: fires gtag('event','purchase', …) exactly once. */}
      <PurchaseTracker orderId={order._id} purchase={purchase} />

      <div className="max-w-2xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="bg-green-500/10 border border-green-500/30 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="h-12 w-12 text-green-400" />
          </div>
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Confirmed</p>
          <h1 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-3">
            Thank you for your order
          </h1>
          <p className="text-ink/70 font-display">
            Order <span className="text-gold font-bold">#{(order.orderNumber || order._id.slice(-8)).toString().toUpperCase()}</span> is being processed.
          </p>
        </div>

        {/* Estimated delivery */}
        <div className="bg-obsidian border border-hairline rounded-sm p-6 mb-6 flex items-center gap-3">
          <Truck className="h-5 w-5 text-gold shrink-0" />
          <div>
            <p className="text-xs text-ink-muted font-display uppercase tracking-widest mb-0.5">Estimated Delivery</p>
            <p className="text-ink/80 font-display font-bold text-sm">{estimatedDelivery}</p>
          </div>
        </div>

        {/* Items */}
        <div className="bg-obsidian border border-hairline rounded-sm p-6 mb-6">
          <h2 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-5">
            Items ({order.items.length})
          </h2>
          <div className="space-y-4">
            {order.items.map((item, index) => {
              const name = itemProductName(item);
              const image =
                (typeof item.product === 'object' && item.product?.images?.[0]?.url) || item.image;
              return (
                <div
                  key={item._id || index}
                  className="flex gap-4 border-b border-hairline pb-4 last:border-b-0 last:pb-0"
                >
                  <div className="w-16 h-16 bg-obsidian-raised border border-hairline rounded-sm overflow-hidden shrink-0">
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={image} alt={name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="h-6 w-6 text-ink-muted" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-display font-light text-ink tracking-[-0.01em] line-clamp-2">{name}</p>
                    <p className="text-ink-muted font-display text-xs mt-1">Qty: {item.quantity}</p>
                  </div>
                  <p className="font-display font-bold text-gold shrink-0">{inr(item.price * item.quantity)}</p>
                </div>
              );
            })}
          </div>

          <div className="flex justify-between border-t border-hairline pt-4 mt-4">
            <span className="font-display font-light text-ink tracking-[-0.01em]">Total Paid</span>
            <span className="text-xl font-display font-bold text-gold">{inr(order.totalAmount)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href={`/orders/${order._id}`}
            className="bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors text-center"
          >
            View Order Details
          </Link>
          <Link
            href="/products"
            className="bg-obsidian-raised border border-hairline text-ink/70 hover:text-ink font-display font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors text-center"
          >
            Continue Shopping
          </Link>
        </div>
      </div>
    </div>
  );
}
