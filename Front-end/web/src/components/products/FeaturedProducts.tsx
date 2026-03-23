'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
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
  category?: { 
    name: string;
  } | string;
  categories?: Array<{ 
    _id: string;
    name: string;
    slug: string;
  }>;
  stock: number;
  averageRating: number;
  isFeatured?: boolean;
  isNew?: boolean;
  __v?: number;
}

export default function FeaturedProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const fetchFeaturedProducts = async () => {
      try {
        setLoading(true);
        // Use the dedicated endpoint for featured products
        const response: any = await apiClient.get('/products/featured?limit=6', { signal: controller.signal });
        setProducts(response.products);
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.error('Failed to fetch featured products:', err);
        // Handle rate limit errors specifically
        if (err.status === 429) {
          setError('Too many requests. Please try again in a moment.');
          // Optionally implement exponential backoff or show a countdown
        } else {
          setError('Failed to load featured products');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    fetchFeaturedProducts();
    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Featured Products</h2>
            <p className="text-gray-600">Our most popular automotive accessories</p>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(3)].map((_, index) => (
              <div key={index} className="bg-white rounded-lg shadow-md overflow-hidden animate-pulse">
                <div className="h-48 bg-gray-200"></div>
                <div className="p-4">
                  <div className="h-4 bg-gray-200 rounded mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-2/3 mb-4"></div>
                  <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (error || products.length === 0) {
    return null;
  }

  return (
    <section className="py-16 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Featured Products</h2>
          <p className="text-gray-600">Our most popular automotive accessories</p>
        </div>
        
        <ProductGrid products={products} />
        
        <div className="text-center mt-12">
          <Link 
            href="/products?featured=true"
            className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            View All Featured Products
          </Link>
        </div>
      </div>
    </section>
  );
}