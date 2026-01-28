'use client';

import { useState, useEffect, use } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShoppingCart, Heart, Filter } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useAuth } from '@/context/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import ProductImage from '@/components/products/ProductImage';
import { toast } from 'react-hot-toast';
import { wordpressService, WordPressProduct, WordPressProductCategory } from '@/services/wordpressService';
import VehicleModelFilterSidebar from '@/components/vehicles/VehicleModelFilterSidebar';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import apiClient from '@/lib/api';
import { vehicleService, VEHICLE_IMAGE_MAP, CROSS_RELATED_SLUG_MAP } from '@/services/vehicleService';

// Extended product type to handle both local and WordPress products
interface LocalProductImage {
  id?: number;
  src?: string;
  url?: string;
  name?: string;
  alt?: string;
}

interface ExtendedProduct extends Omit<WordPressProduct, 'images'> {
  _id?: string;
  stock?: number;
  isFeatured?: boolean;
  averageRating?: number;
  originalPrice?: number;
  images: LocalProductImage[];
}

export default function VehicleModelPage({ params }: { params: Promise<{ slug: string }> }) {
  // Navigation hooks
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Context hooks
  const { addToCart } = useCart();
  const { isAuthenticated } = useAuth();
  const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const { handleError } = useErrorHandler();
  
  // State hooks - MUST be called before any conditional returns
  const [products, setProducts] = useState<ExtendedProduct[]>([]);
  const [categories, setCategories] = useState<WordPressProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [animatingItems, setAnimatingItems] = useState<Record<string | number, boolean>>({});
  const [vehicle, setVehicle] = useState<any>(null);
  const [relatedVehicles, setRelatedVehicles] = useState<any[]>([]);
  const [totalProductsFromAPI, setTotalProductsFromAPI] = useState<number>(0);
  const [currentSort, setCurrentSort] = useState<string>('date');
  
  // Unwrap the params Promise - must be consistent across all renders
  const unwrappedParams = use(params);
  const { slug } = unwrappedParams || {};
  
  const vehicleName = slug ? decodeURIComponent(slug) : '';
  
  const itemsPerPage = 12; // Number of products per page
  
  // Get current page from URL parameters
  const currentPage = parseInt(searchParams.get('page') || '1') || 1;

  // Helper function to map sort values to API format
  const mapSortBy = (sortValue: string): string => {
    const sortMap: Record<string, string> = {
      'date': 'createdAt',
      'price-asc': 'price',
      'price-desc': 'price',
      'rating': 'rating',
      'popularity': 'popularity'
    };
    return sortMap[sortValue] || 'createdAt';
  };

  const getSortOrder = (sortValue: string): 'asc' | 'desc' => {
    if (sortValue === 'price-asc') return 'asc';
    if (sortValue === 'price-desc') return 'desc';
    return 'desc';
  };

  // Fetch products, categories, and vehicle data when vehicleSlug, selectedCategory, currentSort, or currentPage changes
  useEffect(() => {
    // Validate slug exists, redirect if not
    if (!slug) {
      router.push('/vehicles');
      return;
    }
    
    const fetchData = async () => {
      setLoading(true);
      setError(null);
        
      try {
        // Fetch categories, products, and vehicle data in parallel for better performance
        // Using local API instead of WordPress for better performance and control
        const timeoutDuration = 15000; // Increased timeout to 15s to prevent premature timeouts in dev
        const [categoriesData, productsResponse, vehicleResponseRaw] = await Promise.all([
          wordpressService.getProductCategories({ timeout: timeoutDuration }),
          vehicleService.getVehicleProducts(slug, {
            page: currentPage,
            limit: itemsPerPage,
            ...(selectedCategory && { category: selectedCategory }),
            sortBy: mapSortBy(currentSort),
            order: getSortOrder(currentSort)
          }, { timeout: timeoutDuration }).catch((err: any) => {
            console.warn('Local API failed, falling back to WordPress:', err);
            // Fallback to WordPress if local API fails
            return wordpressService.getProductsByVehicle(slug, currentPage, itemsPerPage, { timeout: timeoutDuration });
          }),
          apiClient.get(`/vehicles/slug/${slug}`, { timeout: timeoutDuration }).catch(err => {
            console.warn('Could not fetch vehicle data:', err);
            return { success: false };
          })
        ]);
        
        const vehicleResponse: any = vehicleResponseRaw;
        
        // Set categories
        setCategories(categoriesData);
        
        // Set products - handle both local API and WordPress fallback responses
        let productsData = productsResponse.products || [];
        const totalProductsFromAPI = productsResponse.pagination?.total || productsResponse.total || 0;
        setProducts(productsData);
        setTotalProductsFromAPI(totalProductsFromAPI);
        
        // Set vehicle data and fetch related vehicles if available
        if (vehicleResponse.success && vehicleResponse.vehicle) {
          setVehicle(vehicleResponse.vehicle);
          
          if (vehicleResponse.vehicle.make) {
            try {
              const relatedResponse: any = await apiClient.get(`/vehicles/models/${vehicleResponse.vehicle.make}`);
              if (relatedResponse.success && relatedResponse.models) {
                const relatedVehiclePromises = relatedResponse.models
                  .filter((model: string) => model.toLowerCase() !== vehicleResponse.vehicle.model.toLowerCase())
                  .map((model: string) => 
                    apiClient.get(`/vehicles/make-model/${vehicleResponse.vehicle.make}/${model}`)
                      .then((res: any) => res.success && res.vehicle ? res.vehicle : null)
                      .catch(() => null)
                  );

                let relatedVehiclesData: any[] = (await Promise.all(relatedVehiclePromises)).filter(v => v !== null);

                const currentSlug = (vehicleResponse.vehicle.slug || '').toString().toLowerCase();
                const crossTargets = CROSS_RELATED_SLUG_MAP[currentSlug] || [];

                if (crossTargets.length > 0) {
                  try {
                    const allVehicles = await vehicleService.getAllVehicles();
                    for (const targetSlug of crossTargets) {
                      const alreadyHasTarget = relatedVehiclesData.some(
                        v => (v.slug || '').toString().toLowerCase() === targetSlug
                      );
                      if (!alreadyHasTarget) {
                        const targetVehicle = allVehicles.find(
                          v => (v.slug || '').toString().toLowerCase() === targetSlug
                        );
                        if (targetVehicle) {
                          relatedVehiclesData.unshift(targetVehicle);
                        }
                      }
                    }
                  } catch (crossErr) {
                    console.warn('Could not enrich cross-related vehicles:', crossErr);
                  }
                }

                setRelatedVehicles(relatedVehiclesData);
              }
            } catch (err) {
              console.warn('Could not fetch related vehicles:', err);
            }
          }
        }
          
        // Show a warning if no data is found and WordPress API might not be configured
        if (categoriesData.length === 0 && productsData.length === 0) {
          const isWordPressConfigured = process.env.NEXT_PUBLIC_WORDPRESS_SITE_URL && 
            process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY && 
            process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET;
            
          if (!isWordPressConfigured) {
            console.warn('WordPress API not configured. Please check your environment variables.');
            setError('WordPress API not configured. Please check your environment variables.');
          }
        }
      } catch (err: any) {
        // Use global error handler for toast and logging
        const message = handleError(err, 'Failed to load products for this vehicle');
        // Still set local error state for UI fallback
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [slug, selectedCategory, currentSort, currentPage]);

  const handleAddToCart = async (product: ExtendedProduct) => {
    try {
      // For WordPress products, we would typically add to cart via WooCommerce API
      // For now, we'll just show a toast
      toast.success(`${product.name} added to cart`);
    } catch (error) {
      handleError(error, 'Failed to add to cart');
    }
  };

  const handleToggleWishlist = async (product: ExtendedProduct, e: React.MouseEvent) => {
    e.preventDefault();
    
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    const productId = (product._id || product.id)?.toString();
    if (!productId) {
      console.error('Product has no valid ID');
      return;
    }

    // Trigger animation
    const productKey = product._id || product.id;
    const animationKey = productKey?.toString() || String(productKey || '');
    if (animationKey) {
      setAnimatingItems(prev => ({ ...prev, [animationKey]: true }));
    }
    
    try {
      if (isInWishlist(productId)) {
        await removeFromWishlist(productId);
        toast.success('Removed from wishlist');
      } else {
        await addToWishlist(productId);
        toast.success('Added to wishlist');
      }
    } catch (error: any) {
      handleError(error, 'Failed to update wishlist');
    } finally {
      // Remove animation after delay
      setTimeout(() => {
        const productKey = product._id || product.id;
        const animationKey = productKey?.toString() || String(productKey || '');
        if (animationKey) {
          setAnimatingItems(prev => {
            const newState = { ...prev };
            delete newState[animationKey];
            return newState;
          });
        }
      }, 300);
    }
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sortValue = e.target.value;
    setCurrentSort(sortValue);
    
    // For path-based pagination, we'll just update the state
    // In a full implementation, you might want to update the URL with sort parameters
  };

  const handleCategoryChange = (categorySlug: string) => {
    setSelectedCategory(categorySlug);
  };

  // Filter products based on selected category
  const filteredProducts = selectedCategory 
    ? products.filter(product => 
        product.categories && Array.isArray(product.categories) && product.categories.some(cat => cat && cat.slug === selectedCategory)
      )
    : products;
  
  // Calculate pagination based on API total, not filtered products
  const safeTotal = totalProductsFromAPI || 0;
  const totalPages = Math.max(0, Math.ceil(safeTotal / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, safeTotal);
  
  // Use the products from API which are already paginated
  const paginatedProducts = filteredProducts;
  


  return (
    <div className="min-h-screen bg-white">
      
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-blue-900 to-black text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-5xl font-bold mb-6">{vehicleName ? vehicleName.replace(/-/g, ' ').split(' ')
              .filter(word => word)
              .map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'Vehicle'} Parts & Accessories</h1>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto">
            Find the perfect parts and accessories for your {vehicleName ? vehicleName.replace(/-/g, ' ')
              .split(' ').filter(word => word).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'vehicle'}
          </p>
          
          {/* Vehicle Details */}
          {vehicle && (
            <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm text-gray-200">
              <div className="flex items-center">
                <span className="font-medium">Make:</span>
                <span className="ml-2">{vehicle.make}</span>
              </div>
              <div className="flex items-center">
                <span className="font-medium">Model:</span>
                <span className="ml-2">{vehicle.model}</span>
              </div>
              {vehicle.year && (
                <div className="flex items-center">
                  <span className="font-medium">Year:</span>
                  <span className="ml-2">{vehicle.year}</span>
                </div>
              )}
              {vehicle.variant && (
                <div className="flex items-center">
                  <span className="font-medium">Variant:</span>
                  <span className="ml-2">{vehicle.variant}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <nav className="text-sm text-gray-600">
          <Link href="/" className="hover:text-blue-600 transition-colors">Home</Link>
          <span className="mx-2">/</span>
          <Link href="/vehicles" className="hover:text-blue-600 transition-colors">Vehicles</Link>
          <span className="mx-2">/</span>
          <span className="text-gray-900 font-medium">{vehicleName ? vehicleName.replace(/-/g, ' ')
            .split(' ').filter(word => word).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'Vehicle'}</span>
        </nav>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="lg:grid lg:grid-cols-4 lg:gap-8">
          {/* Vehicle and Category Filters Sidebar */}
          <aside className="hidden lg:block">
            <div className="space-y-6">
              {/* Vehicle Filter Sidebar */}
              <VehicleModelFilterSidebar currentVehicleSlug={slug} />
              
              {/* Category Filters */}
              <div className="bg-white rounded-xl shadow-md p-6 sticky top-24 border border-gray-100">
                <h2 className="text-lg font-bold mb-5 flex items-center text-gray-900">
                  <Filter className="h-5 w-5 mr-2" />
                  Category Filters
                </h2>
                
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-800 mb-4 text-base">Categories</h3>
                  <ul className="space-y-2">
                    <li>
                      <button
                        onClick={() => handleCategoryChange('')}
                        className={`text-left w-full px-4 py-2.5 rounded-lg text-sm transition-colors ${
                          selectedCategory === '' 
                            ? 'bg-blue-50 text-blue-700 font-medium border border-blue-200' 
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        All Categories
                      </button>
                    </li>
                    {categories.filter(cat => cat && cat.id).map((category) => {
                      // Calculate count of products in this category
                      const categoryProductCount = products.filter(product => 
                        product.categories && Array.isArray(product.categories) && product.categories.some(cat => cat && cat.slug === category.slug)
                      ).length;
                      
                      // Only show categories that have products
                      if (categoryProductCount === 0) return null;
                      
                      return (
                        <li key={category.id}>
                          <button
                            onClick={() => handleCategoryChange(category.slug)}
                            className={`text-left w-full px-4 py-2.5 rounded-lg text-sm transition-colors ${
                              selectedCategory === category.slug
                                ? 'bg-blue-50 text-blue-700 font-medium border border-blue-200'
                                : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {category.name} ({categoryProductCount})
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </div>
          </aside>

          {/* Products Grid */}
          <div className="lg:col-span-3">
            {/* Results Header */}
            <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <p className="text-gray-600 text-lg">
                {loading ? (
                  'Loading products...'
                ) : filteredProducts.length > 0 ? (
                  <>
                    Showing {(startIndex + 1)}-{Math.min(endIndex, safeTotal)} of {safeTotal} product{filteredProducts.length !== 1 ? 's' : ''}
                    {selectedCategory && ` in ${categories.find(c => c.slug === selectedCategory)?.name || selectedCategory}`}
                    {' '}for {vehicleName ? vehicleName.replace(/-/g, ' ')
                      .split(' ').filter(word => word).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'vehicle'}
                  </>
                ) : (
                  'No products found'
                )}
              </p>

              {/* Controls */}
              <div className="flex items-center gap-4">
                {/* Mobile Filter Button */}
                <button className="lg:hidden flex items-center gap-2 text-sm text-gray-700 bg-white px-4 py-2 rounded-md shadow-sm border border-gray-200 hover:border-gray-300 transition-colors">
                  <Filter className="h-4 w-4" />
                  Filters
                </button>
                
                {/* Sort Dropdown */}
                <div className="flex items-center gap-2">
                  <label htmlFor="sort" className="text-sm text-gray-700 font-medium">
                    Sort by:
                  </label>
                  <select
                    id="sort"
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    value={currentSort}
                    onChange={handleSortChange}
                    disabled={loading}
                  >
                    <option value="date">Newest First</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                    <option value="name_asc">Name: A to Z</option>
                    <option value="rating">Highest Rated</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Loading state */}
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                {[...Array(6)].map((_, index) => (
                  <div key={index} className="bg-gray-100 rounded-xl overflow-hidden shadow-sm animate-pulse border border-gray-200">
                    <div className="h-48 bg-gray-200"></div>
                    <div className="p-5">
                      <div className="h-5 bg-gray-200 rounded mb-3"></div>
                      <div className="h-4 bg-gray-200 rounded w-2/3 mb-4"></div>
                      <div className="h-6 bg-gray-200 rounded w-1/2 mb-5"></div>
                      <div className="flex justify-between gap-3">
                        <div className="h-10 bg-gray-200 rounded w-full"></div>
                        <div className="h-10 bg-gray-200 rounded w-12"></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center max-w-2xl mx-auto">
                <h3 className="text-xl font-medium text-red-800 mb-3">Error Loading Products</h3>
                <p className="text-red-600 mb-5">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="bg-red-600 text-white px-6 py-3 rounded-md hover:bg-red-700 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : paginatedProducts.length > 0 ? (
              <div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                  {paginatedProducts.filter(p => p && (p._id || p.id)).map((product) => {
                    // Safe value calculation to prevent "0" rendering issues
                    const averageRatingValue = product.averageRating || (product.average_rating ? parseFloat(product.average_rating) : 0);
                    
                    const priceValue = typeof product.price === 'number' 
                      ? product.price 
                      : parseFloat(product.price ?? '0');
                    
                    const hasValidPrice = !Number.isNaN(priceValue) && priceValue > 0;

                    const originalPriceSource = product.regular_price || (product.originalPrice != null ? product.originalPrice.toString() : '');
                    const originalPriceNumber = originalPriceSource ? parseFloat(originalPriceSource) : NaN;
                    
                    const hasOriginalPrice = hasValidPrice && !Number.isNaN(originalPriceNumber) && originalPriceNumber > priceValue;

                    return (
                    <div
                      key={product._id || product.id || `product-${product.sku}`}
                      className="bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl transition-all duration-300 border border-gray-100 group"
                    >
                      {/* Product Image */}
                      <Link href={`/products/${product._id || product.id}`} className="block relative h-52 bg-gray-100">
                        {(product.images && product.images.length > 0) ? (
                          <ProductImage
                            src={typeof product.images[0] === 'object' ? product.images[0].src || product.images[0].url : product.images[0]}
                            alt={(typeof product.images[0] === 'object' ? product.images[0].alt : null) || product.name}
                            className="object-cover w-full h-full"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100">
                            <span className="text-gray-400">No image available</span>
                          </div>
                        )}
                        
                        {/* Wishlist Button */}
                        <button
                          className={`absolute top-3 right-3 p-2 bg-white rounded-full shadow-md hover:bg-gray-50 transition-all duration-200 ${
                            animatingItems[String((product._id || product.id) || '')] ? 'animate-pulse' : ''
                          }`}
                          onClick={(e) => handleToggleWishlist(product, e)}
                        >
                          <Heart className={`h-5 w-5 transition-colors duration-200 ${
                            isInWishlist((product._id || product.id)?.toString() || '') 
                              ? 'text-red-500 fill-current' 
                              : 'text-gray-500'
                          }`} />
                        </button>

                        {/* Badges */}
                        <div className="absolute top-3 left-3 flex gap-2 flex-wrap">
                          {(product.stock_status === 'outofstock' || (product.stock !== undefined && product.stock <= 0)) && (
                            <div className="bg-red-500 text-white px-2.5 py-1 rounded-md text-xs font-semibold">
                              Out of Stock
                            </div>
                          )}
                          {(product.featured || product.isFeatured) && (product.stock_status === 'instock' || (product.stock !== undefined && product.stock >= 0)) && (
                            <div className="bg-blue-500 text-white px-2.5 py-1 rounded-md text-xs font-semibold">
                              Popular
                            </div>
                          )}
                          {(product.on_sale || (product.originalPrice && product.originalPrice > 0)) && (product.stock_status === 'instock' || (product.stock !== undefined && product.stock >= 0)) && (
                            <div className="bg-red-500 text-white px-2.5 py-1 rounded-md text-xs font-semibold">
                              Sale
                            </div>
                          )}
                          {/* Vehicle Compatibility Badge */}
                          <div className="bg-green-500 text-white px-2.5 py-1 rounded-md text-xs font-semibold">
                            Fits {vehicleName ? vehicleName.replace(/-/g, ' ').split(' ')
                              .filter(word => word)
                              .map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'Vehicle'}
                          </div>
                        </div>
                      </Link>

                      {/* Product Info */}
                      <div className="p-5">
                        {/* Categories */}
                        <p className="text-xs text-gray-500 uppercase mb-2">
                          {Array.isArray(product.categories) && product.categories.length > 0
                            ? product.categories.filter(cat => cat).map(cat => typeof cat === 'object' ? cat.name : cat).filter(Boolean).join(', ')
                            : 'Uncategorized'}
                        </p>

                        {/* Product Name */}
                        <Link href={`/products/${product._id || product.id}`}>
                          <h3 className="font-bold text-gray-900 mb-3 line-clamp-2 hover:text-blue-600 transition-colors">
                            {product.name}
                          </h3>
                        </Link>

                        {/* Rating */}
                        {averageRatingValue > 0 && (
                          <div className="flex items-center gap-2 mb-3">
                            <div className="flex">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <svg
                                  key={star}
                                  className={`h-4 w-4 ${
                                    star <= averageRatingValue
                                      ? 'text-yellow-400' 
                                      : 'text-gray-300'
                                  }`}
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                >
                                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                </svg>
                              ))}
                            </div>
                            <span className="text-sm text-gray-600">
                              ({averageRatingValue.toFixed(1)})
                            </span>
                          </div>
                        )}

                        {hasValidPrice && (
                          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                            <div>
                              {hasOriginalPrice ? (
                                <div className="flex items-baseline gap-2">
                                  <p className="text-xl font-bold text-blue-600">
                                    {formatPrice(priceValue)}
                                  </p>
                                  <p className="text-sm text-gray-500 line-through">
                                    {formatPrice(originalPriceNumber)}
                                  </p>
                                </div>
                              ) : (
                                <p className="text-xl font-bold text-blue-600">
                                  {formatPrice(priceValue)}
                                </p>
                              )}
                            </div>

                            <button
                              onClick={() => handleAddToCart(product)}
                              disabled={product.stock_status === 'outofstock' || product.stock === 0}
                              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                            >
                              <ShoppingCart className="h-4 w-4" />
                              <span className="text-sm font-medium">Add</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
                
                {/* Pagination Controls - only show if there are multiple pages */}
                {totalPages > 1 && (
                  <div className="mt-12 flex items-center justify-center">
                    <nav className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (currentPage > 1 && slug) {
                            const newPage = currentPage - 1;
                            const baseUrl = newPage === 1 ? `/model/${slug}` : `/model/${slug}/page/${newPage}`;
                            router.push(baseUrl);
                          }
                        }}
                        disabled={currentPage === 1}
                        className={`px-4 py-2 rounded-md border ${currentPage === 1 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300'}`}
                      >
                        Previous
                      </button>
                      
                      {/* Page numbers */}
                      {slug && totalPages > 0 && Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum;
                        if (totalPages <= 5) {
                          // Show all pages
                          pageNum = i + 1;
                        } else if (currentPage <= 3) {
                          // Show first 5 pages
                          pageNum = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          // Show last 5 pages
                          pageNum = totalPages - 4 + i;
                        } else {
                          // Show pages around current page
                          pageNum = currentPage - 2 + i;
                        }
                        
                        // Ensure pageNum is valid before rendering
                        if (!pageNum || pageNum < 1) return null;
                        
                        return (
                          <button
                            key={i}
                            onClick={() => {
                              if (slug && pageNum) {
                                const baseUrl = pageNum === 1 ? `/model/${slug}` : `/model/${slug}/page/${pageNum}`;
                                router.push(baseUrl);
                              }
                            }}
                            className={`px-4 py-2 rounded-md border ${currentPage === pageNum ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300'}`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                      
                      <button
                        onClick={() => {
                          if (currentPage < totalPages && slug) {
                            const newPage = currentPage + 1;
                            const baseUrl = newPage === 1 ? `/model/${slug}` : `/model/${slug}/page/${newPage}`;
                            router.push(baseUrl);
                          }
                        }}
                        disabled={currentPage === totalPages}
                        className={`px-4 py-2 rounded-md border ${currentPage === totalPages ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300'}`}
                      >
                        Next
                      </button>
                    </nav>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-500 text-lg mb-4">No products found for {vehicleName ? vehicleName.replace(/-/g, ' ')
                  .split(' ').filter(word => word).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'this vehicle'}</p>
                <button
                  onClick={() => handleCategoryChange('')}
                  className="text-blue-600 hover:text-blue-700 font-medium"
                >
                  View all products
                </button>
              </div>
            )}
          </div>
        </div>
        
        {/* Related Vehicles Section */}
        {Array.isArray(relatedVehicles) && relatedVehicles.length > 0 && (
          <section className="mt-16">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-8">Related {vehicle?.make || 'Vehicles'}</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
                {relatedVehicles.filter(v => v && v._id && v.slug).slice(0, 5).map((relatedVehicle) => (
                  <Link 
                    key={relatedVehicle._id}
                    href={`/model/${encodeURIComponent(relatedVehicle.slug)}`}
                    className="block group"
                  >
                    <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-all duration-300 border border-gray-100">
                      <div className="aspect-square bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center overflow-hidden">
                        {(() => {
                          const slugKey = (relatedVehicle.slug || '').toString().toLowerCase();
                          const nameKey = `${relatedVehicle.make || ''}-${relatedVehicle.model || ''}`
                            .toLowerCase()
                            .replace(/\s+/g, '-')
                            .replace(/[^a-z0-9-]/g, '');

                          let imageUrl: string | undefined;

                          if (slugKey.includes('fortuner') || nameKey.includes('fortuner')) {
                            imageUrl = VEHICLE_IMAGE_MAP['fortuner'];
                          } else if (slugKey.includes('hilux') || nameKey.includes('hilux')) {
                            imageUrl = VEHICLE_IMAGE_MAP['hilux'];
                          } else if (slugKey.includes('thar') || nameKey.includes('thar')) {
                            imageUrl = VEHICLE_IMAGE_MAP['thar'];
                          } else if (slugKey.includes('jimny') || nameKey.includes('jimny')) {
                            imageUrl = VEHICLE_IMAGE_MAP['jimny'];
                          }

                          if (!imageUrl) {
                            imageUrl =
                              (relatedVehicle.image && relatedVehicle.image.url) ||
                              VEHICLE_IMAGE_MAP[slugKey] ||
                              VEHICLE_IMAGE_MAP[nameKey];
                          }
                          
                          if (!imageUrl) {
                            return (
                              <div className="w-full h-full flex items-center justify-center text-gray-400">
                                <span className="text-sm">No image</span>
                              </div>
                            );
                          }

                          return (
                            <img 
                              src={imageUrl} 
                              alt={relatedVehicle.name || relatedVehicle.make + ' ' + relatedVehicle.model}
                              className="object-cover w-full h-full scale-110 group-hover:scale-125 transition-transform duration-500"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                if (slugKey.includes('fortuner') || nameKey.includes('fortuner')) {
                                  target.src = VEHICLE_IMAGE_MAP['fortuner'];
                                } else if (slugKey.includes('hilux') || nameKey.includes('hilux')) {
                                  target.src = VEHICLE_IMAGE_MAP['hilux'];
                                } else if (slugKey.includes('thar') || nameKey.includes('thar')) {
                                  target.src = VEHICLE_IMAGE_MAP['thar'];
                                } else if (slugKey.includes('jimny') || nameKey.includes('jimny')) {
                                  target.src = VEHICLE_IMAGE_MAP['jimny'];
                                } else {
                                  target.src = '/images/fallback-product.png';
                                }
                              }}
                              loading="lazy"
                            />
                          );
                        })()}
                      </div>
                      <div className="p-3 text-center bg-gray-50">
                        <h3 className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                          {relatedVehicle.model}
                        </h3>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
