'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import apiClient from '@/lib/api';
import { API_ENDPOINTS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/lib/constants';
import { Check, CreditCard, MapPin, Package } from 'lucide-react';

type CheckoutStep = 'cart' | 'address' | 'payment' | 'review' | 'confirmation';

interface Address {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
}

export default function CheckoutPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const { cart, clearCart } = useCart();
  const [currentStep, setCurrentStep] = useState<CheckoutStep>('cart');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [address, setAddress] = useState<Address>({
    street: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'India',
    phone: '',
  });

  const [paymentMethod, setPaymentMethod] = useState<string>(PAYMENT_METHODS.COD);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, authLoading, router]);

  useEffect(() => {
    if (!cart || cart.items?.length === 0) {
      router.push('/cart');
    }
  }, [cart, router]);

  const handleAddressSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.street || !address.city || !address.state || !address.postalCode || !address.phone) {
      alert('Please fill all address fields');
      return;
    }
    setCurrentStep('payment');
  };

  const handlePlaceOrder = async () => {
    try {
      setLoading(true);
      const orderData = {
        shippingAddress: address,
        paymentMethod,
        items: cart?.items.map((item: any) => ({
          productId: item.productId._id,
          quantity: item.quantity,
          price: item.productId.price,
        })),
        totalAmount: cart?.total || 0,
      };

      const response = await apiClient.post(API_ENDPOINTS.ORDERS, orderData);
      
      // If Razorpay is selected, initiate Razorpay checkout
      if (paymentMethod === PAYMENT_METHODS.RAZORPAY) {
        await handleRazorpayCheckout(response.order._id, response.order.totalAmount);
      } else {
        // For other payment methods (COD), proceed normally
        setOrderId(response.order._id);
        await clearCart();
        setCurrentStep('confirmation');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to place order');
    } finally {
      setLoading(false);
    }
  };

  const handleRazorpayCheckout = async (orderId: string, amount: number) => {
    try {
      // Create Razorpay order
      const razorpayResponse = await apiClient.post('/razorpay/create-order', {
        orderId,
        amount: Math.round(amount * 100), // Convert to paise
        currency: 'INR'
      });

      if (!razorpayResponse.success) {
        throw new Error('Failed to create Razorpay order');
      }

      const razorpayOptions = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: razorpayResponse.data.amount,
        currency: razorpayResponse.data.currency,
        name: 'Autobacs India',
        description: `Order #${orderId}`,
        order_id: razorpayResponse.data.orderId,
        handler: async function (response: any) {
          try {
            // Verify payment
            const verifyResponse = await apiClient.post('/razorpay/verify-payment', {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            });

            if (verifyResponse.success) {
              // Payment successful, update UI
              setOrderId(orderId);
              await clearCart();
              setCurrentStep('confirmation');
            } else {
              alert('Payment verification failed');
            }
          } catch (err: any) {
            alert(err.message || 'Payment verification failed');
          }
        },
        prefill: {
          name: user?.name || '',
          email: user?.email || '',
        },
        theme: {
          color: '#3399cc'
        }
      };

      // Load Razorpay SDK dynamically
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      document.body.appendChild(script);

      script.onload = () => {
        // @ts-ignore
        const rzp = new window.Razorpay(razorpayOptions);
        rzp.open();
      };

      script.onerror = () => {
        alert('Failed to load Razorpay SDK. Please try again.');
      };
    } catch (err: any) {
      alert(err.message || 'Failed to initiate Razorpay payment');
    }
  };

  if (authLoading || !isAuthenticated) {
    return null;
  }

  if (currentStep === 'confirmation' && orderId) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-2xl mx-auto text-center">
          <div className="bg-green-100 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
            <Check className="h-12 w-12 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold mb-4">Order Placed Successfully!</h1>
          <p className="text-gray-600 mb-2">Thank you for your order</p>
          <p className="text-lg font-semibold mb-8">Order ID: #{orderId}</p>
          <div className="flex gap-4 justify-center">
            <button
              onClick={() => router.push(`/orders/${orderId}`)}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700"
            >
              View Order Details
            </button>
            <button
              onClick={() => router.push('/products')}
              className="bg-gray-200 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-300"
            >
              Continue Shopping
            </button>
          </div>
        </div>
      </div>
    );
  }

  const steps: { id: CheckoutStep; label: string; icon: any }[] = [
    { id: 'cart', label: 'Cart', icon: Package },
    { id: 'address', label: 'Shipping', icon: MapPin },
    { id: 'payment', label: 'Payment', icon: CreditCard },
    { id: 'review', label: 'Review', icon: Check },
  ];

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Checkout</h1>

      {/* Progress Steps */}
      <div className="flex items-center justify-center mb-12">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isActive = step.id === currentStep;
          const isCompleted = steps.findIndex(s => s.id === currentStep) > index;

          return (
            <div key={step.id} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    isActive ? 'bg-blue-600 text-white' : isCompleted ? 'bg-green-600 text-white' : 'bg-gray-200'
                  }`}
                >
                  <Icon className="h-6 w-6" />
                </div>
                <span className="text-sm mt-2">{step.label}</span>
              </div>
              {index < steps.length - 1 && (
                <div className={`w-24 h-1 mx-4 ${isCompleted ? 'bg-green-600' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Cart Review */}
      {currentStep === 'cart' && (
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold mb-4">Review Your Cart</h2>
          <div className="space-y-4 mb-8">
            {cart?.items.map((item: any) => (
              <div key={item._id} className="flex items-center gap-4 border rounded-lg p-4">
                <div className="w-20 h-20 bg-gray-100 rounded"></div>
                <div className="flex-1">
                  <h3 className="font-semibold">{item.productId.name}</h3>
                  <p className="text-gray-600">Quantity: {item.quantity}</p>
                </div>
                <p className="font-bold">₹{(item.productId.price * item.quantity).toFixed(2)}</p>
              </div>
            ))}
          </div>
          <div className="bg-gray-50 p-6 rounded-lg mb-6">
            <div className="flex justify-between text-xl font-bold">
              <span>Total:</span>
              <span>₹{cart?.total?.toFixed(2)}</span>
            </div>
          </div>
          <button
            onClick={() => setCurrentStep('address')}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700"
          >
            Continue to Shipping
          </button>
        </div>
      )}

      {/* Shipping Address */}
      {currentStep === 'address' && (
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold mb-4">Shipping Address</h2>
          <form onSubmit={handleAddressSubmit} className="space-y-4">
            <input
              type="text"
              placeholder="Street Address"
              value={address.street}
              onChange={(e) => setAddress({ ...address, street: e.target.value })}
              className="w-full border rounded-lg px-4 py-2"
              required
            />
            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                placeholder="City"
                value={address.city}
                onChange={(e) => setAddress({ ...address, city: e.target.value })}
                className="border rounded-lg px-4 py-2"
                required
              />
              <input
                type="text"
                placeholder="State"
                value={address.state}
                onChange={(e) => setAddress({ ...address, state: e.target.value })}
                className="border rounded-lg px-4 py-2"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                placeholder="Postal Code"
                value={address.postalCode}
                onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
                className="border rounded-lg px-4 py-2"
                required
              />
              <input
                type="tel"
                placeholder="Phone"
                value={address.phone}
                onChange={(e) => setAddress({ ...address, phone: e.target.value })}
                className="border rounded-lg px-4 py-2"
                required
              />
            </div>
            <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700">
              Continue to Payment
            </button>
          </form>
        </div>
      )}

      {/* Payment Method */}
      {currentStep === 'payment' && (
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold mb-4">Payment Method</h2>
          <div className="space-y-4 mb-8">
            {[
              { value: PAYMENT_METHODS.COD, label: PAYMENT_METHOD_LABELS[PAYMENT_METHODS.COD] },
              { value: PAYMENT_METHODS.RAZORPAY, label: PAYMENT_METHOD_LABELS[PAYMENT_METHODS.RAZORPAY] }
            ].map((method) => (
              <label key={method.value} className="flex items-center gap-4 border rounded-lg p-4 cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="payment"
                  value={method.value}
                  checked={paymentMethod === method.value}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-4 h-4"
                />
                <span className="font-medium">{method.label}</span>
              </label>
            ))}
          </div>
          <button
            onClick={() => setCurrentStep('review')}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700"
          >
            Continue to Review
          </button>
        </div>
      )}

      {/* Review Order */}
      {currentStep === 'review' && (
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold mb-4">Review Your Order</h2>
          <div className="bg-gray-50 p-6 rounded-lg mb-6 space-y-4">
            <div>
              <h3 className="font-bold mb-2">Shipping Address</h3>
              <p>{address.street}</p>
              <p>{address.city}, {address.state} {address.postalCode}</p>
              <p>{address.phone}</p>
            </div>
            <div>
              <h3 className="font-bold mb-2">Payment Method</h3>
              <p>{PAYMENT_METHOD_LABELS[paymentMethod] || paymentMethod}</p>
            </div>
            <div>
              <h3 className="font-bold mb-2">Order Total</h3>
              <p className="text-2xl font-bold text-blue-600">₹{cart?.total?.toFixed(2)}</p>
            </div>
          </div>
          <button
            onClick={handlePlaceOrder}
            disabled={loading}
            className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 disabled:bg-gray-300"
          >
            {loading ? 'Placing Order...' : 'Place Order'}
          </button>
        </div>
      )}
    </div>
  );
}
