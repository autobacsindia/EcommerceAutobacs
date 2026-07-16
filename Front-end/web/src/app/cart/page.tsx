'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Trash2, Plus, Minus, ShoppingBag, ArrowRight, AlertTriangle } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useCurrency } from '@/context/CurrencyContext';
import EnhancedImage from '@/components/layout/EnhancedImage';
import { ProductImage, productUrl } from '@/lib/types';
import { toast } from 'react-hot-toast';
import SkeletonLoader from '@/components/layout/SkeletonLoader';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { useAuth } from '@/context/AuthContext';
import CheckoutErrorBoundary from '@/components/checkout/CheckoutErrorBoundary';
import Eyebrow from '@/components/ui/Eyebrow';
import Reveal from '@/components/ui/Reveal';
import { useCheckoutQuote } from '@/hooks/useCheckoutQuote';

export default function CartPage() {
  return (
    <CheckoutErrorBoundary feature="cart">
      <CartPageContent />
    </CheckoutErrorBoundary>
  );
}

function CartPageContent() {
  const { cart, removeFromCart, updateQuantity, clearCart, isLoading, refreshCart, applyCoupon, removeCoupon } = useCart();

  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  // Public (visibility: 'public') coupons only. Hidden ones still work when typed.
  const [availableCoupons, setAvailableCoupons] = useState<{ code: string; description?: string }[]>([]);

  useEffect(() => {
    apiClient.get<{ success: boolean; coupons: { code: string; description?: string }[] }>(API_ENDPOINTS.COUPONS_AVAILABLE)
      .then((r) => setAvailableCoupons(r.coupons || []))
      .catch(() => setAvailableCoupons([]));
  }, []);

  // The server prices the cart; this mirrors it for display only. Order creation
  // re-computes from scratch, so nothing here can influence what the buyer is charged.
  const quoteItems = useMemo(
    () => (cart?.items || []).map((i) => ({ product: i.product._id, quantity: i.quantity })),
    [cart?.items]
  );
  const { quote } = useCheckoutQuote(quoteItems, cart?.couponCode || undefined, 0);

  const handleApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code || couponBusy) return;
    setCouponBusy(true);
    setCouponError(null);
    try {
      await applyCoupon(code);
      setCouponInput('');
      toast.success(`${code} applied`);
    } catch (err: any) {
      setCouponError(err?.message || 'Could not apply this coupon');
    } finally {
      setCouponBusy(false);
    }
  };

  const handleRemoveCoupon = async () => {
    if (couponBusy) return;
    setCouponBusy(true);
    setCouponError(null);
    try {
      await removeCoupon();
    } catch (err: any) {
      setCouponError(err?.message || 'Could not remove this coupon');
    } finally {
      setCouponBusy(false);
    }
  };
  const { isAuthenticated } = useAuth();
  const { formatPrice } = useCurrency();
  const [updatingItem, setUpdatingItem] = useState<string | null>(null);
  const [recentChanges, setRecentChanges] = useState<any[]>([]);
  const [hasShownChanges, setHasShownChanges] = useState(false);

  useEffect(() => {
    const fetchCartWithStockCheck = async () => {
      try {
        const response: any = await apiClient.get(API_ENDPOINTS.CART);
        if (response.recentChanges?.length > 0) {
          setRecentChanges(response.recentChanges);
          if (!hasShownChanges) {
            response.recentChanges.forEach((change: any) => {
              if (change.type === 'REMOVED_OUT_OF_STOCK') toast.error(change.message, { icon: '❌', duration: 6000 });
              else if (change.type === 'QUANTITY_ADJUSTED') toast(change.message, { icon: '⚠️', style: { background: '#FFA726', color: '#fff' }, duration: 6000 });
            });
            setHasShownChanges(true);
            setTimeout(() => setHasShownChanges(false), 5000);
          }
        }
        if (response.stockMessages?.length > 0) {
          response.stockMessages.forEach((msg: string) => toast(msg, { icon: '⚠️', style: { background: '#FFA726', color: '#fff' } }));
        }
      } catch (error) {
        console.error('Failed to fetch cart:', error);
      }
    };
    if (isAuthenticated && !isLoading) fetchCartWithStockCheck();
  }, [isAuthenticated, isLoading]);

  // A line is identified by product + variant, so the same product under two
  // models tracks its spinner/updates independently.
  const lineKey = (productId: string, variantId?: string | null) =>
    productId + (variantId ? `:${variantId}` : '');

  const handleQuantityChange = async (productId: string, newQuantity: number, variantId?: string | null) => {
    if (newQuantity < 1) return;
    try {
      setUpdatingItem(lineKey(productId, variantId));
      await updateQuantity(productId, newQuantity, variantId);
      toast.success('Cart updated');
    } catch (error: any) {
      if (error.message?.includes('out of stock')) {
        toast.error('This item is now out of stock', { icon: '❌' });
        setTimeout(() => removeFromCart(productId, variantId), 2000);
      } else if (error.message?.includes('Only') && error.message?.includes('available')) {
        toast.error(error.message, { icon: '⚠️' });
        if (error.maxQuantity) setTimeout(async () => { await updateQuantity(productId, error.maxQuantity, variantId); }, 1500);
      } else {
        toast.error('Failed to update quantity');
      }
    } finally {
      setUpdatingItem(null);
    }
  };

  const handleRemoveItem = async (productId: string, variantId?: string | null) => {
    if (confirm('Remove this item from cart?')) {
      try {
        await removeFromCart(productId, variantId);
        toast.success('Item removed from cart');
      } catch {
        toast.error('Failed to remove item');
      }
    }
  };

  const handleClearCart = async () => {
    if (confirm('Clear all items from cart?')) {
      try {
        await clearCart();
        toast.success('Cart cleared');
      } catch {
        toast.error('Failed to clear cart');
      }
    }
  };

  const getFirstImageUrl = (images: ProductImage[] | string | undefined): string | null => {
    if (!images) return null;
    if (typeof images === 'string') return images;
    if (Array.isArray(images) && images.length > 0) {
      const first = images[0];
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object' && 'url' in first) return (first as ProductImage).url;
    }
    return null;
  };

  if (isLoading && !cart) return <SkeletonLoader type="cart-page" />;

  if (!cart || cart.items?.length === 0) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
        <div className="text-center py-12 px-6">
          <ShoppingBag className="mx-auto h-16 w-16 text-hairline mb-8" strokeWidth={1} />
          <Eyebrow className="mb-4">Your bag</Eyebrow>
          <h2 className="text-[clamp(32px,5vw,52px)] font-light leading-tight text-ink mb-4">Your cart is empty</h2>
          <p className="text-ink-muted font-display font-light mb-8">Nothing here yet — let&apos;s find something.</p>
          <Link
            href="/products"
            className="inline-flex items-center gap-2.5 bg-gold text-obsidian font-display text-[10px] font-semibold uppercase tracking-[0.2em] px-7 py-4 transition-opacity hover:opacity-90"
          >
            Browse Products
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-obsidian-deep py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <Reveal className="mb-10">
          <Eyebrow>Your bag</Eyebrow>
          <h1 className="mt-4 text-[clamp(34px,5vw,60px)] font-light leading-[0.95] tracking-[-0.01em] text-ink">Shopping Cart</h1>
          <p className="mt-3 font-display text-[13px] tracking-[0.04em] text-ink-muted">
            <span className="text-ink">{cart.items.length}</span> item{cart.items.length !== 1 ? 's' : ''} in your cart
          </p>
        </Reveal>

        {/* Stock change banner */}
        {recentChanges.length > 0 && (
          <div className="mb-6 bg-orange-500/10 border-l-4 border-orange-500 rounded-sm p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 text-orange-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-display font-bold text-orange-400 uppercase tracking-wide">Cart Updates Due to Stock Changes</h3>
                <ul className="mt-2 space-y-1">
                  {recentChanges.map((change, idx) => (
                    <li key={idx} className="text-sm text-orange-300 font-display flex items-start gap-2">
                      <span className="text-orange-400 mt-0.5">·</span>
                      <span>
                        {change.type === 'REMOVED_OUT_OF_STOCK' ? (
                          <strong>{change.productName}</strong>
                        ) : change.type === 'QUANTITY_ADJUSTED' ? (
                          <><strong>{change.productName}</strong>: qty {change.previousQuantity} → {change.newQuantity}</>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        <div className="lg:grid lg:grid-cols-12 lg:gap-8">
          {/* Cart Items */}
          <div className="lg:col-span-8">
            <div className="bg-obsidian border border-hairline rounded-lg">
              <div className="p-4 border-b border-hairline flex justify-between items-center">
                <h2 className="font-display font-light text-ink tracking-[-0.01em]">Cart Items</h2>
                <button onClick={handleClearCart} className="text-sm text-red-400 hover:text-red-300 font-display transition-colors">
                  Clear Cart
                </button>
              </div>

              <div className="divide-y divide-hairline">
                {cart.items.map((item, index) => {
                  const unitPrice = item.price ?? item.product.price;
                  const uid = lineKey(item.product._id, item.variantId);
                  return (
                  <div key={`${uid}-${index}`} className="p-6">
                    <div className="flex gap-4">
                      <Link
                        href={productUrl(item.product, '/products') || '/products'}
                        className="shrink-0 w-24 h-24 bg-obsidian-raised border border-hairline rounded-sm overflow-hidden"
                      >
                        <EnhancedImage
                          src={getFirstImageUrl(item.product.images)}
                          alt={item.product.name}
                          width={96}
                          height={96}
                          context="product"
                          className="object-cover w-full h-full"
                        />
                      </Link>

                      <div className="flex-1">
                        <div className="flex justify-between">
                          <div>
                            <Link
                              href={productUrl(item.product, '/products') || '/products'}
                              className="font-display font-light text-ink tracking-[-0.01em] hover:text-gold transition-colors"
                            >
                              {item.product.name}
                            </Link>
                            {item.variantLabel && (
                              <p className="text-[11px] uppercase tracking-[0.14em] text-gold mt-1">{item.variantLabel}</p>
                            )}
                            <p className="text-sm text-ink-muted font-display mt-1">{formatPrice(unitPrice)} each</p>
                          </div>
                          <button
                            onClick={() => handleRemoveItem(item.product._id, item.variantId)}
                            className="text-ink-muted hover:text-red-400 transition-colors"
                            title="Remove item"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </div>

                        <div className="mt-4 flex items-center justify-between">
                          <div className="flex items-center border border-hairline rounded-sm">
                            <button
                              onClick={() => handleQuantityChange(item.product._id, item.quantity - 1, item.variantId)}
                              disabled={item.quantity <= 1 || updatingItem === uid}
                              className="p-2 text-ink/70 hover:bg-obsidian-raised disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="px-4 py-2 min-w-12 text-center text-ink font-display font-bold">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => handleQuantityChange(item.product._id, item.quantity + 1, item.variantId)}
                              disabled={item.product.stock === 'out' || updatingItem === uid}
                              className="p-2 text-ink/70 hover:bg-obsidian-raised disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                          <p className="text-lg font-display font-bold text-gold">
                            {formatPrice(unitPrice * item.quantity)}
                          </p>
                        </div>

                        {item.product.stock === 'out' ? (
                          <div className="mt-2 flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded-sm">
                            <AlertTriangle className="h-4 w-4" />
                            <span className="text-sm font-display">This item is now out of stock</span>
                          </div>
                        ) : item.product.stock === 'low' ? (
                          <p className="text-sm text-orange-400 font-display mt-2">⚠ Low stock</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-6">
              <Link href="/products" className="inline-flex items-center gap-2 text-gold hover:text-ink font-display font-bold uppercase tracking-widest transition-colors">
                ← Continue Shopping
              </Link>
            </div>
          </div>

          {/* Order Summary */}
          <div className="lg:col-span-4 mt-8 lg:mt-0">
            <div className="bg-obsidian border border-hairline rounded-lg p-6 sticky top-20">
              <h2 className="text-lg font-display font-light text-ink tracking-[-0.01em] mb-4">Order Summary</h2>

              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-ink/70 font-display text-sm">
                  <span>Subtotal</span>
                  <span>{formatPrice(quote ? quote.subtotal : cart.total || 0)}</span>
                </div>
                {quote && quote.couponDiscount > 0 && (
                  <div className="flex justify-between text-gold font-display text-sm">
                    <span>Discount ({quote.appliedCoupon?.code})</span>
                    <span>−{formatPrice(quote.couponDiscount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-ink/70 font-display text-sm">
                  <span>Tax (18% GST)</span>
                  <span>{formatPrice(quote ? quote.tax : 0)}</span>
                </div>
                <div className="border-t border-hairline pt-3 flex justify-between">
                  <span className="font-display font-light text-ink tracking-[-0.01em]">Total</span>
                  <span className="text-xl font-display font-bold text-gold">
                    {formatPrice(quote ? quote.totalAmount : cart.total || 0)}
                  </span>
                </div>
              </div>

              <Link
                href="/checkout"
                className="w-full bg-gold text-obsidian font-display text-[11px] font-semibold uppercase tracking-[0.2em] py-4 transition-opacity hover:opacity-90 flex items-center justify-center gap-2.5"
              >
                Proceed to Checkout
                <ArrowRight className="h-4 w-4" />
              </Link>

              <div className="mt-4 text-center">
                <p className="text-xs text-ink-muted font-display">🔒 Secure Checkout · Safe Payment</p>
              </div>

              {/* Promo code */}
              <div className="mt-6 pt-6 border-t border-hairline">
                <p className="text-sm font-display font-bold text-ink/70 uppercase tracking-widest mb-2">Have a promo code?</p>

                {cart.couponCode ? (
                  <div className="flex items-center justify-between gap-2 bg-obsidian-raised border border-gold/40 rounded-sm px-3 py-2">
                    <span className="text-sm font-display font-bold text-gold">{cart.couponCode} applied</span>
                    <button
                      onClick={handleRemoveCoupon}
                      disabled={couponBusy}
                      className="text-ink-muted hover:text-red-400 transition-colors disabled:opacity-50"
                      title="Remove coupon"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleApplyCoupon(); }}
                      placeholder="Enter code"
                      className="flex-1 bg-obsidian-raised border border-hairline text-ink placeholder:text-ink-muted rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-gold font-display"
                    />
                    <button
                      onClick={handleApplyCoupon}
                      disabled={!couponInput.trim() || couponBusy}
                      className="bg-obsidian-raised hover:bg-gold text-ink/70 hover:text-obsidian px-4 py-2 rounded-sm text-sm font-display font-bold uppercase tracking-widest transition-colors disabled:opacity-50 disabled:hover:bg-obsidian-raised disabled:hover:text-ink/70"
                    >
                      {couponBusy ? '…' : 'Apply'}
                    </button>
                  </div>
                )}

                {!cart.couponCode && availableCoupons.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {availableCoupons.map((c) => (
                      <button
                        key={c.code}
                        onClick={() => setCouponInput(c.code)}
                        title={c.description || ''}
                        className="text-xs font-display font-bold uppercase tracking-wide text-gold border border-gold/30 hover:border-gold rounded-sm px-2 py-1 transition-colors"
                      >
                        {c.code}
                      </button>
                    ))}
                  </div>
                )}

                {couponError && (
                  <p className="text-red-400 text-xs font-display mt-1.5">{couponError}</p>
                )}
                {/* A coupon valid at apply time can lapse (expiry, stock, cart edits). The
                    checkout re-quotes and order creation hard-fails on a now-invalid code. */}
                {cart.couponCode && quote?.couponError && (
                  <p className="text-red-400 text-xs font-display mt-1.5">{quote.couponError}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
