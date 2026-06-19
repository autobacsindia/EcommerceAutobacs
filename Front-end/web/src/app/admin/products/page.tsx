'use client';

import { type StockStatus, getStockLabel } from '@/lib/stock';
import { useState, useEffect } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { Plus, Edit, Trash2, Search } from 'lucide-react';
import Link from 'next/link';

interface Product {
  _id: string;
  name: string;
  price: number;
  stock: StockStatus;
  categories?: { name: string }[];
  isFeatured: boolean;
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

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [limit] = useState(50); // Show 50 products per page

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

  useEffect(() => {
    fetchProducts(currentPage);
  }, [currentPage, debouncedSearchTerm]);

  const fetchProducts = async (page: number = 1) => {
    try {
      setLoading(true);
      // Build query parameters
      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      
      if (debouncedSearchTerm) {
        params.append('search', debouncedSearchTerm);
      }
      
      // Cache busting to prevent stale data
      params.append('t', Date.now().toString());

      const response = await apiClient.get<ProductsResponse>(
        `${API_ENDPOINTS.PRODUCTS}?${params.toString()}`
      );
      
      setProducts(response.products || []);
      setTotalCount(response.total || response.count || 0);
      setTotalPages(response.pages || Math.ceil((response.total || response.count || 0) / limit));
    } catch (err) {
      console.error('Failed to fetch products:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return;
    
    try {
      await apiClient.delete(`${API_ENDPOINTS.PRODUCTS}/${id}`);
      setProducts(products.filter(p => p._id !== id));
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

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="p-4 md:p-6 w-full">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <h1 className="text-2xl md:text-3xl font-bold">Products Management</h1>
        <Link href="/admin/products/create" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm">
          <Plus className="h-4 w-4" />
          Add Product
        </Link>
      </div>

      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search products..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"
          />
        </div>
      </div>

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
              {products.map((product) => (
                <tr key={product._id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900 line-clamp-2" title={product.name}>{product.name}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-gray-500 line-clamp-2">
                      {product.categories && product.categories.length > 0 
                        ? product.categories.map(c => c.name).join(', ') 
                        : 'N/A'}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-sm text-gray-900">₹{product.price.toFixed(2)}</div>
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

      {products.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No products found
        </div>
      )}
    </div>
  );
}