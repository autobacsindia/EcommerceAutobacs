'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useRequireAuth } from '@/lib/hooks/useRequireAuth';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import apiClient from '@/lib/api';
import orderService from '@/lib/services/orderService';
import { API_ENDPOINTS, PAYMENT_METHOD_LABELS, RETURN_WINDOW_DAYS } from '@/lib/constants';
import {
  ArrowLeft, MapPin, CreditCard, Package, Truck, CheckCircle,
  XCircle, Clock, AlertCircle, Download, RotateCcw, X, Trash2, RefreshCcw, ShoppingCart, Star, HelpCircle, ChevronDown
} from 'lucide-react';
import CancelOrderModal from '@/components/orders/CancelOrderModal';
import ReturnRequestModal from '@/components/orders/ReturnRequestModal';
import WriteReviewModal from '@/components/reviews/WriteReviewModal';
import { TimelineProgress } from '@/components/tracking/TimelineProgress';
import { useRazorpay } from '@/hooks/useRazorpay';
import { OrderStatus } from '@/types/tracking';
import { productUrl, type OrderPaymentSummary } from '@/lib/types';
import EmiPaymentNotice from '@/components/orders/EmiPaymentNotice';
import OrderDetailSkeleton from '@/components/skeletons/OrderDetailSkeleton';
import { formatDateIST, formatLongDateIST, formatLongDateTimeIST } from '@/lib/datetime';
import { buildOrderLines } from '@/lib/orderLines';
import OrderParcels from '@/components/orders/OrderParcels';
import {
  canReturnItem,
  deliveredAtForItem,
  fulfilmentStateForItem,
  parcelProgress,
} from '@/lib/orderFulfilment';
import type { ItemFulfilmentState } from '@/lib/orderFulfilment';

