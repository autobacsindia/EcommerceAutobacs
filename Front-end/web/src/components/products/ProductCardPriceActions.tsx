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
    toast.success('Added to cart');
    try {
      await addToCart(productId, 1);
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
            <p className="text-2xl font-display font-bold text-gold">{formatPrice(price)}</p>
            <p className="text-sm text-ink-muted line-through">{formatPrice(originalPrice)}</p>
          </div>
        ) : (
          <p className="text-2xl font-display font-bold text-gold">{formatPrice(price)}</p>
        )}
      </div>

      <button
        onClick={handleAddToCart}
        disabled={stock === 'out'}
        className="flex items-center gap-2 bg-gold text-obsidian px-4 py-2 rounded-sm hover:bg-gold transition-colors disabled:bg-obsidian-raised disabled:text-ink-muted disabled:cursor-not-allowed font-display font-bold text-sm tracking-wider uppercase"
      >
        <ShoppingCart className="h-4 w-4" />
        <span className="text-sm font-medium">Add</span>
      </button>
    </div>
  );
}
