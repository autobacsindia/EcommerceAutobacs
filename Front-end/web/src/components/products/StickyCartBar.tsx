'use client';

import type { StockStatus } from '@/lib/stock';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCart } from '@/context/CartContext';
import { toast } from 'react-hot-toast';

interface StickyVariant {
  _id: string;
  label: string;
  price: number;
  stock: StockStatus;
}

interface StickyCartBarProps {
  product: {
    _id: string;
    name: string;
    price: number;
    stock: StockStatus;
  };
  isDark?: boolean;
  // Variable-product context (mirrors the BuyBox selection, lifted to the page).
  isVariable?: boolean;
  variant?: StickyVariant | null;
  priceMin?: number;
  priceMax?: number;
}

export default function StickyCartBar({
  product,
  isDark = true,
  isVariable = false,
  variant = null,
  priceMin,
  priceMax,
}: StickyCartBarProps) {
  const { addToCart } = useCart();
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [buyNowLoading, setBuyNowLoading] = useState(false);

  // For a variable product the buyable unit is the selected variant; until one is
  // picked the bar shows the range and its buttons prompt selection (scroll up).
  const needsSelection = isVariable && !variant;
  const activePrice = variant ? variant.price : product.price;
  const activeStock: StockStatus = variant ? variant.stock : product.stock;
  const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;

  const promptSelect = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Select a model to continue', { icon: '👆' });
  };

  useEffect(() => {
    const handleScroll = () => {
      // Show sticky bar after scrolling 600px
      setIsVisible(window.scrollY > 600);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const snapshot = () => ({
    name: product.name,
    price: activePrice,
    images: [] as [],
    stock: activeStock,
    variantLabel: variant?.label ?? null,
  });

  const handleAddToCart = async () => {
    if (needsSelection) return promptSelect();
    setLoading(true);
    // Optimistic: badge + toast fire on tap; rolled back with an error toast on
    // a server rejection.
    toast.success('Added to cart!');
    try {
      await addToCart(product._id, 1, snapshot(), variant?._id ?? null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to add to cart');
    } finally {
      setLoading(false);
    }
  };

  const handleBuyNow = async () => {
    if (needsSelection) return promptSelect();
    setBuyNowLoading(true);
    try {
      await addToCart(product._id, 1, snapshot(), variant?._id ?? null);
      router.push('/checkout');
    } catch (error: any) {
      toast.error(error.message || 'Failed to add to cart');
      setBuyNowLoading(false);
    }
  };

  // Hide when the resolved unit is sold out (a selected out-of-stock variant, or a
  // simple product out of stock). Variable products with no selection stay visible.
  if (!isVisible || activeStock === 'out') {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className={`fixed bottom-0 left-0 right-0 backdrop-blur-xl border-t shadow-2xl z-50 md:hidden ${isDark ? 'bg-obsidian-deep/95 border-hairline' : 'bg-obsidian/95 border-hairline'}`}
      >
        <div className="flex items-center justify-between p-4 max-w-7xl mx-auto gap-4">
          <div className="flex-1 min-w-0">
            <p className={`text-sm truncate ${isDark ? 'text-ink-muted' : 'text-ink-muted'}`}>
              {product.name}
              {variant ? ` · ${variant.label}` : ''}
            </p>
            <p className="text-2xl font-black text-orange-500">
              {needsSelection
                ? (priceMin != null && priceMax != null && priceMin !== priceMax
                    ? `${fmt(priceMin)} – ${fmt(priceMax)}`
                    : fmt(priceMin ?? activePrice))
                : fmt(activePrice)}
            </p>
          </div>
          <div className="flex gap-2">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleAddToCart}
              disabled={loading}
              className="bg-orange-500 hover:bg-orange-600 disabled:bg-obsidian-raised text-ink font-bold py-3 px-5 rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg shadow-orange-500/30"
            >
              <ShoppingCart className="w-5 h-5" />
              <span className="hidden sm:inline">{loading ? 'Adding...' : 'Add'}</span>
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleBuyNow}
              disabled={buyNowLoading}
              className={`${isDark ? 'bg-obsidian-raised hover:bg-obsidian-raised' : 'bg-obsidian-raised hover:bg-obsidian-raised'} disabled:bg-obsidian-raised text-ink font-bold py-3 px-5 rounded-xl transition-all duration-200 flex items-center gap-2`}
            >
              <Zap className="w-5 h-5" />
              <span className="hidden sm:inline">{buyNowLoading ? '...' : 'Buy'}</span>
            </motion.button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
