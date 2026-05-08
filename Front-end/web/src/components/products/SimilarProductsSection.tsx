import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import apiClient from '@/lib/api';

interface Product {
  _id: string;
  name: string;
  slug: string;
  price: number;
  originalPrice?: number;
  images?: Array<{ url: string; alt?: string }> | string[];
  averageRating?: number;
  totalReviews?: number;
  brand?: string;
  categories?: Array<{ name: string; slug: string }>;
}

interface SimilarProductsSectionProps {
  productId: string;
  isDark?: boolean;
}

export default function SimilarProductsSection({ productId, isDark = true }: SimilarProductsSectionProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchSimilarProducts = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response: any = await apiClient.get(`/products/${productId}/similar?limit=4`);
        
        if (response.success && Array.isArray(response.products)) {
          setProducts(response.products);
        } else {
          setError('No similar products found');
        }
      } catch (err) {
        console.error('[SimilarProductsSection] Fetch error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load similar products');
      } finally {
        setLoading(false);
      }
    };

    fetchSimilarProducts();
  }, [productId]);

  // Handle keyboard navigation for accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && containerRef.current) {
        containerRef.current.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (loading) {
    return (
      <section className={`py-8 ${isDark ? 'bg-zinc-900' : 'bg-gray-50'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className={`text-2xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>Similar Products</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className={`${isDark ? 'bg-zinc-800' : 'bg-white'} rounded-lg shadow-sm overflow-hidden animate-pulse`}>
                <div className={`h-48 ${isDark ? 'bg-zinc-700' : 'bg-gray-200'}`} />
                <div className="p-4">
                  <div className={`h-4 ${isDark ? 'bg-zinc-700' : 'bg-gray-200'} rounded w-3/4 mb-2`} />
                  <div className={`h-4 ${isDark ? 'bg-zinc-700' : 'bg-gray-200'} rounded w-1/2 mb-3`} />
                  <div className={`h-6 ${isDark ? 'bg-zinc-700' : 'bg-blue-100'} rounded w-1/3`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (error || products.length === 0) {
    return null; // Hide section if no similar products or error
  }

  return (
    <section 
      ref={containerRef}
      aria-labelledby="similar-products-heading"
      className={`py-8 ${isDark ? 'bg-zinc-900' : 'bg-gray-50'}`}
      tabIndex={-1}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 
          id="similar-products-heading"
          className={`text-2xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}
          aria-live="polite"
        >
          Similar Products
        </h2>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {products.map((product) => (
            <article 
              key={product._id}
              className={`${isDark ? 'bg-zinc-800 hover:bg-zinc-750' : 'bg-white hover:bg-gray-50'} rounded-lg shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2`}
              tabIndex={0}
            >
              <Link 
                href={`/products/${product.slug}`}
                className="block"
                prefetch={true}
              >
                <div className="relative overflow-hidden aspect-square">
                  {product.images && product.images.length > 0 ? (
                    <Image
                      src={typeof product.images[0] === 'string' 
                        ? product.images[0] 
                        : product.images[0].url || '/placeholder.jpg'}
                      alt={product.name || 'Product image'}
                      fill
                      sizes="(max-width: 768px) 100vw, (max-width: 1280px) 25vw, 20vw"
                      className="object-cover transition-transform duration-500 hover:scale-105"
                      priority={false}
                    />
                  ) : (
                    <div className={`w-full h-full ${isDark ? 'bg-zinc-700' : 'bg-gray-100'} flex items-center justify-center`}>
                      <span className={`${isDark ? 'text-zinc-500' : 'text-gray-400'} text-sm`}>No image</span>
                    </div>
                  )}
                </div>
                
                <div className="p-4">
                  <h3 className={`font-semibold line-clamp-2 mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {product.name}
                  </h3>
                  
                  <div className="flex items-center mb-2">
                    <span className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      ₹{product.price.toLocaleString()}
                    </span>
                    {product.originalPrice && product.originalPrice > product.price && (
                      <span className={`ml-2 text-sm line-through ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                        ₹{product.originalPrice.toLocaleString()}
                      </span>
                    )}
                  </div>
                  
                  {product.averageRating && (
                    <div className="flex items-center mb-2">
                      <span className="text-yellow-400 mr-1">★</span>
                      <span className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
                        {product.averageRating.toFixed(1)} ({product.totalReviews || 0})
                      </span>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between mt-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${isDark ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-800'}`}>
                      {product.brand || 'Autobacs'}
                    </span>
                    <span className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                      {product.categories?.[0]?.name || 'Auto Parts'}
                    </span>
                  </div>
                </div>
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}