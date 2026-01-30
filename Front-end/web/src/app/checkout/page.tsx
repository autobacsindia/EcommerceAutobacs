'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import apiClient from '@/lib/api';
import { API_ENDPOINTS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/lib/constants';
import { Check, CreditCard, MapPin, Package, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useRazorpay } from '@/hooks/useRazorpay';
import PaymentMethodSelector from '@/components/checkout/PaymentMethodSelector';

type CheckoutStep = 'cart' | 'address' | 'payment' | 'review' | 'confirmation';

interface Address {
  fullName: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault?: boolean;
}

interface SavedAddress {
  fullName: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault?: boolean;
}

export default function CheckoutPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const { cart, clearCart } = useCart();
  const [currentStep, setCurrentStep] = useState<CheckoutStep>('cart');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  const { processPayment, isProcessing: isRazorpayProcessing } = useRazorpay({
    onSuccess: async (orderId) => {
      setOrderId(orderId);
      await clearCart();
      setCurrentStep('confirmation');
    },
    onFailure: (error) => {
      if (error.message !== 'Payment cancelled') {
        console.error('Payment failed:', error);
      }
    }
  });

  const [address, setAddress] = useState<Address>({
    fullName: '',
    street: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'India',
    phone: '',
  });

  const [paymentMethod, setPaymentMethod] = useState<string>(PAYMENT_METHODS.COD);
  
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [shouldSaveAddress, setShouldSaveAddress] = useState(false);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [selectedAddressIndex, setSelectedAddressIndex] = useState<number | null>(null);

  useEffect(() => {
    const fetchProfile = async () => {
      if (isAuthenticated) {
        try {
          const response = await apiClient.get('/profile') as any;
          if (response.success && response.user && response.user.addresses) {
            setSavedAddresses(response.user.addresses);
            if (response.user.addresses.length === 0) {
              setShowAddressForm(true);
              if (user?.name) {
                setAddress(prev => ({ ...prev, fullName: user.name }));
              }
            } else {
              // Pre-select default address if exists
              const defaultIndex = response.user.addresses.findIndex((a: any) => a.isDefault);
              if (defaultIndex !== -1) {
                setSelectedAddressIndex(defaultIndex);
                const addr = response.user.addresses[defaultIndex];
                setAddress({
                  fullName: addr.fullName,
                  street: addr.addressLine1,
                  city: addr.city,
                  state: addr.state,
                  postalCode: addr.postalCode,
                  country: addr.country,
                  phone: addr.phone
                });
              }
            }
          } else {
             setShowAddressForm(true);
             if (user?.name) {
               setAddress(prev => ({ ...prev, fullName: user.name }));
             }
          }
        } catch (error) {
          console.error('Failed to fetch profile', error);
          setShowAddressForm(true);
        }
      }
    };
    fetchProfile();
  }, [isAuthenticated]); // removed user dependency to avoid infinite loop if user object changes

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

  const handleAddressSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!showAddressForm && selectedAddressIndex !== null) {
       setCurrentStep('payment');
       return;
    }

    if (!address.fullName || !address.street || !address.city || !address.state || !address.postalCode || !address.phone) {
      toast.error('Please fill all address fields');
      return;
    }

    if (shouldSaveAddress) {
      try {
        const newAddress: SavedAddress = {
          fullName: address.fullName,
          addressLine1: address.street,
          city: address.city,
          state: address.state,
          postalCode: address.postalCode,
          country: address.country,
          phone: address.phone,
          isDefault: savedAddresses.length === 0
        };

        const updatedAddresses = [...savedAddresses, newAddress];

        await apiClient.put('/profile', {
          name: user?.name,
          email: user?.email,
          addresses: updatedAddresses
        });

        setSavedAddresses(updatedAddresses);
        toast.success('Address saved to profile');
      } catch (error) {
        console.error('Failed to save address', error);
        // Continue anyway
      }
    }

    setCurrentStep('payment');
  };

  const handlePlaceOrder = async () => {
    try {
      setLoading(true);
      
      const subtotal = cart?.total || 0;
      const tax = subtotal * 0.18;
      const totalAmount = subtotal + tax;
      
      const orderData = {
        shippingAddress: {
          fullName: address.fullName,
          addressLine1: address.street,
          city: address.city,
          state: address.state,
          postalCode: address.postalCode,
          country: address.country,
          phone: address.phone
        },
        paymentMethod,
        items: cart?.items.map((item: any) => ({
          product: item.product._id, // Backend expects 'product' not 'productId' in items array
          quantity: item.quantity,
          price: item.product.price,
        })),
        subtotal,
        tax,
        shippingCost: 0,
        discount: 0,
        totalAmount,
      };

      const response = await apiClient.post(API_ENDPOINTS.ORDERS, orderData) as any;
      const newOrderId = response.order._id;
      
      // If Razorpay is selected, initiate Razorpay checkout
      if (paymentMethod === PAYMENT_METHODS.RAZORPAY) {
        await processPayment(newOrderId, response.order.totalAmount, {
           name: user?.name || address.fullName,
           email: user?.email || '',
           phone: address.phone
        });
      } else {
        // For other payment methods (COD), proceed normally
        setOrderId(newOrderId);
        await clearCart();
        setCurrentStep('confirmation');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to place order');
    } finally {
      setLoading(false);
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
          
          <div className="bg-gray-50 rounded-lg p-6 mb-8 max-w-md mx-auto text-left">
            <h3 className="font-semibold text-lg mb-4 text-center">Payment Details</h3>
            <div className="flex justify-between mb-2">
              <span className="text-gray-600">Method</span>
              <span className="font-medium">{PAYMENT_METHOD_LABELS[paymentMethod]}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Status</span>
              <span className="font-medium text-green-600">
                {paymentMethod === PAYMENT_METHODS.COD ? 'Pending' : 'Success'}
              </span>
            </div>
          </div>

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
              <div key={item.product._id} className="flex items-center gap-4 border rounded-lg p-4">
                <div className="w-20 h-20 bg-gray-100 rounded"></div>
                <div className="flex-1">
                  <h3 className="font-semibold">{item.product.name}</h3>
                  <p className="text-gray-600">Quantity: {item.quantity}</p>
                </div>
                <p className="font-bold">₹{(item.product.price * item.quantity).toFixed(2)}</p>
              </div>
            ))}
          </div>
          <div className="bg-gray-50 p-6 rounded-lg mb-6">
            <div className="space-y-3 mb-4 border-b pb-4">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal:</span>
                <span>₹{cart?.total?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Shipping:</span>
                <span className="text-green-600">FREE</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Tax (18% GST):</span>
                <span>₹{((cart?.total || 0) * 0.18).toFixed(2)}</span>
              </div>
            </div>
            <div className="flex justify-between text-xl font-bold">
              <span>Total:</span>
              <span>₹{((cart?.total || 0) * 1.18).toFixed(2)}</span>
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
          
          {/* Saved Addresses List */}
          {!showAddressForm && savedAddresses.length > 0 && (
            <div className="space-y-4 mb-6">
              {savedAddresses.map((addr, index) => (
                <div 
                  key={index} 
                  className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                    selectedAddressIndex === index 
                      ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' 
                      : 'border-gray-200 hover:border-blue-300'
                  }`}
                  onClick={() => {
                    setSelectedAddressIndex(index);
                    setAddress({
                      fullName: addr.fullName,
                      street: addr.addressLine1,
                      city: addr.city,
                      state: addr.state,
                      postalCode: addr.postalCode,
                      country: addr.country,
                      phone: addr.phone
                    });
                  }}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-semibold">{addr.fullName}</p>
                      <p className="text-gray-600">{addr.addressLine1}</p>
                      <p className="text-gray-600">{addr.city}, {addr.state} {addr.postalCode}</p>
                      <p className="text-gray-600">{addr.phone}</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm('Are you sure you want to delete this address?')) return;
                          
                          const newAddresses = savedAddresses.filter((_, i) => i !== index);
                          try {
                            await apiClient.put('/profile', {
                              name: user?.name,
                              email: user?.email,
                              addresses: newAddresses
                            });
                            setSavedAddresses(newAddresses);
                            if (selectedAddressIndex === index) {
                              setSelectedAddressIndex(null);
                            } else if (selectedAddressIndex !== null && selectedAddressIndex > index) {
                              setSelectedAddressIndex(selectedAddressIndex - 1);
                            }
                            toast.success('Address deleted');
                          } catch (error) {
                            console.error('Failed to delete address', error);
                            toast.error('Failed to delete address');
                          }
                        }}
                        className="text-gray-400 hover:text-red-500 p-1"
                        title="Delete address"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      {selectedAddressIndex === index && (
                        <div className="bg-blue-600 text-white p-1 rounded-full">
                          <Check className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              
              <button
                onClick={() => {
                  setShowAddressForm(true);
                  setSelectedAddressIndex(null);
                  setAddress({
                    fullName: user?.name || '',
                    street: '',
                    city: '',
                    state: '',
                    postalCode: '',
                    country: 'India',
                    phone: ''
                  });
                }}
                className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-500 hover:text-blue-600 flex items-center justify-center gap-2 transition-colors"
              >
                <Plus className="h-5 w-5" />
                Add New Address
              </button>

              <button 
                onClick={handleAddressSubmit}
                disabled={selectedAddressIndex === null}
                className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed mt-4"
              >
                Deliver to this address
              </button>
            </div>
          )}

          {/* New Address Form */}
          {showAddressForm && (
            <form onSubmit={handleAddressSubmit} className="space-y-4">
               {/* Header if canceling */}
               {savedAddresses.length > 0 && (
                 <button 
                    type="button"
                    onClick={() => setShowAddressForm(false)}
                    className="text-sm text-blue-600 hover:underline mb-4"
                 >
                    &larr; Back to saved addresses
                 </button>
               )}

            <input
              type="text"
              placeholder="Full Name"
              value={address.fullName}
              onChange={(e) => setAddress({ ...address, fullName: e.target.value })}
              className="w-full border rounded-lg px-4 py-2"
              required
            />
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

            <div className="flex items-center gap-2 mt-2">
                <input
                    type="checkbox"
                    id="saveAddress"
                    checked={shouldSaveAddress}
                    onChange={(e) => setShouldSaveAddress(e.target.checked)}
                    className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <label htmlFor="saveAddress" className="text-sm text-gray-700">Save this address for future orders</label>
            </div>

            <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 mt-4">
              Continue to Payment
            </button>
          </form>
          )}
        </div>
      )}

      {/* Payment Method */}
      {currentStep === 'payment' && (
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold mb-4">Payment Method</h2>
          <div className="mb-8">
            <PaymentMethodSelector selectedMethod={paymentMethod} onSelect={setPaymentMethod} />
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
              <h3 className="font-bold mb-2">Order Summary</h3>
              <div className="flex justify-between text-sm mb-1">
                <span>Subtotal:</span>
                <span>₹{cart?.total?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm mb-1">
                <span>Tax (18% GST):</span>
                <span>₹{((cart?.total || 0) * 0.18).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xl font-bold text-blue-600 border-t pt-2 mt-2">
                <span>Total:</span>
                <span>₹{((cart?.total || 0) * 1.18).toFixed(2)}</span>
              </div>
            </div>
          </div>
          <button
            onClick={handlePlaceOrder}
            disabled={loading || isRazorpayProcessing}
            className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading || isRazorpayProcessing ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              'Place Order'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
