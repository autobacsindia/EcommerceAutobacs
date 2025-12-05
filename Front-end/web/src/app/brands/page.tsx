'use client';

import Link from 'next/link';
import { Tag, ArrowLeft } from 'lucide-react';

/**
 * Brands Page - Placeholder
 * TODO: Implement brand listing and filtering functionality
 */
export default function BrandsPage() {
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

        {/* Coming Soon Message */}
        <div className="bg-white rounded-lg shadow-sm p-12 text-center">
          <div className="max-w-md mx-auto">
            <div className="bg-blue-100 text-blue-600 rounded-full h-16 w-16 flex items-center justify-center mx-auto mb-6">
              <Tag className="h-8 w-8" />
            </div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              Brand Directory Coming Soon
            </h2>
            <p className="text-gray-600 mb-8">
              We're working on bringing you a comprehensive brand directory to help you find products from your favorite automotive brands.
            </p>
            
            {/* Temporary Navigation */}
            <div className="space-y-4">
              <Link
                href="/products"
                className="inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                Browse All Products
              </Link>
              <div className="text-sm text-gray-500">
                <p>In the meantime, you can:</p>
                <ul className="mt-2 space-y-1">
                  <li>• Browse our complete product catalog</li>
                  <li>• Use filters to find products by brand</li>
                  <li>• Search for specific brand names</li>
                </ul>
              </div>
            </div>

            <div className="mt-8 pt-8 border-t border-gray-200">
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
      </div>
    </div>
  );
}
