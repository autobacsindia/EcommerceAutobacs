'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';

export default function TestDataPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch products
        const productsResponse: any = await api.get('/products?limit=5');
        setProducts(productsResponse.products || []);
        
        // Fetch categories
        const categoriesResponse: any = await api.get('/categories');
        setCategories(categoriesResponse.categories || []);
      } catch (err: any) {
        console.error('Failed to fetch data:', err);
        setError(err.message || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-500 text-xl">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8">
      <h1 className="text-3xl font-bold mb-8">Test Data Page</h1>
      
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">Products Sample (5 items)</h2>
        {products.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((product) => (
              <div key={product._id} className="border rounded-lg p-4 shadow-sm">
                <h3 className="font-medium text-lg">{product.name}</h3>
                <p className="text-gray-600">SKU: {product.sku}</p>
                <p className="text-gray-600">Category: {product.category?.name || 'N/A'}</p>
                <p className="text-gray-600">Price: ${product.price?.toFixed(2) || 'N/A'}</p>
              </div>
            ))}
          </div>
        ) : (
          <p>No products found</p>
        )}
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-4">Categories</h2>
        {categories.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {categories.map((category) => (
              <div key={category._id} className="border rounded-lg p-4 shadow-sm">
                <h3 className="font-medium">{category.name}</h3>
                <p className="text-gray-600 text-sm">Slug: {category.slug}</p>
                {category.parent && (
                  <p className="text-gray-600 text-sm">Parent: {category.parent.name}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p>No categories found</p>
        )}
      </section>
    </div>
  );
}