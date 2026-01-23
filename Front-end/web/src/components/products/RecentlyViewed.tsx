'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import EnhancedImage from '@/components/layout/EnhancedImage';
import { useAuth } from '@/context/AuthContext';

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
  const [products, setProducts] = useState<RecentProduct[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const storageKey = user ? `recentlyViewed_${user._id}` : 'recentlyViewed_guest';
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        setProducts(JSON.parse(stored));
      } else {
        setProducts([]);
      }
    } catch (e) {
      console.error('Failed to load recently viewed products', e);
    }
  }, [user]);

  if (!mounted || products.length === 0) {
    return null;
  }

  return (
    <div className="bg-white py-8">
      <div className="container mx-auto px-4">
        <h2 className="text-2xl font-bold mb-6 text-gray-800">Recently Viewed</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {products.map((product) => (
            <Link 
              key={product._id} 
              href={`/products/${product._id}`}
              className="group block bg-white border border-gray-100 rounded-lg overflow-hidden hover:shadow-md transition-shadow"
            >
              <div className="aspect-square relative bg-gray-50">
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
                <h3 className="text-sm font-medium text-gray-900 line-clamp-2 min-h-[2.5rem] mb-2 group-hover:text-blue-600">
                  {product.name}
                </h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-bold text-gray-900">
                    ₹{product.price?.toLocaleString('en-IN')}
                  </span>
                  {product.originalPrice && product.originalPrice > product.price && (
                    <span className="text-xs text-gray-500 line-through">
                      ₹{product.originalPrice.toLocaleString('en-IN')}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

export default RecentlyViewed;
