'use client';

import { useState } from 'react';
import { ShoppingCart, Zap, Shield, Truck, RotateCcw, Star } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { toast } from 'react-hot-toast';
import { type StockStatus, isOutOfStock, isLowStock } from '@/lib/stock';

// Max quantity a customer can add per line. Stock is a coarse status, so we no
// longer have a per-product unit count to cap against.
const MAX_QUANTITY = 99;

interface ProductInfoProps {
  product: {
    _id: string;
    name: string;
    price: number;
    originalPrice?: number;
    brand?: string;
    stock: StockStatus;
    averageRating?: number;
    totalReviews?: number;
    shortDescription?: string;
    features?: string[];
  };
}

export default function ProductInfo({ product }: ProductInfoProps) {
  const { addToCart } = useCart();
  const [cartLoading, setCartLoading] = useState(false);
  const [quantity, setQuantity] = useState(1);

  const outOfStock = isOutOfStock(product);
  const lowStock = isLowStock(product);

  const discount = product.originalPrice
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0;

  const handleAddToCart = async () => {
    setCartLoading(true);
    try {
      await addToCart(product._id, quantity);
      toast.success(`Added ${quantity} item(s) to cart!`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to add to cart');
    } finally {
      setCartLoading(false);
    }
  };

  const handleBuyNow = async () => {
    await handleAddToCart();
    // In a real implementation, redirect to checkout
    // router.push('/checkout');
  };

  return (
    <div className="space-y-6">
      {/* Brand */}
      {product.brand && (
        <div className="inline-block px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm font-medium">
          {product.brand}
        </div>
      )}

      {/* Product Title */}
      <h1 className="text-2xl md:text-3xl font-bold text-gray-900 leading-tight">
        {product.name}
      </h1>

      {/* Rating */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {[...Array(5)].map((_, i) => (
            <Star
              key={i}
              className={`w-4 h-4 ${
                i < Math.floor(product.averageRating || 0)
                  ? 'text-yellow-400 fill-yellow-400'
                  : 'text-gray-300'
              }`}
            />
          ))}
        </div>
        <span className="text-sm text-gray-600">
          {product.averageRating?.toFixed(1) || '0.0'} ({product.totalReviews || 0} reviews)
        </span>
      </div>

      {/* Price Section */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-2">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold text-gray-900">
            ₹{product.price.toLocaleString('en-IN')}
          </span>
          {product.originalPrice && product.originalPrice > product.price && (
            <>
              <span className="text-lg text-gray-500 line-through">
                ₹{product.originalPrice.toLocaleString('en-IN')}
              </span>
              <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold">
                {discount}% OFF
              </span>
            </>
          )}
        </div>
        <p className="text-sm text-gray-600">
          Inclusive of all taxes
        </p>
      </div>

      {/* Short Description */}
      {product.shortDescription && (
        <p className="text-gray-700 leading-relaxed">
          {product.shortDescription}
        </p>
      )}

      {/* Key Selling Points */}
      {product.features && product.features.length > 0 && (
        <ul className="space-y-2">
          {product.features.slice(0, 3).map((feature, index) => (
            <li key={index} className="flex items-start gap-2">
              <Shield className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <span className="text-gray-700">{feature}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Stock Status */}
      <div className="space-y-1">
        {!outOfStock ? (
          <>
            {lowStock ? (
              <p className="text-sm text-red-600 font-semibold">
                🔥 Low stock - Order now!
              </p>
            ) : (
              <p className="text-sm text-green-600 font-semibold">
                ✓ In Stock
              </p>
            )}
            <p className="text-xs text-gray-500">
              Ships within 24 hours
            </p>
          </>
        ) : (
          <p className="text-sm text-red-600 font-semibold">
            ✗ Out of Stock
          </p>
        )}
      </div>

      {/* Quantity Selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Quantity:</label>
        <div className="flex items-center border border-gray-300 rounded-lg">
          <button
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            disabled={quantity <= 1}
            className="px-3 py-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-100"
            aria-label="Decrease quantity"
          >
            -
          </button>
          <input
            type="number"
            min="1"
            max={MAX_QUANTITY}
            value={quantity}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              if (!isNaN(val) && val >= 1 && val <= MAX_QUANTITY) {
                setQuantity(val);
              }
            }}
            className="px-4 py-2 font-semibold min-w-[3rem] text-center border-x border-gray-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            onClick={() => setQuantity(Math.min(MAX_QUANTITY, quantity + 1))}
            disabled={quantity >= MAX_QUANTITY}
            className="px-3 py-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-100"
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
        {lowStock && (
          <span className="text-orange-600 text-sm font-semibold">
            Low stock!
          </span>
        )}
      </div>

      {/* CTA Buttons */}
      <div className="space-y-3">
        <button
          onClick={handleAddToCart}
          disabled={outOfStock || cartLoading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
        >
          <ShoppingCart className="w-5 h-5" />
          {cartLoading ? 'Adding...' : 'Add to Cart'}
        </button>

        <button
          onClick={handleBuyNow}
          disabled={outOfStock || cartLoading}
          className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
        >
          <Zap className="w-5 h-5" />
          Buy Now
        </button>
      </div>

      {/* Trust Badges */}
      <div className="grid grid-cols-3 gap-3 pt-4 border-t border-gray-200">
        <div className="flex flex-col items-center text-center gap-1">
          <Truck className="w-6 h-6 text-blue-600" />
          <span className="text-xs text-gray-700 font-medium">Free Shipping</span>
        </div>
        <div className="flex flex-col items-center text-center gap-1">
          <RotateCcw className="w-6 h-6 text-blue-600" />
          <span className="text-xs text-gray-700 font-medium">7-Day Returns</span>
        </div>
        <div className="flex flex-col items-center text-center gap-1">
          <Shield className="w-6 h-6 text-blue-600" />
          <span className="text-xs text-gray-700 font-medium">COD Available</span>
        </div>
      </div>

      {/* Social Proof */}
      <div className="bg-blue-50 rounded-lg p-3 text-center">
        <p className="text-sm text-blue-800 font-medium">
          🔥 500+ installed on Indian SUVs
        </p>
      </div>
    </div>
  );
}
