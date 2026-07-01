'use client';

import type { StockStatus } from '@/lib/stock';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import apiClient from '@/lib/api';
import ProductGrid from '@/components/products/ProductGrid';
import ProductFilters from '@/components/products/ProductFilters';
import Pagination from '@/components/layout/Pagination';
import Breadcrumb from '@/components/layout/Breadcrumb';
import { trackViewItemList } from '@/lib/analytics';
import { getMainCategory } from '@/lib/categoryMapping';

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
  stock: StockStatus;
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

interface Category {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  parent?: any;
  image?: {
    url: string;
    alt?: string;
  };
  isActive: boolean;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

// Function to fetch products with proper sorting parameters
async function getProducts(searchParams: any, categoryId: string): Promise<ProductsData> {
  try {
    // Build query string from search params
    const queryParams = new URLSearchParams();
    
    // Add category filter
    queryParams.append('category', categoryId);
    
    if (searchParams.search) queryParams.append('search', searchParams.search);
    if (searchParams.page) queryParams.append('page', searchParams.page);
    if (searchParams.minPrice) queryParams.append('minPrice', searchParams.minPrice);
    if (searchParams.maxPrice) queryParams.append('maxPrice', searchParams.maxPrice);
    if (searchParams.inStock) queryParams.append('inStock', searchParams.inStock);
    if (searchParams.rating) queryParams.append('rating', searchParams.rating);
    if (searchParams.vehicleMake) queryParams.append('vehicleMake', searchParams.vehicleMake);
    if (searchParams.vehicleModel) queryParams.append('vehicleModel', searchParams.vehicleModel);
    if (searchParams.brand) queryParams.append('brand', searchParams.brand);
    if (searchParams.showAll === 'true') queryParams.append('limit', '500');
    
    // Map frontend sort values to backend parameters
    if (searchParams.sort) {
      const sortValue = searchParams.sort;
      switch (sortValue) {
        case 'price_asc':
          queryParams.append('sortBy', 'price');
          queryParams.append('order', 'asc');
          break;
        case 'price_desc':
          queryParams.append('sortBy', 'price');
          queryParams.append('order', 'desc');
          break;
        case 'name_asc':
          queryParams.append('sortBy', 'name');
          queryParams.append('order', 'asc');
          break;
        case 'rating_desc':
          queryParams.append('sortBy', 'averageRating');
          queryParams.append('order', 'desc');
          break;
        case 'createdAt_desc':
        default:
          queryParams.append('sortBy', 'createdAt');
          queryParams.append('order', 'desc');
          break;
      }
    }
    
    const queryString = queryParams.toString();
    const endpoint = `/products${queryString ? `?${queryString}` : ''}`;
    
    const data: any = await apiClient.get(endpoint);
    
    // Fix: Backend returns pagination properties directly in response object
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
    // Don't log 404 errors for products as they might be expected when no products match filters
    if (!(error.status === 404 || error.responseStatus === 404)) {
      console.error('Error fetching products:', error);
    }
    // Return empty data instead of throwing to prevent crashing the page
    return { products: [], pagination: {} };
  }
}

// Function to fetch category by slug
async function getCategoryBySlug(slug: string): Promise<Category | null> {
  try {
    const response: any = await apiClient.get(`/categories/slug/${slug}`);
    // The API returns { success: true, category: {...} } for successful requests
    // Or { success: false, message: '...' } for errors
    if (response.success && response.category) {
      return response.category;
    }
    
    // If we get here, the category wasn't found
    return null;
  } catch (error: any) {
    // Handle 404 errors silently as they're expected for invalid slugs
    if (error.status === 404 || error.responseStatus === 404) {
      return null;
    }
    
    // For other unexpected errors, log and return null
    console.error('Unexpected error fetching category:', error);
    return null;
  }
}

export default function ClientPage({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<ProductsData>({ products: [], pagination: {} });
  const [category, setCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Get current sort value from URL parameters
  const currentSort = searchParams.get('sort') || 'createdAt_desc';
  const showAll = searchParams.get('showAll') === 'true';
  const currentPage = searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1;

  // Helper functions to safely access pagination properties
  const getPaginationTotal = (pagination: Pagination | undefined) => {
    return pagination && 'total' in pagination ? pagination.total : undefined;
  };

  const getPaginationPages = (pagination: Pagination | undefined) => {
    return pagination && 'pages' in pagination ? pagination.pages : undefined;
  };

  const getPaginationPage = (pagination: Pagination | undefined) => {
    return pagination && 'currentPage' in pagination ? pagination.currentPage : undefined;
  };

  // Fetch category and products when slug or search params change
  useEffect(() => {
    let isMounted = true;
    
    const fetchData = async () => {
      if (!isMounted) return;
      
      try {
        setLoading(true);
        setError(null);
        
        // Validate slug before fetching
        if (!slug) {
          if (isMounted) {
            setError('Invalid category');
            setData({ products: [], pagination: {} });
          }
          return;
        }
        
        // Fetch category by slug
        const categoryData = await getCategoryBySlug(slug);
        if (!categoryData) {
          if (isMounted) {
            setError('Category not found');
            setData({ products: [], pagination: {} });
          }
          return;
        }
        
        if (isMounted) {
          setCategory(categoryData);
        }
        
        // Fetch products for this category
        const resolvedSearchParams = Object.fromEntries(searchParams.entries());
        const result = await getProducts(resolvedSearchParams, categoryData._id);
        if (isMounted) {
          setData(result);
          // Analytics: view_item_list (ADR-005)
          trackViewItemList({ listType: 'category', listName: categoryData.slug || slug, itemCount: result.products.length });
        }
      } catch (err: any) {
        if (isMounted) {
          // Only show error message if it's not the expected "Category not found" error
          if (err.message && err.message !== 'Category not found') {
            setError(err.message || 'Failed to load products');
          }
          setData({ products: [], pagination: {} });
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    
    fetchData();
    
    return () => {
      isMounted = false;
    };
  }, [slug, searchParams]);

  // Handle sort change
  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sortValue = e.target.value;
    const currentParams = new URLSearchParams(window.location.search);
    
    // Remove existing sort parameter
    currentParams.delete('sort');
    
    // Add new sort parameter if it's not the default
    if (sortValue !== 'createdAt_desc') {
      currentParams.set('sort', sortValue);
    }
    
    // Reset to first page when sorting (unless showing all)
    if (!showAll) {
      currentParams.delete('page');
    }
    
    // Update URL which will trigger useEffect
    window.location.search = currentParams.toString();
  };

  // Handle show all toggle
  const handleShowAllToggle = () => {
    const currentParams = new URLSearchParams(window.location.search);
    
    if (showAll) {
      currentParams.delete('showAll');
      currentParams.delete('limit');
      // Reset to first page when switching back to paginated view
      currentParams.delete('page');
    } else {
      currentParams.set('showAll', 'true');
    }
    
    // Update URL which will trigger useEffect
    window.location.search = currentParams.toString();
  };

  if (error && (error === 'Category not found' || error === 'Invalid category')) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center py-12">
        <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-8 max-w-md mx-4 text-center">
          <svg className="w-14 h-14 mx-auto text-red-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 className="text-xl font-display font-bold text-ink uppercase tracking-wide mb-2">Category Not Available</h2>
          <p className="text-ink/70 font-display mb-6">{error === 'Invalid category' ? 'Invalid category URL.' : "The category you're looking for doesn't exist or has been removed."}</p>
          <Link href="/categories" className="bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest px-4 py-2 rounded-sm transition-colors text-sm">
            Browse All Categories
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Categories', href: '/categories' },
          { label: category?.name || 'Category', href: '#' }
        ]}
      />

      {/* Hero */}
      <div className="bg-obsidian border-b border-hairline py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-gold font-display font-bold text-sm uppercase tracking-widest mb-1">Category</p>
          <h1 className="text-4xl font-display font-bold text-ink uppercase tracking-wide">
            {category?.name || 'Products'}
          </h1>
          {category?.description && (
            <p className="text-ink/70 font-display mt-2 max-w-2xl">{category.description}</p>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="lg:grid lg:grid-cols-4 lg:gap-8">
          {/* Filters Sidebar */}
          <aside className="hidden lg:block space-y-6">
            <ProductFilters />
          </aside>

          {/* Products Grid */}
          <div className="lg:col-span-3">
            {/* Results Header */}
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <p className="text-ink-muted font-display text-sm">
                {loading ? 'Loading products...' : data.products.length > 0 ? (
                  showAll
                    ? `Showing all ${data.products.length} product${data.products.length !== 1 ? 's' : ''}`
                    : <>Showing {data.products.length} product{data.products.length !== 1 ? 's' : ''}{getPaginationTotal(data.pagination) && ` of ${getPaginationTotal(data.pagination)}`}</>
                ) : 'No products found'}
              </p>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="showAll"
                    checked={showAll}
                    onChange={handleShowAllToggle}
                    className="h-4 w-4 accent-[#3B9EE8] rounded border-hairline bg-obsidian-raised"
                  />
                  <label htmlFor="showAll" className={`text-sm font-display ${showAll ? 'text-gold' : 'text-ink/70'}`}>
                    Show All{showAll && ' (Active)'}
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="sort" className="text-sm text-ink-muted font-display">Sort:</label>
                  <select
                    id="sort"
                    className="bg-obsidian-raised border border-hairline text-ink/70 rounded-sm px-3 py-1.5 text-sm focus:outline-none focus:border-gold font-display"
                    value={currentSort}
                    onChange={handleSortChange}
                    disabled={loading}
                  >
                    <option value="createdAt_desc">Newest First</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                    <option value="name_asc">Name: A to Z</option>
                    <option value="rating_desc">Highest Rated</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Loading skeletons */}
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(6)].map((_, index) => (
                  <div key={index} className="bg-obsidian border border-hairline rounded-sm overflow-hidden animate-pulse">
                    <div className="h-48 bg-obsidian-raised" />
                    <div className="p-4">
                      <div className="h-4 bg-obsidian-raised rounded-sm mb-2" />
                      <div className="h-4 bg-obsidian-raised rounded-sm w-2/3 mb-4" />
                      <div className="h-6 bg-obsidian-raised rounded-sm w-1/3 mb-4" />
                      <div className="flex justify-between gap-2">
                        <div className="h-9 bg-obsidian-raised rounded-sm flex-1" />
                        <div className="h-9 bg-obsidian-raised rounded-sm flex-1" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : data.products.length > 0 ? (
              <ProductGrid products={data.products} />
            ) : (
              <div className="text-center py-12">
                <p className="text-ink-muted font-display mb-4">No products found in this category</p>
                <Link href="/categories" className="text-gold hover:text-ink font-display font-bold uppercase tracking-widest transition-colors text-sm">
                  Browse Other Categories
                </Link>
              </div>
            )}

            {!loading && !showAll && (
              <Pagination
                pagination={data.pagination}
                currentPage={currentPage}
                basePath={`/categories/${slug}`}
                searchParams={searchParams}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}