interface OrderDetail {
  _id: string;
  orderNumber: string;
  createdAt: string;
  status: string;
  totalAmount: number;
  subtotal: number;
  shippingCost: number;
  tax: number;
  discount: number;
  shippingAddress: {
    fullName: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  payment?: {
    _id: string;
    paymentMethod: string;
    status: string;
    transactionId?: string;
  } | string;
  items: Array<{
    _id: string;
    product?: {
      _id: string;
      name: string;
      price: number;
      images?: Array<{ url: string; alt?: string }>;
    };
    quantity: number;
    price: number;
    name?: string;
    image?: string;
  }>;
  trackingNumber?: string;
  carrier?: { name: string; code: string; trackingUrl?: string };
  estimatedDelivery?: string;
  deliveredAt?: string;
  statusHistory?: Array<{
    status: string;
    timestamp: string;
    updatedBy?: any;
    reason?: string;
    notes?: string;
  }>;
  /**
   * Parcels this order shipped in. Already present on GET /orders/:id, which returns
   * the whole order document — no extra request needed to work out per-line delivery.
   */
  shipments?: Array<{
    _id: string;
    status: 'packed' | 'shipped' | 'delivered' | 'lost';
    lines?: Array<{ itemId: string; quantity: number }>;
    includesReward?: boolean;
    deliveredAt?: string | null;
  }>;
  /**
   * Won Spin-to-Win reward. Stored beside the order, never inside `items` (a ₹0 entry
   * there would corrupt the invoice and the refund maths) — `buildOrderLines` renders
   * it as a FREE line so the customer can actually see the gift they won.
   */
  spinReward?: {
    name: string;
    sku?: string | null;
    kind: string;
    imageUrl?: string | null;
    fulfilledAt?: string | null;
    voidedAt?: string | null;
  } | null;
  returnRequest?: { status: string; reason?: string; requestedAt?: string };
  refundDetails?: { amount: number; status: string; refundMethod: string; requestedAt?: string };
  fulfillmentMetrics?: { deliveredAt?: string; confirmedAt?: string; processingStartedAt?: string; shippedAt?: string };
}

/**
 * Where one order line has got to — the per-item answer to "which of my things came?".
 *
 * Renders NOTHING when `state` is null, which is every order placed before split
 * shipments existed. Those have no parcels to read, and inventing a state for them
 * would put a fulfilment chip on thousands of historical orders that never had one.
 *
 * Unlike the Parcels panel it does NOT hide itself at one parcel. That panel repeats
 * itself on a single-box order ("Parcel 1 of 1"); a per-line "Delivered 3 Aug" does
 * not — that date is the thing customers come to this page to find.
 */
function ItemFulfilmentChip({
  state,
  deliveredAt,
}: {
  state: ItemFulfilmentState | null;
  deliveredAt: Date | null;
}) {
  if (!state) return null;

  const copy: Record<ItemFulfilmentState, { label: string; className: string }> = {
    delivered: {
      label: deliveredAt ? `Delivered ${formatLongDateIST(deliveredAt.toISOString())}` : 'Delivered',
      className: 'border-green-500/40 text-green-400',
    },
    shipped: { label: 'On its way', className: 'border-gold/40 text-gold' },
    packed: { label: 'Getting ready', className: 'border-hairline text-ink-muted' },
    // Covers both "not in a box yet" and "the box it was in was lost" — in both cases
    // the customer is still waiting, and the units are back in the to-ship pool.
    pending: { label: 'Not shipped yet', className: 'border-hairline text-ink-muted' },
  };
  const { label, className } = copy[state];

  return (
    <span
      className={`inline-block mt-1.5 px-2 py-0.5 border rounded-sm font-display font-bold uppercase tracking-widest text-[10px] ${className}`}
    >
      {label}
    </span>
  );
}

export default function OrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = params.id as string;
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { addToCart } = useCart();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingToCart, setAddingToCart] = useState<string | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [selectedItemForReview, setSelectedItemForReview] = useState<any>(null);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  const { processPayment, isProcessing: isPaymentProcessing } = useRazorpay({
    onSuccess: () => fetchOrderDetail(),
    onFailure: (error) => { if (error.message !== 'Payment cancelled') console.error('Retry payment failed:', error); }
  });

  useRequireAuth();

  useEffect(() => {
    if (isAuthenticated && orderId) fetchOrderDetail();
  }, [isAuthenticated, orderId]);

  const fetchOrderDetail = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const order = await orderService.getOrderById(orderId);
      setOrder(order as unknown as OrderDetail);
    } catch (err: any) {
      // A background poll must not blow away a rendered order with an error screen.
      if (!silent) setError(err.message || 'Failed to load order details');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // After a verified payment the order is confirmed asynchronously by the Razorpay
  // webhook (or the reconciliation sweep). Poll briefly so the page reflects the
  // confirmed state without a manual refresh. Gated on a per-order marker set by
  // useRazorpay, so it never nags a customer who simply abandoned an unpaid order.
  useEffect(() => {
    if (!order) return;
    const key = `awaitingPaymentConfirmation:${orderId}`;
    let marker: string | null = null;
    try { marker = sessionStorage.getItem(key); } catch { /* unavailable */ }
    if (!marker) return;

    const paymentStatus = (order as { paymentStatus?: string }).paymentStatus;
    const confirmed = order.status.toLowerCase() !== 'awaiting_payment' || paymentStatus === 'paid';
    const waitedMs = Date.now() - Number(marker);

    // Confirmed, or we've waited past the window (webhook + sweep should have run) —
    // stop polling and clear the marker so a future visit doesn't re-trigger it.
    if (confirmed || waitedMs > 2 * 60 * 1000) {
      try { sessionStorage.removeItem(key); } catch { /* ignore */ }
      setIsConfirmingPayment(false);
      return;
    }

    setIsConfirmingPayment(true);
    const t = setTimeout(() => fetchOrderDetail(true), 4000);
    return () => clearTimeout(t);
  }, [order, orderId]);

  const handleDeleteOrder = async () => {
    if (!confirm('Are you sure you want to delete this order? This action cannot be undone.')) return;
    try {
      setLoading(true);
      await orderService.deleteOrder(orderId);
      router.push('/orders');
    } catch (err: any) {
      setError(err.message || 'Failed to delete order');
      setLoading(false);
    }
  };

  const handleRetryPayment = async () => {
    if (!order || !user) return;
    processPayment(order._id, order.totalAmount, { name: order.shippingAddress.fullName, email: user.email, phone: order.shippingAddress.phone });
  };

  const handleBuyAgain = async (item: any) => {
    if (!item.product?._id) { toast.error('Product no longer available'); return; }
    try {
      setAddingToCart(item._id);
      toast.success('Added to cart');
      await addToCart(item.product._id, 1);
    } catch (err: any) {
      toast.error(err.message || 'Failed to add to cart');
    } finally {
      setAddingToCart(null);
    }
  };

  const handleWriteReview = (item: any) => { setSelectedItemForReview(item); setShowReviewDialog(true); };

  const canRetryPayment = (order: OrderDetail) => {
    const orderStatus = order.status.toLowerCase();
    if (['delivered', 'cancelled', 'returned', 'shipped'].includes(orderStatus)) return false;
    if (order.payment && typeof order.payment === 'object') {
      if (order.payment.paymentMethod === 'cod') return false;
      const paymentStatus = order.payment.status ? order.payment.status.toLowerCase() : 'pending';
      return ['failed', 'pending'].includes(paymentStatus);
    }
    if (['processing'].includes(orderStatus)) return false; // already paid
    return true;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      awaiting_payment: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
      pending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
      confirmed: 'bg-gold/10 text-gold border-gold/30',
      processing: 'bg-gold/10 text-gold border-gold/40/30',
      shipped: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
      delivered: 'bg-green-500/10 text-green-400 border-green-500/30',
      cancelled: 'bg-red-500/10 text-red-400 border-red-500/30',
      returned: 'bg-obsidian-raised text-ink/70 border-hairline',
      refunded: 'bg-obsidian-raised text-ink/70 border-hairline',
    };
    return colors[status.toLowerCase()] || 'bg-obsidian-raised text-ink/70 border-hairline';
  };

  const getStatusIcon = (status: string) => {
    const icons: Record<string, any> = {
      awaiting_payment: <Clock className="h-4 w-4" />,
      pending: <Clock className="h-4 w-4" />,
      confirmed: <CheckCircle className="h-4 w-4" />,
      processing: <Package className="h-4 w-4" />,
      shipped: <Truck className="h-4 w-4" />,
      delivered: <CheckCircle className="h-4 w-4" />,
      cancelled: <XCircle className="h-4 w-4" />,
      returned: <RotateCcw className="h-4 w-4" />,
      refunded: <RotateCcw className="h-4 w-4" />,
    };
    return icons[status.toLowerCase()] || <AlertCircle className="h-4 w-4" />;
  };

  const canCancelOrder = (status: string) => ['awaiting_payment', 'processing'].includes(status.toLowerCase());
  /*
    Can ANY line still be returned?

    Deliberately not "is the order delivered". A split order sits at `shipped` until its
    LAST parcel lands, so gating on the order status would hide the Return button from a
    customer holding a damaged item that arrived days ago — and their 4-day window could
    expire before the final parcel ever flipped the order to `delivered`. The window is
    per line, measured from the parcel that line came in (lib/orderFulfilment.ts).

    Legacy orders have no parcels and fall through to the order-level delivery date, so
    they behave exactly as before.
  */
  const canReturnOrder = (order: OrderDetail) => {
    const status = order.status.toLowerCase();
    const isSplit = (order.shipments?.length || 0) > 0;
    if (!['delivered', 'returned'].includes(status) && !(isSplit && status === 'shipped')) {
      return false;
    }
    // Mirror the signed policy's RETURN_WINDOW_DAYS (4). Kept in sync with the
    // backend config/returnPolicy.js via lib/constants.ts.
    return order.items.some((item) =>
      item._id && canReturnItem(order, String(item._id), RETURN_WINDOW_DAYS));
  };
  /*
    The lines the return form may offer, and the oldest of their delivery dates (which
    drives the modal's "delivered N days ago" copy). Derived from the SAME helper as
    `canReturnOrder`, so the button and the form can never disagree about what is
    returnable — a mismatch there means an empty form or a rejected submission.
  */
  const returnableItems = order
    ? order.items.filter((item) => item._id && canReturnItem(order, String(item._id), RETURN_WINDOW_DAYS))
    : [];
  const oldestReturnableDelivery = returnableItems
    .map((item) => deliveredAtForItem(order!, String(item._id)))
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => a.getTime() - b.getTime())[0]?.toISOString();

  /*
    Parcel roll-up for this order, computed once.

    `isSplit` is what makes the order-level tracking fields safe to suppress: they
    mirror PARCEL 1 ONLY (shipmentService deliberately does not let a second parcel
    overwrite them), so on a multi-parcel order they present one box's AWB and one
    delivery date as if they were the order's. The Parcels panel below says it
    properly, per box.
  */
  const progress = order ? parcelProgress(order) : null;
  const isSplitOrder = Boolean(progress?.isSplit);

  const canDeleteOrder = (status: string) => ['cancelled'].includes(status.toLowerCase());

  // A return/refund summary is only real once it has been actually requested
  // (`requestedAt`). Legacy orders carried an empty, phantom subdoc from a schema
  // default; guarding on requestedAt keeps those bogus "PENDING / Invalid Date /
  // ₹0.00" cards off the page even before the backend cleanup migration runs.
  const hasReturnRequest = (order: OrderDetail) => !!order.returnRequest?.requestedAt;
  const hasRefund = (order: OrderDetail) =>
    !!(order.refundDetails && (order.refundDetails.requestedAt || (order.refundDetails.amount || 0) > 0));

  // Return/refund card dates. `formatDateIST` already collapses missing and
  // unparseable timestamps to a dash, so "Invalid Date" can't reach the page.
  const formatDate = (value?: string) => formatDateIST(value);

  if (authLoading || loading) return <OrderDetailSkeleton />;
  if (!isAuthenticated) return null;

  if (error || !order) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
        <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-6 text-center max-w-md mx-4">
          <p className="text-red-400 font-display mb-4">{error || 'Order not found'}</p>
          <button onClick={() => router.push('/orders')} className="bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest px-4 py-2 rounded-sm transition-colors text-sm">
            Back to Orders
          </button>
        </div>
      </div>
    );
  }

  const cardClass = 'bg-obsidian border border-hairline rounded-sm p-6 mb-6';

  // The won goodie as a display line (0 or 1). `audience: 'customer'` hides a VOIDED
  // reward: once the order is cancelled or refunded the gift is withdrawn, and showing
  // it would promise something that is no longer coming.
  const giftLines = buildOrderLines(order, { audience: 'customer' }).filter((l) => l.kind === 'reward');

  return (
    <div className="min-h-screen bg-obsidian-deep py-8">
      <div className="max-w-6xl mx-auto px-4">
        {/* Back */}
        <Link href="/orders" className="inline-flex items-center gap-2 text-gold hover:text-ink font-display font-bold uppercase tracking-widest text-sm transition-colors mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back to Orders
        </Link>

        {/* Header */}
        <div className={cardClass}>
          <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
            <div>
              <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-1">Order</p>
              <h1 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-2">
                #{order._id.slice(-8).toUpperCase()}
              </h1>
              <p className="text-ink-muted font-display text-sm">
                Placed on {formatLongDateTimeIST(order.createdAt)}
              </p>
            </div>
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-sm border text-sm font-display font-bold uppercase tracking-widest ${getStatusColor(order.status)}`}>
              {getStatusIcon(order.status)}
              {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
            </div>
          </div>
          <div className="mt-8">
            <TimelineProgress currentStatus={order.status as OrderStatus} />
          </div>
        </div>

        {/* Payment confirmation banner (shown while polling for the confirmed state) */}
        {isConfirmingPayment && (
          <div className="bg-gold/10 border border-gold/30 rounded-sm p-4 mb-6 flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin shrink-0" />
            <p className="text-sm text-ink/80 font-display">
              Payment received — we’re confirming your order. This page updates automatically.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className={cardClass}>
          <h2 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-4">Available Actions</h2>
          <div className="flex flex-wrap gap-3">
            {canRetryPayment(order) && (
              <button onClick={handleRetryPayment} disabled={isPaymentProcessing} className="flex items-center gap-2 px-4 py-2 bg-gold hover:opacity-90 text-obsidian rounded-sm font-display font-bold uppercase tracking-widest text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {isPaymentProcessing ? <div className="w-4 h-4 border-2 border-hairline border-t-transparent rounded-full animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                Retry Payment
              </button>
            )}
            {canCancelOrder(order.status) ? (
              <button onClick={() => setShowCancelDialog(true)} className="flex items-center gap-2 px-4 py-2 border border-red-500/40 text-red-400 hover:bg-red-500/10 rounded-sm font-display font-bold uppercase tracking-widest text-sm transition-colors">
                <XCircle className="h-4 w-4" />
                Cancel Order
              </button>
            ) : order.status.toLowerCase() === 'shipped' && (
              // Once it's on its way we can't cancel — the customer would use a return
              // after delivery instead. Show the disabled control so the "why" is clear.
              <button
                disabled
                title="This order has already shipped and can no longer be cancelled."
                className="flex items-center gap-2 px-4 py-2 border border-hairline text-ink-muted rounded-sm font-display font-bold uppercase tracking-widest text-sm cursor-not-allowed opacity-60"
              >
                <XCircle className="h-4 w-4" />
                Already Shipped — Can’t Cancel
              </button>
            )}
            {/* Only linkable when the courier has a tracking URL — an "Other"
                courier has none, and the old /orders/[id]/tracking fallback is
                not a route (404). The number + carrier still show below. */}
            {!isSplitOrder && order.trackingNumber && order.carrier?.trackingUrl && (
              <Link href={order.carrier.trackingUrl} target="_blank" className="flex items-center gap-2 px-4 py-2 bg-gold hover:opacity-90 text-obsidian rounded-sm font-display font-bold uppercase tracking-widest text-sm transition-colors">
                <Truck className="h-4 w-4" />
                Track Package
              </Link>
            )}
            {canReturnOrder(order) && !hasReturnRequest(order) && (
              <button onClick={() => setShowReturnDialog(true)} className="flex items-center gap-2 px-4 py-2 border border-orange-500/40 text-orange-400 hover:bg-orange-500/10 rounded-sm font-display font-bold uppercase tracking-widest text-sm transition-colors">
                <RotateCcw className="h-4 w-4" />
                Return / Exchange
              </button>
            )}
            {canDeleteOrder(order.status) && (
              <button onClick={handleDeleteOrder} className="flex items-center gap-2 px-4 py-2 border border-red-500/40 text-red-400 hover:bg-red-500/10 rounded-sm font-display font-bold uppercase tracking-widest text-sm transition-colors">
                <Trash2 className="h-4 w-4" />
                Delete Order
              </button>
            )}
            <Link href={`/contact?orderId=${order.orderNumber || order._id}`} className="flex items-center gap-2 px-4 py-2 border border-hairline text-ink/70 hover:text-ink hover:border-gold rounded-sm font-display font-bold uppercase tracking-widest text-sm transition-colors">
              <HelpCircle className="h-4 w-4" />
              Need Help?
            </Link>
            {['paid', 'refunded'].includes((order as { paymentStatus?: string }).paymentStatus || '') && (
              <a href={`/api/v1/orders/${order._id}/invoice`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 border border-hairline text-ink/70 hover:text-ink hover:border-gold rounded-sm font-display font-bold uppercase tracking-widest text-sm transition-colors">
                <Download className="h-4 w-4" />
                Download Invoice
              </a>
            )}
          </div>
        </div>

        {/*
          Tracking Info — SINGLE-PARCEL ONLY.

          `order.trackingNumber` / `carrier` / `estimatedDelivery` / `deliveredAt` are
          the pre-parcel flat fields, and shipmentService mirrors only the FIRST
          parcel onto them (a second box deliberately does not overwrite them, because
          there is no honest single answer once two are in flight). Rendering them on a
          split order puts one AWB and one delivery date under the heading "Tracking
          Information" directly above a Parcels panel listing two different ones — the
          customer is told two things and cannot tell which is theirs.

          So on a split order this card stands down and OrderParcels is the only
          answer. Single-parcel orders — the overwhelming majority, and every order
          placed before parcels existed — are untouched.
        */}
        {!isSplitOrder && order.trackingNumber && (
          <div className={cardClass}>
            <h2 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-4">Tracking Information</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-ink-muted font-display mb-1">Tracking Number</p>
                <p className="font-mono text-ink/70 font-bold">{order.trackingNumber}</p>
              </div>
              {order.carrier && (
                <div>
                  <p className="text-xs text-ink-muted font-display mb-1">Carrier</p>
                  <p className="text-ink/70 font-display font-bold">{order.carrier.name}</p>
                </div>
              )}
              {order.estimatedDelivery && (
                <div>
                  <p className="text-xs text-ink-muted font-display mb-1">Estimated Delivery</p>
                  <p className="text-ink/70 font-display font-bold">{formatLongDateIST(order.estimatedDelivery)}</p>
                </div>
              )}
              {order.deliveredAt && (
                <div>
                  <p className="text-xs text-ink-muted font-display mb-1">Delivered On</p>
                  <p className="text-green-400 font-display font-bold">{formatLongDateIST(order.deliveredAt)}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Return Request — only when a return was actually raised */}
        {hasReturnRequest(order) && order.returnRequest && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-sm p-6 mb-6">
            <h2 className="font-display font-bold text-orange-400 uppercase tracking-wide mb-4">Return Request</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div><p className="text-xs text-orange-400/70 font-display mb-1">Status</p><p className="text-orange-300 font-display font-bold">{(order.returnRequest.status || 'pending').toUpperCase()}</p></div>
              {order.returnRequest.reason && (
                <div><p className="text-xs text-orange-400/70 font-display mb-1">Reason</p><p className="text-orange-300 font-display text-sm">{order.returnRequest.reason}</p></div>
              )}
              <div><p className="text-xs text-orange-400/70 font-display mb-1">Requested On</p><p className="text-orange-300 font-display text-sm">{formatDate(order.returnRequest.requestedAt)}</p></div>
            </div>
          </div>
        )}

        {/* Refund Info — only when a refund was actually initiated */}
        {hasRefund(order) && order.refundDetails && (
          <div className="bg-gold/10 border border-gold/30 rounded-sm p-6 mb-6">
            <h2 className="font-display font-bold text-gold uppercase tracking-wide mb-4">Refund Information</h2>
            <div className="grid md:grid-cols-3 gap-4">
              <div><p className="text-xs text-gold/70 font-display mb-1">Refund Amount</p><p className="text-xl font-display font-bold text-gold">₹{(order.refundDetails.amount || 0).toFixed(2)}</p></div>
              <div><p className="text-xs text-gold/70 font-display mb-1">Status</p><p className="text-ink/70 font-display font-bold">{order.refundDetails.status.toUpperCase()}</p></div>
              <div><p className="text-xs text-gold/70 font-display mb-1">Method</p><p className="text-ink/70 font-display font-bold">{(order.refundDetails.refundMethod || '').replace(/_/g, ' ').toUpperCase()}</p></div>
            </div>
          </div>
        )}

        {/* Info Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-6">
          {/* Shipping */}
          <div className="bg-obsidian border border-hairline rounded-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="h-4 w-4 text-gold" />
              <h3 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest">Shipping Address</h3>
            </div>
            <div className="font-display text-sm space-y-1">
              <p className="font-display font-light text-ink tracking-[-0.01em]">{order.shippingAddress.fullName}</p>
              <p className="text-ink/70">{order.shippingAddress.addressLine1}</p>
              {order.shippingAddress.addressLine2 && <p className="text-ink/70">{order.shippingAddress.addressLine2}</p>}
              <p className="text-ink/70">{order.shippingAddress.city}, {order.shippingAddress.state}</p>
              <p className="text-ink/70">{order.shippingAddress.postalCode}</p>
              <p className="text-ink-muted mt-2">{order.shippingAddress.phone}</p>
            </div>
          </div>

          {/* Payment */}
          <div className="bg-obsidian border border-hairline rounded-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <CreditCard className="h-4 w-4 text-gold" />
              <h3 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest">Payment Details</h3>
            </div>
            <div className="font-display text-sm space-y-3">
              {order.payment ? (
                <>
                  <div>
                    <p className="text-xs text-ink-muted mb-0.5">Method</p>
                    <p className="text-ink/70 font-display font-bold">{PAYMENT_METHOD_LABELS[(order.payment as any)?.paymentMethod] || (order.payment as any)?.paymentMethod || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted mb-0.5">Status</p>
                    <p className={`font-display font-bold ${
                      !(order.payment as any)?.status ? 'text-ink-muted' :
                      ['completed', 'success', 'paid'].includes((order.payment as any)?.status) ? 'text-green-400' :
                      (order.payment as any)?.status === 'pending' ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {((order.payment as any)?.status || 'Unknown').charAt(0).toUpperCase() + ((order.payment as any)?.status || 'Unknown').slice(1)}
                    </p>
                  </div>
                  {(order.payment as any)?.status === 'failed' && (
                    <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded-sm text-sm">
                      <div className="flex items-start gap-2 text-red-400">
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                        <span className="font-display text-xs">Payment failed. Please verify your transaction or retry.</span>
                      </div>
                      {canRetryPayment(order) && (
                        <button onClick={handleRetryPayment} disabled={isPaymentProcessing} className="text-xs font-display font-bold text-red-400 hover:text-red-300 disabled:opacity-50 mt-2 ml-6 underline">
                          {isPaymentProcessing ? 'Processing...' : 'Retry Payment Now'}
                        </button>
                      )}
                    </div>
                  )}
                  {((order.payment as any)?.gatewayPaymentId || (order.payment as any)?.transactionId) && (
                    <div>
                      <p className="text-xs text-ink-muted mb-0.5">Transaction ID</p>
                      {/* gatewayPaymentId is what the capture actually writes; transactionId
                          only exists on legacy/offline rows. */}
                      <p className="font-mono text-xs text-ink/70">
                        {(order.payment as any)?.gatewayPaymentId || (order.payment as any)?.transactionId}
                      </p>
                    </div>
                  )}
                  <EmiPaymentNotice payment={order.payment as OrderPaymentSummary} tone="dark" />
                </>
              ) : (
                <p className="text-ink-muted">Payment information not available</p>
              )}
            </div>
          </div>

          {/* Order Summary */}
          <div className="bg-obsidian border border-hairline rounded-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <Package className="h-4 w-4 text-gold" />
              <h3 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest">Order Summary</h3>
            </div>
            <div className="font-display text-sm space-y-2">
              <div className="flex justify-between"><span className="text-ink-muted">Subtotal</span><span className="text-ink/70">₹{(order.subtotal || 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Shipping</span><span className="text-ink/70">{(order.shippingCost || 0) > 0 ? `₹${order.shippingCost.toFixed(2)}` : 'Calculated at delivery'}</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Tax</span><span className="text-ink/70">₹{(order.tax || 0).toFixed(2)}</span></div>
              {(order.discount || 0) > 0 && (
                <div className="flex justify-between"><span className="text-ink-muted">Discount</span><span className="text-green-400">-₹{(order.discount || 0).toFixed(2)}</span></div>
              )}
              <div className="flex justify-between border-t border-hairline pt-3 mt-3">
                <span className="font-display font-light text-ink tracking-[-0.01em]">Total</span>
                <span className="text-xl font-display font-bold text-gold">₹{(order.totalAmount || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/*
          Parcels, when this order arrives in more than one. Rendered ABOVE the item
          list because a customer opening this page mid-delivery is asking where their
          things are, not what they bought. Self-hiding for single-parcel orders.
        */}
        <OrderParcels
          orderId={order._id}
          itemNames={Object.fromEntries(
            order.items
              .filter((item) => item._id)
              .map((item) => [String(item._id), item.name ?? item.product?.name ?? 'Item']),
          )}
          rewardName={order.spinReward && !order.spinReward.voidedAt ? order.spinReward.name : null}
          cardClass={cardClass}
        />

        {/* Order Items */}
        <div className={cardClass}>
          {/*
            Count includes the won goodie, because the customer sees it as a row in
            this list. `buildOrderLines` decides whether there IS one: only a physical
            `goodie` prize appears (a coupon or karma prize needs no packing), and a
            VOIDED reward — withdrawn when an order is cancelled or refunded — is
            dropped entirely for customers rather than dangled.
          */}
          <h3 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-6">
            Order Items ({giftLines.length + order.items.length})
          </h3>
          <div className="space-y-4">
            {order.items.map((item, index) => {
              const product = item.product;
              const productName = product?.name || item.name || 'Unknown Product';
              const productImage = product?.images?.[0]?.url || item.image;
              return (
                <div key={item._id || index} className="flex gap-4 border-b border-hairline pb-4 last:border-b-0">
                  <div className="w-20 h-20 bg-obsidian-raised border border-hairline rounded-sm overflow-hidden shrink-0">
                    {productImage ? (
                      <img src={productImage} alt={productName} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="h-8 w-8 text-ink-muted" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    {product?._id ? (
                      <Link href={productUrl(product, '/products') || '/products'} className="font-display font-light text-ink tracking-[-0.01em] hover:text-gold transition-colors line-clamp-2">
                        {productName}
                      </Link>
                    ) : (
                      <p className="font-display font-light text-ink tracking-[-0.01em]">{productName}</p>
                    )}
                    <p className="text-ink-muted font-display text-xs mt-1">Qty: {item.quantity}</p>
                    <p className="text-ink-muted font-display text-xs">₹{(item.price || 0).toFixed(2)} each</p>
                    {/*
                      Where THIS line has got to. Renders nothing on an order with no
                      parcels, so every historical order looks exactly as it did.
                    */}
                    <ItemFulfilmentChip
                      state={fulfilmentStateForItem(order, String(item._id), item.quantity)}
                      deliveredAt={deliveredAtForItem(order, String(item._id))}
                    />
                  </div>
                  <div className="text-right flex flex-col items-end gap-2 shrink-0">
                    <p className="font-display font-bold text-gold">₹{((item.price || 0) * (item.quantity || 0)).toFixed(2)}</p>
                    {product?._id && (
                      <button onClick={() => handleBuyAgain(item)} disabled={addingToCart === item._id} className="flex items-center gap-1 text-xs text-gold hover:text-obsidian hover:bg-gold border border-gold/30 px-2 py-1 rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-display font-bold uppercase tracking-widest">
                        {addingToCart === item._id ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" /> : <ShoppingCart className="h-3 w-3" />}
                        Buy Again
                      </button>
                    )}
                    {/*
                      Reviewable once THIS item has arrived — not once the order has.

                      Gating on `order.status` was the same mistake the return window
                      already fixed above: a split order sits at `shipped` until its
                      LAST parcel lands, so an item delivered two weeks ago could not be
                      reviewed until an unrelated box turned up. Derived from the same
                      helper as the Return button so the two can never disagree.

                      `returned` still qualifies wholesale: an approved return moves the
                      whole order onto that stage, but the items the customer kept are
                      still reviewable. Legacy orders (no parcels) get `null` from the
                      helper and fall through to the order-level status, unchanged.
                    */}
                    {(() => {
                      const state = fulfilmentStateForItem(order, String(item._id), item.quantity);
                      // Parcels exist → they are the truth for this line. Only a
                      // parcel-less (legacy) order falls back to the order status,
                      // which is also the only case where that status is honest about
                      // every line at once.
                      return state === null
                        ? ['delivered', 'returned'].includes(order.status)
                        : state === 'delivered';
                    })() && product?._id && (
                      <button onClick={() => handleWriteReview(item)} className="flex items-center gap-1 text-xs text-gold hover:text-obsidian hover:bg-gold border border-gold/30 px-2 py-1 rounded-sm transition-colors font-display font-bold uppercase tracking-widest">
                        <Star className="h-3 w-3" />
                        Review
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/*
              The gift, as a row in the same list — quantity 1, FREE. Display only:
              `spinReward` is stored beside the order and contributes ₹0, so the
              totals in the summary are untouched. It is deliberately not returnable
              and not reviewable — the customer was never charged for it.
            */}
            {giftLines.map((line) => (
              <div key="spin-reward" className="flex gap-4 border-b border-hairline pb-4 last:border-b-0">
                <div className="w-20 h-20 bg-gold/10 border border-gold/30 rounded-sm overflow-hidden shrink-0">
                  {line.image ? (
                    <img src={line.image} alt={line.name ?? 'Free gift'} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl">🎁</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-display font-light text-ink tracking-[-0.01em]">{line.name}</p>
                  <span className="inline-block mt-1 px-2 py-0.5 bg-gold/20 border border-gold/40 text-gold font-display font-bold uppercase tracking-widest text-[10px] rounded-sm">
                    🎁 Goodie — free gift
                  </span>
                  <p className="text-ink-muted font-display text-xs mt-1">Qty: {line.quantity}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-display font-bold text-gold">FREE</p>
                  <p className="text-ink-muted font-display text-[10px] uppercase tracking-widest mt-1">You won this</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Status History */}
        {order.statusHistory && order.statusHistory.length > 0 && (
          <div className={cardClass}>
            <button
              type="button"
              onClick={() => setShowTimeline((v) => !v)}
              aria-expanded={showTimeline}
              className="w-full flex items-center justify-between gap-2 group"
            >
              <h3 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest">
                Order Timeline
                <span className="ml-2 text-ink/40 normal-case tracking-normal">({order.statusHistory.length})</span>
              </h3>
              <ChevronDown className={`w-4 h-4 text-ink-muted transition-transform ${showTimeline ? 'rotate-180' : ''}`} />
            </button>
            <div className={`space-y-4 ${showTimeline ? 'mt-6' : 'hidden'}`}>
              {order.statusHistory.map((history, index) => (
                <div key={index} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${getStatusColor(history.status)}`}>
                      {getStatusIcon(history.status)}
                    </div>
                    {index < order.statusHistory!.length - 1 && (
                      <div className="w-px h-12 bg-obsidian-raised my-1" />
                    )}
                  </div>
                  <div className="flex-1 pb-6">
                    <p className="font-display font-light text-ink tracking-[-0.01em] text-sm">
                      {history.status.charAt(0).toUpperCase() + history.status.slice(1)}
                    </p>
                    <p className="text-xs text-ink-muted font-display mt-0.5">
                      {formatLongDateTimeIST(history.timestamp)}
                    </p>
                    {history.reason && <p className="text-xs text-ink/70 font-display mt-1">Reason: {history.reason}</p>}
                    {history.notes && <p className="text-xs text-ink/70 font-display mt-1">Notes: {history.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {showCancelDialog && order && (
          <CancelOrderModal orderId={order._id} orderNumber={order._id.slice(-8).toUpperCase()} totalAmount={order.totalAmount} hasPayment={!!order.payment} onClose={() => setShowCancelDialog(false)} onSuccess={() => fetchOrderDetail()} />
        )}
        {showReturnDialog && order && (
          <ReturnRequestModal
            orderId={order._id}
            orderNumber={order._id.slice(-8).toUpperCase()}
            /*
              Only lines that are actually returnable. On a split order each line's
              window runs from the parcel it arrived in, so offering the whole order
              would let the customer build a request the server then rejects — after
              they had already picked a reason and uploaded evidence.
            */
            items={returnableItems}
            excludedCount={order.items.length - returnableItems.length}
            deliveredAt={oldestReturnableDelivery ?? ''}
            // Debit-card EMI is all-or-nothing at the bank; the form says so up front
            // rather than letting the customer find out after we've collected the goods.
            fullRefundOnly={(order.payment as OrderPaymentSummary)?.fullRefundOnly ?? false}
            paidByLabel={(order.payment as OrderPaymentSummary)?.emiPlanLabel ?? null}
            onClose={() => setShowReturnDialog(false)}
            onSuccess={() => fetchOrderDetail()}
          />
        )}
        {showReviewDialog && selectedItemForReview && order && (
          <WriteReviewModal productId={selectedItemForReview.product?._id || ''} productName={selectedItemForReview.product?.name || selectedItemForReview.name || ''} productImage={selectedItemForReview.product?.images?.[0]?.url || selectedItemForReview.image} orderId={order._id} onClose={() => setShowReviewDialog(false)} onSuccess={() => {}} />
        )}
      </div>
    </div>
  );
}
