'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ShoppingCart, Star, Zap } from 'lucide-react';
import EnhancedImage from '@/components/layout/EnhancedImage';
import apiClient from '@/lib/api';
import { useCart } from '@/context/CartContext';
import { useCurrency } from '@/contexts/CurrencyContext';

interface Product {
  _id: string;
  name: string;
  price: number;
  originalPrice?: number;
  images: Array<{ url: string; alt?: string }>;
  averageRating?: number;
  totalReviews?: number;
  slug: string;
  category?: { name: string; slug: string };
  stock: number;
}

const ModernFastMovingSection = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const { addToCart } = useCart();
  const [addingToCart, setAddingToCart] = useState<string | null>(null);
  const { formatPrice } = useCurrency();

  useEffect(() => {
    const fetchFastMoving = async () => {
      try {
        // Fetch fast moving products
        // We use the search endpoint which supports isFastMoving filter
        const response: any = await apiClient.get('/products?isFastMoving=true&limit=4');
        if (response.products) {
          setProducts(response.products);
        }
      } catch (error) {
        console.error('Failed to fetch fast moving products:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFastMoving();
  }, []);

  const handleAddToCart = async (e: React.MouseEvent, product: Product) => {
    e.preventDefault();
    if (addingToCart) return;

    setAddingToCart(product._id);
    try {
      await addToCart(product._id, 1);
      // Optional: Show toast notification here
    } catch (error) {
      console.error('Failed to add to cart:', error);
    } finally {
      setAddingToCart(null);
    }
  };

  if (loading) {
    return (
      <section className="py-16 bg-gradient-to-br from-gray-900 to-gray-800 text-white">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-2 mb-8 animate-pulse">
            <div className="h-8 w-8 bg-gray-700 rounded-full"></div>
            <div className="h-8 w-64 bg-gray-700 rounded"></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-gray-800 rounded-xl overflow-hidden h-96 animate-pulse">
                <div className="h-48 bg-gray-700"></div>
                <div className="p-4 space-y-3">
                  <div className="h-4 bg-gray-700 rounded w-3/4"></div>
                  <div className="h-4 bg-gray-700 rounded w-1/2"></div>
                  <div className="h-10 bg-gray-700 rounded mt-4"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (products.length === 0) {
    return null;
  }

  return (
    <section className="py-16 bg-gradient-to-br from-gray-900 to-gray-800 text-white relative overflow-hidden">
      {/* Background Decorative Elements */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600 rounded-full blur-[128px] opacity-20 -translate-y-1/2 translate-x-1/3"></div>
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-purple-600 rounded-full blur-[128px] opacity-20 translate-y-1/2 -translate-x-1/3"></div>

      <div className="container mx-auto px-4 relative z-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">
          <div>
            <div className="flex items-center gap-2 text-yellow-400 mb-2 font-medium tracking-wide text-sm uppercase">
              <Zap className="h-4 w-4" fill="currentColor" />
              <span>Trending Now</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-white">Fast Moving Products</h2>
            <p className="text-gray-400 mt-2 max-w-xl">
              Our most popular items that are flying off the shelves. Get them while stocks last.
            </p>
          </div>
          <Link 
            href="/products?isFastMoving=true" 
            className="flex items-center gap-2 text-white hover:text-blue-400 transition-colors font-medium group"
          >
            View All Collection
            <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {products.map((product) => (
            <Link 
              key={product._id} 
              href={`/products/${product._id}`}
              className="group bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-2xl overflow-hidden hover:border-gray-500 hover:shadow-xl hover:shadow-blue-900/10 transition-all duration-300 flex flex-col"
            >
              {/* Image Container */}
              <div className="relative aspect-[4/3] bg-white overflow-hidden p-4">
                {product.originalPrice && product.price < product.originalPrice && (
                  <div className="absolute top-3 left-3 z-10 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded">
                    {Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}% OFF
                  </div>
                )}
                <EnhancedImage
                  src={product.images?.[0]?.url}
                  alt={product.name}
                  fill
                  className="object-contain group-hover:scale-105 transition-transform duration-500"
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                  context="product"
                />
              </div>

              {/* Content */}
              <div className="p-5 flex flex-col flex-grow">
                {product.category && (
                  <span className="text-xs text-blue-400 font-medium mb-2 block uppercase tracking-wider">
                    {product.category.name}
                  </span>
                )}
                <h3 className="text-lg font-bold text-gray-100 mb-2 line-clamp-2 group-hover:text-blue-400 transition-colors">
                  {product.name}
                </h3>
                
                <div className="flex items-center gap-1 mb-4">
                  <div className="flex text-yellow-400">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={`h-3 w-3 ${star <= (product.averageRating || 0) ? 'fill-current' : 'text-gray-600'}`}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-gray-500 ml-1">({product.totalReviews || 0})</span>
                </div>

                <div className="mt-auto flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    {product.originalPrice && product.originalPrice > product.price && (
                      <span className="text-xs text-gray-500 line-through">
                        {formatPrice(product.originalPrice)}
                      </span>
                    )}
                    <span className="text-xl font-bold text-white">
                      {formatPrice(product.price)}
                    </span>
                  </div>
                  
                  <button
                    onClick={(e) => handleAddToCart(e, product)}
                    disabled={addingToCart === product._id || product.stock === 0}
                    className={`h-10 w-10 rounded-full flex items-center justify-center transition-all ${
                      product.stock === 0
                        ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30'
                    }`}
                    aria-label="Add to cart"
                  >
                    {addingToCart === product._id ? (
                      <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ) : (
                      <ShoppingCart className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ModernFastMovingSection;
