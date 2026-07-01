'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import { productUrl } from '@/lib/types';
import EnhancedImage from '@/components/layout/EnhancedImage';
import { useAuth } from '@/context/AuthContext';
import { useCurrency } from '@/context/CurrencyContext';

interface RecentProduct {
  _id: string;
  name: string;
  price: number;
  originalPrice?: number;
  image: string;
  slug: string;
}

const RecentlyViewed = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const [products, setProducts] = useState<RecentProduct[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const storageKey = user ? `recentlyViewed_${user._id}` : 'recentlyViewed_guest';
      const stored = localStorage.getItem(storageKey);
      setProducts(stored ? JSON.parse(stored) : []);
    } catch (e) {
      console.error('Failed to load recently viewed products', e);
    }
  }, [user]);

  const clearHistory = () => {
    const storageKey = user ? `recentlyViewed_${user._id}` : 'recentlyViewed_guest';
    localStorage.removeItem(storageKey);
    setProducts([]);
    toast.success('Recently viewed history cleared');
  };

  if (!mounted || products.length === 0) return null;

  return (
    <div className="bg-obsidian-deep border-t border-hairline py-8">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between mb-6">
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

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {products.map((product) => {
            const url = productUrl(product, '/products');
            return (
            <Link
              key={product._id}
              href={url}
              className="group block bg-obsidian border border-hairline rounded-lg overflow-hidden hover:border-gold transition-all duration-300"
            >
              <div className="aspect-square relative bg-obsidian-raised">
                <EnhancedImage
                  src={product.image}
                  alt={product.name}
                  fill
                  className="object-contain p-4 group-hover:scale-105 transition-transform duration-300"
                  sizes="(max-width: 768px) 50vw, (max-width: 1200px) 25vw, 20vw"
                  context="product"
                />
              </div>
              <div className="p-4">
                <h3 className="font-display font-bold text-ink text-sm uppercase tracking-wide line-clamp-2 min-h-10 mb-2 group-hover:text-gold transition-colors">
                  {product.name}
                </h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-display font-bold text-gold">
                    {formatPrice(product.price)}
                  </span>
                  {product.originalPrice && product.originalPrice > product.price && (
                    <span className="text-xs text-ink-muted line-through">
                      {formatPrice(product.originalPrice)}
                    </span>
                  )}
                </div>
              </div>
            </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default RecentlyViewed;
