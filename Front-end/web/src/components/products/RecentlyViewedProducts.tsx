'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ShoppingCart } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';

interface RecentProduct {
  _id: string;
  name: string;
  price: number;
  originalPrice?: number;
  image?: string;
  slug?: string;
}

export default function RecentlyViewedProducts() {
  const [products, setProducts] = useState<RecentProduct[]>([]);
  const { addToCart } = useCart();
  const { user } = useAuth();
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const storageKey = user ? `recentlyViewed_${user._id}` : 'recentlyViewed_guest';
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        setProducts(JSON.parse(stored));
      } else {
        setProducts([]);
      }
    } catch (e) {
      console.error('Failed to load recently viewed', e);
    }
  }, [user]);

  const handleImageError = (id: string) => {
    setImageErrors(prev => ({ ...prev, [id]: true }));
  };

  if (products.length === 0) return null;

  return (
    <section className="py-12 bg-white border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-8">Recently Viewed</h2>
        
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
          {products.slice(0, 5).map((product) => (
            <div key={product._id} className="group bg-white rounded-lg border border-gray-100 hover:shadow-lg transition-all duration-300">
              <Link href={`/products/${product._id}`} className="block relative aspect-[4/3] overflow-hidden rounded-t-lg bg-gray-50">
                {product.image && !imageErrors[product._id] ? (
                  <Image
                    src={product.image}
                    alt={product.name}
                    fill
                    className="object-contain p-4 group-hover:scale-105 transition-transform duration-500"
                    onError={() => handleImageError(product._id)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 bg-gray-50">
                    <span className="text-xs">No Image</span>
                  </div>
                )}
              </Link>
              
              <div className="p-4">
                <Link href={`/products/${product._id}`}>
                  <h3 className="text-sm font-medium text-gray-900 line-clamp-2 min-h-[2.5em] group-hover:text-blue-600 transition-colors">
                    {product.name}
                  </h3>
                </Link>
                
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-lg font-bold text-gray-900">₹{product.price.toLocaleString()}</span>
                      {product.originalPrice && product.originalPrice > product.price && (
                        <span className="text-xs text-gray-400 line-through">₹{product.originalPrice.toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                  
                  <button 
                    onClick={(e) => {
                      e.preventDefault();
                      addToCart(product._id, 1);
                    }}
                    className="p-2 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-600 hover:text-white transition-colors"
                    title="Add to Cart"
                  >
                    <ShoppingCart className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
