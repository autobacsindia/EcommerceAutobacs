'use client';

import type { StockStatus } from '@/lib/stock';
import { useEffect, useState } from 'react';
import apiClient from '@/lib/api';
import ProductGrid from '@/components/products/ProductGrid';

interface ProductImage {
  url: string;
  alt?: string;
  isPrimary?: boolean;
  _id?: string;
}

interface Product {
  _id: string;
  name: string;
  price: number;
  originalPrice?: number;
  images: ProductImage[] | string;
  categories?: Array<{ _id: string; name: string; slug: string }>;
  stock: StockStatus;
  averageRating: number;
  isFeatured?: boolean;
  isOfferFeatured?: boolean;
}

export default function OffersPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOffers = async () => {
      try {
        setLoading(true);
        const response: any = await apiClient.get('/products/offers?limit=24');
        setProducts(response.products || []);
      } catch (err: any) {
        setError('Failed to load offers');
      } finally {
        setLoading(false);
      }
    };
    fetchOffers();
  }, []);

  return (
    <div className="min-h-screen bg-[#080808]">
      <div className="bg-[#0E0E0E] border-b border-[#252525] py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-2">Limited Time</p>
          <h1 className="text-4xl font-condensed font-bold text-white uppercase tracking-wide mb-3">Offers</h1>
          <p className="text-[#C4C4C4] font-body">Your Dream Upgrades, Now More Affordable!</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-[#0E0E0E] border border-[#252525] rounded-sm overflow-hidden animate-pulse">
                <div className="h-48 bg-[#161616]" />
                <div className="p-4">
                  <div className="h-4 bg-[#252525] rounded-sm mb-2" />
                  <div className="h-4 bg-[#252525] rounded-sm w-2/3 mb-4" />
                  <div className="h-6 bg-[#252525] rounded-sm w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-6 text-center">
            <p className="text-red-400 font-body">{error}</p>
          </div>
        )}

        {!loading && !error && products.length > 0 && (
          <ProductGrid products={products} />
        )}

        {!loading && !error && products.length === 0 && (
          <div className="text-center py-12">
            <p className="text-[#555555] font-body">No offers available right now. Please check back later.</p>
          </div>
        )}
      </div>
    </div>
  );
}
