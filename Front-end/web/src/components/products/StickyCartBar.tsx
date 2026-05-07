'use client';

import { useState, useEffect } from 'react';
import { ShoppingCart } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { toast } from 'react-hot-toast';

interface StickyCartBarProps {
  product: {
    _id: string;
    name: string;
    price: number;
    stock: number;
  };
}

export default function StickyCartBar({ product }: StickyCartBarProps) {
  const { addToCart } = useCart();
  const [isVisible, setIsVisible] = useState(false);
  const [loading, setLoading] = useState(false);

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

  if (!isVisible || product.stock === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50 md:hidden">
      <div className="flex items-center justify-between p-4 max-w-7xl mx-auto">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-600 truncate">{product.name}</p>
          <p className="text-xl font-bold text-gray-900">
            ₹{product.price.toLocaleString('en-IN')}
          </p>
        </div>
        <button
          onClick={handleAddToCart}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 flex items-center gap-2 disabled:opacity-50 active:scale-95"
        >
          <ShoppingCart className="w-5 h-5" />
          {loading ? 'Adding...' : 'Add to Cart'}
        </button>
      </div>
    </div>
  );
}
