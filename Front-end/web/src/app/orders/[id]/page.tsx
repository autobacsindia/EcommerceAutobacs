'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import apiClient from '@/lib/api';
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
  carrier?: {
    name: string;
    code: string;
    trackingUrl?: string;
  };
  estimatedDelivery?: string;
  deliveredAt?: string;
  statusHistory?: Array<{
    status: string;
    timestamp: string;
    updatedBy?: any;
    reason?: string;
    notes?: string;
  }>;
  returnRequest?: {
    status: string;
    reason: string;
    requestedAt: string;
  };
  refundDetails?: {
    amount: number;
    status: string;
    refundMethod: string;
  };
  fulfillmentMetrics?: {
    deliveredAt?: string;
    confirmedAt?: string;
    processingStartedAt?: string;
    shippedAt?: string;
  };
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
    onSuccess: (orderId) => {
      fetchOrderDetail();
    },
    onFailure: (error) => {
      // Error is handled by the hook (toast), but we can add extra logic if needed
      if (error.message !== 'Payment cancelled') {
        console.error('Retry payment failed:', error);
      }
    }
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, authLoading, router]);

  useEffect(() => {
    if (isAuthenticated && orderId) {
      fetchOrderDetail();
    }
  }, [isAuthenticated, orderId]);

  const fetchOrderDetail = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get(`${API_ENDPOINTS.ORDERS}/${orderId}`);
      setOrder((response as any).order);
    } catch (err: any) {
      setError(err.message || 'Failed to load order details');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteOrder = async () => {
    if (!confirm('Are you sure you want to delete this order? This action cannot be undone.')) {
      return;
    }
    
    try {
      setLoading(true);
      await apiClient.delete(`${API_ENDPOINTS.ORDERS}/${orderId}`);
      router.push('/orders');
    } catch (err: any) {
      setError(err.message || 'Failed to delete order');
      setLoading(false);
    }
  };

  const handleRetryPayment = async () => {
    if (!order || !user) return;
    
    const userDetails = {
      name: order.shippingAddress.fullName,
      email: user.email,
      phone: order.shippingAddress.phone
    };

    processPayment(order._id, order.totalAmount, userDetails);
  };

  const handleBuyAgain = async (item: any) => {
    if (!item.product?._id) {
      toast.error('Product no longer available');
      return;
    }

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

  const handleWriteReview = (item: any) => {
    setSelectedItemForReview(item);
    setShowReviewDialog(true);
  };

  const canRetryPayment = (order: OrderDetail) => {
    const orderStatus = order.status.toLowerCase();
    
    // Terminal statuses where retry is invalid
    if (['delivered', 'cancelled', 'refunded', 'shipped'].includes(orderStatus)) return false;

    // If payment is object (populated)
    if (order.payment && typeof order.payment === 'object') {
       if (order.payment.paymentMethod === 'cod') return false;
       
       const paymentStatus = order.payment.status ? order.payment.status.toLowerCase() : 'pending';
       return ['failed', 'pending'].includes(paymentStatus);
    }

    // If payment is string (ID) or missing (fallback logic)
    // If order is confirmed or processing, assume payment successful
    if (['confirmed', 'processing'].includes(orderStatus)) return false;

    return true;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      confirmed: 'bg-blue-100 text-blue-800 border-blue-200',
      processing: 'bg-purple-100 text-purple-800 border-purple-200',
      shipped: 'bg-orange-100 text-orange-800 border-orange-200',
      delivered: 'bg-green-100 text-green-800 border-green-200',
      cancelled: 'bg-red-100 text-red-800 border-red-200',
      refunded: 'bg-gray-100 text-gray-800 border-gray-200',
    };
    return colors[status.toLowerCase()] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getStatusIcon = (status: string) => {
    const icons: Record<string, any> = {
      pending: <Clock className="h-5 w-5" />,
      confirmed: <CheckCircle className="h-5 w-5" />,
      processing: <Package className="h-5 w-5" />,
      shipped: <Truck className="h-5 w-5" />,
      delivered: <CheckCircle className="h-5 w-5" />,
      cancelled: <XCircle className="h-5 w-5" />,
      refunded: <RotateCcw className="h-5 w-5" />,
    };
    return icons[status.toLowerCase()] || <AlertCircle className="h-5 w-5" />;
  };

  const canCancelOrder = (status: string) => {
    return ['pending', 'confirmed'].includes(status.toLowerCase());
  };

  const canReturnOrder = (order: OrderDetail) => {
    if (order.status.toLowerCase() !== 'delivered') return false;
    
    const deliveredDate = order.deliveredAt || order.fulfillmentMetrics?.deliveredAt;
    if (!deliveredDate) return false;
    
    const daysSinceDelivery = (new Date().getTime() - new Date(deliveredDate).getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceDelivery <= 7;
  };

  const canDeleteOrder = (status: string) => {
    return ['cancelled', 'failed'].includes(status.toLowerCase());
  };

  const getProgressPercentage = (status: string) => {
    const progress: Record<string, number> = {
      pending: 20,
      confirmed: 40,
      processing: 60,
      shipped: 80,
      delivered: 100,
      cancelled: 0,
      refunded: 0,
    };
    return progress[status.toLowerCase()] || 0;
  };

  if (authLoading || loading) {
    return <OrderDetailSkeleton />;
  }

  if (!isAuthenticated) {
    return null;
  }

  if (error || !order) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-600">{error || 'Order not found'}</p>
          <button
            onClick={() => router.push('/orders')}
            className="mt-4 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
          >
            Back to Orders
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Back Button */}
      <Link
        href="/orders"
        className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6 transition"
      >
        <ArrowLeft className="h-5 w-5" />
        <span className="font-medium">Back to Orders</span>
      </Link>

      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">
              Order #{order._id.slice(-8).toUpperCase()}
            </h1>
            <p className="text-gray-600">
              Placed on {new Date(order.createdAt).toLocaleDateString('en-IN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${getStatusColor(order.status)}`}>
              {getStatusIcon(order.status)}
              <span className="font-medium">
                {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
              </span>
            </div>
          </div>
        </div>

        {/* Progress Bar (Roadmap) */}
        <div className="mt-8 mb-4">
          <TimelineProgress currentStatus={order.status as OrderStatus} />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h2 className="font-bold text-lg mb-4">Available Actions</h2>
        <div className="flex flex-wrap gap-3">
          {canRetryPayment(order) && (
            <button
              onClick={handleRetryPayment}
              disabled={isPaymentProcessing}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPaymentProcessing ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <RefreshCcw className="h-5 w-5" />
              )}
              Retry Payment
            </button>
          )}
          {canCancelOrder(order.status) && (
            <button
              onClick={() => setShowCancelDialog(true)}
              className="flex items-center gap-2 px-4 py-2 border-2 border-red-500 text-red-600 rounded-lg hover:bg-red-50 transition font-medium"
            >
              <XCircle className="h-5 w-5" />
              Cancel Order
            </button>
          )}
          {order.trackingNumber && (
            <Link
              href={order.carrier?.trackingUrl || `/orders/${order._id}/tracking`}
              target="_blank"
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
            >
              <Truck className="h-5 w-5" />
              Track Package
            </Link>
          )}
          {canReturnOrder(order) && (!order.returnRequest || !order.returnRequest.status) && (
            <button
              onClick={() => setShowReturnDialog(true)}
              className="flex items-center gap-2 px-4 py-2 border-2 border-orange-500 text-orange-600 rounded-lg hover:bg-orange-50 transition font-medium"
            >
              <RotateCcw className="h-5 w-5" />
              Return / Exchange Items
            </button>
          )}
          {canDeleteOrder(order.status) && (
            <button
              onClick={handleDeleteOrder}
              className="flex items-center gap-2 px-4 py-2 border-2 border-red-500 text-red-600 rounded-lg hover:bg-red-50 transition font-medium"
            >
              <Trash2 className="h-5 w-5" />
              Delete Order
            </button>
          )}
          <Link
            href={`/contact?orderId=${order.orderNumber || order._id}`}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium"
          >
            <HelpCircle className="h-5 w-5" />
            Need Help?
          </Link>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium"
          >
            <Download className="h-5 w-5" />
            Download Invoice
          </button>
        </div>
      </div>

      {/* Tracking Information */}
      {order.trackingNumber && (
        <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
          <h2 className="font-bold text-lg mb-4">Tracking Information</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600 mb-1">Tracking Number</p>
              <p className="font-mono font-medium text-lg">{order.trackingNumber}</p>
            </div>
            {order.carrier && (
              <div>
                <p className="text-sm text-gray-600 mb-1">Carrier</p>
                <p className="font-medium text-lg">{order.carrier.name}</p>
              </div>
            )}
            {order.estimatedDelivery && (
              <div>
                <p className="text-sm text-gray-600 mb-1">Estimated Delivery</p>
                <p className="font-medium text-lg">
                  {new Date(order.estimatedDelivery).toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>
            )}
            {order.deliveredAt && (
              <div>
                <p className="text-sm text-gray-600 mb-1">Delivered On</p>
                <p className="font-medium text-lg">
                  {new Date(order.deliveredAt).toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Return Request Info */}
      {order.returnRequest && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-6 mb-6">
          <h2 className="font-bold text-lg mb-4 text-orange-800">Return Request</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-orange-600 mb-1">Status</p>
              <p className="font-medium">{order.returnRequest.status.toUpperCase()}</p>
            </div>
            <div>
              <p className="text-sm text-orange-600 mb-1">Reason</p>
              <p className="font-medium">{order.returnRequest.reason}</p>
            </div>
            <div>
              <p className="text-sm text-orange-600 mb-1">Requested On</p>
              <p className="font-medium">
                {new Date(order.returnRequest.requestedAt).toLocaleDateString('en-IN')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Refund Info */}
      {order.refundDetails && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
          <h2 className="font-bold text-lg mb-4 text-blue-800">Refund Information</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-blue-600 mb-1">Refund Amount</p>
              <p className="font-bold text-xl">₹{(order.refundDetails.amount || 0).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-sm text-blue-600 mb-1">Status</p>
              <p className="font-medium">{order.refundDetails.status.toUpperCase()}</p>
            </div>
            <div>
              <p className="text-sm text-blue-600 mb-1">Method</p>
              <p className="font-medium">
                {(order.refundDetails.refundMethod || '').replace(/_/g, ' ').toUpperCase()}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6 mb-6">
        {/* Shipping Address */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="h-5 w-5 text-blue-600" />
            <h3 className="font-bold">Shipping Address</h3>
          </div>
          <div className="text-gray-700 space-y-1">
            <p className="font-medium">{order.shippingAddress.fullName}</p>
            <p>{order.shippingAddress.addressLine1}</p>
            {order.shippingAddress.addressLine2 && <p>{order.shippingAddress.addressLine2}</p>}
            <p>{order.shippingAddress.city}, {order.shippingAddress.state}</p>
            <p>{order.shippingAddress.postalCode}</p>
            <p className="font-medium mt-2">{order.shippingAddress.phone}</p>
          </div>
        </div>

        {/* Payment Method */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="h-5 w-5 text-blue-600" />
            <h3 className="font-bold">Payment Details</h3>
          </div>
          <div className="text-gray-700 space-y-2">
            {order.payment ? (
              <>
                <div>
                  <p className="text-sm text-gray-600">Method</p>
                  <p className="font-medium">{PAYMENT_METHOD_LABELS[(order.payment as any)?.paymentMethod] || (order.payment as any)?.paymentMethod || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Status</p>
                  <p className={`font-medium ${
                    !(order.payment as any)?.status ? 'text-gray-500' :
                    (order.payment as any)?.status === 'completed' || (order.payment as any)?.status === 'success' || (order.payment as any)?.status === 'paid' 
                      ? 'text-green-600' 
                      : (order.payment as any)?.status === 'pending' 
                        ? 'text-yellow-600' 
                        : 'text-red-600'
                  }`}>
                    {((order.payment as any)?.status || 'Unknown').charAt(0).toUpperCase() + ((order.payment as any)?.status || 'Unknown').slice(1)}
                  </p>
                </div>
                {(order.payment as any)?.status === 'failed' && (
                  <div className="mt-2 p-2 bg-red-50 border border-red-100 rounded text-sm text-red-700 flex flex-col gap-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>Payment failed. Please verify your transaction or try placing the order again.</span>
                    </div>
                    {canRetryPayment(order) && (
                      <button
                        onClick={handleRetryPayment}
                        disabled={isPaymentProcessing}
                        className="self-start text-sm font-medium text-red-700 underline hover:text-red-800 disabled:opacity-50 ml-6"
                      >
                        {isPaymentProcessing ? 'Processing...' : 'Retry Payment Now'}
                      </button>
                    )}
                  </div>
                )}
                {(order.payment as any)?.transactionId && (
                  <div>
                    <p className="text-sm text-gray-600">Transaction ID</p>
                    <p className="font-mono text-xs">{(order.payment as any)?.transactionId}</p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-gray-500">Payment information not available</p>
            )}
          </div>
        </div>

        {/* Order Summary */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Package className="h-5 w-5 text-blue-600" />
            <h3 className="font-bold">Order Summary</h3>
          </div>
          <div className="space-y-2 text-gray-700">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span>₹{(order.subtotal || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Shipping:</span>
              <span>₹{(order.shippingCost || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tax:</span>
              <span>₹{(order.tax || 0).toFixed(2)}</span>
            </div>
            {(order.discount || 0) > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Discount:</span>
                <span>-₹{(order.discount || 0).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg pt-2 border-t">
              <span>Total:</span>
              <span className="text-blue-600">₹{(order.totalAmount || 0).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Order Items */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h3 className="font-bold text-xl mb-6">Order Items ({order.items.length})</h3>
        <div className="space-y-4">
          {order.items.map((item, index) => {
            const product = item.product;
            const productName = product?.name || item.name || 'Unknown Product';
            const productImage = product?.images?.[0]?.url || item.image;

            return (
              <div key={item._id || index} className="flex gap-4 border-b pb-4 last:border-b-0">
                <div className="w-24 h-24 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                  {productImage ? (
                    <img
                      src={productImage}
                      alt={productName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <Package className="h-8 w-8" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  {product?._id ? (
                    <Link
                      href={`/products/${product._id}`}
                      className="font-semibold hover:text-blue-600 transition"
                    >
                      {productName}
                    </Link>
                  ) : (
                    <p className="font-semibold">{productName}</p>
                  )}
                  <p className="text-gray-600 text-sm mt-1">Quantity: {item.quantity}</p>
                  <p className="text-gray-600 text-sm">Price: ₹{(item.price || 0).toFixed(2)} each</p>
                </div>
                <div className="text-right flex flex-col items-end gap-2">
                  <p className="font-bold text-lg">₹{((item.price || 0) * (item.quantity || 0)).toFixed(2)}</p>
                  {product?._id && (
                    <button
                      onClick={() => handleBuyAgain(item)}
                      disabled={addingToCart === item._id}
                      className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded-full transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {addingToCart === item._id ? (
                        <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <ShoppingCart className="h-4 w-4" />
                      )}
                      Buy Again
                    </button>
                  )}
                  {order.status === 'delivered' && product?._id && (
                    <button
                      onClick={() => handleWriteReview(item)}
                      className="flex items-center gap-1 text-sm text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50 px-3 py-1.5 rounded-full transition"
                    >
                      <Star className="h-4 w-4" />
                      Write a Review
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
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="font-bold text-xl mb-6">Order Timeline</h3>
          <div className="space-y-4">
            {order.statusHistory.map((history, index) => (
              <div key={index} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getStatusColor(history.status)}`}>
                    {getStatusIcon(history.status)}
                  </div>
                  {index < order.statusHistory!.length - 1 && (
                    <div className="w-0.5 h-16 bg-gray-300 my-1"></div>
                  )}
                </div>
                <div className="flex-1 pb-8">
                  <p className="font-semibold">
                    {history.status.charAt(0).toUpperCase() + history.status.slice(1)}
                  </p>
                  <p className="text-sm text-gray-600">
                    {new Date(history.timestamp).toLocaleString('en-IN', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  {history.reason && (
                    <p className="text-sm text-gray-700 mt-1">Reason: {history.reason}</p>
                  )}
                  {history.notes && (
                    <p className="text-sm text-gray-700 mt-1">Notes: {history.notes}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cancel Order Modal */}
      {showCancelDialog && order && (
        <CancelOrderModal
          orderId={order._id}
          orderNumber={order._id.slice(-8).toUpperCase()}
          totalAmount={order.totalAmount}
          hasPayment={!!order.payment}
          onClose={() => setShowCancelDialog(false)}
          onSuccess={() => {
            fetchOrderDetail();
          }}
        />
      )}

      {/* Return Request Modal */}
      {showReturnDialog && order && (
        <ReturnRequestModal
          orderId={order._id}
          orderNumber={order._id.slice(-8).toUpperCase()}
          items={order.items}
          deliveredAt={order.deliveredAt || order.fulfillmentMetrics?.deliveredAt || ''}
          onClose={() => setShowReturnDialog(false)}
          onSuccess={() => {
            fetchOrderDetail();
          }}
        />
      )}

      {/* Write Review Modal */}
      {showReviewDialog && selectedItemForReview && order && (
        <WriteReviewModal
          productId={selectedItemForReview.product?._id || ''}
          productName={selectedItemForReview.product?.name || selectedItemForReview.name || ''}
          productImage={selectedItemForReview.product?.images?.[0]?.url || selectedItemForReview.image}
          orderId={order._id}
          onClose={() => setShowReviewDialog(false)}
          onSuccess={() => {
            // Optional: refresh order if we want to show "Reviewed" state later
            // fetchOrderDetail(); 
          }}
        />
      )}
    </div>
  );
}
