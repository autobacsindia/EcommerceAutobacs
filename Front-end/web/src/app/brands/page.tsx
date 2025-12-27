'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Tag, ArrowLeft, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api';

interface Brand {
  name: string;
  slug: string;
  logo?: string;
  description?: string;
  productCount?: number;
}

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBrands = async () => {
      try {
        setLoading(true);
        const data = await apiClient.get('/products/brands');
        
        if (data && data.brands) {
          setBrands(data.brands);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to fetch brands');
        console.error('Error fetching brands:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchBrands();
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Error Loading Brands</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-4">
            <Tag className="h-12 w-12 text-blue-600" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Explore Brands
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Discover premium automotive brands and find the perfect parts for your vehicle.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {brands.length > 0 ? (
              brands.map((brand) => (
                <Link 
                  key={brand.slug}
                  href={`/brands/${brand.slug}`}
                  className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow border border-gray-100"
                >
                  <div className="flex flex-col items-center text-center">
                    <div className="bg-gray-100 rounded-lg p-4 w-16 h-16 flex items-center justify-center mb-4">
                      <Tag className="h-8 w-8 text-blue-600" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">{brand.name}</h3>
                    <p className="text-sm text-gray-500">
                      {brand.productCount !== undefined ? `${brand.productCount} products` : 'View products'}
                    </p>
                  </div>
                </Link>
              ))
            ) : (
              <div className="col-span-full text-center py-12">
                <p className="text-gray-500 text-lg">No brands available at the moment.</p>
              </div>
            )}
          </div>
        )}

        {/* Back to Home */}
        <div className="mt-12 text-center pt-8 border-t border-gray-200">
          <Link
            href="/"
            className="inline-flex items-center text-blue-600 hover:text-blue-700 font-medium"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
