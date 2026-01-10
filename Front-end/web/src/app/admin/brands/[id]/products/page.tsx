'use client';

import { useState, useEffect, use } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { ArrowLeft, Search, Plus, X, Loader2, Check } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

interface Brand {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  productCount: number;
}

interface Product {
  _id: string;
  name: string;
  price: number;
  brand?: string;
  images?: Array<{ url: string; alt?: string }>;
}

interface BrandProductsResponse {
  success: boolean;
  brand: Brand;
  products: Product[];
  pagination: {
    total: number;
    page: number;
    pages: number;
    limit: number;
  };
}

interface ProductsResponse {
  success: boolean;
  products: Product[];
  total: number;
}

export default function BrandProductsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [mappedProducts, setMappedProducts] = useState<Product[]>([]);
  const [availableProducts, setAvailableProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetchBrandProducts();
  }, [id, currentPage]);

  useEffect(() => {
    if (showAddModal && searchTerm) {
      const timer = setTimeout(() => {
        searchAvailableProducts();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [searchTerm, showAddModal]);

  const fetchBrandProducts = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<BrandProductsResponse>(
        `${API_ENDPOINTS.BRAND_PRODUCTS(id)}?page=${currentPage}&limit=20`
      );
      
      setBrand(response.brand);
      setMappedProducts(response.products || []);
      setTotalPages(response.pagination?.pages || 1);
    } catch (err) {
      console.error('Failed to fetch brand products:', err);
    } finally {
      setLoading(false);
    }
  };

  const searchAvailableProducts = async () => {
    if (!searchTerm.trim()) {
      setAvailableProducts([]);
      return;
    }

    try {
      setSearchLoading(true);
      const response = await apiClient.get<ProductsResponse>(
        `${API_ENDPOINTS.PRODUCTS}?search=${encodeURIComponent(searchTerm)}&limit=20`
      );
      
      const unmappedProducts = (response.products || []).filter(
        p => !p.brand || p.brand.toLowerCase() !== brand?.name.toLowerCase()
      );
      
      setAvailableProducts(unmappedProducts);
    } catch (err) {
      console.error('Failed to search products:', err);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleMapProducts = async () => {
    if (selectedProducts.length === 0) return;

    try {
      await apiClient.post(API_ENDPOINTS.BRAND_MAP_PRODUCTS(id), {
        productIds: selectedProducts
      });
      
      alert(`${selectedProducts.length} product(s) mapped successfully!`);
      setSelectedProducts([]);
      setShowAddModal(false);
      setSearchTerm('');
      setAvailableProducts([]);
      fetchBrandProducts();
    } catch (err: any) {
      alert(err.message || 'Failed to map products');
    }
  };

  const handleUnmapProduct = async (productId: string, productName: string) => {
    if (!confirm(`Are you sure you want to remove "${productName}" from ${brand?.name}?`)) return;

    try {
      await apiClient.delete(API_ENDPOINTS.BRAND_UNMAP_PRODUCT(id, productId));
      fetchBrandProducts();
    } catch (err: any) {
      alert(err.message || 'Failed to unmap product');
    }
  };

  const toggleProductSelection = (productId: string) => {
    setSelectedProducts(prev =>
      prev.includes(productId)
        ? prev.filter(pid => pid !== productId)
        : [...prev, productId]
    );
  };

  if (loading && !brand) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <Link 
          href={`/admin/brands/${id}`} 
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Brand
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {brand?.logo && (
              <div className="relative h-12 w-12 rounded overflow-hidden bg-gray-100">
                <Image
                  src={brand.logo}
                  alt={brand.name}
                  fill
                  className="object-contain"
                />
              </div>
            )}
            <div>
              <h1 className="text-3xl font-bold">{brand?.name} Products</h1>
              <p className="text-gray-500">{mappedProducts.length} products mapped</p>
            </div>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Add Products
          </button>
        </div>
      </div>

      {/* Mapped Products Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Product
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Price
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {mappedProducts.map((product) => (
              <tr key={product._id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    {product.images && product.images[0]?.url && (
                      <div className="relative h-10 w-10 rounded overflow-hidden bg-gray-100 flex-shrink-0">
                        <Image
                          src={product.images[0].url}
                          alt={product.name}
                          fill
                          className="object-cover"
                        />
                      </div>
                    )}
                    <div className="text-sm font-medium text-gray-900 line-clamp-2">
                      {product.name}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">₹{product.price.toFixed(2)}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <button
                    onClick={() => handleUnmapProduct(product._id, product.name)}
                    className="text-red-600 hover:text-red-900 flex items-center gap-1"
                  >
                    <X className="h-4 w-4" />
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {mappedProducts.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No products mapped to this brand yet.{' '}
            <button
              onClick={() => setShowAddModal(true)}
              className="text-blue-600 hover:underline"
            >
              Add products
            </button>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-4 py-2 text-sm rounded bg-white border border-gray-300 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-sm">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-4 py-2 text-sm rounded bg-white border border-gray-300 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Add Products Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">Add Products to {brand?.name}</h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setSearchTerm('');
                  setSelectedProducts([]);
                  setAvailableProducts([]);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Search */}
            <div className="p-4 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search products to add..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border rounded-lg"
                  autoFocus
                />
              </div>
            </div>

            {/* Products List */}
            <div className="flex-1 overflow-y-auto p-4">
              {searchLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                </div>
              ) : availableProducts.length > 0 ? (
                <div className="space-y-2">
                  {availableProducts.map((product) => (
                    <div
                      key={product._id}
                      onClick={() => toggleProductSelection(product._id)}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedProducts.includes(product._id)
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className={`h-5 w-5 rounded border flex items-center justify-center ${
                        selectedProducts.includes(product._id)
                          ? 'bg-blue-600 border-blue-600'
                          : 'border-gray-300'
                      }`}>
                        {selectedProducts.includes(product._id) && (
                          <Check className="h-3 w-3 text-white" />
                        )}
                      </div>
                      {product.images && product.images[0]?.url && (
                        <div className="relative h-10 w-10 rounded overflow-hidden bg-gray-100 flex-shrink-0">
                          <Image
                            src={product.images[0].url}
                            alt={product.name}
                            fill
                            className="object-cover"
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {product.name}
                        </div>
                        <div className="text-sm text-gray-500">
                          ₹{product.price.toFixed(2)}
                          {product.brand && (
                            <span className="ml-2 text-xs bg-gray-100 px-2 py-0.5 rounded">
                              Current: {product.brand}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : searchTerm ? (
                <div className="text-center py-8 text-gray-500">
                  No products found matching &quot;{searchTerm}&quot;
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  Start typing to search for products
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t flex items-center justify-between">
              <span className="text-sm text-gray-500">
                {selectedProducts.length} product(s) selected
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setSearchTerm('');
                    setSelectedProducts([]);
                    setAvailableProducts([]);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMapProducts}
                  disabled={selectedProducts.length === 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add {selectedProducts.length > 0 ? `(${selectedProducts.length})` : ''} Products
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
