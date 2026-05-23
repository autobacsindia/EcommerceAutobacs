'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import { productUrl } from '@/lib/types';
import EnhancedImage from '@/components/layout/EnhancedImage';
import { useAuth } from '@/context/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';

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
    <div className="bg-[#080808] border-t border-[#252525] py-8">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-1">Your History</p>
            <h2 className="text-2xl font-condensed font-bold text-white uppercase tracking-wide">Recently Viewed</h2>
          </div>
          <button
            onClick={clearHistory}
            className="text-sm text-[#C4C4C4] hover:text-red-400 font-body px-3 py-1 rounded-sm hover:bg-[#252525] transition-colors"
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
              className="group block bg-[#0E0E0E] border border-[#252525] rounded-lg overflow-hidden hover:border-[#3B9EE8] transition-all duration-300"
            >
              <div className="aspect-square relative bg-[#161616]">
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
                <h3 className="font-condensed font-bold text-white text-sm uppercase tracking-wide line-clamp-2 min-h-10 mb-2 group-hover:text-[#3B9EE8] transition-colors">
                  {product.name}
                </h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-condensed font-bold text-[#3B9EE8]">
                    {formatPrice(product.price)}
                  </span>
                  {product.originalPrice && product.originalPrice > product.price && (
                    <span className="text-xs text-[#555555] line-through">
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
