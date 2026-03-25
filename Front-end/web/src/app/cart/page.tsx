'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Trash2, Plus, Minus, ShoppingBag, ArrowRight } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import EnhancedImage from '@/components/layout/EnhancedImage';
import { ProductImage, productUrl } from '@/lib/types';
import { toast } from 'react-hot-toast';
import SkeletonLoader from '@/components/layout/SkeletonLoader';

export default function CartPage() {
  const { cart, removeFromCart, updateQuantity, clearCart, isLoading } = useCart();
  const { formatPrice } = useCurrency();
  const [updatingItem, setUpdatingItem] = useState<string | null>(null);

  const handleQuantityChange = async (productId: string, newQuantity: number) => {
    if (newQuantity < 1) return;
    
    try {
      setUpdatingItem(productId);
      await updateQuantity(productId, newQuantity);
    } catch (error) {
      console.error('Failed to update quantity:', error);
      toast.error('Failed to update quantity');
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
                {cart.items.map((item) => (
                  <div key={item.product._id} className="p-6">
                    <div className="flex gap-4">
                      {/* Product Image */}
                      <Link
                        href={productUrl(item.product)}
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
                              href={productUrl(item.product)}
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

                        {/* Stock Warning */}
                        {item.quantity >= item.product.stock && (
                          <p className="text-sm text-orange-600 mt-2">
                            Maximum available: {item.product.stock}
                          </p>
                        )}
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
