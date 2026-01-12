'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Tag, ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import apiClient from '@/lib/api';

interface Brand {
  id?: string;
  name: string;
  slug: string;
  logo?: string;
  description?: string;
  productCount?: number;
}

interface BrandsResponse {
  success: boolean;
  message?: string;
  brands: any[];
}

// Sanitize brand data to ensure it meets requirements
function sanitizeBrand(brand: any): Brand | null {
  // Check required fields
  if (!brand || !brand.slug || !brand.name) {
    console.warn('Invalid brand object - missing required fields:', brand);
    return null;
  }
  
  // Validate slug is URL-safe
  const slugPattern = /^[a-z0-9-]+$/;
  if (!slugPattern.test(brand.slug)) {
    console.warn('Invalid brand slug format:', brand.slug);
    return null;
  }
  
  return {
    id: brand.id || undefined,
    name: brand.name,
    slug: brand.slug,
    logo: brand.logo || undefined,
    description: brand.description || undefined,
    productCount: typeof brand.productCount === 'number' && brand.productCount >= 0 ? brand.productCount : 0
  };
}

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const fetchBrands = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const data = await apiClient.get('/products/brands') as BrandsResponse;
      
      // Validate response structure
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response format');
      }
      
      // Check for success field
      if (data.success === false) {
        throw new Error(data.message || 'Failed to fetch brands');
      }
      
      // Validate brands array
      if (!Array.isArray(data.brands)) {
        console.error('Brands is not an array:', data);
        throw new Error('Invalid brands data format');
      }
      
      // Sanitize and filter brands
      const sanitizedBrands = data.brands
        .map(sanitizeBrand)
        .filter((brand: Brand | null): brand is Brand => brand !== null);
      
      if (sanitizedBrands.length === 0 && data.brands.length > 0) {
        console.warn('All brands were filtered out due to validation failures');
      }
      
      setBrands(sanitizedBrands);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch brands';
      setError(errorMessage);
      console.error('Error fetching brands:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBrands();
  }, []);

  const handleRetry = () => {
    setRetryCount(prev => prev + 1);
    fetchBrands();
  };

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="bg-red-50 rounded-full p-4 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <Tag className="h-8 w-8 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Error Loading Brands</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button 
              onClick={handleRetry}
              className="inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </button>
            <Link
              href="/"
              className="inline-flex items-center justify-center px-6 py-3 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Hero Section */}
      <div className="relative bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 text-white overflow-hidden">
        <div className="absolute inset-0 bg-black/10"></div>
        <div className="absolute inset-0">
          <div className="absolute top-0 left-0 w-96 h-96 bg-blue-400/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"></div>
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-indigo-400/20 rounded-full blur-3xl translate-x-1/2 translate-y-1/2"></div>
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
          <div className="text-center">
            <div className="flex items-center justify-center mb-6">
              <div className="bg-white/10 backdrop-blur-sm rounded-full p-4">
                <Tag className="h-14 w-14 text-white" />
              </div>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 tracking-tight">
              Premium Automotive Brands
            </h1>
            <p className="text-lg md:text-xl text-blue-100 max-w-3xl mx-auto leading-relaxed">
              Explore our curated collection of world-class automotive brands. Find authentic parts and accessories from trusted manufacturers.
            </p>
            {!loading && brands.length > 0 && (
              <div className="mt-8 flex items-center justify-center gap-2 text-blue-100">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-300 rounded-full animate-pulse"></div>
                  <span className="text-sm font-medium">{brands.length} Brands Available</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        {loading ? (
          // Enhanced loading state with skeleton
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {[...Array(8)].map((_, index) => (
              <div key={index} className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100 animate-pulse">
                <div className="flex flex-col items-center text-center">
                  <div className="bg-gray-200 rounded-xl w-32 h-32 mb-6"></div>
                  <div className="h-6 bg-gray-200 rounded w-32 mb-3"></div>
                  <div className="h-4 bg-gray-200 rounded w-24"></div>
                </div>
              </div>
            ))}
          </div>
        ) : brands.length > 0 ? (
          <>
            {/* Brands Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {brands.map((brand, index) => (
                <Link 
                  key={brand.slug}
                  href={`/brands/${brand.slug}`}
                  className="group bg-white rounded-2xl shadow-md hover:shadow-2xl transition-all duration-300 border border-gray-100 overflow-hidden transform hover:-translate-y-1"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="relative">
                    {/* Brand Logo Container */}
                    <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-8 flex items-center justify-center min-h-[200px] group-hover:from-blue-50 group-hover:to-indigo-50 transition-all duration-300">
                      {brand.logo ? (
                        <div className="relative w-full h-32 flex items-center justify-center">
                          <img 
                            src={brand.logo} 
                            alt={brand.name}
                            className="max-w-full max-h-full object-contain transform group-hover:scale-110 transition-transform duration-300 filter group-hover:brightness-110"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              const fallback = document.createElement('div');
                              fallback.className = 'bg-gradient-to-br from-blue-100 to-indigo-100 rounded-xl p-6 w-32 h-32 flex items-center justify-center';
                              fallback.innerHTML = '<svg class="h-16 w-16 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>';
                              target.parentElement!.appendChild(fallback);
                            }}
                          />
                        </div>
                      ) : (
                        <div className="bg-gradient-to-br from-blue-100 to-indigo-100 rounded-xl p-6 w-32 h-32 flex items-center justify-center group-hover:from-blue-200 group-hover:to-indigo-200 transition-all duration-300">
                          <Tag className="h-16 w-16 text-blue-600" />
                        </div>
                      )}
                    </div>

                    {/* Brand Info */}
                    <div className="p-6 text-center">
                      <h3 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">
                        {brand.name}
                      </h3>
                      <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                        <div className="flex items-center gap-1">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                          </svg>
                          <span className="font-semibold text-gray-700">
                            {brand.productCount !== undefined ? brand.productCount : '0'}
                          </span>
                          <span>product{brand.productCount !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                      {brand.description && (
                        <p className="mt-3 text-sm text-gray-600 line-clamp-2">
                          {brand.description}
                        </p>
                      )}
                    </div>

                    {/* Hover effect overlay */}
                    <div className="absolute inset-0 border-2 border-blue-500 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                  </div>

                  {/* View Products Button - appears on hover */}
                  <div className="px-6 pb-6 opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 transition-all duration-300">
                    <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-center py-3 rounded-lg font-semibold text-sm hover:from-blue-700 hover:to-indigo-700 transition-all">
                      View Products →
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {/* Stats Section */}
            <div className="mt-16 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-8 md:p-12 text-white shadow-xl">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
                <div className="space-y-2">
                  <div className="text-4xl md:text-5xl font-bold">{brands.length}+</div>
                  <div className="text-blue-100 text-lg">Premium Brands</div>
                </div>
                <div className="space-y-2">
                  <div className="text-4xl md:text-5xl font-bold">
                    {brands.reduce((sum, brand) => sum + (brand.productCount || 0), 0)}+
                  </div>
                  <div className="text-blue-100 text-lg">Quality Products</div>
                </div>
                <div className="space-y-2">
                  <div className="text-4xl md:text-5xl font-bold">100%</div>
                  <div className="text-blue-100 text-lg">Authentic Parts</div>
                </div>
              </div>
            </div>
          </>
        ) : (
          // Enhanced empty state
          <div className="text-center py-20">
            <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-full p-8 w-32 h-32 mx-auto mb-6 flex items-center justify-center">
              <Tag className="h-16 w-16 text-gray-400" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3">No Brands Available</h3>
            <p className="text-gray-600 mb-8 max-w-md mx-auto">
              We're currently updating our brand catalog. Please check back later or browse our product collection.
            </p>
            <Link
              href="/products"
              className="inline-flex items-center px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              Browse All Products
            </Link>
          </div>
        )}

        {/* Back to Home */}
        {brands.length > 0 && (
          <div className="mt-16 text-center pt-12 border-t border-gray-200">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold text-lg group"
            >
              <ArrowLeft className="h-5 w-5 transform group-hover:-translate-x-1 transition-transform" />
              Back to Home
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
