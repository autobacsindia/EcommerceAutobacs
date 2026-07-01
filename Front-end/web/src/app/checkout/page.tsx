'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import apiClient from '@/lib/api';
import {
  trackBeginCheckout, trackPurchase, trackViewCart, trackCheckoutStep,
  trackAddPaymentInfo, trackCheckoutAbandoned,
} from '@/lib/analytics';
import orderService from '@/lib/services/orderService';
import { API_ENDPOINTS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/lib/constants';
import { Check, CreditCard, MapPin, Package, Loader2, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useRazorpay } from '@/hooks/useRazorpay';
import PaymentMethodSelector from '@/components/checkout/PaymentMethodSelector';
import CheckoutErrorBoundary from '@/components/checkout/CheckoutErrorBoundary';
import CheckoutSummary from '@/components/checkout/CheckoutSummary';
import type { CheckoutQuote } from '@/hooks/useCheckoutQuote';

type CheckoutStep = 'cart' | 'address' | 'payment' | 'review' | 'confirmation';

interface ServerValidation {
  subtotal: number;
  tax: number;
  total: number;
  items: Array<{ productId: string; name: string; quantity: number; unitPrice: number; lineTotal: number }>;
}

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
  return (
    <CheckoutErrorBoundary feature="checkout">
      <CheckoutPageContent />
    </CheckoutErrorBoundary>
  );
}

