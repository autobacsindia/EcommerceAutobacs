'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import apiClient from '@/lib/api';
import toast from 'react-hot-toast';
import { ArrowLeft, Package, MapPin, CreditCard, Truck, Download } from 'lucide-react';
import { CUSTOMER_NOTIFIED_STATUSES } from '@/lib/constants';
import ConfirmStatusChangeModal, { ConfirmStatusPayload } from '@/components/orders/ConfirmStatusChangeModal';
import { updateOrderStatus } from '@/lib/orderStatusUpdate';

// Fulfillment stages an admin can move to (mirrors the list page + backend rules).
const ALL_STATUSES = ['awaiting_payment', 'processing', 'shipped', 'delivered', 'returned', 'cancelled'];
const SYSTEM_OWNED = ['awaiting_payment']; // payment-driven, never picked manually
const CANCEL_BLOCKED_FROM = ['delivered', 'returned', 'cancelled']; // cancel only before delivery

function getAdminNextStatuses(currentStatus: string): string[] {
  return ALL_STATUSES.filter(s => {
    if (s === currentStatus || SYSTEM_OWNED.includes(s)) return false;
    if (s === 'cancelled' && CANCEL_BLOCKED_FROM.includes(currentStatus)) return false;
    return true;
  });
}

// Fulfillment only starts once the gateway confirms payment. Until then the
// order sits in awaiting_payment and the status control stays locked.
const AWAITING_PAYMENT = 'awaiting_payment';

interface OrderItem {
  product: {
    _id: string;
    name: string;
    images: { url: string }[];
  };
  quantity: number;
  price: number;
}

interface Order {
  _id: string;
  orderNumber: string;
  createdAt: string;
  status: string;
  paymentStatus?: string;
  items: OrderItem[];
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
  subtotal: number;
  shippingCost: number;
  tax: number;
  discount: number;
  totalAmount: number;
  trackingNumber?: string;
  carrier?: {
    name?: string;
    code?: string;
    trackingUrl?: string;
  };
  shippingSlip?: {
    url?: string;
    uploadedAt?: string;
  };
  estimatedDelivery?: string;
  deliveredAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  cancelledBy?: 'admin' | 'customer' | 'system';
  user: {
    _id: string;
    name: string;
    email: string;
  };
}

