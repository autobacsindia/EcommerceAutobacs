'use client';

import type { StockStatus } from '@/lib/stock';
import Link from 'next/link';
import { ShoppingCart, SlidersHorizontal } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useCurrency } from '@/context/CurrencyContext';
import { toast } from 'react-hot-toast';

interface Props {
  productId: string;
  price: number;
  originalPrice?: number;
  stock: StockStatus;
  // Variable-product context: a card can't quick-add a variable product (a model
  // must be picked on the PDP), so it shows a "From" price + a Select link instead.
  productType?: 'simple' | 'variable' | 'grouped';
  priceMin?: number;
  priceMax?: number;
  href?: string | null;
}

export default function ProductCardPriceActions({
  productId,
  price,
  originalPrice,
  stock,
  productType,
  priceMin,
  priceMax,
  href,
}: Props) {
  const { addToCart } = useCart();
  const { formatPrice } = useCurrency();

  const isVariable = productType === 'variable';
  // Range spans two different prices → advertise the starting ("From") price.
  const showsRange = isVariable && priceMin != null && priceMax != null && priceMax > priceMin;
  const displayPrice = isVariable ? priceMin ?? price : price;

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
        {showsRange && (
          <p className="text-[10px] uppercase tracking-[0.16em] text-ink-muted mb-0.5">From</p>
        )}
        {!isVariable && originalPrice && originalPrice > price ? (
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-display font-bold text-gold">{formatPrice(price)}</p>
            <p className="text-sm text-ink-muted line-through">{formatPrice(originalPrice)}</p>
          </div>
        ) : (
          <p className="text-2xl font-display font-bold text-gold">{formatPrice(displayPrice)}</p>
        )}
      </div>

      {isVariable ? (
        // A variable product must be configured on the PDP — link there instead of
        // quick-adding (which the server would reject without a selected variant).
        <Link
          href={href || `/products`}
          className="flex items-center gap-2 bg-gold text-obsidian px-4 py-2 rounded-sm hover:opacity-90 transition-opacity font-display font-bold text-sm tracking-wider uppercase"
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="text-sm font-medium">Select</span>
        </Link>
      ) : (
        <button
          onClick={handleAddToCart}
          disabled={stock === 'out'}
          className="flex items-center gap-2 bg-gold text-obsidian px-4 py-2 rounded-sm hover:bg-gold transition-colors disabled:bg-obsidian-raised disabled:text-ink-muted disabled:cursor-not-allowed font-display font-bold text-sm tracking-wider uppercase"
        >
          <ShoppingCart className="h-4 w-4" />
          <span className="text-sm font-medium">Add</span>
        </button>
      )}
    </div>
  );
}
