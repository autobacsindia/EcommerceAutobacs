'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export default function ProductFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Initialize state from URL parameters
  const [priceRange, setPriceRange] = useState<[number, number]>(() => {
    const minPrice = Number(searchParams.get('minPrice')) || 0;
    const maxPrice = Number(searchParams.get('maxPrice')) || 100000;
    return [minPrice, maxPrice];
  });
  
  const [selectedCategories, setSelectedCategories] = useState<string[]>(() => {
    const category = searchParams.get('category');
    return category ? [category] : [];
  });
  
  const [inStockOnly, setInStockOnly] = useState<boolean>(() => {
    return searchParams.get('inStock') === 'true';
  });
  
  const [selectedRatings, setSelectedRatings] = useState<number[]>(() => {
    const rating = searchParams.get('rating');
    return rating ? [Number(rating)] : [];
  });

  // Update URL when filters change
  const applyFilters = () => {
    const currentParams = new URLSearchParams(searchParams.toString());
    
    // Reset to first page when applying filters
    currentParams.delete('page');
    
    // Price range
    if (priceRange[0] > 0) {
      currentParams.set('minPrice', priceRange[0].toString());
    } else {
      currentParams.delete('minPrice');
    }
    
    if (priceRange[1] < 100000) {
      currentParams.set('maxPrice', priceRange[1].toString());
    } else {
      currentParams.delete('maxPrice');
    }
    
    // In stock only
    if (inStockOnly) {
      currentParams.set('inStock', 'true');
    } else {
      currentParams.delete('inStock');
    }
    
    // Update URL
    router.push(`/products?${currentParams.toString()}`);
  };

  // Clear all filters
  const clearFilters = () => {
    setPriceRange([0, 100000]);
    setSelectedCategories([]);
    setInStockOnly(false);
    setSelectedRatings([]);
    
    const currentParams = new URLSearchParams(searchParams.toString());
    currentParams.delete('minPrice');
    currentParams.delete('maxPrice');
    currentParams.delete('inStock');
    currentParams.delete('rating');
    currentParams.delete('page');
    
    router.push(`/products?${currentParams.toString()}`);
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 sticky top-20">
      <h2 className="text-lg font-bold mb-4">Filters</h2>

      {/* Categories */}
      <div className="mb-6">
        <h3 className="font-semibold text-gray-900 mb-3">Categories</h3>
        <div className="space-y-2">
          {['Body Kits', 'Performance Parts', 'Suspension', 'Exhaust Systems', 'Lighting'].map(
            (category) => (
              <label key={category} className="flex items-center">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={selectedCategories.includes(category)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedCategories([...selectedCategories, category]);
                    } else {
                      setSelectedCategories(selectedCategories.filter(c => c !== category));
                    }
                  }}
                />
                <span className="ml-2 text-sm text-gray-700">{category}</span>
              </label>
            )
          )}
        </div>
      </div>

      {/* Price Range */}
      <div className="mb-6">
        <h3 className="font-semibold text-gray-900 mb-3">Price Range</h3>
        <div className="space-y-4">
          <input
            type="range"
            min="0"
            max="100000"
            step="1000"
            value={priceRange[1]}
            onChange={(e) => setPriceRange([priceRange[0], parseInt(e.target.value)])}
            className="w-full"
          />
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">₹{priceRange[0].toLocaleString()}</span>
            <span className="text-sm text-gray-600">₹{priceRange[1].toLocaleString()}</span>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={applyFilters}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      </div>

      {/* Stock Status */}
      <div className="mb-6">
        <h3 className="font-semibold text-gray-900 mb-3">Availability</h3>
        <label className="flex items-center">
          <input
            type="checkbox"
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            checked={inStockOnly}
            onChange={(e) => setInStockOnly(e.target.checked)}
          />
          <span className="ml-2 text-sm text-gray-700">In Stock Only</span>
        </label>
      </div>

      {/* Rating */}
      <div className="mb-6">
        <h3 className="font-semibold text-gray-900 mb-3">Rating</h3>
        <div className="space-y-2">
          {[4, 3, 2, 1].map((rating) => (
            <label key={rating} className="flex items-center">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                checked={selectedRatings.includes(rating)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedRatings([...selectedRatings, rating]);
                  } else {
                    setSelectedRatings(selectedRatings.filter(r => r !== rating));
                  }
                }}
              />
              <span className="ml-2 text-sm text-gray-700 flex items-center">
                {rating}
                <svg className="h-4 w-4 text-yellow-400 ml-1" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                & up
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Clear Filters */}
      <button 
        onClick={clearFilters}
        className="w-full bg-gray-200 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-300 transition-colors"
      >
        Clear All Filters
      </button>
    </div>
  );
}