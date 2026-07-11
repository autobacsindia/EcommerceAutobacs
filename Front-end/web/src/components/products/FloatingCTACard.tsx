'use client';

import type { StockStatus } from '@/lib/stock';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart, Zap, Shield, Truck, RotateCcw, CreditCard, Heart } from 'lucide-react';
import { motion } from 'framer-motion';
import { useCart } from '@/context/CartContext';
import { toast } from 'react-hot-toast';
import { TRUST_BADGES, type TrustIcon } from '@/lib/storePolicies';
import SaleCountdown, { useSaleCountdown } from './SaleCountdown';

const TRUST_ICONS: Record<TrustIcon, typeof Shield> = { CreditCard, Shield, Truck, RotateCcw };

// Stock is a coarse status (no unit count), so cap quantity at a fixed max.
const MAX_QUANTITY = 99;

interface FloatingCTACardProps {
  product: {
    _id: string;
    name: string;
    price: number;
    originalPrice?: number;
    saleEndsAt?: string | null;
    stock: StockStatus;
  };
}

export default function FloatingCTACard({ product }: FloatingCTACardProps) {
  const { addToCart } = useCart();
  const router = useRouter();
  const [cartLoading, setCartLoading] = useState(false);
  const [buyNowLoading, setBuyNowLoading] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [isWishlisted, setIsWishlisted] = useState(false);

  const { live: saleLive } = useSaleCountdown(product.saleEndsAt);
  const showSale =
    !!product.originalPrice &&
    product.originalPrice > product.price &&
    (!product.saleEndsAt || saleLive);
  const discount = showSale
    ? Math.round(((product.originalPrice! - product.price) / product.originalPrice!) * 100)
    : 0;

  const handleAddToCart = async () => {
    setCartLoading(true);
    // Optimistic: badge + toast fire on tap; rolled back with an error toast on
    // a server rejection.
    toast.success(`Added ${quantity} item(s) to cart!`);
    try {
      await addToCart(product._id, quantity);
    } catch (error: any) {
      toast.error(error.message || 'Failed to add to cart');
    } finally {
      setCartLoading(false);
    }
  };

  const handleBuyNow = async () => {
    setBuyNowLoading(true);
    try {
      await addToCart(product._id, quantity);
      router.push('/checkout');
    } catch (error: any) {
      toast.error(error.message || 'Failed to add to cart');
      setBuyNowLoading(false);
    }
  };

  const handleToggleWishlist = async () => {
    setWishlistLoading(true);
    try {
      // TODO: Implement wishlist API call
      setIsWishlisted(!isWishlisted);
      toast.success(isWishlisted ? 'Removed from wishlist' : 'Added to wishlist!');
    } catch (error: any) {
      toast.error(error.message || 'Failed to update wishlist');
    } finally {
      setWishlistLoading(false);
    }
  };

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      className="bg-obsidian/10 backdrop-blur-xl border border-hairline/20 rounded-2xl p-5 sm:p-8 space-y-6 shadow-2xl"
    >
      {/* Price Section */}
      <div className="space-y-2">
        <div className="flex items-baseline gap-3">
          <span className="text-4xl sm:text-5xl font-black text-ink">
            ₹{product.price.toLocaleString('en-IN')}
          </span>
        </div>
        {showSale && (
          <div className="flex items-center gap-2">
            <span className="text-ink-muted line-through">
              ₹{product.originalPrice?.toLocaleString('en-IN')}
            </span>
            <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm font-bold border border-green-500/30">
              {discount}% OFF
            </span>
          </div>
        )}
        {showSale && <SaleCountdown saleEndsAt={product.saleEndsAt} />}
        <p className="text-ink-muted text-sm">Inclusive of all taxes</p>
      </div>

      {/* Quantity Selector */}
      <div className="flex items-center gap-4">
        <label className="text-ink/70 font-semibold">Quantity:</label>
        <div className="flex items-center bg-obsidian/10 border border-hairline/20 rounded-lg">
          <button
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            disabled={quantity <= 1}
            className="px-4 py-3 text-ink font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-obsidian/10"
          >
            −
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
            className="px-6 py-3 text-ink font-bold min-w-16 text-center border-x border-hairline/20 bg-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            onClick={() => setQuantity(Math.min(MAX_QUANTITY, quantity + 1))}
            disabled={quantity >= MAX_QUANTITY}
            className="px-4 py-3 text-ink font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-obsidian/10"
          >
            +
          </button>
        </div>
        {product.stock === 'low' && (
          <span className="text-orange-400 text-sm font-semibold">
            Low stock!
          </span>
        )}
      </div>

      {/* CTA Buttons */}
      <div className="space-y-3">
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleAddToCart}
          disabled={product.stock === 'out' || cartLoading}
          className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-obsidian-raised text-ink font-bold py-4 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-3 text-lg shadow-lg shadow-orange-500/30"
        >
          <ShoppingCart className="w-6 h-6" />
          {cartLoading ? 'Adding...' : 'Add to Cart'}
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleBuyNow}
          disabled={product.stock === 'out' || buyNowLoading}
          className="w-full bg-obsidian/10 hover:bg-obsidian/20 disabled:bg-obsidian-raised border border-hairline/30 text-ink font-bold py-4 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-3 text-lg"
        >
          <Zap className="w-6 h-6" />
          {buyNowLoading ? 'Processing...' : 'Buy Now'}
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleToggleWishlist}
          disabled={wishlistLoading}
          className={`w-full border font-bold py-3 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-3 text-lg ${
            isWishlisted
              ? 'bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30'
              : 'bg-obsidian/5 border-hairline/20 text-ink/70 hover:bg-obsidian/10 hover:border-hairline/30'
          }`}
        >
          <Heart className={`w-5 h-5 ${isWishlisted ? 'fill-current' : ''}`} />
          {wishlistLoading ? 'Updating...' : isWishlisted ? 'Saved to Wishlist' : 'Add to Wishlist'}
        </motion.button>
      </div>

      {/* Trust Badges — site-wide, from a single source of truth (storePolicies) */}
      <div
        className="grid gap-3 pt-4 border-t border-hairline/20"
        style={{ gridTemplateColumns: `repeat(${TRUST_BADGES.length}, minmax(0, 1fr))` }}
      >
        {TRUST_BADGES.map(({ icon, label }) => {
          const Icon = TRUST_ICONS[icon];
          return (
            <div key={label} className="flex flex-col items-center text-center gap-2">
              <Icon className="w-6 h-6 text-orange-400" />
              <span className="text-xs text-ink/70 font-medium">{label}</span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
