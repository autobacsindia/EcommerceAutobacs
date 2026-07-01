'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import apiClient from '@/lib/api';
import orderService from '@/lib/services/orderService';
import { API_ENDPOINTS, PAYMENT_METHOD_LABELS } from '@/lib/constants';
import {
  ArrowLeft, MapPin, CreditCard, Package, Truck, CheckCircle,
  XCircle, Clock, AlertCircle, Download, RotateCcw, X, Trash2, RefreshCcw, ShoppingCart, Star, HelpCircle
} from 'lucide-react';
import CancelOrderModal from '@/components/orders/CancelOrderModal';
import ReturnRequestModal from '@/components/orders/ReturnRequestModal';
import WriteReviewModal from '@/components/reviews/WriteReviewModal';
import { TimelineProgress } from '@/components/tracking/TimelineProgress';
import { useRazorpay } from '@/hooks/useRazorpay';
import { OrderStatus } from '@/types/tracking';
import { productUrl } from '@/lib/types';
import OrderDetailSkeleton from '@/components/skeletons/OrderDetailSkeleton';

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
  returnRequest?: { status: string; reason: string; requestedAt: string };
  refundDetails?: { amount: number; status: string; refundMethod: string };
  fulfillmentMetrics?: { deliveredAt?: string; confirmedAt?: string; processingStartedAt?: string; shippedAt?: string };
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

  const { processPayment, isProcessing: isPaymentProcessing } = useRazorpay({
    onSuccess: () => fetchOrderDetail(),
    onFailure: (error) => { if (error.message !== 'Payment cancelled') console.error('Retry payment failed:', error); }
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [isAuthenticated, authLoading, router]);

  useEffect(() => {
    if (isAuthenticated && orderId) fetchOrderDetail();
  }, [isAuthenticated, orderId]);

  const fetchOrderDetail = async () => {
    try {
      setLoading(true);
      const order = await orderService.getOrderById(orderId);
      setOrder(order as unknown as OrderDetail);
    } catch (err: any) {
      setError(err.message || 'Failed to load order details');
    } finally {
      setLoading(false);
    }
  };

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
      await addToCart(item.product._id, 1);
      toast.success('Added to cart');
    } catch (err: any) {
      toast.error(err.message || 'Failed to add to cart');
    } finally {
      setAddingToCart(null);
    }
  };

  const handleWriteReview = (item: any) => { setSelectedItemForReview(item); setShowReviewDialog(true); };

  const canRetryPayment = (order: OrderDetail) => {
    const orderStatus = order.status.toLowerCase();
    if (['delivered', 'cancelled', 'refunded', 'shipped'].includes(orderStatus)) return false;
    if (order.payment && typeof order.payment === 'object') {
      if (order.payment.paymentMethod === 'cod') return false;
      const paymentStatus = order.payment.status ? order.payment.status.toLowerCase() : 'pending';
      return ['failed', 'pending'].includes(paymentStatus);
    }
    if (['confirmed', 'processing'].includes(orderStatus)) return false;
    return true;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
      confirmed: 'bg-gold/10 text-gold border-gold/30',
      processing: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
      shipped: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
      delivered: 'bg-green-500/10 text-green-400 border-green-500/30',
      cancelled: 'bg-red-500/10 text-red-400 border-red-500/30',
      refunded: 'bg-obsidian-raised text-ink/70 border-hairline',
    };
    return colors[status.toLowerCase()] || 'bg-obsidian-raised text-ink/70 border-hairline';
  };

  const getStatusIcon = (status: string) => {
    const icons: Record<string, any> = {
      pending: <Clock className="h-4 w-4" />,
      confirmed: <CheckCircle className="h-4 w-4" />,
      processing: <Package className="h-4 w-4" />,
      shipped: <Truck className="h-4 w-4" />,
      delivered: <CheckCircle className="h-4 w-4" />,
      cancelled: <XCircle className="h-4 w-4" />,
      refunded: <RotateCcw className="h-4 w-4" />,
    };
    return icons[status.toLowerCase()] || <AlertCircle className="h-4 w-4" />;
  };

  const canCancelOrder = (status: string) => ['pending', 'confirmed'].includes(status.toLowerCase());
  const canReturnOrder = (order: OrderDetail) => {
    if (order.status.toLowerCase() !== 'delivered') return false;
    const deliveredDate = order.deliveredAt || order.fulfillmentMetrics?.deliveredAt;
    if (!deliveredDate) return false;
    return (new Date().getTime() - new Date(deliveredDate).getTime()) / (1000 * 60 * 60 * 24) <= 7;
  };
  const canDeleteOrder = (status: string) => ['cancelled', 'failed'].includes(status.toLowerCase());

  if (authLoading || loading) return <OrderDetailSkeleton />;
  if (!isAuthenticated) return null;

  if (error || !order) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
        <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-6 text-center max-w-md mx-4">
          <p className="text-red-400 font-display mb-4">{error || 'Order not found'}</p>
          <button onClick={() => router.push('/orders')} className="bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest px-4 py-2 rounded-sm transition-colors text-sm">
            Back to Orders
          </button>
        </div>
      </div>
    );
  }

  const cardClass = 'bg-obsidian border border-hairline rounded-sm p-6 mb-6';

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
              <p className="text-gold font-display font-bold text-sm uppercase tracking-widest mb-1">Order</p>
              <h1 className="text-3xl font-display font-bold text-ink uppercase tracking-wide mb-2">
                #{order._id.slice(-8).toUpperCase()}
              </h1>
              <p className="text-ink-muted font-display text-sm">
                Placed on {new Date(order.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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

        {/* Actions */}
        <div className={cardClass}>
          <h2 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-4">Available Actions</h2>
          <div className="flex flex-wrap gap-3">
            {canRetryPayment(order) && (
              <button onClick={handleRetryPayment} disabled={isPaymentProcessing} className="flex items-center gap-2 px-4 py-2 bg-gold hover:bg-gold text-obsidian rounded-sm font-display font-bold uppercase tracking-widest text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {isPaymentProcessing ? <div className="w-4 h-4 border-2 border-hairline border-t-transparent rounded-full animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                Retry Payment
              </button>
            )}
            {canCancelOrder(order.status) && (
              <button onClick={() => setShowCancelDialog(true)} className="flex items-center gap-2 px-4 py-2 border border-red-500/40 text-red-400 hover:bg-red-500/10 rounded-sm font-display font-bold uppercase tracking-widest text-sm transition-colors">
                <XCircle className="h-4 w-4" />
                Cancel Order
              </button>
            )}
            {order.trackingNumber && (
              <Link href={order.carrier?.trackingUrl || `/orders/${order._id}/tracking`} target="_blank" className="flex items-center gap-2 px-4 py-2 bg-gold hover:bg-gold text-obsidian rounded-sm font-display font-bold uppercase tracking-widest text-sm transition-colors">
                <Truck className="h-4 w-4" />
                Track Package
              </Link>
            )}
            {canReturnOrder(order) && (!order.returnRequest || !order.returnRequest.status) && (
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
            <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 border border-hairline text-ink/70 hover:text-ink hover:border-gold rounded-sm font-display font-bold uppercase tracking-widest text-sm transition-colors">
              <Download className="h-4 w-4" />
              Download Invoice
            </button>
          </div>
        </div>

        {/* Tracking Info */}
        {order.trackingNumber && (
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
                  <p className="text-ink/70 font-display font-bold">{new Date(order.estimatedDelivery).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
              )}
              {order.deliveredAt && (
                <div>
                  <p className="text-xs text-ink-muted font-display mb-1">Delivered On</p>
                  <p className="text-green-400 font-display font-bold">{new Date(order.deliveredAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Return Request */}
        {order.returnRequest && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-sm p-6 mb-6">
            <h2 className="font-display font-bold text-orange-400 uppercase tracking-wide mb-4">Return Request</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div><p className="text-xs text-orange-400/70 font-display mb-1">Status</p><p className="text-orange-300 font-display font-bold">{order.returnRequest.status.toUpperCase()}</p></div>
              <div><p className="text-xs text-orange-400/70 font-display mb-1">Reason</p><p className="text-orange-300 font-display text-sm">{order.returnRequest.reason}</p></div>
              <div><p className="text-xs text-orange-400/70 font-display mb-1">Requested On</p><p className="text-orange-300 font-display text-sm">{new Date(order.returnRequest.requestedAt).toLocaleDateString('en-IN')}</p></div>
            </div>
          </div>
        )}

        {/* Refund Info */}
        {order.refundDetails && (
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
              <p className="font-display font-bold text-ink uppercase tracking-wide">{order.shippingAddress.fullName}</p>
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
                  {(order.payment as any)?.transactionId && (
                    <div>
                      <p className="text-xs text-ink-muted mb-0.5">Transaction ID</p>
                      <p className="font-mono text-xs text-ink/70">{(order.payment as any)?.transactionId}</p>
                    </div>
                  )}
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
              <div className="flex justify-between"><span className="text-ink-muted">Shipping</span><span className="text-ink/70">₹{(order.shippingCost || 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Tax</span><span className="text-ink/70">₹{(order.tax || 0).toFixed(2)}</span></div>
              {(order.discount || 0) > 0 && (
                <div className="flex justify-between"><span className="text-ink-muted">Discount</span><span className="text-green-400">-₹{(order.discount || 0).toFixed(2)}</span></div>
              )}
              <div className="flex justify-between border-t border-hairline pt-3 mt-3">
                <span className="font-display font-bold text-ink uppercase tracking-wide">Total</span>
                <span className="text-xl font-display font-bold text-gold">₹{(order.totalAmount || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Order Items */}
        <div className={cardClass}>
          <h3 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-6">
            Order Items ({order.items.length})
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
                      <Link href={productUrl(product, '/products') || '/products'} className="font-display font-bold text-ink uppercase tracking-wide hover:text-gold transition-colors line-clamp-2">
                        {productName}
                      </Link>
                    ) : (
                      <p className="font-display font-bold text-ink uppercase tracking-wide">{productName}</p>
                    )}
                    <p className="text-ink-muted font-display text-xs mt-1">Qty: {item.quantity}</p>
                    <p className="text-ink-muted font-display text-xs">₹{(item.price || 0).toFixed(2)} each</p>
                  </div>
                  <div className="text-right flex flex-col items-end gap-2 shrink-0">
                    <p className="font-display font-bold text-gold">₹{((item.price || 0) * (item.quantity || 0)).toFixed(2)}</p>
                    {product?._id && (
                      <button onClick={() => handleBuyAgain(item)} disabled={addingToCart === item._id} className="flex items-center gap-1 text-xs text-gold hover:text-obsidian hover:bg-gold border border-gold/30 px-2 py-1 rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-display font-bold uppercase tracking-widest">
                        {addingToCart === item._id ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" /> : <ShoppingCart className="h-3 w-3" />}
                        Buy Again
                      </button>
                    )}
                    {order.status === 'delivered' && product?._id && (
                      <button onClick={() => handleWriteReview(item)} className="flex items-center gap-1 text-xs text-gold hover:text-obsidian hover:bg-gold border border-gold/30 px-2 py-1 rounded-sm transition-colors font-display font-bold uppercase tracking-widest">
                        <Star className="h-3 w-3" />
                        Review
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Status History */}
        {order.statusHistory && order.statusHistory.length > 0 && (
          <div className={cardClass}>
            <h3 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-6">Order Timeline</h3>
            <div className="space-y-4">
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
                    <p className="font-display font-bold text-ink uppercase tracking-wide text-sm">
                      {history.status.charAt(0).toUpperCase() + history.status.slice(1)}
                    </p>
                    <p className="text-xs text-ink-muted font-display mt-0.5">
                      {new Date(history.timestamp).toLocaleString('en-IN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
          <ReturnRequestModal orderId={order._id} orderNumber={order._id.slice(-8).toUpperCase()} items={order.items} deliveredAt={order.deliveredAt || order.fulfillmentMetrics?.deliveredAt || ''} onClose={() => setShowReturnDialog(false)} onSuccess={() => fetchOrderDetail()} />
        )}
        {showReviewDialog && selectedItemForReview && order && (
          <WriteReviewModal productId={selectedItemForReview.product?._id || ''} productName={selectedItemForReview.product?.name || selectedItemForReview.name || ''} productImage={selectedItemForReview.product?.images?.[0]?.url || selectedItemForReview.image} orderId={order._id} onClose={() => setShowReviewDialog(false)} onSuccess={() => {}} />
        )}
      </div>
    </div>
  );
}
