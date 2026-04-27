'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Trash2, Plus, Minus, ShoppingBag, ArrowRight, AlertTriangle } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useCurrency } from '@/contexts/CurrencyContext';
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

  // 🟡 LAYER 1: Fetch cart on mount to get stock messages and recent changes
  useEffect(() => {
    const fetchCartWithStockCheck = async () => {
      try {
        const response: any = await apiClient.get(API_ENDPOINTS.CART);
        
        // Handle recent changes for transparency
        if (response.recentChanges && response.recentChanges.length > 0) {
          setRecentChanges(response.recentChanges);
          
          // Show toast notifications for each change (only first time)
          if (!hasShownChanges) {
            response.recentChanges.forEach((change: any) => {
              if (change.type === 'REMOVED_OUT_OF_STOCK') {
                toast.error(change.message, {
                  icon: '❌',
                  duration: 6000,
                });
              } else if (change.type === 'QUANTITY_ADJUSTED') {
                toast(change.message, {
                  icon: '⚠️',
                  style: {
                    background: '#FFA726',
                    color: '#FFFFFF',
                  },
                  duration: 6000,
                });
              }
            });
            setHasShownChanges(true);
            
            // Clear the flag after 5 seconds
            setTimeout(() => setHasShownChanges(false), 5000);
          }
        }
        
        // Also handle legacy stockMessages
        if (response.stockMessages && response.stockMessages.length > 0) {
          response.stockMessages.forEach((msg: string) => {
            toast(msg, {
              icon: '⚠️',
              style: {
                background: '#FFA726',
                color: '#FFFFFF',
              },
            });
          });
        }
      } catch (error) {
        console.error('Failed to fetch cart:', error);
      }
    };

    if (isAuthenticated && !isLoading) {
      fetchCartWithStockCheck();
    }
  }, [isAuthenticated, isLoading]);

  // 🟡 LAYER 1: Enhanced quantity update with better error handling
  const handleQuantityChange = async (productId: string, newQuantity: number) => {
    if (newQuantity < 1) return;
    
    try {
      setUpdatingItem(productId);
      await updateQuantity(productId, newQuantity);
      toast.success('Cart updated');
    } catch (error: any) {
      console.error('Failed to update quantity:', error);
      
      // Handle stock-related errors
      if (error.message?.includes('out of stock')) {
        toast.error('This item is now out of stock', {
          icon: '❌',
        });
        // Remove from cart after delay
        setTimeout(() => {
          removeFromCart(productId);
        }, 2000);
      } else if (error.message?.includes('Only') && error.message?.includes('available')) {
        toast.error(error.message, {
          icon: '⚠️',
        });
        // Auto-adjust quantity if maxQuantity is provided
        if (error.maxQuantity) {
          setTimeout(async () => {
            await updateQuantity(productId, error.maxQuantity);
          }, 1500);
        }
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
      } catch (error) {
        console.error('Failed to remove item:', error);
        toast.error('Failed to remove item');
      }
    }
  };

  const handleClearCart = async () => {
    if (confirm('Clear all items from cart?')) {
      try {
        await clearCart();
        toast.success('Cart cleared');
      } catch (error) {
        console.error('Failed to clear cart:', error);
        toast.error('Failed to clear cart');
      }
    }
  };

  // Loading state
  if (isLoading && !cart) {
    return <SkeletonLoader type="cart-page" />;
  }

  // Empty cart state
  if (!cart || cart.items?.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center py-12">
          <ShoppingBag className="mx-auto h-24 w-24 text-gray-300 mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Your cart is empty</h2>
          <p className="text-gray-600 mb-6">Add some products to get started!</p>
          <Link
            href="/products"
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 transition-colors"
          >
            Browse Products
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  // Helper function to get the first image URL
  const getFirstImageUrl = (images: ProductImage[] | string | undefined): string | null => {
    if (!images) return null;
    
    if (typeof images === 'string') {
      return images;
    }
    
    if (Array.isArray(images) && images.length > 0) {
      const firstImage = images[0];
      if (typeof firstImage === 'string') {
        return firstImage;
      } else if (firstImage && typeof firstImage === 'object' && 'url' in firstImage) {
        return (firstImage as ProductImage).url;
      }
    }
    
    return null;
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Shopping Cart</h1>
          <p className="text-gray-600 mt-1">{cart.items.length} item{cart.items.length !== 1 ? 's' : ''} in your cart</p>
        </div>

        {/* 🟡 Recent Changes Notification Banner */}
        {recentChanges.length > 0 && (
          <div className="mb-6 bg-gradient-to-r from-orange-50 to-yellow-50 border-l-4 border-orange-400 rounded-lg p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <AlertTriangle className="h-6 w-6 text-orange-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-orange-800">
                  Cart Updates Due to Stock Changes
                </h3>
                <ul className="mt-2 space-y-1">
                  {recentChanges.map((change, idx) => (
                    <li key={idx} className="text-sm text-orange-700 flex items-start gap-2">
                      <span className="text-orange-500 mt-0.5">•</span>
                      <span>
                        {change.type === 'REMOVED_OUT_OF_STOCK' ? (
                          <strong>{change.productName}</strong>
                        ) : change.type === 'QUANTITY_ADJUSTED' ? (
                          <>
                            <strong>{change.productName}</strong>: Quantity changed from{' '}
                            <span className="font-mono">{change.previousQuantity}</span> to{' '}
                            <span className="font-mono">{change.newQuantity}</span>
                          </>
                        ) : null}{' '}
                        {change.message.includes('because') && (
                          <span className="text-orange-600 italic">
                            ({change.message.split('because')[1]})
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-orange-600 mt-3">
                  💡 These changes were made automatically based on current stock availability
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="lg:grid lg:grid-cols-12 lg:gap-8">
          {/* Cart Items */}
          <div className="lg:col-span-8">
            <div className="bg-white rounded-lg shadow-md">
              {/* Clear Cart Button */}
              <div className="p-4 border-b flex justify-between items-center">
                <h2 className="font-semibold text-gray-900">Cart Items</h2>
                <button
                  onClick={handleClearCart}
                  className="text-sm text-red-600 hover:text-red-700 font-medium"
                >
                  Clear Cart
                </button>
              </div>

              {/* Items List */}
              <div className="divide-y">
                {cart.items.map((item, index) => (
                  <div key={`${item.product._id}-${index}`} className="p-6">
                    <div className="flex gap-4">
                      {/* Product Image */}
                      <Link
                        href={productUrl(item.product, '/products') || '/products'}
                        className="flex-shrink-0 w-24 h-24 bg-gray-100 rounded-md overflow-hidden"
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

                      {/* Product Details */}
                      <div className="flex-1">
                        <div className="flex justify-between">
                          <div>
                            <Link
                              href={productUrl(item.product, '/products') || '/products'}
                              className="font-semibold text-gray-900 hover:text-blue-600"
                            >
                              {item.product.name}
                            </Link>
                            <p className="text-sm text-gray-500 mt-1">
                              {formatPrice(item.product.price)} each
                            </p>
                          </div>
                          <button
                            onClick={() => handleRemoveItem(item.product._id)}
                            className="text-gray-400 hover:text-red-600"
                            title="Remove item"
                            aria-label="Remove item"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </div>

                        {/* Quantity Controls */}
                        <div className="mt-4 flex items-center justify-between">
                          <div className="flex items-center border border-gray-300 rounded-md">
                            <button
                              onClick={() => handleQuantityChange(item.product._id, item.quantity - 1)}
                              disabled={item.quantity <= 1 || updatingItem === item.product._id}
                              className="p-2 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                              aria-label="Decrease quantity"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="px-4 py-2 min-w-[3rem] text-center">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => handleQuantityChange(item.product._id, item.quantity + 1)}
                              disabled={
                                item.quantity >= item.product.stock ||
                                updatingItem === item.product._id
                              }
                              className="p-2 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                              aria-label="Increase quantity"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>

                          {/* Item Total */}
                          <p className="text-lg font-bold text-gray-900">
                            {formatPrice(item.product.price * item.quantity)}
                          </p>
                        </div>

                        {/* 🟡 LAYER 1: Enhanced Stock Warnings */}
                        {item.product.stock === 0 ? (
                          <div className="mt-2 flex items-center gap-2 text-red-600 bg-red-50 px-3 py-2 rounded-md">
                            <AlertTriangle className="h-4 w-4" />
                            <span className="text-sm font-medium">This item is now out of stock</span>
                          </div>
                        ) : item.quantity >= item.product.stock ? (
                          <div className="mt-2 flex items-center gap-2 text-orange-600 bg-orange-50 px-3 py-2 rounded-md">
                            <AlertTriangle className="h-4 w-4" />
                            <span className="text-sm font-medium">
                              Maximum available: {item.product.stock} {item.product.stock === 1 ? 'item' : 'items'}
                            </span>
                          </div>
                        ) : item.product.stock <= 5 ? (
                          <p className="text-sm text-orange-600 mt-2">
                            ⚠️ Only {item.product.stock} left in stock
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Continue Shopping */}
            <div className="mt-6">
              <Link
                href="/products"
                className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium"
              >
                ← Continue Shopping
              </Link>
            </div>
          </div>

          {/* Order Summary */}
          <div className="lg:col-span-4 mt-8 lg:mt-0">
            <div className="bg-white rounded-lg shadow-md p-6 sticky top-20">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Order Summary</h2>

              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span>{formatPrice((cart.total || 0) / 1.18)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Shipping</span>
                  <span className="text-green-600">FREE</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Tax (18% GST)</span>
                  <span>{formatPrice((cart.total || 0) - ((cart.total || 0) / 1.18))}</span>
                </div>
                <div className="border-t pt-3 flex justify-between text-lg font-bold text-gray-900">
                  <span>Total</span>
                  <span>{formatPrice(cart.total || 0)}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">* Final tax calculated at checkout</p>
              </div>

              {/* Checkout Button */}
              <Link
                href="/checkout"
                className="w-full bg-blue-600 text-white py-3 rounded-md hover:bg-blue-700 transition-colors font-semibold flex items-center justify-center gap-2"
              >
                Proceed to Checkout
                <ArrowRight className="h-5 w-5" />
              </Link>

              {/* Security Badge */}
              <div className="mt-6 text-center">
                <p className="text-xs text-gray-500">
                  🔒 Secure Checkout · Safe Payment
                </p>
              </div>

              {/* Promo Code (Optional) */}
              <div className="mt-6 pt-6 border-t">
                <p className="text-sm font-medium text-gray-900 mb-2">Have a promo code?</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter code"
                    className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button className="bg-gray-200 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-300 text-sm font-medium">
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