function CheckoutPageContent() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const { cart, clearCart, isLoading: cartLoading, refreshCart } = useCart();
  const [currentStep, setCurrentStep] = useState<CheckoutStep>('cart');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stockValidationErrors, setStockValidationErrors] = useState<any[]>([]);
  const [serverValidation, setServerValidation] = useState<ServerValidation | null>(null);
  const [priceConfirmationPending, setPriceConfirmationPending] = useState(false);
  // Coupon + karma selections and the server-computed breakdown (display + intent;
  // the order total is recomputed authoritatively server-side at creation).
  const [pricing, setPricing] = useState<{ couponCode?: string; redeemKarmaPoints: number; quote: CheckoutQuote | null }>({
    redeemKarmaPoints: 0,
    quote: null,
  });

  const isGuest = !authLoading && !isAuthenticated;

  // ── Analytics funnel (ADR-005) ──────────────────────────────────────────────
  const beganCheckoutRef = useRef(false);
  const purchasedRef = useRef(false);
  const lastCartTotalRef = useRef(0);
  const lastItemCountRef = useRef(0);
  const lastStepRef = useRef<CheckoutStep>('cart');
  useEffect(() => {
    if (cart?.total) lastCartTotalRef.current = cart.total;
    if (cart?.items?.length) lastItemCountRef.current = cart.items.length;
  }, [cart?.total, cart?.items?.length]);
  // begin_checkout + view_cart — once, when the checkout loads with items.
  useEffect(() => {
    if (!beganCheckoutRef.current && cart && cart.items.length > 0) {
      beganCheckoutRef.current = true;
      trackViewCart({ value: cart.total, itemCount: cart.items.length });
      trackBeginCheckout({ value: cart.total, itemCount: cart.items.length });
    }
  }, [cart?.items?.length]);
  // checkout_step — each step the shopper reaches (step-by-step drop-off).
  useEffect(() => {
    lastStepRef.current = currentStep;
    if (currentStep !== 'confirmation') {
      trackCheckoutStep({ step: currentStep, value: lastCartTotalRef.current, itemCount: lastItemCountRef.current });
    }
  }, [currentStep]);
  // purchase — once, when the order reaches the confirmation step.
  useEffect(() => {
    if (currentStep === 'confirmation' && orderId) {
      purchasedRef.current = true;
      trackPurchase({ orderId, value: lastCartTotalRef.current, itemCount: lastItemCountRef.current });
    }
  }, [currentStep, orderId]);
  // checkout_abandoned — left the flow (navigated away or closed tab) without buying.
  useEffect(() => {
    const fireAbandon = () => {
      if (beganCheckoutRef.current && !purchasedRef.current) {
        purchasedRef.current = true; // guard against double-fire (pagehide + unmount)
        trackCheckoutAbandoned({
          lastStep: lastStepRef.current,
          value: lastCartTotalRef.current,
          itemCount: lastItemCountRef.current,
        });
      }
    };
    window.addEventListener('pagehide', fireAbandon);
    return () => {
      window.removeEventListener('pagehide', fireAbandon);
      fireAbandon();
    };
  }, []);
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');

  const { processPayment, isProcessing: isRazorpayProcessing } = useRazorpay({
    onSuccess: async (orderId) => {
      setOrderId(orderId);
      await clearCart();
      setCurrentStep('confirmation');
    },
    onFailure: (error) => {
      if (error.message !== 'Payment cancelled') console.error('Payment failed:', error);
    }
  });

  const [address, setAddress] = useState<Address>({
    fullName: '', street: '', city: '', state: '', postalCode: '', country: 'India', phone: '',
  });

  const [paymentMethod, setPaymentMethod] = useState<string>(PAYMENT_METHODS.RAZORPAY);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [shouldSaveAddress, setShouldSaveAddress] = useState(false);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [selectedAddressIndex, setSelectedAddressIndex] = useState<number | null>(null);

  useEffect(() => {
    const validateCartStock = async () => {
      if (!cart || cart.items.length === 0) return;
      try {
        const response: any = await apiClient.post(API_ENDPOINTS.CART_VALIDATE_CHECKOUT, {});
        if (!response.isValid) {
          setStockValidationErrors(response.validationErrors || []);
          (response.validationErrors || []).forEach((error: any) => {
            toast.error(error.message, { icon: '⚠️', duration: 5000 });
          });
          await refreshCart();
        } else {
          setStockValidationErrors([]);
        }
      } catch (error) {
        setStockValidationErrors([{ message: 'Unable to validate stock availability' }]);
      }
    };
    if (currentStep === 'cart' && cart && cart.items.length > 0) validateCartStock();
  }, [currentStep, cart?.items?.length]);

  useEffect(() => {
    const fetchProfile = async () => {
      if (isAuthenticated) {
        try {
          const response = await apiClient.get('/profile') as any;
          if (response.success && response.user && response.user.addresses) {
            setSavedAddresses(response.user.addresses);
            if (response.user.addresses.length === 0) {
              setShowAddressForm(true);
              if (user?.name) setAddress(prev => ({ ...prev, fullName: user.name }));
            } else {
              const defaultIndex = response.user.addresses.findIndex((a: any) => a.isDefault);
              if (defaultIndex !== -1) {
                setSelectedAddressIndex(defaultIndex);
                const addr = response.user.addresses[defaultIndex];
                setAddress({ fullName: addr.fullName, street: addr.addressLine1, city: addr.city, state: addr.state, postalCode: addr.postalCode, country: addr.country, phone: addr.phone });
              }
            }
          } else {
            setShowAddressForm(true);
            if (user?.name) setAddress(prev => ({ ...prev, fullName: user.name }));
          }
        } catch (error) {
          setShowAddressForm(true);
        }
      } else {
        setShowAddressForm(true);
      }
    };
    fetchProfile();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!authLoading && !cartLoading) {
      if (!cart || cart.items?.length === 0) router.push('/cart');
    }
  }, [cart, router, authLoading, cartLoading]);

  const handleAddressSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAddressForm && selectedAddressIndex !== null) { setCurrentStep('payment'); return; }
    if (!address.fullName || !address.street || !address.city || !address.state || !address.postalCode || !address.phone) {
      toast.error('Please fill all address fields');
      return;
    }
    if (shouldSaveAddress && isAuthenticated) {
      try {
        const newAddress: SavedAddress = { fullName: address.fullName, addressLine1: address.street, city: address.city, state: address.state, postalCode: address.postalCode, country: address.country, phone: address.phone, isDefault: savedAddresses.length === 0 };
        const updatedAddresses = [...savedAddresses, newAddress];
        await apiClient.put('/profile', { name: user?.name, email: user?.email, addresses: updatedAddresses });
        setSavedAddresses(updatedAddresses);
        toast.success('Address saved to profile');
      } catch (error) {
        console.error('Failed to save address', error);
      }
    }
    setCurrentStep('payment');
  };

  // Step 1: validate prices server-side, then either proceed or pause for confirmation.
  const handlePlaceOrder = async () => {
    if (isGuest && !guestEmail && !guestPhone) {
      toast.error('Please enter email or phone number for guest checkout');
      return;
    }
    setLoading(true);
    setPriceConfirmationPending(false);
    try {
      const validation = await apiClient.get(API_ENDPOINTS.CART_VALIDATE) as any;

      if (!validation.success) {
        toast.error('Unable to validate cart. Please try again.');
        return;
      }

      if (!validation.isValid) {
        setStockValidationErrors(validation.stockErrors || []);
        await refreshCart();
        setCurrentStep('cart');
        toast.error('Some items have changed. Please review your cart before proceeding.');
        return;
      }

      const validated: ServerValidation = {
        subtotal: validation.subtotal,
        tax: validation.tax,
        total: validation.total,
        items: validation.items,
      };

      // Detect price drift: compare server subtotal vs CartContext's pre-tax total.
      // Tolerance of ₹0.50 absorbs floating-point rounding in older cart documents.
      const clientSubtotal = cart?.total || 0;
      const priceDrifted = Math.abs(validated.subtotal - clientSubtotal) > 0.5;

      if (priceDrifted) {
        setServerValidation(validated);
        setPriceConfirmationPending(true);
        return; // Pause — UI will render the confirmation banner
      }

      setServerValidation(validated);
      await placeOrderWithValidation(validated);
    } catch (err: any) {
      toast.error(err.message || 'Failed to validate cart');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: place the order using server-validated prices.
  // Called directly when prices are unchanged, or after the user confirms a price change.
  const placeOrderWithValidation = async (validated: ServerValidation) => {
    setLoading(true);
    setPriceConfirmationPending(false);
    try {
      const orderData = {
        ...(isGuest && { email: guestEmail, phone: guestPhone }),
        shippingAddress: {
          fullName: address.fullName, addressLine1: address.street,
          city: address.city, state: address.state, postalCode: address.postalCode,
          country: address.country, phone: address.phone
        },
        paymentMethod,
        items: validated.items.map(item => ({
          product: item.productId,
          quantity: item.quantity,
          price: item.unitPrice,
        })),
        subtotal: validated.subtotal,
        tax: validated.tax,
        shippingCost: 0,
        // Coupon + karma intent. The backend recomputes the authoritative discount
        // and totalAmount server-side (client values below are ignored for pricing).
        couponCode: pricing.couponCode,
        redeemKarmaPoints: pricing.redeemKarmaPoints || 0,
        discount: pricing.quote?.discount ?? 0,
        totalAmount: pricing.quote?.totalAmount ?? validated.total,
      };

      const endpoint = isGuest ? '/orders/guest' : '/orders';
      const response = await apiClient.post(endpoint, orderData) as any;
      const newOrderId = response.order._id;
      // Authoritative charged amount comes back on the created order (post-discount).
      const chargedTotal = response.order.totalAmount ?? pricing.quote?.totalAmount ?? validated.total;

      if (isGuest) {
        localStorage.setItem('pendingClaim', JSON.stringify({
          orderId: newOrderId, email: guestEmail, phone: guestPhone,
          magicToken: response.magicLinkToken
        }));
      }

      if (paymentMethod === PAYMENT_METHODS.RAZORPAY) {
        // Pass the post-discount charged total as a hint for the Razorpay modal display.
        // The backend /razorpay/create-order ignores this and uses order.totalAmount
        // from the DB — the browser never controls the charged amount.
        await processPayment(newOrderId, chargedTotal, {
          name: user?.name || address.fullName,
          email: user?.email || guestEmail || '',
          phone: address.phone,
        });
      } else {
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

  if (authLoading || cartLoading) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-gold mx-auto"></div>
          <p className="mt-4 text-ink/70 font-display">Loading checkout...</p>
        </div>
      </div>
    );
  }

  if (currentStep === 'confirmation' && orderId) {
    const isGuestOrder = typeof window !== 'undefined' ? localStorage.getItem('pendingClaim') : null;
    return (
      <div className="min-h-screen bg-obsidian-deep py-16">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <div className="bg-green-500/10 border border-green-500/30 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
            <Check className="h-12 w-12 text-green-400" />
          </div>
          <p className="text-gold font-display font-bold text-sm uppercase tracking-widest mb-2">Success</p>
          <h1 className="text-3xl font-display font-bold text-ink uppercase tracking-wide mb-4">Order Placed!</h1>
          <p className="text-ink/70 font-display mb-2">Thank you for your order</p>
          <p className="text-lg font-display font-bold text-gold mb-8">Order ID: #{orderId}</p>

          {isGuestOrder && (
            <div className="bg-obsidian border border-gold/30 rounded-sm p-6 mb-8 text-left">
              <h3 className="font-display font-bold text-ink uppercase tracking-wide text-xl mb-3">
                Claim Your Account
              </h3>
              <p className="text-ink/70 font-display mb-4">
                We&apos;ve sent a magic link to your email. Click the link to:
              </p>
              <ul className="text-ink/70 font-display mb-6 space-y-2 text-sm">
                <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Track your order in real-time</li>
                <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Get shipping updates</li>
                <li className="flex items-center gap-2"><span className="text-green-400">✓</span> View order history</li>
                <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Easy returns &amp; support</li>
              </ul>
              <a href={`/claim-order?orderId=${orderId}`} className="inline-block bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest px-8 py-3 rounded-sm transition-colors">
                Claim My Account
              </a>
              <p className="text-xs text-ink-muted font-display mt-3">Or check your email for the magic link</p>
            </div>
          )}

          <div className="bg-obsidian border border-hairline rounded-sm p-6 mb-8 max-w-md mx-auto text-left">
            <h3 className="font-display font-bold text-ink uppercase tracking-widest text-sm mb-4">Payment Details</h3>
            <div className="flex justify-between mb-3 text-sm">
              <span className="text-ink-muted font-display">Method</span>
              <span className="text-ink/70 font-display font-bold">{PAYMENT_METHOD_LABELS[paymentMethod]}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-ink-muted font-display">Status</span>
              <span className="font-display font-bold text-green-400">
                Success
              </span>
            </div>
          </div>

          <div className="flex gap-4 justify-center">
            <button onClick={() => router.push(`/orders/${orderId}`)} className="bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors">
              View Order Details
            </button>
            <button onClick={() => { localStorage.removeItem('pendingClaim'); router.push('/products'); }} className="bg-obsidian-raised border border-hairline text-ink/70 hover:text-ink font-display font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors">
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

  const inputClass = 'w-full bg-obsidian-raised border border-hairline text-ink placeholder:text-ink-muted rounded-sm px-4 py-2.5 focus:outline-none focus:border-gold font-display text-sm transition-colors';

  return (
    <div className="min-h-screen bg-obsidian-deep py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="mb-8">
          <p className="text-gold font-display font-bold text-sm uppercase tracking-widest mb-1">Secure</p>
          <h1 className="text-3xl font-display font-bold text-ink uppercase tracking-wide">Checkout</h1>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-12">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = step.id === currentStep;
            const isCompleted = steps.findIndex(s => s.id === currentStep) > index;
            return (
              <div key={step.id} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isActive ? 'bg-gold text-obsidian' : isCompleted ? 'bg-green-500/20 border border-green-500/50 text-green-400' : 'bg-obsidian-raised border border-hairline text-obsidian-muted'}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className={`text-xs mt-2 font-display font-bold uppercase tracking-widest ${isActive ? 'text-gold' : isCompleted ? 'text-green-400' : 'text-ink-muted'}`}>{step.label}</span>
                </div>
                {index < steps.length - 1 && (
                  <div className={`w-16 sm:w-24 h-px mx-2 sm:mx-4 ${isCompleted ? 'bg-green-500/50' : 'bg-obsidian-raised'}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Cart Review */}
        {currentStep === 'cart' && (
          <div>
            <h2 className="text-xl font-display font-bold text-ink uppercase tracking-wide mb-4">Review Your Cart</h2>

            {stockValidationErrors.length > 0 && (
              <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-sm p-4">
                <h3 className="font-display font-bold text-red-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Stock Availability Issues
                </h3>
                <ul className="space-y-2">
                  {stockValidationErrors.map((error, idx) => (
                    <li key={idx} className="text-red-300 text-sm font-display flex items-start gap-2">
                      <span className="text-red-400 mt-1">·</span>
                      <span>
                        {error.name ? <strong>{error.name}:</strong> : null}{' '}
                        {error.message}
                        {error.availableStock !== undefined && (
                          <span className="block text-xs mt-1 text-red-400">Available: {error.availableStock} | In cart: {error.requestedQuantity}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-ink-muted font-display mt-3">Please update your cart before proceeding to checkout.</p>
              </div>
            )}

            <div className="space-y-3 mb-8">
              {cart?.items.map((item: any) => (
                <div key={item.product._id} className="flex items-center gap-4 bg-obsidian border border-hairline rounded-sm p-4">
                  <div className="w-16 h-16 bg-obsidian-raised border border-hairline rounded-sm shrink-0" />
                  <div className="flex-1">
                    <h3 className="font-display font-bold text-ink uppercase tracking-wide text-sm">{item.product.name}</h3>
                    <p className="text-ink-muted font-display text-xs mt-0.5">Qty: {item.quantity}</p>
                  </div>
                  <p className="font-display font-bold text-gold">₹{(item.product.price * item.quantity).toFixed(2)}</p>
                </div>
              ))}
            </div>

            <div className="bg-obsidian border border-hairline rounded-sm p-6 mb-6">
              <div className="space-y-3 mb-4 border-b border-hairline pb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-ink-muted font-display">Subtotal</span>
                  <span className="text-ink/70 font-display">₹{((cart?.total || 0) / 1.18).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-ink-muted font-display">Shipping</span>
                  <span className="text-ink-muted font-display text-xs">Calculated at delivery</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-ink-muted font-display">Tax (18% GST)</span>
                  <span className="text-ink/70 font-display">₹{((cart?.total || 0) - (cart?.total || 0) / 1.18).toFixed(2)}</span>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="font-display font-bold text-ink uppercase tracking-wide">Total</span>
                <span className="text-xl font-display font-bold text-gold">₹{(cart?.total || 0).toFixed(2)}</span>
              </div>
            </div>

            <button
              onClick={() => setCurrentStep('address')}
              disabled={stockValidationErrors.length > 0}
              className="w-full bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest py-3 rounded-sm disabled:bg-obsidian-raised disabled:text-obsidian-muted disabled:cursor-not-allowed transition-colors"
            >
              Continue to Shipping
            </button>
          </div>
        )}

        {/* Shipping Address */}
        {currentStep === 'address' && (
          <div>
            <h2 className="text-xl font-display font-bold text-ink uppercase tracking-wide mb-6">Shipping Address</h2>

            {!isAuthenticated && (
              <div className="mb-6 bg-obsidian border border-hairline rounded-sm p-6">
                <h3 className="font-display font-bold text-ink uppercase tracking-wide mb-4 flex items-center gap-2">
                  <span className="text-xl">📧</span>
                  Contact Information
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1">Email Address</label>
                    <input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="your@email.com" className={inputClass} required={!guestPhone} />
                  </div>
                  <div>
                    <label className="block text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-1">Phone Number</label>
                    <input type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="+91 98765 43210" className={inputClass} required={!guestEmail} />
                  </div>
                  <div className="bg-gold/10 border border-gold/30 rounded-sm p-4">
                    <p className="text-sm text-ink/70 font-display">
                      <span className="text-gold font-display font-bold">Quick Checkout:</span> No account needed! We&apos;ll send you a magic link to track your order.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!showAddressForm && savedAddresses.length > 0 && (
              <div className="space-y-4 mb-6">
                {savedAddresses.map((addr, index) => (
                  <div
                    key={index}
                    className={`border rounded-sm p-4 cursor-pointer transition-colors ${selectedAddressIndex === index ? 'border-gold bg-gold/5' : 'border-hairline bg-obsidian hover:border-gold/40'}`}
                    onClick={() => {
                      setSelectedAddressIndex(index);
                      setAddress({ fullName: addr.fullName, street: addr.addressLine1, city: addr.city, state: addr.state, postalCode: addr.postalCode, country: addr.country, phone: addr.phone });
                    }}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <p className="font-display font-bold text-ink uppercase tracking-wide text-sm">{addr.fullName}</p>
                        <p className="text-ink/70 font-display text-sm mt-1">{addr.addressLine1}</p>
                        <p className="text-ink/70 font-display text-sm">{addr.city}, {addr.state} {addr.postalCode}</p>
                        <p className="text-ink-muted font-display text-sm">{addr.phone}</p>
                      </div>
                      <div className="flex items-start gap-2 ml-4">
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirm('Delete this address?')) return;
                            const newAddresses = savedAddresses.filter((_, i) => i !== index);
                            try {
                              await apiClient.put('/profile', { name: user?.name, email: user?.email, addresses: newAddresses });
                              setSavedAddresses(newAddresses);
                              if (selectedAddressIndex === index) setSelectedAddressIndex(null);
                              else if (selectedAddressIndex !== null && selectedAddressIndex > index) setSelectedAddressIndex(selectedAddressIndex - 1);
                              toast.success('Address deleted');
                            } catch { toast.error('Failed to delete address'); }
                          }}
                          className="text-ink-muted hover:text-red-400 p-1 transition-colors"
                          title="Delete address"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        {selectedAddressIndex === index && (
                          <div className="bg-gold text-obsidian p-1 rounded-full">
                            <Check className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => { setShowAddressForm(true); setSelectedAddressIndex(null); setAddress({ fullName: user?.name || '', street: '', city: '', state: '', postalCode: '', country: 'India', phone: '' }); }}
                  className="w-full py-3 border-2 border-dashed border-hairline rounded-sm text-ink-muted hover:border-gold hover:text-gold flex items-center justify-center gap-2 transition-colors font-display font-bold uppercase tracking-widest text-sm"
                >
                  <Plus className="h-4 w-4" />
                  Add New Address
                </button>

                <button
                  onClick={handleAddressSubmit}
                  disabled={selectedAddressIndex === null}
                  className="w-full bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest py-3 rounded-sm disabled:bg-obsidian-raised disabled:text-obsidian-muted disabled:cursor-not-allowed transition-colors"
                >
                  Deliver to This Address
                </button>
              </div>
            )}

            {showAddressForm && (
              <form onSubmit={handleAddressSubmit} className="space-y-4">
                {savedAddresses.length > 0 && (
                  <button type="button" onClick={() => setShowAddressForm(false)} className="text-sm text-gold hover:text-ink font-display font-bold uppercase tracking-widest transition-colors mb-2">
                    ← Back to Saved Addresses
                  </button>
                )}
                <input type="text" placeholder="Full Name" value={address.fullName} onChange={(e) => setAddress({ ...address, fullName: e.target.value })} className={inputClass} required />
                <input type="text" placeholder="Street Address" value={address.street} onChange={(e) => setAddress({ ...address, street: e.target.value })} className={inputClass} required />
                <div className="grid grid-cols-2 gap-4">
                  <input type="text" placeholder="City" value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} className={inputClass} required />
                  <input type="text" placeholder="State" value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value })} className={inputClass} required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <input type="text" placeholder="Postal Code" value={address.postalCode} onChange={(e) => setAddress({ ...address, postalCode: e.target.value })} className={inputClass} required />
                  <input type="tel" placeholder="Phone" value={address.phone} onChange={(e) => setAddress({ ...address, phone: e.target.value })} className={inputClass} required />
                </div>
                {isAuthenticated && (
                  <div className="flex items-center gap-3 mt-2">
                    <input type="checkbox" id="saveAddress" checked={shouldSaveAddress} onChange={(e) => setShouldSaveAddress(e.target.checked)} className="h-4 w-4 accent-[#3B9EE8] rounded border-hairline bg-obsidian-raised" />
                    <label htmlFor="saveAddress" className="text-sm text-ink/70 font-display">Save this address for future orders</label>
                  </div>
                )}
                <button type="submit" className="w-full bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest py-3 rounded-sm transition-colors mt-4">
                  Continue to Payment
                </button>
              </form>
            )}
          </div>
        )}

        {/* Payment Method */}
        {currentStep === 'payment' && (
          <div>
            <h2 className="text-xl font-display font-bold text-ink uppercase tracking-wide mb-6">Payment Method</h2>
            <div className="mb-8">
              <PaymentMethodSelector selectedMethod={paymentMethod} onSelect={setPaymentMethod} />
            </div>
            <button onClick={() => { trackAddPaymentInfo({ method: paymentMethod, value: lastCartTotalRef.current }); setCurrentStep('review'); }} className="w-full bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest py-3 rounded-sm transition-colors">
              Continue to Review
            </button>
          </div>
        )}

        {/* Review Order */}
        {currentStep === 'review' && (
          <div>
            <h2 className="text-xl font-display font-bold text-ink uppercase tracking-wide mb-6">Review Your Order</h2>

            {/* Price-change confirmation banner — shown when server prices differ from CartContext */}
            {priceConfirmationPending && serverValidation && (
              <div className="mb-6 bg-yellow-500/10 border border-yellow-500/40 rounded-sm p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-display font-bold text-yellow-400 uppercase tracking-wide mb-1">Prices Updated</h3>
                    <p className="text-ink/70 font-display text-sm mb-4">
                      One or more item prices changed since you loaded this page. Please confirm the updated total before paying.
                    </p>
                    <div className="bg-obsidian border border-hairline rounded-sm p-4 mb-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-ink-muted font-display">Previous total</span>
                        <span className="text-ink-muted font-display line-through">
                          ₹{(cart?.total || 0).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-ink-muted font-display">Subtotal (updated)</span>
                        <span className="text-ink/70 font-display">₹{serverValidation.subtotal.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-ink-muted font-display">Tax (18% GST)</span>
                        <span className="text-ink/70 font-display">₹{serverValidation.tax.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between border-t border-hairline pt-2">
                        <span className="font-display font-bold text-ink uppercase tracking-wide text-sm">New Total</span>
                        <span className="text-lg font-display font-bold text-gold">₹{serverValidation.total.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => placeOrderWithValidation(serverValidation)}
                        disabled={loading || isRazorpayProcessing}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-ink font-display font-bold uppercase tracking-widest py-2.5 rounded-sm disabled:bg-obsidian-raised disabled:text-ink-muted disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors text-sm"
                      >
                        {loading || isRazorpayProcessing ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /><span>Processing...</span></>
                        ) : (
                          `Confirm & Pay ₹${(pricing.quote?.totalAmount ?? serverValidation.total).toFixed(2)}`
                        )}
                      </button>
                      <button
                        onClick={() => { setPriceConfirmationPending(false); router.push('/cart'); }}
                        className="px-4 bg-obsidian-raised border border-hairline text-ink/70 hover:text-ink font-display font-bold uppercase tracking-widest py-2.5 rounded-sm transition-colors text-sm"
                      >
                        Back to Cart
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-obsidian border border-hairline rounded-sm p-6 mb-6 space-y-5">
              <div>
                <h3 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-2">Shipping Address</h3>
                <p className="text-ink/70 font-display text-sm">{address.street}</p>
                <p className="text-ink/70 font-display text-sm">{address.city}, {address.state} {address.postalCode}</p>
                <p className="text-ink-muted font-display text-sm">{address.phone}</p>
              </div>
              <div className="border-t border-hairline pt-4">
                <h3 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-2">Payment Method</h3>
                <p className="text-ink/70 font-display text-sm">{PAYMENT_METHOD_LABELS[paymentMethod] || paymentMethod}</p>
              </div>
              <div className="border-t border-hairline pt-4">
                {/* Coupon + karma + server-computed breakdown (single source of truth). */}
                <CheckoutSummary
                  items={(cart?.items || []).map((it: any) => ({ product: it.product._id, quantity: it.quantity }))}
                  isAuthenticated={isAuthenticated}
                  onChange={setPricing}
                />
              </div>
            </div>

            {!priceConfirmationPending && (
              <button
                onClick={handlePlaceOrder}
                disabled={loading || isRazorpayProcessing}
                className="w-full bg-green-600 hover:bg-green-700 text-ink font-display font-bold uppercase tracking-widest py-3 rounded-sm disabled:bg-obsidian-raised disabled:text-ink-muted disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
              >
                {loading || isRazorpayProcessing ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /><span>Processing...</span></>
                ) : (
                  'Place Order'
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
