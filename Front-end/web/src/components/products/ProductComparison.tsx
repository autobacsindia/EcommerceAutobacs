'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import apiClient from '@/lib/api';
import { useCurrency } from '@/contexts/CurrencyContext';
import EnhancedImage from '@/components/EnhancedImage';

interface ProductImage {
  url: string;
  alt?: string;
  isPrimary?: boolean;
  _id?: string;
}

interface Product {
  _id: string;
  name: string;
  description: string;
  shortDescription?: string;
  price: number;
  originalPrice?: number;
  category: { 
    _id: string;
    name: string;
    slug: string;
  } | string;
  brand?: string;
  images: ProductImage[] | string;
  stock: number;
  sku?: string;
  specifications?: Array<{
    key: string;
    value: string;
    _id?: string;
  }> | string;
  features?: string[] | string;
  isActive: boolean;
  isFeatured: boolean;
  averageRating: number;
  totalReviews: number;
  tags?: string[] | string;
  createdAt: string;
  updatedAt: string;
  __v?: number;
}

export default function ProductComparison() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { formatPrice } = useCurrency();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get product IDs from URL parameters
  const productIds = searchParams.get('ids')?.split(',') || [];

  useEffect(() => {
    if (productIds.length === 0) {
      setProducts([]);
      setLoading(false);
      return;
    }

    const fetchProducts = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch each product individually
        const productPromises = productIds.map(id => 
          apiClient.get(`/products/${id}`)
        );
        
        const responses = await Promise.all(productPromises);
        const fetchedProducts = responses
          .map(response => response.product)
          .filter(Boolean);
          
        setProducts(fetchedProducts);
      } catch (err: any) {
        console.error('Failed to fetch products for comparison:', err);
        setError('Failed to load products for comparison');
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [productIds]);

  const removeProduct = (productId: string) => {
    const newProductIds = productIds.filter(id => id !== productId);
    const params = new URLSearchParams(searchParams.toString());
    
    if (newProductIds.length > 0) {
      params.set('ids', newProductIds.join(','));
    } else {
      params.delete('ids');
    }
    
    router.push(`/compare?${params.toString()}`);
  };

  if (productIds.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Product Comparison</h1>
            <p className="text-gray-600 mb-8">No products selected for comparison</p>
            <button
              onClick={() => router.push('/products')}
              className="bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 transition-colors"
            >
              Browse Products
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Product Comparison</h1>
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-1/3 mb-8"></div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(3)].map((_, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4">
                    <div className="h-48 bg-gray-200 rounded mb-4"></div>
                    <div className="h-6 bg-gray-200 rounded mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded w-2/3 mb-4"></div>
                    <div className="space-y-2">
                      <div className="h-4 bg-gray-200 rounded"></div>
                      <div className="h-4 bg-gray-200 rounded"></div>
                      <div className="h-4 bg-gray-200 rounded"></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Product Comparison</h1>
          <div className="bg-white rounded-lg shadow-md p-6 text-center">
            <div className="text-red-500 mb-4">Error: {error}</div>
            <button
              onClick={() => window.location.reload()}
              className="bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Extract all unique specification keys
  const allSpecKeys = Array.from(
    new Set(
      products.flatMap(product => 
        Array.isArray(product.specifications) 
          ? product.specifications.map(spec => spec.key)
          : []
      )
    )
  ).sort();

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Product Comparison</h1>
          <div className="mt-4 md:mt-0">
            <button
              onClick={() => router.push('/products')}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
            >
              Add More Products
            </button>
          </div>
        </div>

        {products.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <p className="text-gray-600">No products found for comparison</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            {/* Product Headers */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_repeat(auto-fill,minmax(250px,1fr))] gap-6 p-6 border-b">
              <div></div> {/* Empty cell for the labels column */}
              {products.map((product) => (
                <div key={product._id} className="flex flex-col items-center">
                  <button
                    onClick={() => removeProduct(product._id)}
                    className="self-end text-gray-400 hover:text-red-500 mb-2"
                    aria-label="Remove product"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                  
                  {/* Product Image */}
                  <div className="w-32 h-32 mb-4 relative">
                    {Array.isArray(product.images) && product.images.length > 0 ? (
                      <EnhancedImage 
                        src={product.images[0].url} 
                        alt={product.images[0].alt || product.name}
                        width={128}
                        height={128}
                        className="w-full h-full object-contain"
                        context="product"
                      />
                    ) : typeof product.images === 'string' ? (
                      <EnhancedImage 
                        src={product.images} 
                        alt={product.name}
                        width={128}
                        height={128}
                        className="w-full h-full object-contain"
                        context="product"
                      />
                    ) : (
                      <div className="bg-gray-200 border-2 border-dashed rounded-xl w-full h-full" />
                    )}
                  </div>
                  
                  {/* Product Name */}
                  <h3 className="font-bold text-lg text-center mb-2">{product.name}</h3>
                  
                  {/* Price */}
                  <div className="text-center mb-4">
                    {product.originalPrice && product.originalPrice > product.price ? (
                      <div className="flex flex-col items-center">
                        <span className="text-2xl font-bold text-blue-600">
                          {formatPrice(product.price)}
                        </span>
                        <span className="text-sm text-gray-500 line-through">
                          {formatPrice(product.originalPrice)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-2xl font-bold text-blue-600">
                        {formatPrice(product.price)}
                      </span>
                    )}
                  </div>
                  
                  {/* Rating */}
                  <div className="flex items-center mb-4">
                    <div className="flex">
                      {[...Array(5)].map((_, i) => (
                        <svg
                          key={i}
                          className={`w-4 h-4 ${i < Math.floor(product.averageRating) ? 'text-yellow-400' : 'text-gray-300'}`}
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      ))}
                    </div>
                    <span className="ml-1 text-sm text-gray-600">
                      ({product.totalReviews})
                    </span>
                  </div>
                  
                  {/* Stock Status */}
                  <div className="mb-4">
                    {product.stock > 0 ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        In Stock ({product.stock} available)
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        Out of Stock
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Product Details Comparison */}
            <div className="divide-y">
              {/* Category */}
              <div className="grid grid-cols-1 md:grid-cols-[1fr_repeat(auto-fill,minmax(250px,1fr))] gap-6 p-6">
                <div className="font-medium text-gray-900">Category</div>
                {products.map((product) => (
                  <div key={`${product._id}-category`} className="text-center">
                    {typeof product.category === 'object' && product.category !== null 
                      ? (product.category.name === 'Suspension' ? 'SUSPENSION' : product.category.name)
                      : typeof product.category === 'string' 
                        ? product.category 
                        : 'Uncategorized'}
                  </div>
                ))}
              </div>

              {/* Brand */}
              <div className="grid grid-cols-1 md:grid-cols-[1fr_repeat(auto-fill,minmax(250px,1fr))] gap-6 p-6">
                <div className="font-medium text-gray-900">Brand</div>
                {products.map((product) => (
                  <div key={`${product._id}-brand`} className="text-center">
                    {product.brand || 'N/A'}
                  </div>
                ))}
              </div>

              {/* Description */}
              <div className="grid grid-cols-1 md:grid-cols-[1fr_repeat(auto-fill,minmax(250px,1fr))] gap-6 p-6">
                <div className="font-medium text-gray-900">Description</div>
                {products.map((product) => (
                  <div key={`${product._id}-description`} className="text-center">
                    {product.description ? (
                      <div className="text-gray-700 line-clamp-3">
                        {product.description}
                      </div>
                    ) : (
                      <span className="text-gray-500">No description available</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Short Description */}
              {products.some(product => product.shortDescription) && (
                <div className="grid grid-cols-1 md:grid-cols-[1fr_repeat(auto-fill,minmax(250px,1fr))] gap-6 p-6">
                  <div className="font-medium text-gray-900">Short Description</div>
                  {products.map((product) => (
                    <div key={`${product._id}-short-description`} className="text-center">
                      {product.shortDescription ? (
                        <div className="text-gray-700">
                          {product.shortDescription}
                        </div>
                      ) : (
                        <span className="text-gray-500">N/A</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Dynamic Specifications */}
              {allSpecKeys.map((specKey) => (
                <div key={specKey} className="grid grid-cols-1 md:grid-cols-[1fr_repeat(auto-fill,minmax(250px,1fr))] gap-6 p-6">
                  <div className="font-medium text-gray-900">{specKey}</div>
                  {products.map((product) => {
                    const spec = Array.isArray(product.specifications) 
                      ? product.specifications.find(s => s.key === specKey)
                      : null;
                    return (
                      <div key={`${product._id}-${specKey}`} className="text-center">
                        {spec ? spec.value : 'N/A'}
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* Action Buttons */}
              <div className="grid grid-cols-1 md:grid-cols-[1fr_repeat(auto-fill,minmax(250px,1fr))] gap-6 p-6">
                <div className="font-medium text-gray-900">Actions</div>
                {products.map((product) => (
                  <div key={`${product._id}-actions`} className="flex flex-col gap-2">
                    <button
                      onClick={() => router.push(`/products/${product._id}`)}
                      className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
                    >
                      View Details
                    </button>
                    <button
                      onClick={() => {
                        // Add to cart functionality would go here
                        alert(`Added ${product.name} to cart!`);
                      }}
                      disabled={product.stock <= 0}
                      className="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      Add to Cart
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
