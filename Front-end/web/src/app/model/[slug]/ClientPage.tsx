'use client';

import { type StockStatus, isOutOfStock } from '@/lib/stock';
import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShoppingCart, Heart, Filter } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useAuth } from '@/context/AuthContext';
import { useCurrency } from '@/context/CurrencyContext';
import ProductImage from '@/components/products/ProductImage';
import { toast } from 'react-hot-toast';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import apiClient from '@/lib/api';
import { vehicleService, VEHICLE_IMAGE_MAP, CROSS_RELATED_SLUG_MAP } from '@/services/vehicleService';
import { productUrl } from '@/lib/types';

interface ProductImage {
  src?: string;
  url?: string;
  alt?: string;
}

interface Category {
  _id?: string;
  id?: string | number;
  name: string;
  slug: string;
  count?: number;
}

interface ExtendedProduct {
  _id?: string;
  id?: number;
  name: string;
  slug?: string;
  sku?: string;
  price: string | number;
  regular_price?: string;
  sale_price?: string;
  originalPrice?: number;
  on_sale?: boolean;
  stock?: StockStatus;
  stock_status?: string;
  featured?: boolean;
  isFeatured?: boolean;
  averageRating?: number;
  average_rating?: string;
  images: ProductImage[];
  categories: any[];
}

