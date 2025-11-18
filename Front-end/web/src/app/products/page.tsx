import Link from 'next/link';
import { Metadata } from 'next';
import ProductGrid from '@/components/products/ProductGrid';
import ProductFilters from '@/components/products/ProductFilters';

export const metadata: Metadata = {
  title: 'Products | Autobacs India',
  description: 'Browse our extensive collection of automotive accessories and performance parts',
};

async function getProducts(searchParams: any) {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  
  try {
    // Build query string from search params
    const queryParams = new URLSearchParams();
    if (searchParams.category) queryParams.append('category', searchParams.category);
    if (searchParams.search) queryParams.append('search', searchParams.search);
    if (searchParams.sort) queryParams.append('sort', searchParams.sort);
    if (searchParams.page) queryParams.append('page', searchParams.page);
    
    const queryString = queryParams.toString();
    const url = `${API_URL}/products${queryString ? `?${queryString}` : ''}`;
    
    const response = await fetch(url, {
      cache: 'no-store', // Always fetch fresh data
    });

    if (!response.ok) {
      throw new Error('Failed to fetch products');
    }

    const data = await response.json();
    return data.data || { products: [], pagination: {} };
  } catch (error) {
    console.error('Error fetching products:', error);
    return { products: [], pagination: {} };
  }
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const data = await getProducts(searchParams);
  const { products = [], pagination = {} } = data;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold mb-2">Our Products</h1>
          <p className="text-blue-100">
            Explore our premium collection of automotive accessories and performance parts
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="lg:grid lg:grid-cols-4 lg:gap-8">
          {/* Filters Sidebar */}
          <aside className="hidden lg:block">
            <ProductFilters />
          </aside>

          {/* Products Grid */}
          <div className="lg:col-span-3">
            {/* Results Header */}
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <p className="text-gray-600">
                {products.length > 0 ? (
                  <>
                    Showing {products.length} product{products.length !== 1 ? 's' : ''}
                    {pagination.total && ` of ${pagination.total}`}
                  </>
                ) : (
                  'No products found'
                )}
              </p>

              {/* Sort Dropdown */}
              <div className="flex items-center gap-2">
                <label htmlFor="sort" className="text-sm text-gray-600">
                  Sort by:
                </label>
                <select
                  id="sort"
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  defaultValue={searchParams.sort as string || 'createdAt_desc'}
                >
                  <option value="createdAt_desc">Newest First</option>
                  <option value="price_asc">Price: Low to High</option>
                  <option value="price_desc">Price: High to Low</option>
                  <option value="name_asc">Name: A to Z</option>
                  <option value="rating_desc">Highest Rated</option>
                </select>
              </div>
            </div>

            {/* Products Grid Component */}
            {products.length > 0 ? (
              <ProductGrid products={products} />
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-500 text-lg mb-4">No products found matching your criteria</p>
                <Link
                  href="/products"
                  className="text-blue-600 hover:text-blue-700 font-medium"
                >
                  Clear filters
                </Link>
              </div>
            )}

            {/* Pagination */}
            {pagination.pages > 1 && (
              <div className="mt-8 flex justify-center gap-2">
                {Array.from({ length: pagination.pages }, (_, i) => i + 1).map((page) => (
                  <Link
                    key={page}
                    href={`/products?page=${page}`}
                    className={`px-4 py-2 rounded-md ${
                      page === (pagination.page || 1)
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {page}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
