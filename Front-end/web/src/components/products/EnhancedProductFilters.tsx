'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import apiClient from '@/lib/api';

// Define the Category interface inline to avoid import issues
interface Category {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  parent?: any;
  image?: {
    url: string;
    alt?: string;
  };
  isActive: boolean;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

// Add Brand interface
interface Brand {
  _id: string;
  name: string;
}

// Helper function to parse price values consistently
const parsePriceValue = (value: string | null, defaultValue: number): number => {
  if (!value) return defaultValue;
  const parsed = Number(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

// Helper function to format price values consistently
const formatPriceValue = (value: number): string => {
  // Use fixed locale to ensure consistent formatting between server and client
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0
  }).format(value).replace('₹', '₹');
};

// Helper function to save filter preferences to localStorage
const saveFilterPreferences = (preferences: any) => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('productFilterPreferences', JSON.stringify(preferences));
    } catch (e) {
      console.error('Failed to save filter preferences', e);
    }
  }
};

// Helper function to load filter preferences from localStorage
const loadFilterPreferences = () => {
  if (typeof window !== 'undefined') {
    try {
      const savedPreferences = localStorage.getItem('productFilterPreferences');
      return savedPreferences ? JSON.parse(savedPreferences) : null;
    } catch (e) {
      console.error('Failed to load filter preferences', e);
      return null;
    }
  }
  return null;
};

