'use client';

import { useState } from 'react';
import { ShoppingCart, Zap, Shield, Truck, RotateCcw, CreditCard } from 'lucide-react';
import { motion } from 'framer-motion';
import { useCart } from '@/context/CartContext';
import { toast } from 'react-hot-toast';

interface FloatingCTACardProps {
  product: {
    _id: string;
    name: string;
    price: number;
    originalPrice?: number;
    stock: number;
  };
}

export default function FloatingCTACard({ product }: FloatingCTACardProps) {
  const { addToCart } = useCart();
  const [cartLoading, setCartLoading] = useState(false);
  const [quantity, setQuantity] = useState(1);

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

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-8 space-y-6 shadow-2xl"
    >
      {/* Price Section */}
      <div className="space-y-2">
        <div className="flex items-baseline gap-3">
          <span className="text-5xl font-black text-white">
            ₹{product.price.toLocaleString('en-IN')}
          </span>
        </div>
        {discount > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-zinc-400 line-through">
              ₹{product.originalPrice?.toLocaleString('en-IN')}
            </span>
            <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm font-bold border border-green-500/30">
              {discount}% OFF
            </span>
          </div>
        )}
        <p className="text-zinc-400 text-sm">Inclusive of all taxes</p>
      </div>

      {/* Quantity Selector */}
      <div className="flex items-center gap-4">
        <label className="text-zinc-300 font-semibold">Quantity:</label>
        <div className="flex items-center bg-white/10 border border-white/20 rounded-lg">
          <button
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            className="px-4 py-3 text-white hover:bg-white/10 transition-colors font-bold"
          >
            −
          </button>
          <span className="px-6 py-3 text-white font-bold min-w-[4rem] text-center border-x border-white/20">
            {quantity}
          </span>
          <button
            onClick={() => setQuantity(Math.min(product.stock, quantity + 1))}
            className="px-4 py-3 text-white hover:bg-white/10 transition-colors font-bold"
          >
            +
          </button>
        </div>
      </div>

      {/* CTA Buttons */}
      <div className="space-y-3">
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleAddToCart}
          disabled={product.stock === 0 || cartLoading}
          className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-700 text-white font-bold py-4 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-3 text-lg shadow-lg shadow-orange-500/30"
        >
          <ShoppingCart className="w-6 h-6" />
          {cartLoading ? 'Adding...' : 'Add to Cart'}
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleAddToCart}
          disabled={product.stock === 0 || cartLoading}
          className="w-full bg-white/10 hover:bg-white/20 disabled:bg-zinc-800 border border-white/30 text-white font-bold py-4 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-3 text-lg"
        >
          <Zap className="w-6 h-6" />
          Buy Now
        </motion.button>
      </div>

      {/* Trust Badges */}
      <div className="grid grid-cols-3 gap-3 pt-4 border-t border-white/20">
        <div className="flex flex-col items-center text-center gap-2">
          <Truck className="w-6 h-6 text-orange-400" />
          <span className="text-xs text-zinc-300 font-medium">Free Shipping</span>
        </div>
        <div className="flex flex-col items-center text-center gap-2">
          <RotateCcw className="w-6 h-6 text-orange-400" />
          <span className="text-xs text-zinc-300 font-medium">7-Day Returns</span>
        </div>
        <div className="flex flex-col items-center text-center gap-2">
          <Shield className="w-6 h-6 text-orange-400" />
          <span className="text-xs text-zinc-300 font-medium">COD Available</span>
        </div>
      </div>

      {/* Additional Trust */}
      <div className="space-y-2 pt-4 border-t border-white/20">
        <div className="flex items-center gap-2 text-zinc-300 text-sm">
          <CreditCard className="w-4 h-4 text-green-400" />
          <span>Secure Checkout</span>
        </div>
        <div className="flex items-center gap-2 text-zinc-300 text-sm">
          <Shield className="w-4 h-4 text-green-400" />
          <span>2-Year Warranty</span>
        </div>
      </div>
    </motion.div>
  );
}
