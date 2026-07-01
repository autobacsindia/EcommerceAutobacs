'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ShoppingCart } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { useCurrency } from '@/context/CurrencyContext';
import { toast } from 'react-hot-toast';
import { productUrl } from '@/lib/types';

interface RecentProduct {
  _id: string;
  slug?: string;
  name: string;
  price: number;
  originalPrice?: number;
  image?: string;
}

export default function RecentlyViewedProducts() {
  const { formatPrice } = useCurrency();
  const [products, setProducts] = useState<RecentProduct[]>([]);
  const { addToCart } = useCart();
  const { user } = useAuth();
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const storageKey = user ? `recentlyViewed_${user._id}` : 'recentlyViewed_guest';
      const stored = localStorage.getItem(storageKey);
      setProducts(stored ? JSON.parse(stored) : []);
    } catch (e) {
      console.error('Failed to load recently viewed', e);
    }
  }, [user]);

  const handleImageError = (id: string) => {
    setImageErrors(prev => ({ ...prev, [id]: true }));
  };

  const clearHistory = () => {
    const storageKey = user ? `recentlyViewed_${user._id}` : 'recentlyViewed_guest';
    localStorage.removeItem(storageKey);
    setProducts([]);
    toast.success('Recently viewed history cleared');
  };

  if (products.length === 0) return null;

  return (
    <section className="py-12 bg-obsidian-deep border-t border-hairline">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-gold font-display font-bold text-sm uppercase tracking-widest mb-1">Your History</p>
            <h2 className="text-2xl font-display font-bold text-ink uppercase tracking-wide">Recently Viewed</h2>
          </div>
          <button
            onClick={clearHistory}
            className="text-sm text-ink/70 hover:text-red-400 font-display px-3 py-1 rounded-sm hover:bg-obsidian-raised transition-colors"
          >
            Clear History
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
          {products.slice(0, 5).map((product) => {
            const url = productUrl(product, '/products');
            return (
            <div key={product._id} className="group bg-obsidian border border-hairline rounded-lg hover:border-gold transition-all duration-300">
              <Link href={url} className="block relative aspect-4/3 overflow-hidden rounded-t-lg bg-obsidian-raised">
                {product.image && !imageErrors[product._id] ? (
                  <Image
                    src={product.image}
                    alt={product.name}
                    fill
                    className="object-contain p-4 group-hover:scale-105 transition-transform duration-500"
                    onError={() => handleImageError(product._id)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-obsidian-raised">
                    <span className="text-ink-muted text-xs">No Image</span>
                  </div>
                )}
              </Link>

              <div className="p-4">
                <Link href={url}>
                  <h3 className="font-display font-bold text-ink text-sm uppercase tracking-wide line-clamp-2 min-h-[2.5em] group-hover:text-gold transition-colors">
                    {product.name}
                  </h3>
                </Link>

                <div className="mt-3 flex items-end justify-between">
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-display font-bold text-gold">{formatPrice(product.price)}</span>
                    {product.originalPrice && product.originalPrice > product.price && (
                      <span className="text-xs text-ink-muted line-through">{formatPrice(product.originalPrice)}</span>
                    )}
                  </div>

                  <button
                    onClick={async (e) => {
                      e.preventDefault();
                      try {
                        await addToCart(product._id, 1);
                        toast.success('Added to cart');
                      } catch (error: any) {
                        toast.error(error.message || 'Failed to add to cart');
                      }
                    }}
                    className="p-2 bg-obsidian-raised text-obsidian/70 rounded-full hover:bg-gold hover:text-obsidian transition-colors"
                    title="Add to Cart"
                  >
                    <ShoppingCart className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
