'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import productService from '@/lib/services/productService';
import { Product } from '@/lib/types';

export default function StaticProductDemo() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');

  useEffect(() => {
    const loadProducts = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Load all products from static data
        const staticProducts = await productService.loadStaticProducts();
        
        if (staticProducts.length > 0) {
          // Format products for display
          const formattedProducts = staticProducts.map(product => 
            productService.formatProductForDisplay(product)
          );
          setProducts(formattedProducts);
        } else {
          setError('No products found in static data');
        }
      } catch (err) {
        console.error('Error loading products:', err);
        setError('Failed to load products. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    loadProducts();
  }, []);

  // Get unique categories and brands for filter dropdowns
  const categories = [...new Set(products
    .map(p => typeof p.category === 'object' ? p.category.name : p.category)
    .filter(Boolean))] as string[];
    
  const brands = [...new Set(products
    .map(p => p.brand)
    .filter(Boolean))] as string[];

  // Filter products based on search term, category, and brand
  const filteredProducts = products.filter(product => {
    const matchesSearch = searchTerm === '' || 
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.description.toLowerCase().includes(searchTerm.toLowerCase());
      
    const matchesCategory = selectedCategory === '' || 
      (typeof product.category === 'object' ? product.category.name : product.category) === selectedCategory;
      
    const matchesBrand = selectedBrand === '' || product.brand === selectedBrand;
    
    return matchesSearch && matchesCategory && matchesBrand;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Static Product Data Demo</h1>
            <p className="text-gray-600">Demonstrating how to use static product data for improved performance</p>
          </div>
          
          <div className="animate-pulse">
            <div className="h-10 bg-gray-200 rounded w-1/3 mb-8"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[...Array(8)].map((_, index) => (
                <div key={index} className="bg-white rounded-lg shadow-md overflow-hidden">
                  <div className="aspect-square bg-gray-200"></div>
                  <div className="p-4">
                    <div className="h-4 bg-gray-200 rounded mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded mb-4"></div>
                    <div className="h-6 bg-gray-200 rounded mb-3"></div>
                    <div className="h-10 bg-gray-200 rounded"></div>
                  </div>
                </div>
              ))}
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
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Static Product Data Demo</h1>
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-2xl mx-auto">
              <p className="text-red-800 mb-4">{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Static Product Data Demo</h1>
          <p className="text-gray-600">
            This page demonstrates how to use static product data for improved performance.
            All product data is loaded directly from a static JSON file instead of making API calls.
          </p>
        </div>

        {/* Stats */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-blue-600">{products.length}</p>
              <p className="text-gray-600">Total Products</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-green-600">
                {products.filter(p => p.isFeatured).length}
              </p>
              <p className="text-gray-600">Featured Products</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-purple-600">{categories.length}</p>
              <p className="text-gray-600">Categories</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
                Search Products
              </label>
              <input
                type="text"
                id="search"
                placeholder="Search by name or description..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <div>
              <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">
                Filter by Category
              </label>
              <select
                id="category"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                <option value="">All Categories</option>
                {categories.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label htmlFor="brand" className="block text-sm font-medium text-gray-700 mb-1">
                Filter by Brand
              </label>
              <select
                id="brand"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={selectedBrand}
                onChange={(e) => setSelectedBrand(e.target.value)}
              >
                <option value="">All Brands</option>
                {brands.map(brand => (
                  <option key={brand} value={brand}>{brand}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="mb-6 flex items-center justify-between">
          <p className="text-gray-600">
            Showing {filteredProducts.length} of {products.length} products
          </p>
          <Link 
            href="/products" 
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            ← Back to Products
          </Link>
        </div>

        {filteredProducts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filteredProducts.map((product) => {
              // Get primary image or fallback
              const primaryImage = product.images && Array.isArray(product.images) 
                ? product.images.find(img => img.isPrimary)?.url || product.images[0]?.url
                : '/images/fallback-product.png';

              return (
                <div key={product._id} className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-300">
                  <div className="aspect-square overflow-hidden">
                    <img 
                      src={primaryImage} 
                      alt={product.name} 
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = productService.getProductPlaceholderImage();
                      }}
                    />
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-lg mb-1 line-clamp-2">{product.name}</h3>
                    <p className="text-gray-600 text-sm mb-2">
                      {typeof product.category === 'object' ? product.category.name : product.category}
                    </p>
                    <p className="text-gray-600 text-sm mb-2 line-clamp-2">
                      {product.shortDescription || product.description.substring(0, 100) + '...'}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-bold text-blue-600">
                        ₹{product.price.toLocaleString('en-IN')}
                      </span>
                      {product.stock > 0 ? (
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                          In Stock
                        </span>
                      ) : (
                        <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">
                          Out of Stock
                        </span>
                      )}
                    </div>
                    <Link 
                      href={`/products/${product._id}`} 
                      className="mt-3 inline-block w-full text-center bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 transition-colors"
                    >
                      View Details
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 bg-white rounded-lg shadow-md">
            <p className="text-gray-500">No products match your search criteria.</p>
          </div>
        )}
      </div>
    </div>
  );
}