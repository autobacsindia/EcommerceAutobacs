'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCart } from '@/context/CartContext';
import { toast } from 'react-hot-toast';

interface StickyCartBarProps {
  product: {
    _id: string;
    name: string;
    price: number;
    stock: number;
  };
  isDark?: boolean;
}

export default function StickyCartBar({ product, isDark = true }: StickyCartBarProps) {
  const { addToCart } = useCart();
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [buyNowLoading, setBuyNowLoading] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // Show sticky bar after scrolling 600px
      setIsVisible(window.scrollY > 600);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleAddToCart = async () => {
    setLoading(true);
    try {
      await addToCart(product._id, 1);
      toast.success('Added to cart!');
    } catch (error: any) {
      toast.error(error.message || 'Failed to add to cart');
    } finally {
      setLoading(false);
    }
  };

  const handleBuyNow = async () => {
    setBuyNowLoading(true);
    try {
      await addToCart(product._id, 1);
      router.push('/checkout');
    } catch (error: any) {
      toast.error(error.message || 'Failed to add to cart');
      setBuyNowLoading(false);
    }
  };

  if (!isVisible || product.stock === 0) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className={`fixed bottom-0 left-0 right-0 backdrop-blur-xl border-t shadow-2xl z-50 md:hidden ${isDark ? 'bg-zinc-900/95 border-zinc-700' : 'bg-white/95 border-gray-300'}`}
      >
        <div className="flex items-center justify-between p-4 max-w-7xl mx-auto gap-4">
          <div className="flex-1 min-w-0">
            <p className={`text-sm truncate ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>{product.name}</p>
            <p className="text-2xl font-black text-orange-500">
              ₹{product.price.toLocaleString('en-IN')}
            </p>
          </div>
          <div className="flex gap-2">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleAddToCart}
              disabled={loading}
              className="bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-700 text-white font-bold py-3 px-5 rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg shadow-orange-500/30"
            >
              <ShoppingCart className="w-5 h-5" />
              <span className="hidden sm:inline">{loading ? 'Adding...' : 'Add'}</span>
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleBuyNow}
              disabled={buyNowLoading}
              className={`${isDark ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-gray-200 hover:bg-gray-300'} disabled:bg-zinc-800 text-white font-bold py-3 px-5 rounded-xl transition-all duration-200 flex items-center gap-2`}
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
