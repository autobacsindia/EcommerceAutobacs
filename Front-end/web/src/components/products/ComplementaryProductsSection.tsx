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

interface ComplementaryProductsSectionProps {
  productId: string;
}

export default function ComplementaryProductsSection({ productId }: ComplementaryProductsSectionProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchComplementaryProducts = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response: any = await apiClient.get(`/products/${productId}/complementary?limit=4`);
        
        console.log('[ComplementaryProductsSection] API Response:', response);
        console.log('[ComplementaryProductsSection] Response.success:', response.success);
        console.log('[ComplementaryProductsSection] Response.products:', response.products);
        console.log('[ComplementaryProductsSection] Response.products.length:', response.products?.length);
        
        if (response.success && Array.isArray(response.products)) {
          console.log('[ComplementaryProductsSection] Setting products:', response.products.length);
          setProducts(response.products);
        } else {
          console.log('[ComplementaryProductsSection] Invalid response format');
        }
      } catch (err) {
        console.error('[ComplementaryProductsSection] Fetch error:', err);
        setError('Failed to load complementary products');
      } finally {
        setLoading(false);
      }
    };

    if (productId) {
      fetchComplementaryProducts();
    }
  }, [productId]);

  if (loading) {
    return (
      <section 
        aria-labelledby="complementary-products-heading"
        className="mt-16"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 
            id="complementary-products-heading"
            className="text-2xl font-bold text-gray-900 mb-6"
          >
            Frequently Bought Together
          </h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white rounded-lg shadow-sm overflow-hidden animate-pulse">
                <div className="aspect-square bg-gray-200" />
                <div className="p-4 space-y-3">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                  <div className="h-5 bg-gray-200 rounded w-1/3" />
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
    <section 
      aria-labelledby="complementary-products-heading"
      className="mt-16 bg-linear-to-br from-blue-50 to-indigo-50 py-12"
      ref={containerRef}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 
              id="complementary-products-heading"
              className="text-2xl font-bold text-gray-900"
              aria-live="polite"
            >
              Frequently Bought Together
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Complete your purchase with these complementary items
            </p>
          </div>
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            💡 Recommended
          </span>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {products.map((product) => {
            const getImageUrl = () => {
              if (!product.images || product.images.length === 0) {
                return '/placeholder-product.jpg';
              }
              
              const firstImage = product.images[0];
              return typeof firstImage === 'string' 
                ? firstImage 
                : firstImage?.url || '/placeholder-product.jpg';
            };

            const getImageAlt = () => {
              if (!product.images || product.images.length === 0) {
                return product.name;
              }
              
              const firstImage = product.images[0];
              return typeof firstImage === 'string' 
                ? product.name 
                : firstImage?.alt || product.name;
            };

            const discount = product.originalPrice && product.originalPrice > product.price
              ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
              : null;

            return (
              <article 
                key={product._id}
                className="bg-white rounded-lg shadow-sm overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2"
                tabIndex={0}
                role="link"
                aria-label={`View ${product.name} - ₹${product.price}`}
              >
                <Link href={`/products/${product.slug}`} className="block">
                  <div className="relative aspect-square bg-gray-50 overflow-hidden">
                    <Image
                      src={getImageUrl()}
                      alt={getImageAlt()}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                      className="object-contain p-4 transition-transform duration-300 hover:scale-105"
                      loading="lazy"
                    />
                    {discount && (
                      <div className="absolute top-2 left-2 bg-red-500 text-white px-2 py-1 rounded text-xs font-bold">
                        {discount}% OFF
                      </div>
                    )}
                  </div>
                  
                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 text-sm line-clamp-2 mb-2 hover:text-blue-600 transition-colors">
                      {product.name}
                    </h3>
                    
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-lg font-bold text-gray-900">
                        ₹{product.price.toLocaleString('en-IN')}
                      </span>
                      {product.originalPrice && product.originalPrice > product.price && (
                        <span className="text-sm text-gray-500 line-through">
                          ₹{product.originalPrice.toLocaleString('en-IN')}
                        </span>
                      )}
                    </div>
                    
                    {product.averageRating && product.averageRating > 0 && (
                      <div className="flex items-center gap-1 mb-2">
                        <svg className="w-4 h-4 text-yellow-400 fill-current" viewBox="0 0 20 20">
                          <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
                        </svg>
                        <span className="text-sm text-gray-600">
                          {product.averageRating.toFixed(1)} ({product.totalReviews || 0})
                        </span>
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between mt-3">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                        {product.brand || 'Autobacs'}
                      </span>
                      <span className="text-xs text-gray-500">
                        {product.categories?.[0]?.name || 'Auto Parts'}
                      </span>
                    </div>
                  </div>
                </Link>
              </article>
            );
          })}
        </div>
        
        <div className="mt-8 text-center">
          <Link 
            href="/products"
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Browse All Products
          </Link>
        </div>
      </div>
    </section>
  );
}
