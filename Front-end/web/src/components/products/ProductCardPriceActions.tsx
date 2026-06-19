'use client';

import type { StockStatus } from '@/lib/stock';
import { ShoppingCart } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useCurrency } from '@/context/CurrencyContext';
import { toast } from 'react-hot-toast';

interface Props {
  productId: string;
  price: number;
  originalPrice?: number;
  stock: StockStatus;
}

export default function ProductCardPriceActions({ productId, price, originalPrice, stock }: Props) {
  const { addToCart } = useCart();
  const { formatPrice } = useCurrency();

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await addToCart(productId, 1);
      toast.success('Added to cart');
    } catch (error: any) {
      console.error('Failed to add to cart:', error);
      toast.error(error.message || 'Failed to add to cart');
    }
  };

  return (
    <div className="flex items-center justify-between mt-4">
      <div>
        {originalPrice && originalPrice > price ? (
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-condensed font-bold text-[#3B9EE8]">{formatPrice(price)}</p>
            <p className="text-sm text-[#555555] line-through">{formatPrice(originalPrice)}</p>
          </div>
        ) : (
          <p className="text-2xl font-condensed font-bold text-[#3B9EE8]">{formatPrice(price)}</p>
        )}
      </div>

      <button
        onClick={handleAddToCart}
        disabled={stock === 'out'}
        className="flex items-center gap-2 bg-[#3B9EE8] text-white px-4 py-2 rounded-sm hover:bg-[#1A6FB5] transition-colors disabled:bg-[#252525] disabled:text-[#555555] disabled:cursor-not-allowed font-condensed font-bold text-sm tracking-wider uppercase"
      >
        <ShoppingCart className="h-4 w-4" />
        <span className="text-sm font-medium">Add</span>
      </button>
    </div>
  );
}
