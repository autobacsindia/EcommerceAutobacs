'use client';

import { useState, useEffect } from 'react';
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

export default function CartPage() {
  return (
    <CheckoutErrorBoundary feature="cart">
      <CartPageContent />
    </CheckoutErrorBoundary>
  );
}

function CartPageContent() {
  const { cart, removeFromCart, updateQuantity, clearCart, isLoading, refreshCart } = useCart();
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

  const handleQuantityChange = async (productId: string, newQuantity: number) => {
    if (newQuantity < 1) return;
    try {
      setUpdatingItem(productId);
      await updateQuantity(productId, newQuantity);
      toast.success('Cart updated');
    } catch (error: any) {
      if (error.message?.includes('out of stock')) {
        toast.error('This item is now out of stock', { icon: '❌' });
        setTimeout(() => removeFromCart(productId), 2000);
      } else if (error.message?.includes('Only') && error.message?.includes('available')) {
        toast.error(error.message, { icon: '⚠️' });
        if (error.maxQuantity) setTimeout(async () => { await updateQuantity(productId, error.maxQuantity); }, 1500);
      } else {
        toast.error('Failed to update quantity');
      }
    } finally {
      setUpdatingItem(null);
    }
  };

  const handleRemoveItem = async (productId: string) => {
    if (confirm('Remove this item from cart?')) {
      try {
        await removeFromCart(productId);
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
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="text-center py-12">
          <ShoppingBag className="mx-auto h-24 w-24 text-[#252525] mb-4" />
          <h2 className="text-2xl font-condensed font-bold text-white uppercase tracking-wide mb-2">Your cart is empty</h2>
          <p className="text-[#C4C4C4] font-body mb-6">Add some products to get started!</p>
          <Link
            href="/products"
            className="inline-flex items-center gap-2 bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors"
          >
            Browse Products
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080808] py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-condensed font-bold text-white uppercase tracking-wide">Shopping Cart</h1>
          <p className="text-[#C4C4C4] font-body mt-1">{cart.items.length} item{cart.items.length !== 1 ? 's' : ''} in your cart</p>
        </div>

        {/* Stock change banner */}
        {recentChanges.length > 0 && (
          <div className="mb-6 bg-orange-500/10 border-l-4 border-orange-500 rounded-sm p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 text-orange-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-condensed font-bold text-orange-400 uppercase tracking-wide">Cart Updates Due to Stock Changes</h3>
                <ul className="mt-2 space-y-1">
                  {recentChanges.map((change, idx) => (
                    <li key={idx} className="text-sm text-orange-300 font-body flex items-start gap-2">
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
            <div className="bg-[#0E0E0E] border border-[#252525] rounded-lg">
              <div className="p-4 border-b border-[#252525] flex justify-between items-center">
                <h2 className="font-condensed font-bold text-white uppercase tracking-wide">Cart Items</h2>
                <button onClick={handleClearCart} className="text-sm text-red-400 hover:text-red-300 font-body transition-colors">
                  Clear Cart
                </button>
              </div>

              <div className="divide-y divide-[#252525]">
                {cart.items.map((item, index) => (
                  <div key={`${item.product._id}-${index}`} className="p-6">
                    <div className="flex gap-4">
                      <Link
                        href={productUrl(item.product, '/products') || '/products'}
                        className="shrink-0 w-24 h-24 bg-[#161616] border border-[#252525] rounded-sm overflow-hidden"
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
                              className="font-condensed font-bold text-white uppercase tracking-wide hover:text-[#3B9EE8] transition-colors"
                            >
                              {item.product.name}
                            </Link>
                            <p className="text-sm text-[#555555] font-body mt-1">{formatPrice(item.product.price)} each</p>
                          </div>
                          <button
                            onClick={() => handleRemoveItem(item.product._id)}
                            className="text-[#555555] hover:text-red-400 transition-colors"
                            title="Remove item"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </div>

                        <div className="mt-4 flex items-center justify-between">
                          <div className="flex items-center border border-[#252525] rounded-sm">
                            <button
                              onClick={() => handleQuantityChange(item.product._id, item.quantity - 1)}
                              disabled={item.quantity <= 1 || updatingItem === item.product._id}
                              className="p-2 text-[#C4C4C4] hover:bg-[#161616] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="px-4 py-2 min-w-12 text-center text-white font-condensed font-bold">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => handleQuantityChange(item.product._id, item.quantity + 1)}
                              disabled={item.quantity >= item.product.stock || updatingItem === item.product._id}
                              className="p-2 text-[#C4C4C4] hover:bg-[#161616] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                          <p className="text-lg font-condensed font-bold text-[#3B9EE8]">
                            {formatPrice(item.product.price * item.quantity)}
                          </p>
                        </div>

                        {item.product.stock === 0 ? (
                          <div className="mt-2 flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded-sm">
                            <AlertTriangle className="h-4 w-4" />
                            <span className="text-sm font-body">This item is now out of stock</span>
                          </div>
                        ) : item.quantity >= item.product.stock ? (
                          <div className="mt-2 flex items-center gap-2 text-orange-400 bg-orange-500/10 border border-orange-500/30 px-3 py-2 rounded-sm">
                            <AlertTriangle className="h-4 w-4" />
                            <span className="text-sm font-body">Maximum available: {item.product.stock}</span>
                          </div>
                        ) : item.product.stock <= 5 ? (
                          <p className="text-sm text-orange-400 font-body mt-2">⚠ Only {item.product.stock} left in stock</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6">
              <Link href="/products" className="inline-flex items-center gap-2 text-[#3B9EE8] hover:text-white font-condensed font-bold uppercase tracking-widest transition-colors">
                ← Continue Shopping
              </Link>
            </div>
          </div>

          {/* Order Summary */}
          <div className="lg:col-span-4 mt-8 lg:mt-0">
            <div className="bg-[#0E0E0E] border border-[#252525] rounded-lg p-6 sticky top-20">
              <h2 className="text-lg font-condensed font-bold text-white uppercase tracking-wide mb-4">Order Summary</h2>

              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-[#C4C4C4] font-body text-sm">
                  <span>Subtotal</span>
                  <span>{formatPrice((cart.total || 0) / 1.18)}</span>
                </div>
                <div className="flex justify-between text-[#C4C4C4] font-body text-sm">
                  <span>Shipping</span>
                  <span className="text-[#555555]">Calculated at checkout</span>
                </div>
                <div className="flex justify-between text-[#C4C4C4] font-body text-sm">
                  <span>Tax (18% GST)</span>
                  <span>{formatPrice((cart.total || 0) - ((cart.total || 0) / 1.18))}</span>
                </div>
                <div className="border-t border-[#252525] pt-3 flex justify-between">
                  <span className="font-condensed font-bold text-white uppercase tracking-wide">Total</span>
                  <span className="text-xl font-condensed font-bold text-[#3B9EE8]">{formatPrice(cart.total || 0)}</span>
                </div>
                <p className="text-xs text-[#555555] font-body">* Final tax calculated at checkout</p>
              </div>

              <Link
                href="/checkout"
                className="w-full bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest py-3 rounded-sm transition-colors flex items-center justify-center gap-2"
              >
                Proceed to Checkout
                <ArrowRight className="h-5 w-5" />
              </Link>

              <div className="mt-4 text-center">
                <p className="text-xs text-[#555555] font-body">🔒 Secure Checkout · Safe Payment</p>
              </div>

              {/* Promo code */}
              <div className="mt-6 pt-6 border-t border-[#252525]">
                <p className="text-sm font-condensed font-bold text-[#C4C4C4] uppercase tracking-widest mb-2">Have a promo code?</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter code"
                    className="flex-1 bg-[#161616] border border-[#252525] text-white placeholder:text-[#555555] rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-[#3B9EE8] font-body"
                  />
                  <button className="bg-[#252525] hover:bg-[#3B9EE8] text-[#C4C4C4] hover:text-white px-4 py-2 rounded-sm text-sm font-condensed font-bold uppercase tracking-widest transition-colors">
                    Apply
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