export default function EnhancedProductFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // State for categories
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [categorySearch, setCategorySearch] = useState('');
  
  // State for brands
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [brandSearch, setBrandSearch] = useState('');
  
  // Initialize state from URL parameters deterministically
  const [priceRange, setPriceRange] = useState<[number, number]>(() => {
    const minPrice = parsePriceValue(searchParams.get('minPrice'), 0);
    const maxPrice = parsePriceValue(searchParams.get('maxPrice'), 100000);
    return [minPrice, maxPrice];
  });
  
  const [selectedCategories, setSelectedCategories] = useState<string[]>(() => {
    // Parse multiple categories from URL
    const categoryParam = searchParams.get('category');
    if (categoryParam) {
      return categoryParam.split(',').filter(Boolean);
    }
    return [];
  });
  
  const [inStockOnly, setInStockOnly] = useState<boolean>(() => {
    return searchParams.get('inStock') === 'true';
  });
  
  const [selectedRatings, setSelectedRatings] = useState<number[]>(() => {
    // Parse multiple ratings from URL
    const ratingParam = searchParams.get('rating');
    if (ratingParam) {
      return ratingParam.split(',').map(Number).filter(n => !isNaN(n));
    }
    return [];
  });
  
  const [selectedBrands, setSelectedBrands] = useState<string[]>(() => {
    // Parse multiple brands from URL
    const brandParam = searchParams.get('brand');
    if (brandParam) {
      return brandParam.split(',').filter(Boolean);
    }
    return [];
  });
  
  // Filtered categories based on search
  const filteredCategories = useMemo(() => {
    return categories.filter(category => 
      ![
        'Brake System', 
        'Electronics', 
        'Engine Parts', 
        'Exhaust', 
        'Filters',
        'SUSPENSION',
        'AUDIO',
        'BODY KIT',
        'EXTERIOR',
        'INTERIOR',
        'LIGHTS',
        'PERFORMANCE',
        'ACCESSORIES'
      ].includes(category.name.toUpperCase()) &&
      category.name.toLowerCase().includes(categorySearch.toLowerCase())
    );
  }, [categories, categorySearch]);
  
  // Filtered brands based on search
  const filteredBrands = useMemo(() => {
    return brands.filter(brand => 
      brand.name.toLowerCase().includes(brandSearch.toLowerCase())
    );
  }, [brands, brandSearch]);
  
  // Load saved filter preferences on mount
  useEffect(() => {
    const savedPreferences = loadFilterPreferences();
    if (savedPreferences) {
      // Only apply saved preferences if URL doesn't already have filter parameters
      const hasUrlFilters = searchParams.toString() && (
        searchParams.has('minPrice') || 
        searchParams.has('maxPrice') || 
        searchParams.has('category') || 
        searchParams.has('brand') || 
        searchParams.has('inStock') || 
        searchParams.has('rating')
      );
      
      if (!hasUrlFilters) {
        // Apply saved preferences
        if (savedPreferences.priceRange) {
          setPriceRange(savedPreferences.priceRange);
        }
        if (savedPreferences.selectedCategories) {
          setSelectedCategories(savedPreferences.selectedCategories);
        }
        if (savedPreferences.inStockOnly !== undefined) {
          setInStockOnly(savedPreferences.inStockOnly);
        }
        if (savedPreferences.selectedRatings) {
          setSelectedRatings(savedPreferences.selectedRatings);
        }
        if (savedPreferences.selectedBrands) {
          setSelectedBrands(savedPreferences.selectedBrands);
        }
      }
    }
  }, []);
  
  // Save filter preferences whenever they change
  useEffect(() => {
    const filterPreferences = {
      priceRange,
      selectedCategories,
      inStockOnly,
      selectedRatings,
      selectedBrands
    };
    saveFilterPreferences(filterPreferences);
  }, [priceRange, selectedCategories, inStockOnly, selectedRatings, selectedBrands]);
  
  // Fetch categories
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setLoadingCategories(true);
        const response = await apiClient.get('/categories');
        setCategories(response.data || response.categories || []);
      } catch (err) {
        console.error('Failed to fetch categories:', err);
        // Fallback to hardcoded categories if API fails
        setCategories([
          { _id: '1', name: 'Body Kits', slug: 'body-kits' } as Category,
          { _id: '2', name: 'Performance Parts', slug: 'performance-parts' } as Category,
          { _id: '3', name: 'SUSPENSION', slug: 'suspension' } as Category,
          { _id: '5', name: 'Lighting', slug: 'lighting' } as Category,
        ]);
      } finally {
        setLoadingCategories(false);
      }
    };

    fetchCategories();
  }, []);

  // Fetch brands (for now we'll use a static list since there's no API endpoint)
  useEffect(() => {
    const fetchBrands = async () => {
      try {
        setLoadingBrands(true);
        // For now, we'll use a static list of brands
        // In the future, this could be fetched from an API endpoint
        // Note: Using brand names (not IDs) to match the Product model's brand field
        setBrands([
          { _id: 'Autobacs', name: 'Autobacs' },
          { _id: 'Thor', name: 'Thor' },
          { _id: 'Profender', name: 'Profender' },
          { _id: 'Bestwyll', name: 'Bestwyll' },
          { _id: 'Dr. Nano', name: 'Dr. Nano' },
          { _id: 'Proman', name: 'Proman' },
          { _id: 'Windbooster', name: 'Windbooster' },
          { _id: 'ComeUp', name: 'ComeUp' },
          { _id: 'Unicorn', name: 'Unicorn' },
        ]);
      } catch (err) {
        console.error('Failed to fetch brands:', err);
      } finally {
        setLoadingBrands(false);
      }
    };

    fetchBrands();
  }, []);

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
    
    // Categories - support multiple
    if (selectedCategories.length > 0) {
      currentParams.set('category', selectedCategories.join(','));
    } else {
      currentParams.delete('category');
    }
    
    // Brands - support multiple
    if (selectedBrands.length > 0) {
      currentParams.set('brand', selectedBrands.join(','));
    } else {
      currentParams.delete('brand');
    }
    
    // In stock only
    if (inStockOnly) {
      currentParams.set('inStock', 'true');
    } else {
      currentParams.delete('inStock');
    }
    
    // Ratings - support multiple
    if (selectedRatings.length > 0) {
      currentParams.set('rating', selectedRatings.join(','));
    } else {
      currentParams.delete('rating');
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
    setSelectedBrands([]);
    setCategorySearch('');
    setBrandSearch('');
    
    const currentParams = new URLSearchParams(searchParams.toString());
    currentParams.delete('minPrice');
    currentParams.delete('maxPrice');
    currentParams.delete('category');
    currentParams.delete('brand');
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
        {loadingCategories ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, index) => (
              <div key={index} className="flex items-center animate-pulse">
                <div className="h-4 w-4 bg-gray-200 rounded"></div>
                <div className="ml-2 h-4 w-3/4 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Category Search */}
            <div className="mb-2">
              <input
                type="text"
                placeholder="Search categories..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                value={categorySearch}
                onChange={(e) => setCategorySearch(e.target.value)}
              />
            </div>
            
            <div className="max-h-60 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
              {filteredCategories.length > 0 ? (
                filteredCategories.map((category) => (
                  <label key={category._id} className="flex items-center py-1">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      checked={selectedCategories.includes(category._id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedCategories([...selectedCategories, category._id]);
                        } else {
                          setSelectedCategories(selectedCategories.filter(id => id !== category._id));
                        }
                      }}
                    />
                    <span className="ml-2 text-sm text-gray-700">{category.name}</span>
                  </label>
                ))
              ) : (
                <p className="text-sm text-gray-500 py-2">No categories found</p>
              )}
            </div>
          </div>
        )}
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
            <span className="text-sm text-gray-600">{formatPriceValue(priceRange[0])}</span>
            <span className="text-sm text-gray-600">{formatPriceValue(priceRange[1])}</span>
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

      {/* Brand Filter */}
      <div className="mb-6">
        <h3 className="font-semibold text-gray-900 mb-3">Brand</h3>
        {loadingBrands ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, index) => (
              <div key={index} className="flex items-center animate-pulse">
                <div className="h-4 w-4 bg-gray-200 rounded"></div>
                <div className="ml-2 h-4 w-3/4 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Brand Search */}
            <div className="mb-2">
              <input
                type="text"
                placeholder="Search brands..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                value={brandSearch}
                onChange={(e) => setBrandSearch(e.target.value)}
              />
            </div>
            
            <div className="max-h-60 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
              {filteredBrands.length > 0 ? (
                filteredBrands.map((brand) => (
                  <label key={brand._id} className="flex items-center py-1">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      checked={selectedBrands.includes(brand._id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedBrands([...selectedBrands, brand._id]);
                        } else {
                          setSelectedBrands(selectedBrands.filter(id => id !== brand._id));
                        }
                      }}
                    />
                    <span className="ml-2 text-sm text-gray-700">{brand.name}</span>
                  </label>
                ))
              ) : (
                <p className="text-sm text-gray-500 py-2">No brands found</p>
              )}
            </div>
          </div>
        )}
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