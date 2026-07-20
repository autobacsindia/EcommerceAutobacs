'use client';

import { type StockStatus, getStockLabel } from '@/lib/stock';
import { useState, useEffect, Suspense } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams, useRouter } from 'next/navigation';
import apiClient from '@/lib/api';
import { adminKeys } from '@/hooks/queries/keys';
import { revalidateHome } from '@/lib/revalidateHome';
import { API_ENDPOINTS } from '@/lib/constants';
import { Plus, Edit, Trash2, Search, X, Package, ChevronUp, Upload } from 'lucide-react';
import Link from 'next/link';

interface Product {
  _id: string;
  name: string;
  price: number;
  stock: StockStatus;
  categories?: { name: string }[];
  isFeatured: boolean;
  isActive?: boolean;
  productType?: 'simple' | 'variable' | 'grouped';
  // The admin list endpoint returns a count, not the full variants array.
  variantCount?: number;
  priceMin?: number;
  priceMax?: number;
}

interface ProductsResponse {
  success: boolean;
  count: number;
  products: Product[];
  total?: number;
  pages?: number;
  currentPage?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
}

interface CategoryInfo {
  name: string;
  parent?: { _id: string; name: string } | null;
}

function AdminProductsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  // Category filter is URL-driven so it's shareable/bookmarkable. The backend
  // search expands a category to its whole subtree, so filtering by a parent
  // returns products from it and all descendant categories.
  const categoryId = searchParams.get('category') || '';
  const categoryNameParam = searchParams.get('categoryName') || '';

  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  // Admin can view all products or narrow to just active / just inactive (drafts).
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'simple' | 'variable' | 'grouped'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [categoryInfo, setCategoryInfo] = useState<CategoryInfo | null>(null);
  const limit = 50; // products per page

  // Server-side list via TanStack Query. keepPreviousData keeps the current table
  // up while a filter/page change loads (no blank flash between fetches).
  const listParams = {
    page: String(currentPage),
    search: debouncedSearchTerm || undefined,
    category: categoryId || undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
    type: typeFilter !== 'all' ? typeFilter : undefined,
  };
  const listKey = adminKeys.list('products', listParams);
  const { data, isPending } = useQuery({
    queryKey: listKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('page', String(currentPage));
      params.append('limit', String(limit));
      if (debouncedSearchTerm) params.append('search', debouncedSearchTerm);
      if (categoryId) params.append('category', categoryId);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (typeFilter !== 'all') params.append('productType', typeFilter);
      const response = await apiClient.get<ProductsResponse>(`${API_ENDPOINTS.ADMIN_PRODUCTS}?${params.toString()}`);
      const total = response.total || response.count || 0;
      return {
        products: response.products || [],
        totalCount: total,
        totalPages: response.pages || Math.ceil(total / limit),
      };
    },
    placeholderData: keepPreviousData,
  });
  const products = data?.products ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const loading = isPending;

  const goToCategory = (id: string, name: string) =>
    router.push(`/admin/products?category=${id}&categoryName=${encodeURIComponent(name)}`);
  const clearCategoryFilter = () => router.push('/admin/products');

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
      setCurrentPage(1); // Reset to first page when search changes
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, [searchTerm]);

  // Reset to the first page whenever the status or product-type filter changes.
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, typeFilter]);

  // Reset to the first page whenever the category filter changes.
  useEffect(() => {
    setCurrentPage(1);
  }, [categoryId]);

  // Resolve the filtered category's display name and parent (for the chip and
  // the "view parent category" link). Seed the name from the URL to avoid a flash.
  useEffect(() => {
    if (!categoryId) {
      setCategoryInfo(null);
      return;
    }
    setCategoryInfo({ name: categoryNameParam, parent: null });

    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get<{ category?: any }>(`/categories/${categoryId}`);
        const cat = res?.category;
        if (!cancelled && cat) {
          setCategoryInfo({
            name: cat.name || categoryNameParam,
            parent: cat.parent?._id ? { _id: cat.parent._id, name: cat.parent.name } : null,
          });
        }
      } catch {
        // Keep the seeded name from the URL on failure.
      }
    })();

    return () => { cancelled = true; };
  }, [categoryId, categoryNameParam]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return;

    try {
      await apiClient.delete(`${API_ENDPOINTS.PRODUCTS}/${id}`);
      // Optimistically drop the row from the current page's cache.
      queryClient.setQueryData<{ products: Product[]; totalCount: number; totalPages: number }>(
        listKey,
        (old) => (old ? { ...old, products: old.products.filter((p) => p._id !== id) } : old)
      );
      // Deleting a product may remove it from the homepage's featured shelf.
      revalidateHome('home:products');
      alert('Product deleted successfully');
    } catch (err: any) {
      alert(err.message || 'Failed to delete product');
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  return (
    <div className="p-4 md:p-6 w-full">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <h1 className="text-2xl md:text-3xl font-bold">Products Management</h1>
        <div className="flex items-center gap-2">
          <Link href="/admin/products/import" className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm">
            <Upload className="h-4 w-4" />
            Import CSV
          </Link>
          <Link href="/admin/products/create" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm">
            <Plus className="h-4 w-4" />
            Add Product
          </Link>
        </div>
      </div>

      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search products..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
          className="border rounded-lg px-4 py-2 text-sm bg-white"
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'all' | 'simple' | 'variable' | 'grouped')}
          className="border rounded-lg px-4 py-2 text-sm bg-white"
          aria-label="Filter by product type"
        >
          <option value="all">All types</option>
          <option value="simple">Simple</option>
          <option value="variable">Variable</option>
          <option value="grouped">Grouped</option>
        </select>
      </div>

      {categoryId && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-sm border border-blue-200">
            <Package className="h-4 w-4" />
            Category:&nbsp;<strong>{categoryInfo?.name || 'Selected category'}</strong>
            <span className="text-blue-500">(includes subcategories)</span>
            <button
              onClick={clearCategoryFilter}
              className="ml-1 hover:text-blue-900"
              title="Clear category filter"
              aria-label="Clear category filter"
            >
              <X className="h-4 w-4" />
            </button>
          </span>
          {categoryInfo?.parent && (
            <button
              onClick={() => goToCategory(categoryInfo.parent!._id, categoryInfo.parent!.name)}
              className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-blue-700"
              title="View products in the parent category"
            >
              <ChevronUp className="h-4 w-4" />
              View parent category: {categoryInfo.parent.name}
            </button>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">
                  Product Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/4">
                  Categories
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Price
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Stock
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Featured
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                    Loading...
                  </td>
                </tr>
              )}
              {!loading && products.map((product) => (
                <tr key={product._id} className={`hover:bg-gray-50 ${product.isActive === false ? 'bg-gray-50/60' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <div className="text-sm font-medium text-gray-900 line-clamp-2" title={product.name}>{product.name}</div>
                      {product.productType === 'variable' && (
                        <span className="shrink-0 mt-0.5 px-2 py-0.5 text-xs rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">
                          Variable{product.variantCount ? ` · ${product.variantCount}` : ''}
                        </span>
                      )}
                      {product.productType === 'grouped' && (
                        <span className="shrink-0 mt-0.5 px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-800 border border-purple-200">
                          Grouped
                        </span>
                      )}
                      {product.isActive === false && (
                        <span className="shrink-0 mt-0.5 px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                          Inactive
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-gray-500 line-clamp-2">
                      {product.categories && product.categories.length > 0 
                        ? product.categories.map(c => c.name).join(', ') 
                        : 'N/A'}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {product.productType === 'variable' && product.priceMin != null && product.priceMax != null && product.priceMin !== product.priceMax
                        ? `₹${product.priceMin.toFixed(2)} – ₹${product.priceMax.toFixed(2)}`
                        : `₹${product.price.toFixed(2)}`}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className={`text-sm ${product.stock === 'in' ? 'text-green-600' : product.stock === 'low' ? 'text-orange-600' : 'text-red-600'}`}>
                      {getStockLabel(product)}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 text-xs rounded-full ${
                        product.isFeatured ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {product.isFeatured ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium">
                    <div className="flex gap-2">
                      <Link href={`/admin/products/edit/${product._id}`} className="text-blue-600 hover:text-blue-900">
                        <Edit className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={() => handleDelete(product._id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Controls */}
      <div className="mt-6 flex items-center justify-between">
        <div className="text-sm text-gray-700">
          Showing {(currentPage - 1) * limit + 1} to {Math.min(currentPage * limit, totalCount)} of {totalCount} products
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className={`px-4 py-2 text-sm rounded ${
              currentPage === 1
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Previous
          </button>
          
          {/* Page numbers */}
          {[...Array(Math.min(5, totalPages))].map((_, i) => {
            const pageNum = Math.max(1, Math.min(currentPage - 2, totalPages - 4)) + i;
            return (
              <button
                key={pageNum}
                onClick={() => handlePageChange(pageNum)}
                className={`px-4 py-2 text-sm rounded ${
                  currentPage === pageNum
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {pageNum}
              </button>
            );
          })}
          
          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className={`px-4 py-2 text-sm rounded ${
              currentPage === totalPages
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Next
          </button>
        </div>
      </div>

      {!loading && products.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No products found
        </div>
      )}
    </div>
  );
}

// useSearchParams() requires a Suspense boundary in the App Router.
export default function AdminProductsPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <AdminProductsPageInner />
    </Suspense>
  );
}