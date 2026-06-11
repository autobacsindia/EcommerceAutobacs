'use client';

import { useState, useEffect, use } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShoppingCart, Heart, Filter } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useAuth } from '@/context/AuthContext';
import { useCurrency } from '@/context/CurrencyContext';
import ProductImage from '@/components/products/ProductImage';
import { toast } from 'react-hot-toast';
import { wordpressService, WordPressProduct, WordPressProductCategory } from '@/services/wordpressService';

export default function WordPressVehicleProductsPage({ params }: { params: Promise<{ make: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToCart } = useCart();
  const { isAuthenticated } = useAuth();
  const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const { formatPrice } = useCurrency();
  
  // Unwrap the params Promise
  const paramsValue = use(params);
  const { make } = paramsValue;
  const vehicleName = decodeURIComponent(make);
  
  const [products, setProducts] = useState<WordPressProduct[]>([]);
  const [categories, setCategories] = useState<WordPressProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [animatingItems, setAnimatingItems] = useState<Record<number, boolean>>({});

  // Get current sort value from URL parameters
  const currentSort = searchParams.get('sort') || 'date';

  // Fetch products and categories when vehicleSlug or selectedCategory changes
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
        
      try {
        // Fetch product categories
        const categoriesData = await wordpressService.getProductCategories();
        setCategories(categoriesData);
          
        // Fetch products for the vehicle
        const response = await wordpressService.getProductsByVehicle(
          make
        );
        let productsData: WordPressProduct[] = (response as any).products || (Array.isArray(response) ? response : []);
        
        // If a category is selected, filter products by that category
        if (selectedCategory) {
          productsData = productsData.filter(product => 
            product.categories.some(cat => cat.slug === selectedCategory)
          );
        }
        
        setProducts(productsData);
          
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
        console.error('Error fetching vehicle products:', err);
        setError(err.message || 'Failed to load products');
        toast.error('Failed to load products');
      } finally {
        setLoading(false);
      }
    };
  
    fetchData();
  }, [make, selectedCategory]);

  const handleAddToCart = async (product: WordPressProduct) => {
    try {
      // For WordPress products, we would typically add to cart via WooCommerce API
      // For now, we'll just show a toast
      toast.success(`${product.name} added to cart`);
    } catch (error) {
      console.error('Failed to add to cart:', error);
      toast.error('Failed to add to cart');
    }
  };

  const handleToggleWishlist = async (product: WordPressProduct, e: React.MouseEvent) => {
    e.preventDefault();
    
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    // Trigger animation
    setAnimatingItems(prev => ({ ...prev, [product.id]: true }));
    
    try {
      if (isInWishlist(product.id.toString())) {
        await removeFromWishlist(product.id.toString());
        toast.success('Removed from wishlist');
      } else {
        await addToWishlist(product.id.toString());
        toast.success('Added to wishlist');
      }
    } catch (error: any) {
      console.error('Failed to toggle wishlist:', error);
      toast.error('Failed to update wishlist');
    } finally {
      // Remove animation after delay
      setTimeout(() => {
        setAnimatingItems(prev => {
          const newState = { ...prev };
          delete newState[product.id];
          return newState;
        });
      }, 300);
    }
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sortValue = e.target.value;
    const currentParams = new URLSearchParams(searchParams.toString());
    
    // Remove existing sort parameter
    currentParams.delete('sort');
    
    // Add new sort parameter if it's not the default
    if (sortValue !== 'date') {
      currentParams.set('sort', sortValue);
    }
    
    // Update URL which will trigger useEffect
    router.push(`/vehicles/${make}/wordpress-page?${currentParams.toString()}`);
  };

  const handleCategoryChange = (categorySlug: string) => {
    setSelectedCategory(categorySlug);
  };

  // Filter products based on selected category
  const filteredProducts = selectedCategory 
    ? products.filter(product => 
        product.categories.some(cat => cat.slug === selectedCategory)
      )
    : products;

  return (
    <div className="min-h-screen bg-white">
      
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-blue-900 to-black text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-5xl font-bold mb-6">{vehicleName} Parts & Accessories</h1>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto">
            Find the perfect parts and accessories for your {vehicleName}
          </p>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <nav className="text-sm text-gray-600">
          <Link href="/" className="hover:text-blue-600 transition-colors">Home</Link>
          <span className="mx-2">/</span>
          <Link href="/vehicles" className="hover:text-blue-600 transition-colors">Vehicles</Link>
          <span className="mx-2">/</span>
          <span className="text-gray-900 font-medium">{vehicleName}</span>
        </nav>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="lg:grid lg:grid-cols-4 lg:gap-8">
          {/* Filters Sidebar */}
          <aside className="hidden lg:block">
            <div className="bg-white rounded-xl shadow-md p-6 sticky top-24 border border-gray-100">
              <h2 className="text-lg font-bold mb-5 flex items-center text-gray-900">
                <Filter className="h-5 w-5 mr-2" />
                Filters
              </h2>
              
              {/* Category Filters */}
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
                  {categories.map((category) => {
                    // Calculate count of products in this category
                    const categoryProductCount = products.filter(product => 
                      product.categories.some(cat => cat.slug === category.slug)
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
                    Showing {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''}
                    {selectedCategory && ` in ${categories.find(c => c.slug === selectedCategory)?.name || selectedCategory}`}
                    {' '}for {vehicleName}
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
            ) : filteredProducts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                {filteredProducts.map((product) => (
                  <div
                    key={product.id}
                    className="bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl transition-all duration-300 border border-gray-100 group"
                  >
                    {/* Product Image */}
                    <Link href={product.permalink} className="block relative h-52 bg-gray-100">
                      {product.images && product.images.length > 0 ? (
                        <ProductImage
                          src={product.images[0].src}
                          alt={product.images[0].alt || product.name}
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
                          animatingItems[product.id] ? 'animate-pulse' : ''
                        }`}
                        onClick={(e) => handleToggleWishlist(product, e)}
                      >
                        <Heart className={`h-5 w-5 transition-colors duration-200 ${
                          isInWishlist(product.id.toString()) 
                            ? 'text-red-500 fill-current' 
                            : 'text-gray-500'
                        }`} />
                      </button>

                      {/* Badges */}
                      <div className="absolute top-3 left-3 flex gap-2">
                        {product.stock_status !== 'instock' && (
                          <div className="bg-red-500 text-white px-2.5 py-1 rounded-md text-xs font-semibold">
                            Out of Stock
                          </div>
                        )}
                        {product.featured && product.stock_status === 'instock' && (
                          <div className="bg-blue-500 text-white px-2.5 py-1 rounded-md text-xs font-semibold">
                            Popular
                          </div>
                        )}
                        {product.on_sale && product.stock_status === 'instock' && (
                          <div className="bg-red-500 text-white px-2.5 py-1 rounded-md text-xs font-semibold">
                            Sale
                          </div>
                        )}
                      </div>
                    </Link>

                    {/* Product Info */}
                    <div className="p-5">
                      {/* Categories */}
                      <p className="text-xs text-gray-500 uppercase mb-2">
                        {product.categories && Array.isArray(product.categories) && product.categories.length > 0
                          ? product.categories.filter(cat => cat && cat.name).map(cat => cat.name).join(', ')
                          : 'Uncategorized'}
                      </p>

                      {/* Product Name */}
                      <Link href={product.permalink}>
                        <h3 className="font-bold text-gray-900 mb-3 line-clamp-2 hover:text-blue-600 transition-colors">
                          {product.name}
                        </h3>
                      </Link>

                      {/* Rating */}
                      {parseFloat(product.average_rating) > 0 && (
                        <div className="flex items-center gap-2 mb-3">
                          <div className="flex">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <svg
                                key={star}
                                className={`h-4 w-4 ${
                                  star <= parseFloat(product.average_rating) 
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
                            ({parseFloat(product.average_rating).toFixed(1)})
                          </span>
                        </div>
                      )}

                      {/* Price and Actions */}
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                        <div>
                          {product.on_sale && product.regular_price !== product.price ? (
                            <div className="flex items-baseline gap-2">
                              <p className="text-xl font-bold text-blue-600">
                                {formatPrice(parseFloat(product.price))}
                              </p>
                              <p className="text-sm text-gray-500 line-through">
                                {formatPrice(parseFloat(product.regular_price))}
                              </p>
                            </div>
                          ) : (
                            <p className="text-xl font-bold text-blue-600">
                              {formatPrice(parseFloat(product.price))}
                            </p>
                          )}
                        </div>

                        <button
                          onClick={() => handleAddToCart(product)}
                          disabled={product.stock_status !== 'instock'}
                          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                        >
                          <ShoppingCart className="h-4 w-4" />
                          <span className="text-sm font-medium">Add</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-500 text-lg mb-4">No products found for {vehicleName}</p>
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
      </div>
    </div>
  );
}