export default function ClientPage({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { addToCart } = useCart();
  const { isAuthenticated } = useAuth();
  const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const { formatPrice } = useCurrency();
  const { handleError } = useErrorHandler();

  const [products, setProducts] = useState<ExtendedProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [animatingItems, setAnimatingItems] = useState<Record<string | number, boolean>>({});
  const [vehicle, setVehicle] = useState<any>(null);
  const [relatedVehicles, setRelatedVehicles] = useState<any[]>([]);
  const [totalProductsFromAPI, setTotalProductsFromAPI] = useState<number>(0);
  const [currentSort, setCurrentSort] = useState<string>('date');

  const vehicleName = slug ? decodeURIComponent(slug) : '';

  const itemsPerPage = 12;

  const currentPage = parseInt(searchParams.get('page') || '1') || 1;

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

  useEffect(() => {
    if (!slug) {
      router.push('/vehicles');
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const timeoutDuration = 45000;
        const [categoriesResponse, productsResponse, vehicleResponseRaw] = await Promise.all([
          apiClient.get('/categories', { timeout: timeoutDuration }).catch(() => ({ success: false, categories: [] })),
          vehicleService.getVehicleProducts(slug, {
            page: currentPage,
            limit: itemsPerPage,
            ...(selectedCategory && { category: selectedCategory }),
            sortBy: mapSortBy(currentSort),
            order: getSortOrder(currentSort)
          }, { timeout: timeoutDuration }).catch((err: any) => {
            console.warn('Could not fetch vehicle products:', err);
            return { products: [], total: 0 };
          }),
          apiClient.get(`/vehicles/slug/${slug}`, { timeout: timeoutDuration }).catch(err => {
            console.warn('Could not fetch vehicle data:', err);
            return { success: false };
          })
        ]);

        const vehicleResponse: any = vehicleResponseRaw;

        const cats: any = categoriesResponse;
        setCategories(cats?.categories || []);

        let productsData = (productsResponse as any).products || [];
        const totalFromAPI = (productsResponse as any).pagination?.total || (productsResponse as any).total || 0;
        setProducts(productsData);
        setTotalProductsFromAPI(totalFromAPI);

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

      } catch (err: any) {
        const message = handleError(err, 'Failed to load products for this vehicle');
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [slug, selectedCategory, currentSort, currentPage]);

  const handleAddToCart = async (product: ExtendedProduct) => {
    try {
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
    if (!productId) return;

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
    setCurrentSort(e.target.value);
  };

  const handleCategoryChange = (categorySlug: string) => {
    setSelectedCategory(categorySlug);
  };

  const filteredProducts = selectedCategory
    ? products.filter(product =>
        product.categories && Array.isArray(product.categories) &&
        product.categories.some(cat => cat && cat.slug === selectedCategory)
      )
    : products;

  const safeTotal = totalProductsFromAPI || 0;
  const totalPages = Math.max(0, Math.ceil(safeTotal / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, safeTotal);

  const paginatedProducts = filteredProducts;

  const formatVehicleName = (raw: string) =>
    raw.replace(/-/g, ' ').split(' ').filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const displayName = vehicleName ? formatVehicleName(vehicleName) : 'Vehicle';

  const paginationBtnBase = 'px-4 py-2 rounded-sm border font-condensed font-bold text-sm uppercase tracking-widest transition-colors';
  const paginationBtnActive = `${paginationBtnBase} bg-[#3B9EE8] text-white border-[#3B9EE8]`;
  const paginationBtnEnabled = `${paginationBtnBase} bg-[#161616] text-[#C4C4C4] border-[#252525] hover:border-[#3B9EE8] hover:text-white`;
  const paginationBtnDisabled = `${paginationBtnBase} bg-[#161616] text-[#555555] border-[#252525] cursor-not-allowed`;

  return (
    <div className="min-h-screen bg-[#080808]">

      {/* Hero */}
      <div className="bg-[#0E0E0E] border-b border-[#252525] py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-2">Vehicles</p>
          <h1 className="text-5xl font-condensed font-bold text-white uppercase tracking-wide mb-4">
            {displayName} Parts & Accessories
          </h1>
          <p className="text-[#C4C4C4] font-body max-w-3xl mx-auto">
            Find the perfect parts and accessories for your {displayName}
          </p>

          {vehicle && (
            <div className="mt-6 flex flex-wrap justify-center gap-6 text-sm text-[#C4C4C4] font-body">
              <div className="flex items-center gap-2">
                <span className="font-condensed font-bold text-[#555555] uppercase tracking-widest">Make</span>
                <span>{vehicle.make}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-condensed font-bold text-[#555555] uppercase tracking-widest">Model</span>
                <span>{vehicle.model}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <nav className="text-sm font-body">
          <Link href="/" className="text-[#555555] hover:text-[#3B9EE8] transition-colors">Home</Link>
          <span className="mx-2 text-[#252525]">/</span>
          <Link href="/vehicles" className="text-[#555555] hover:text-[#3B9EE8] transition-colors">Vehicles</Link>
          <span className="mx-2 text-[#252525]">/</span>
          <span className="text-[#C4C4C4]">{displayName}</span>
        </nav>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="lg:grid lg:grid-cols-4 lg:gap-8">

          {/* Sidebar */}
          <aside className="hidden lg:block">
            <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-6 sticky top-24">
              <h2 className="font-condensed font-bold text-white uppercase tracking-wide mb-5 flex items-center gap-2">
                <Filter className="h-4 w-4 text-[#3B9EE8] shrink-0" />
                Category Filters
              </h2>

              <p className="text-xs font-condensed font-bold text-[#555555] uppercase tracking-widest mb-3">Categories</p>
              <ul className="space-y-1">
                <li>
                  <button
                    onClick={() => handleCategoryChange('')}
                    className={`text-left w-full px-3 py-2 rounded-sm text-sm transition-colors ${
                      selectedCategory === ''
                        ? 'bg-[#3B9EE8]/10 text-[#3B9EE8] font-condensed font-bold border border-[#3B9EE8]/30'
                        : 'text-[#C4C4C4] font-body hover:bg-[#161616]'
                    }`}
                  >
                    All Categories
                  </button>
                </li>
                {categories.filter(cat => cat && (cat._id || cat.id)).map((category) => {
                  const categoryProductCount = products.filter(product =>
                    product.categories && Array.isArray(product.categories) &&
                    product.categories.some(cat => cat && cat.slug === category.slug)
                  ).length;

                  if (categoryProductCount === 0) return null;

                  return (
                    <li key={String(category._id || category.id)}>
                      <button
                        onClick={() => handleCategoryChange(category.slug)}
                        className={`text-left w-full px-3 py-2 rounded-sm text-sm transition-colors ${
                          selectedCategory === category.slug
                            ? 'bg-[#3B9EE8]/10 text-[#3B9EE8] font-condensed font-bold border border-[#3B9EE8]/30'
                            : 'text-[#C4C4C4] font-body hover:bg-[#161616]'
                        }`}
                      >
                        {category.name} ({categoryProductCount})
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>

          {/* Products Grid */}
          <div className="lg:col-span-3">
            {/* Results Header */}
            <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <p className="text-[#C4C4C4] font-body">
                {loading ? (
                  'Loading products...'
                ) : filteredProducts.length > 0 ? (
                  <>
                    Showing {startIndex + 1}–{Math.min(endIndex, safeTotal)} of {safeTotal} product{filteredProducts.length !== 1 ? 's' : ''}
                    {selectedCategory && ` in ${categories.find(c => c.slug === selectedCategory)?.name || selectedCategory}`}
                    {' '}for {displayName}
                  </>
                ) : (
                  'No products found'
                )}
              </p>

              <div className="flex items-center gap-3">
                {/* Mobile Filter Button */}
                <button className="lg:hidden flex items-center gap-2 text-sm font-condensed font-bold text-[#C4C4C4] uppercase tracking-widest bg-[#161616] px-4 py-2 rounded-sm border border-[#252525] hover:border-[#3B9EE8] transition-colors">
                  <Filter className="h-4 w-4" />
                  Filters
                </button>

                {/* Sort Dropdown */}
                <div className="flex items-center gap-2">
                  <label htmlFor="sort" className="text-sm text-[#555555] font-body">
                    Sort:
                  </label>
                  <select
                    id="sort"
                    className="bg-[#161616] border border-[#252525] text-[#C4C4C4] rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-[#3B9EE8] font-body transition-colors"
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

            {/* Loading */}
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="bg-[#0E0E0E] border border-[#252525] rounded-sm overflow-hidden animate-pulse">
                    <div className="h-48 bg-[#161616]" />
                    <div className="p-5 space-y-3">
                      <div className="h-4 bg-[#252525] rounded-sm" />
                      <div className="h-4 bg-[#252525] rounded-sm w-2/3" />
                      <div className="h-5 bg-[#252525] rounded-sm w-1/2" />
                      <div className="flex gap-3 pt-2">
                        <div className="h-9 bg-[#252525] rounded-sm flex-1" />
                        <div className="h-9 w-10 bg-[#252525] rounded-sm" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-8 text-center max-w-2xl mx-auto">
                <h3 className="text-lg font-condensed font-bold text-red-400 uppercase tracking-wide mb-3">Error Loading Products</h3>
                <p className="text-[#C4C4C4] font-body mb-5">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : paginatedProducts.length > 0 ? (
              <div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {paginatedProducts.filter(p => p && (p._id || p.id)).map((product) => {
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
                        className="bg-[#0E0E0E] border border-[#252525] rounded-sm overflow-hidden hover:border-[#3B9EE8] transition-colors group"
                      >
                        {/* Product Image */}
                        <Link
                          href={productUrl({ slug: product.slug, _id: product._id, id: product.id != null ? String(product.id) : undefined }, '/products') || '/products'}
                          className="relative block h-52 bg-[#161616]"
                        >
                          {Array.isArray(product.images) && product.images.length > 0 ? (
                            <ProductImage
                              src={typeof product.images[0] === 'object' ? product.images[0].src || product.images[0].url : product.images[0]}
                              alt={(typeof product.images[0] === 'object' ? product.images[0].alt : null) || product.name}
                              className="object-cover w-full h-full"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <span className="text-[#555555] font-body text-xs">No image available</span>
                            </div>
                          )}

                          {/* Wishlist Button */}
                          <button
                            className={`absolute top-3 right-3 p-2 bg-[#161616] border border-[#252525] rounded-full hover:border-[#3B9EE8] transition-all duration-200 ${
                              animatingItems[String((product._id || product.id) || '')] ? 'animate-pulse' : ''
                            }`}
                            onClick={(e) => handleToggleWishlist(product, e)}
                          >
                            <Heart className={`h-4 w-4 transition-colors duration-200 ${
                              isInWishlist((product._id || product.id)?.toString() || '')
                                ? 'text-red-500 fill-current'
                                : 'text-[#555555]'
                            }`} />
                          </button>

                          {/* Badges */}
                          <div className="absolute top-3 left-3 flex gap-1.5 flex-wrap">
                            {isOutOfStock(product) && (
                              <span className="bg-red-500/20 border border-red-500/40 text-red-400 px-2 py-0.5 rounded-sm text-xs font-condensed font-bold uppercase tracking-wide">
                                Out of Stock
                              </span>
                            )}
                            {(product.featured || product.isFeatured) && !isOutOfStock(product) && (
                              <span className="bg-[#3B9EE8]/20 border border-[#3B9EE8]/40 text-[#3B9EE8] px-2 py-0.5 rounded-sm text-xs font-condensed font-bold uppercase tracking-wide">
                                Popular
                              </span>
                            )}
                            {(product.on_sale || (product.originalPrice && product.originalPrice > 0)) && !isOutOfStock(product) && (
                              <span className="bg-red-500/20 border border-red-500/40 text-red-400 px-2 py-0.5 rounded-sm text-xs font-condensed font-bold uppercase tracking-wide">
                                Sale
                              </span>
                            )}
                            <span className="bg-green-500/20 border border-green-500/40 text-green-400 px-2 py-0.5 rounded-sm text-xs font-condensed font-bold uppercase tracking-wide">
                              Fits {displayName}
                            </span>
                          </div>
                        </Link>

                        {/* Product Info */}
                        <div className="p-4">
                          <p className="text-xs text-[#555555] font-body uppercase tracking-wide mb-1.5">
                            {Array.isArray(product.categories) && product.categories.length > 0
                              ? product.categories.filter(cat => cat).map(cat => typeof cat === 'object' ? cat.name : cat).filter(Boolean).join(', ')
                              : 'Uncategorized'}
                          </p>

                          <Link href={productUrl({ slug: product.slug, _id: product._id, id: product.id != null ? String(product.id) : undefined }, '/products') || '/products'}>
                            <h3 className="font-condensed font-bold text-[#C4C4C4] group-hover:text-[#3B9EE8] mb-3 line-clamp-2 uppercase tracking-wide transition-colors">
                              {product.name}
                            </h3>
                          </Link>

                          {averageRatingValue > 0 && (
                            <div className="flex items-center gap-1.5 mb-3">
                              <div className="flex">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <svg
                                    key={star}
                                    className={`h-3.5 w-3.5 ${star <= averageRatingValue ? 'text-[#EF9F27]' : 'text-[#252525]'}`}
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                  </svg>
                                ))}
                              </div>
                              <span className="text-xs text-[#555555] font-body">({averageRatingValue.toFixed(1)})</span>
                            </div>
                          )}

                          {hasValidPrice && (
                            <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#252525]">
                              <div>
                                {hasOriginalPrice ? (
                                  <div className="flex items-baseline gap-2">
                                    <span className="text-lg font-condensed font-bold text-[#3B9EE8]">{formatPrice(priceValue)}</span>
                                    <span className="text-xs text-[#555555] font-body line-through">{formatPrice(originalPriceNumber)}</span>
                                  </div>
                                ) : (
                                  <span className="text-lg font-condensed font-bold text-[#3B9EE8]">{formatPrice(priceValue)}</span>
                                )}
                              </div>

                              <button
                                onClick={() => handleAddToCart(product)}
                                disabled={isOutOfStock(product)}
                                className="flex items-center gap-1.5 bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-3 py-2 rounded-sm text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <ShoppingCart className="h-3.5 w-3.5" />
                                Add
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="mt-12 flex items-center justify-center">
                    <nav className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (currentPage > 1 && slug) {
                            const newPage = currentPage - 1;
                            router.push(newPage === 1 ? `/model/${slug}` : `/model/${slug}/page/${newPage}`);
                          }
                        }}
                        disabled={currentPage === 1}
                        className={currentPage === 1 ? paginationBtnDisabled : paginationBtnEnabled}
                      >
                        Previous
                      </button>

                      {slug && totalPages > 0 && Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum: number;
                        if (totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (currentPage <= 3) {
                          pageNum = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i;
                        } else {
                          pageNum = currentPage - 2 + i;
                        }

                        if (!pageNum || pageNum < 1) return null;

                        return (
                          <button
                            key={i}
                            onClick={() => {
                              if (slug && pageNum) {
                                router.push(pageNum === 1 ? `/model/${slug}` : `/model/${slug}/page/${pageNum}`);
                              }
                            }}
                            className={currentPage === pageNum ? paginationBtnActive : paginationBtnEnabled}
                          >
                            {pageNum}
                          </button>
                        );
                      })}

                      <button
                        onClick={() => {
                          if (currentPage < totalPages && slug) {
                            const newPage = currentPage + 1;
                            router.push(newPage === 1 ? `/model/${slug}` : `/model/${slug}/page/${newPage}`);
                          }
                        }}
                        disabled={currentPage === totalPages}
                        className={currentPage === totalPages ? paginationBtnDisabled : paginationBtnEnabled}
                      >
                        Next
                      </button>
                    </nav>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-16">
                <p className="text-[#555555] font-body text-lg mb-4">
                  No products found for {displayName}
                </p>
                <button
                  onClick={() => handleCategoryChange('')}
                  className="text-[#3B9EE8] hover:text-white font-condensed font-bold uppercase tracking-widest transition-colors"
                >
                  View all products
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Related Vehicles */}
        {Array.isArray(relatedVehicles) && relatedVehicles.length > 0 && (
          <section className="mt-16">
            <h2 className="text-2xl font-condensed font-bold text-white uppercase tracking-wide mb-8">
              Related {vehicle?.make || 'Vehicles'}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {relatedVehicles.filter(v => v && v._id && v.slug).slice(0, 5).map((relatedVehicle) => (
                <Link
                  key={relatedVehicle._id}
                  href={`/model/${encodeURIComponent(relatedVehicle.slug)}`}
                  className="group block"
                >
                  <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm overflow-hidden hover:border-[#3B9EE8] transition-colors">
                    <div className="aspect-square bg-[#161616] flex items-center justify-center overflow-hidden">
                      {(() => {
                        const slugKey = (relatedVehicle.slug || '').toString().toLowerCase();
                        const nameKey = `${relatedVehicle.make || ''}-${relatedVehicle.model || ''}`
                          .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

                        let imageUrl: string | undefined;

                        if (slugKey.includes('fortuner') || nameKey.includes('fortuner')) imageUrl = VEHICLE_IMAGE_MAP['fortuner'];
                        else if (slugKey.includes('hilux') || nameKey.includes('hilux')) imageUrl = VEHICLE_IMAGE_MAP['hilux'];
                        else if (slugKey.includes('thar') || nameKey.includes('thar')) imageUrl = VEHICLE_IMAGE_MAP['thar'];
                        else if (slugKey.includes('jimny') || nameKey.includes('jimny')) imageUrl = VEHICLE_IMAGE_MAP['jimny'];
                        else if (slugKey.includes('wrangler') || nameKey.includes('wrangler')) imageUrl = VEHICLE_IMAGE_MAP['wrangler'];
                        else if (slugKey.includes('endeavour') || nameKey.includes('endeavour')) imageUrl = VEHICLE_IMAGE_MAP['endeavour'];
                        else if (slugKey.includes('ranger') || nameKey.includes('ranger')) imageUrl = VEHICLE_IMAGE_MAP['ranger'];
                        else if (slugKey.includes('defender') || nameKey.includes('defender')) imageUrl = VEHICLE_IMAGE_MAP['defender'];
                        else if (slugKey.includes('isuzu') || nameKey.includes('isuzu') || slugKey.includes('dmax') || nameKey.includes('dmax')) imageUrl = VEHICLE_IMAGE_MAP['isuzu-dmax'];

                        if (!imageUrl) {
                          imageUrl =
                            (relatedVehicle.image && relatedVehicle.image.url) ||
                            VEHICLE_IMAGE_MAP[slugKey] ||
                            VEHICLE_IMAGE_MAP[nameKey];
                        }

                        if (!imageUrl) {
                          return (
                            <div className="w-full h-full flex items-center justify-center">
                              <span className="text-[#555555] font-body text-xs">No image</span>
                            </div>
                          );
                        }

                        return (
                          <img
                            src={imageUrl}
                            alt={relatedVehicle.name || `${relatedVehicle.make} ${relatedVehicle.model}`}
                            className="object-cover w-full h-full scale-110 group-hover:scale-125 transition-transform duration-500"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              if (slugKey.includes('fortuner') || nameKey.includes('fortuner')) target.src = VEHICLE_IMAGE_MAP['fortuner'];
                              else if (slugKey.includes('hilux') || nameKey.includes('hilux')) target.src = VEHICLE_IMAGE_MAP['hilux'];
                              else if (slugKey.includes('thar') || nameKey.includes('thar')) target.src = VEHICLE_IMAGE_MAP['thar'];
                              else if (slugKey.includes('jimny') || nameKey.includes('jimny')) target.src = VEHICLE_IMAGE_MAP['jimny'];
                              else if (slugKey.includes('wrangler') || nameKey.includes('wrangler')) target.src = VEHICLE_IMAGE_MAP['wrangler'];
                              else if (slugKey.includes('endeavour') || nameKey.includes('endeavour')) target.src = VEHICLE_IMAGE_MAP['endeavour'];
                              else if (slugKey.includes('ranger') || nameKey.includes('ranger')) target.src = VEHICLE_IMAGE_MAP['ranger'];
                              else if (slugKey.includes('defender') || nameKey.includes('defender')) target.src = VEHICLE_IMAGE_MAP['defender'];
                              else if (slugKey.includes('isuzu') || nameKey.includes('isuzu') || slugKey.includes('dmax') || nameKey.includes('dmax')) target.src = VEHICLE_IMAGE_MAP['isuzu-dmax'];
                              else target.src = '/images/fallback-product.png';
                            }}
                            loading="lazy"
                          />
                        );
                      })()}
                    </div>
                    <div className="p-3 text-center bg-[#161616] border-t border-[#252525]">
                      <h3 className="text-sm font-condensed font-bold text-[#C4C4C4] group-hover:text-[#3B9EE8] uppercase tracking-wide transition-colors">
                        {relatedVehicle.model}
                      </h3>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
