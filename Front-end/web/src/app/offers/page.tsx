'use client';

import Link from 'next/link';
import { Gift, ArrowLeft, Tag, TrendingDown } from 'lucide-react';

/**
 * Offers Page - Placeholder
 * TODO: Implement promotional offers, discounts, and deals functionality
 */
export default function OffersPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-4">
            <Gift className="h-12 w-12 text-red-600" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Special Offers & Deals
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Discover exclusive discounts, seasonal promotions, and limited-time offers on premium automotive parts.
          </p>
        </div>

        {/* Coming Soon Message */}
        <div className="bg-white rounded-lg shadow-sm p-12 text-center">
          <div className="max-w-md mx-auto">
            <div className="bg-red-100 text-red-600 rounded-full h-16 w-16 flex items-center justify-center mx-auto mb-6">
              <Gift className="h-8 w-8" />
            </div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              Offers Page Coming Soon
            </h2>
            <p className="text-gray-600 mb-8">
              We're preparing exciting deals and promotions for you. Check back soon for exclusive discounts on your favorite automotive products!
            </p>
            
            {/* Feature Preview */}
            <div className="bg-gray-50 rounded-lg p-6 mb-8">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">
                What to Expect:
              </h3>
              <div className="grid grid-cols-1 gap-4 text-left">
                <div className="flex items-start gap-3">
                  <TrendingDown className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-gray-900 text-sm">Seasonal Sales</p>
                    <p className="text-xs text-gray-600">Special discounts during festivals and events</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Tag className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-gray-900 text-sm">Category Deals</p>
                    <p className="text-xs text-gray-600">Exclusive offers on specific product categories</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Gift className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-gray-900 text-sm">Bundle Offers</p>
                    <p className="text-xs text-gray-600">Save more when you buy product bundles</p>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Temporary Navigation */}
            <div className="space-y-4">
              <Link
                href="/products"
                className="inline-flex items-center justify-center px-6 py-3 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors"
              >
                Browse All Products
              </Link>
              <p className="text-sm text-gray-500">
                Explore our full catalog while we prepare special offers for you
              </p>
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
