'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import apiClient from '@/lib/api';
import productService from '@/lib/services/productService';
import { useCurrency } from '@/context/CurrencyContext';
import WoofCategoryList from './WoofCategoryList';

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

interface Vehicle {
  _id: string;
  make: string;
  model: string;
  year?: number;
}

// Helper function to parse price values consistently
const parsePriceValue = (value: string | null, defaultValue: number): number => {
  if (!value) return defaultValue;
  const parsed = Number(value);
  return isNaN(parsed) ? defaultValue : parsed;
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

export default function ProductFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { formatPrice } = useCurrency();
  
  // State for categories and brands
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [showCategories, setShowCategories] = useState(false);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [showBrands, setShowBrands] = useState(false);
  
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
  
  const [selectedBrands, setSelectedBrands] = useState<string[]>(() => {
    // Parse multiple brands from URL
    const brandParam = searchParams.get('brand');
    if (brandParam) {
      return brandParam.split(',').filter(Boolean);
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

  // Vehicle fitment filter ("shop for my car")
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [showVehicle, setShowVehicle] = useState(false);
  const [selectedMake, setSelectedMake] = useState<string>(() => searchParams.get('vehicleMake') || '');
  const [selectedModel, setSelectedModel] = useState<string>(() => searchParams.get('vehicleModel') || '');

  // Facet counts for the current filter context (brand name -> count, category id -> count).
  const [facetBrands, setFacetBrands] = useState<Record<string, number>>({});
  const [facetCategories, setFacetCategories] = useState<Record<string, number>>({});
  
  // Load saved filter preferences on mount
  useEffect(() => {
    const savedPreferences = loadFilterPreferences();
    if (savedPreferences) {
      // Only apply saved preferences if URL doesn't already have filter parameters
      const hasUrlFilters = searchParams.toString() && (
        searchParams.has('minPrice') || 
        searchParams.has('maxPrice') || 
        searchParams.has('category') || 
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
      }
    }
  }, []);
  
  // Save filter preferences whenever they change
  useEffect(() => {
    const filterPreferences = {
      priceRange,
      selectedCategories,
      inStockOnly,
      selectedRatings
    };
    saveFilterPreferences(filterPreferences);
  }, [priceRange, selectedCategories, inStockOnly, selectedRatings]);
  
  // Fetch categories
  useEffect(() => {
    const controller = new AbortController();
    const cacheKey = 'product_categories';
    const cacheTimestampKey = `${cacheKey}_timestamp`;

    const fetchCategories = async () => {
      // Try cache first (10-minute expiry)
      const cached = localStorage.getItem(cacheKey);
      const timestamp = localStorage.getItem(cacheTimestampKey);
      
      if (cached && timestamp) {
        const age = Date.now() - parseInt(timestamp);
        if (age < 10 * 60 * 1000) { // 10 minutes
          try {
            const categories = JSON.parse(cached);
            // Set categories state here (assuming you have a setter)
            setLoadingCategories(false);
            return;
          } catch (e) {
            console.warn('Failed to parse cached categories:', e);
          }
        }
      }
      
      try {
        setLoadingCategories(true);
        const response: any = await apiClient.get('/categories', { signal: controller.signal });
        // Cache the response
        try {
          localStorage.setItem(cacheKey, JSON.stringify(response.categories || []));
          localStorage.setItem(cacheTimestampKey, Date.now().toString());
        } catch (e) {
          console.warn('Failed to cache categories:', e);
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        // Silently fail on 429
        if (err.status === 429) {
          console.warn('[ProductFilters] Rate limited on categories');
        } else {
          console.error('Failed to fetch categories:', err);
        }
      } finally {
        if (!controller.signal.aborted) setLoadingCategories(false);
      }
    };

    fetchCategories();
    return () => controller.abort();
  }, []);

  // Fetch brands
  useEffect(() => {
    let ignore = false;

    const fetchBrands = async () => {
      try {
        setLoadingBrands(true);
        const brandsData = await productService.getBrands();
        if (!ignore) setBrands(brandsData);
      } catch (err) {
        if (!ignore) console.error('Failed to fetch brands:', err);
      } finally {
        if (!ignore) setLoadingBrands(false);
      }
    };

    fetchBrands();
    return () => { ignore = true; };
  }, []);

  // Fetch vehicles for the fitment filter
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await apiClient.get<{ vehicles?: Vehicle[]; data?: Vehicle[] }>('/vehicles?limit=1000');
        if (!ignore) setVehicles(res.vehicles || res.data || []);
      } catch (err) {
        if (!ignore) console.error('Failed to fetch vehicles:', err);
      }
    })();
    return () => { ignore = true; };
  }, []);

  // Fetch facet counts for the current filter context (re-runs when filters change).
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const qs = searchParams.toString();
        const res = await apiClient.get<{ facets?: { brands?: { name: string; count: number }[]; categories?: { categoryId: string; count: number }[] } }>(
          `/products/facets${qs ? `?${qs}` : ''}`
        );
        if (ignore) return;
        const b: Record<string, number> = {};
        (res.facets?.brands || []).forEach(x => { if (x.name) b[x.name.toLowerCase()] = x.count; });
        const c: Record<string, number> = {};
        (res.facets?.categories || []).forEach(x => { c[x.categoryId] = x.count; });
        setFacetBrands(b);
        setFacetCategories(c);
      } catch (err) {
        if (!ignore) console.error('Failed to fetch facets:', err);
      }
    })();
    return () => { ignore = true; };
  }, [searchParams]);

  // Unique, sorted makes; models scoped to the selected make.
  const vehicleMakes = Array.from(new Set(vehicles.map(v => v.make).filter(Boolean))).sort();
  const vehicleModels = Array.from(
    new Set(vehicles.filter(v => v.make === selectedMake).map(v => v.model).filter(Boolean))
  ).sort();

  const handleBrandToggle = (brandName: string) => {
    setSelectedBrands(prev => {
      if (prev.includes(brandName)) {
        return prev.filter(b => b !== brandName);
      } else {
        return [...prev, brandName];
      }
    });
  };

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

    // Vehicle fitment (make + optional model)
    if (selectedMake) {
      currentParams.set('vehicleMake', selectedMake);
      if (selectedModel) currentParams.set('vehicleModel', selectedModel);
      else currentParams.delete('vehicleModel');
    } else {
      currentParams.delete('vehicleMake');
      currentParams.delete('vehicleModel');
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
    setSelectedMake('');
    setSelectedModel('');

    const currentParams = new URLSearchParams(searchParams.toString());
    currentParams.delete('minPrice');
    currentParams.delete('maxPrice');
    currentParams.delete('category');
    currentParams.delete('inStock');
    currentParams.delete('rating');
    currentParams.delete('vehicleMake');
    currentParams.delete('vehicleModel');
    currentParams.delete('page');

    router.push(`/products?${currentParams.toString()}`);
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-4 lg:p-6">
      <h2 className="text-lg font-bold mb-4">Filters</h2>

      {/* Vehicle fitment — "shop for my car" */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">My Vehicle</h3>
          <button
            type="button"
            onClick={() => setShowVehicle(!showVehicle)}
            className="w-6 h-6 flex items-center justify-center border border-gray-300 rounded text-gray-700 text-sm leading-none"
            aria-label={showVehicle ? 'Collapse vehicle filter' : 'Expand vehicle filter'}
          >
            {showVehicle ? '-' : '+'}
          </button>
        </div>
        {showVehicle && (
          <div className="space-y-2">
            <select
              value={selectedMake}
              onChange={(e) => { setSelectedMake(e.target.value); setSelectedModel(''); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Vehicle make"
            >
              <option value="">All makes</option>
              {vehicleMakes.map((mk) => <option key={mk} value={mk}>{mk}</option>)}
            </select>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={!selectedMake}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
              aria-label="Vehicle model"
            >
              <option value="">{selectedMake ? 'All models' : 'Select a make first'}</option>
              {vehicleModels.map((md) => <option key={md} value={md}>{md}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Categories</h3>
          <button
            type="button"
            onClick={() => setShowCategories(!showCategories)}
            className="w-6 h-6 flex items-center justify-center border border-gray-300 rounded text-gray-700 text-sm leading-none"
            aria-label={showCategories ? 'Collapse categories' : 'Expand categories'}
          >
            {showCategories ? '-' : '+'}
          </button>
        </div>
        {showCategories && (
          <>
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
              <WoofCategoryList
                selectedCategories={selectedCategories}
                onCategoryChange={setSelectedCategories}
                categoryCounts={facetCategories}
              />
            )}
          </>
        )}
      </div>

      {/* Brand Filter */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Brands</h3>
          <button
            type="button"
            onClick={() => setShowBrands(!showBrands)}
            className="w-6 h-6 flex items-center justify-center border border-gray-300 rounded text-gray-700 text-sm leading-none"
            aria-label={showBrands ? 'Collapse brands' : 'Expand brands'}
          >
            {showBrands ? '-' : '+'}
          </button>
        </div>
        
        {showBrands && (
          <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
            {loadingBrands ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, index) => (
                  <div key={index} className="flex items-center animate-pulse">
                    <div className="h-4 w-4 bg-gray-200 rounded"></div>
                    <div className="ml-2 h-4 w-3/4 bg-gray-200 rounded"></div>
                  </div>
                ))}
              </div>
            ) : brands.length > 0 ? (
              brands.map((brand, index) => (
                <div key={brand._id || index} className="flex items-center">
                  <input
                    type="checkbox"
                    id={`brand-${brand._id}`}
                    checked={selectedBrands.includes(brand.name)}
                    onChange={() => handleBrandToggle(brand.name)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor={`brand-${brand._id}`} className="ml-2 text-sm text-gray-700 cursor-pointer">
                    {brand.name}
                    {facetBrands[brand.name.toLowerCase()] != null && (
                      <span className="ml-1 text-gray-400">({facetBrands[brand.name.toLowerCase()]})</span>
                    )}
                  </label>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">No brands available</p>
            )}
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
            <span className="text-sm text-gray-600">{formatPrice(priceRange[0])}</span>
            <span className="text-sm text-gray-600">{formatPrice(priceRange[1])}</span>
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
    </div>
  );
}