export default function AdminOrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = params.id as string;
  
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);

  useEffect(() => {
    if (orderId) {
      fetchOrder();
    }
  }, [orderId]);

  const fetchOrder = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<{ order: Order }>(`/orders/${orderId}`);
      setOrder(response.order);
    } catch (err) {
      console.error('Failed to fetch order:', err);
      alert('Failed to load order details');
      router.push('/admin/orders');
    } finally {
      setLoading(false);
    }
  };

  // Runs after the admin confirms in the modal. Throws on failure so the modal
  // shows the error inline; resolves (and closes the modal) on success.
  const confirmStatusChange = async ({ note, shipping }: ConfirmStatusPayload) => {
    if (!order || !pendingStatus) return;
    setUpdating(true);
    try {
      await updateOrderStatus(orderId, { status: pendingStatus, note, shipping });
      setPendingStatus(null);
      toast.success(`Order status updated to ${pendingStatus}`);
      // Refetch so tracking number, carrier link and slip surface in the panel.
      await fetchOrder();
    } finally {
      setUpdating(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      confirmed: 'bg-blue-100 text-blue-800',
      processing: 'bg-indigo-100 text-indigo-800',
      shipped: 'bg-purple-100 text-purple-800',
      delivered: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      refunded: 'bg-gray-100 text-gray-800',
    };
    return colors[status.toLowerCase()] || 'bg-gray-100 text-gray-800';
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: 'Pending',
      confirmed: 'Confirmed',
      processing: 'Processing',
      shipped: 'Shipped',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
      refunded: 'Refunded',
    };
    return labels[status.toLowerCase()] || status;
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-4 mb-8">
          <button 
            onClick={() => router.back()}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-3xl font-bold">Order Details</h1>
        </div>
        
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6 animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="h-4 bg-gray-200 rounded"></div>
              <div className="h-4 bg-gray-200 rounded"></div>
              <div className="h-4 bg-gray-200 rounded"></div>
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6 animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-16 w-16 bg-gray-200 rounded"></div>
                  <div className="flex-1">
                    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-4 mb-8">
          <button 
            onClick={() => router.back()}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-3xl font-bold">Order Details</h1>
        </div>
        
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">Order not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-8">
        <button 
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-gray-100"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-3xl font-bold">Order Details</h1>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(order.status)}`}>
          {getStatusLabel(order.status)}
        </span>
        {['paid', 'refunded'].includes(order.paymentStatus || '') && (
          <a
            href={`/api/v1/orders/${orderId}/invoice`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            <Download className="h-4 w-4" />
            Download Invoice
          </a>
        )}
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Order Summary */}
        <div className="lg:col-span-2 space-y-6">
          {/* Items */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold">Items</h2>
            </div>
            <div className="divide-y">
              {order.items.map((item, index) => (
                <div key={index} className="p-6 flex items-center gap-4">
                  {item.product?.images && item.product.images.length > 0 ? (
                    <img 
                      src={item.product.images[0].url} 
                      alt={item.product.name}
                      className="h-16 w-16 object-cover rounded-md"
                    />
                  ) : (
                    <div className="h-16 w-16 bg-gray-200 rounded-md flex items-center justify-center">
                      <Package className="h-6 w-6 text-gray-400" />
                    </div>
                  )}
                  <div className="flex-1">
                    <h3 className="font-medium">{item.product?.name ?? '[Product no longer available]'}</h3>
                    <p className="text-gray-500 text-sm">Qty: {item.quantity}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">₹{(item.price * item.quantity).toFixed(2)}</p>
                    <p className="text-gray-500 text-sm">₹{item.price.toFixed(2)} each</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Shipping Address */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Shipping Address
              </h2>
            </div>
            <div className="p-6">
              <p className="font-medium">{order.shippingAddress.fullName}</p>
              <p className="text-gray-600">{order.shippingAddress.phone}</p>
              <p className="text-gray-600 mt-2">
                {order.shippingAddress.addressLine1}
                {order.shippingAddress.addressLine2 && `, ${order.shippingAddress.addressLine2}`}
              </p>
              <p className="text-gray-600">
                {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}
              </p>
              <p className="text-gray-600">{order.shippingAddress.country}</p>
            </div>
          </div>
        </div>
        
        {/* Order Information */}
        <div className="space-y-6">
          {/* Order Info */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold">Order Information</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-sm text-gray-500">Order Number</p>
                <p className="font-medium">#{order.orderNumber || order._id.slice(-8)}</p>
              </div>
              
              <div>
                <p className="text-sm text-gray-500">Order Date</p>
                <p className="font-medium">
                  {new Date(order.createdAt).toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>
              
              <div>
                <p className="text-sm text-gray-500">Customer</p>
                <p className="font-medium">{order.user.name}</p>
                <p className="text-gray-600 text-sm">{order.user.email}</p>
              </div>
              
              {order.trackingNumber && (
                <div>
                  <p className="text-sm text-gray-500">Tracking Number</p>
                  <p className="font-medium">{order.trackingNumber}</p>
                  {order.carrier?.name && (
                    <p className="text-gray-600 text-sm">
                      via {order.carrier.name}
                      {order.carrier.trackingUrl && (
                        <>
                          {' · '}
                          <a
                            href={order.carrier.trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            Track
                          </a>
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}

              {order.shippingSlip?.url && (
                <div>
                  <p className="text-sm text-gray-500">Shipping Slip</p>
                  <a
                    href={order.shippingSlip.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-blue-600 hover:underline font-medium"
                  >
                    <Download className="h-4 w-4" />
                    View slip (PDF)
                  </a>
                </div>
              )}

              {order.estimatedDelivery && (
                <div>
                  <p className="text-sm text-gray-500">Estimated Delivery</p>
                  <p className="font-medium">
                    {new Date(order.estimatedDelivery).toLocaleDateString('en-IN')}
                  </p>
                </div>
              )}
            </div>
          </div>
          
          {/* Order Status */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold">Order Status</h2>
            </div>
            <div className="p-6">
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Update Status
                </label>
                {order.status === AWAITING_PAYMENT ? (
                  // Fulfillment is locked until the gateway confirms payment. Payment
                  // is never set by hand — it's driven by checkout + the Razorpay webhook.
                  <div className="px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
                    Awaiting payment. Fulfillment unlocks automatically once payment
                    succeeds — payment status can’t be set manually.
                  </div>
                ) : (
                  <select
                    value={order.status}
                    onChange={(e) => setPendingStatus(e.target.value)}
                    disabled={updating}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {/* Current status shown but not re-selectable */}
                    <option value={order.status} disabled>
                      {order.status.charAt(0).toUpperCase() + order.status.slice(1)} (current)
                    </option>
                    {/* Fulfillment stages only, gated by valid transitions. Payment
                        (paid/failed/refunded) is webhook-driven, shown separately. */}
                    {getAdminNextStatuses(order.status).map((s) => (
                      <option key={s} value={s}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {order.status === 'cancelled' && (
                <div className="mt-4 p-3 bg-red-50 rounded-md">
                  <p className="text-sm font-medium text-red-800">
                    Cancelled{order.cancelledBy ? ` by ${order.cancelledBy === 'customer' ? 'Customer' : order.cancelledBy === 'admin' ? 'Admin' : 'System'}` : ''}
                  </p>
                  {order.cancellationReason && (
                    <p className="text-sm text-red-700 mt-1">Reason: {order.cancellationReason}</p>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* Order Summary */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold">Order Summary</h2>
            </div>
            <div className="p-6 space-y-3">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>₹{order.subtotal.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between">
                <span>Shipping</span>
                <span>₹{order.shippingCost.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between">
                <span>Tax</span>
                <span>₹{order.tax.toFixed(2)}</span>
              </div>
              
              {order.discount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Discount</span>
                  <span>-₹{order.discount.toFixed(2)}</span>
                </div>
              )}
              
              <div className="border-t pt-3 mt-3 flex justify-between font-semibold">
                <span>Total</span>
                <span>₹{order.totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {pendingStatus && order && (
        <ConfirmStatusChangeModal
          orderNumber={order.orderNumber}
          currentStatus={order.status}
          newStatus={pendingStatus}
          notifiesCustomer={CUSTOMER_NOTIFIED_STATUSES.includes(pendingStatus)}
          onConfirm={confirmStatusChange}
          onClose={() => setPendingStatus(null)}
        />
      )}
    </div>
  );
}