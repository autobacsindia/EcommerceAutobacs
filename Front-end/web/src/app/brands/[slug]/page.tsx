'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft, Filter, Search, RefreshCw } from 'lucide-react';
import { use } from 'react';
import ProductGrid from '@/components/products/ProductGrid';
import Pagination from '@/components/layout/Pagination';
import apiClient from '@/lib/api';

// Define types for our data
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

interface Pagination {
  total?: number;
  pages?: number;
  currentPage?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
  count?: number;
}

interface ProductsData {
  products: Product[];
  pagination: Pagination;
}

// Function to fetch brand details
async function getBrandDetails(slug: string): Promise<any> {
  try {
    // Decode URL-encoded slug
    const decodedSlug = decodeURIComponent(slug);
    
    // Use the dedicated brand details endpoint
    const response: any = await apiClient.get(`/products/brands/${encodeURIComponent(decodedSlug)}/details`);
    
    // Validate response
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response format');
    }
    
    if (response.success === false) {
      throw new Error(response.message || 'Failed to fetch brand details');
    }
    
    if (response.brand && response.brand.name && response.brand.slug) {
      return response.brand;
    }
    
    throw new Error('Invalid brand data structure');
  } catch (error: any) {
    console.error('Error fetching brand details:', error);
    throw error;
  }
}

// Function to fetch products for a specific brand
async function getBrandProducts(brandName: string, page: number = 1, limit: number = 12): Promise<ProductsData> {
  try {
    // Use the new endpoint: /products/brands/{brandName}
    const endpoint = `/products/brands/${encodeURIComponent(brandName)}?page=${page}&limit=${limit}`;
    const data: any = await apiClient.get(endpoint);
    
    if (data && data.products) {
      // Extract pagination properties from the response
      const { total, pages, currentPage, hasNext, hasPrev, count } = data;
      return {
        products: data.products,
        pagination: {
          total,
          pages,
          currentPage,
          hasNext,
          hasPrev,
          count
        }
      };
    }
    return { products: [], pagination: {} };
  } catch (error: any) {
    console.error('Error fetching brand products:', error);
    throw error;
  }
}

function BrandPageInner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ProductsData>({ products: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [brandLoading, setBrandLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brand, setBrand] = useState<any>(null);

  
  // Get current page from URL parameters
  const currentPage = searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1;

  // Fetch brand details and products when slug changes
  useEffect(() => {
    const fetchBrandAndProducts = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch brand details
        const brandDetails = await getBrandDetails(slug);
        if (!brandDetails) {
          setError('Brand not found');
          setBrandLoading(false);
          setLoading(false);
          return;
        }
        setBrand(brandDetails);
        setBrandLoading(false);
        
        // Fetch products for the brand using the actual brand slug
        const brandSlug = brandDetails.slug || slug;
        const result = await getBrandProducts(brandSlug, currentPage);
        setData(result);
      } catch (err: any) {
        const errorMessage = err.message || 'Failed to fetch brand or products';
        
        // Check if it's a 404 error
        if (err.status === 404 || errorMessage.toLowerCase().includes('not found')) {
          setError('Brand not found');
        } else if (err.status === 500) {
          setError('Server error. Please try again later.');
        } else {
          setError(errorMessage);
        }
        
        setBrandLoading(false);
      } finally {
        setLoading(false);
      }
    };
    
    fetchBrandAndProducts();
  }, [slug, currentPage]);

  // Handle page change
  const handlePageChange = (newPage: number) => {
    const currentParams = new URLSearchParams(searchParams.toString());
    currentParams.set('page', newPage.toString());
    router.push(`/brands/${slug}?${currentParams.toString()}`);
  };

  // Show loading state if brand is still loading
  if (brandLoading || !brand) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading brand...</p>
        </div>
      </div>
    );
  }

  if (!brand && !brandLoading && error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="bg-red-50 rounded-full p-4 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4">
            {error === 'Brand not found' ? 'Brand Not Found' : 'Error Loading Brand'}
          </h1>
          <p className="text-gray-600 mb-6">
            {error === 'Brand not found' 
              ? "The brand you're looking for doesn't exist or has been removed."
              : error}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link 
              href="/brands" 
              className="inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Brands
            </Link>
            <Link 
              href="/products" 
              className="inline-flex items-center justify-center px-6 py-3 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
            >
              Browse Products
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Brand Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center">
            <div className="mb-6 md:mb-0 md:mr-8">
              <div className="bg-white rounded-lg p-4 w-32 h-32 flex items-center justify-center">
                {brand.logo ? (
                  <img 
                    src={brand.logo} 
                    alt={brand.name} 
                    className="max-w-full max-h-full object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <span className="text-2xl font-bold text-gray-400">{brand.name?.charAt(0)}</span>
                )}
              </div>
            </div>
            <div className="text-center md:text-left">
              <h1 className="text-4xl font-bold mb-2">{brand.name}</h1>
              <p className="text-blue-100 text-lg mb-4">{brand.description}</p>
              <div className="flex items-center justify-center md:justify-start">
                <span className="bg-blue-500 text-white px-3 py-1 rounded-full text-sm">
                  {data.pagination?.total || 0} Products
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Results Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-gray-600">
            {loading ? (
              'Loading products...'
            ) : data.products.length > 0 ? (
              <>
                Showing {data.products.length} product{data.products.length !== 1 ? 's' : ''}
                {data.pagination?.total && ` of ${data.pagination.total}`}
              </>
            ) : (
              'No products found'
            )}
          </p>


        </div>

        {/* Error State */}
        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <h3 className="text-lg font-medium text-red-800 mb-2">Error Loading Products</h3>
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, index) => (
              <div key={index} className="bg-white rounded-lg shadow-md overflow-hidden animate-pulse">
                <div className="h-48 bg-gray-200"></div>
                <div className="p-4">
                  <div className="h-4 bg-gray-200 rounded mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-2/3 mb-4"></div>
                  <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                  <div className="flex justify-between">
                    <div className="h-10 bg-gray-200 rounded w-24"></div>
                    <div className="h-10 bg-gray-200 rounded w-24"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : !error && data.products.length > 0 ? (
          <>
            <ProductGrid products={data.products} />
            
            {/* Pagination */}
            {!loading && !error && (
              <Pagination
                pagination={data.pagination}
                currentPage={currentPage}
                basePath={`/brands/${slug}`}
                searchParams={searchParams}
              />
            )}
          </>
        ) : !error ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg mb-4">No products found for this brand</p>
            <Link
              href="/products"
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              Browse all products
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <BrandPageInner params={params} />
    </Suspense>
  );
}