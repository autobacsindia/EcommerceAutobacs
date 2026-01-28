'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ShoppingCart, Heart, Star } from 'lucide-react';
import apiClient from '@/lib/api';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCurrency } from '@/contexts/CurrencyContext';
import ProductImage from '@/components/products/ProductImage';
import ViewAllCard from './ViewAllCard';
import { toast } from 'react-hot-toast';

interface ProductImageType {
  url: string;
  alt?: string;
  isPrimary?: boolean;
  _id?: string;
}

interface Product {
  _id: string;
  name: string;
  price: number;
  originalPrice?: number;
  images: ProductImageType[] | string;
  category: { 
    name: string;
  } | string;
  stock: number;
  averageRating: number;
  isFeatured?: boolean;
  isNew?: boolean;
}

interface FastMovingProductsProps {
  limit?: number;
  className?: string;
}

export default function FastMovingProducts({
  limit = 4,
  className = ''
}: FastMovingProductsProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { addToCart } = useCart();
  const { formatPrice } = useCurrency();
  const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const fetchFastMovingProducts = async () => {
      try {
        setLoading(true);
        setError(null); // Reset error state
        
        // Fetch featured products (actual products marked as featured in the database)
        // This ensures we show real, curated popular products
        const response: any = await apiClient.get(`/products/featured?limit=${limit}`);
        setProducts(response.products || []);
      } catch (err: any) {
        console.error('Failed to fetch fast-moving products:', err);
        
        // Provide more specific error messages based on error type
        if (err.status === 429) {
          setError('Too many requests. Please try again in a moment.');
        } else if (err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))) {
          setError('Unable to connect to the server. Please check your internet connection and try again later.');
        } else {
          setError('Failed to load fast-moving products. Please try again later.');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchFastMovingProducts();
  }, [limit]);

  const handleAddToCart = async (productId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent navigation to product page

    if (!isAuthenticated) {
      toast.error('Please login to add items to cart');
      router.push('/login?redirect=/');
      return;
    }

    try {
      await addToCart(productId, 1);
      toast.success('Added to cart!');
    } catch (error) {
      console.error('Failed to add to cart:', error);
      toast.error('Failed to add to cart');
    }
  };

  const handleToggleWishlist = async (productId: string, e: React.MouseEvent) => {
    e.preventDefault();
    
    if (!isAuthenticated) {
      router.push('/login');
      return;
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
      if (error.message && error.message.includes('already in wishlist')) {
        try {
          await removeFromWishlist(productId);
          toast.success('Removed from wishlist');
        } catch (removeError) {
          toast.error('Failed to update wishlist');
        }
      } else {
        toast.error('Failed to update wishlist');
      }
    }
  };

  // Loading skeleton
  if (loading) {
    return (
      <section className={`py-16 bg-white ${className}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Featured Products</h2>
            <p className="text-gray-600">Popular products customers love to buy</p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
            {[...Array(limit)].map((_, index) => (
              <div key={index} className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse">
                <div className="aspect-square bg-gray-200"></div>
                <div className="p-4">
                  <div className="h-4 bg-gray-200 rounded mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-2/3 mb-3"></div>
                  <div className="h-6 bg-gray-200 rounded w-1/2 mb-3"></div>
                  <div className="h-10 bg-gray-200 rounded"></div>
                </div>
              </div>
            ))}
            {/* View All Card Skeleton */}
            <div className="bg-gray-200 rounded-lg animate-pulse min-h-[400px]"></div>
          </div>
        </div>
      </section>
    );
  }

  // Show error message if there's an error, but still render the section
  if (error) {
    return (
      <section className={`py-16 bg-white ${className}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Featured Products</h2>
            <p className="text-gray-600">Popular products customers love to buy</p>
          </div>
          
          <div className="text-center py-12">
            <div className="text-red-500 text-lg font-medium mb-4">{error}</div>
            <button 
              onClick={() => {
                setError(null);
                // Retry the fetch
                const fetchFastMovingProducts = async () => {
                  try {
                    setLoading(true);
                    const response: any = await apiClient.get(`/products/featured?limit=${limit}`);
                    setProducts(response.products || []);
                  } catch (err: any) {
                    console.error('Failed to fetch fast-moving products:', err);
                    
                    if (err.status === 429) {
                      setError('Too many requests. Please try again in a moment.');
                    } else if (err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))) {
                      setError('Unable to connect to the server. Please check your internet connection and try again later.');
                    } else {
                      setError('Failed to load fast-moving products. Please try again later.');
                    }
                  } finally {
                    setLoading(false);
                  }
                };
                
                fetchFastMovingProducts();
              }}
              className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </section>
    );
  }
  
  // Don't show section if no products
  if (products.length === 0) {
    return null;
  }

  return (
    <section className={`py-16 bg-white ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Featured Products</h2>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Popular products customers love to buy
          </p>
        </div>
        
        {/* Products Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
          {/* Product Cards */}
          {products.map((product) => (
            <Link
              key={product._id}
              href={`/products/${product._id}`}
              className="group"
            >
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-xl transition-all duration-300">
                {/* Product Image */}
                <div className="relative aspect-square bg-gray-100 overflow-hidden">
                  {product.images && (
                    Array.isArray(product.images) && product.images.length > 0 && product.images[0].url ? (
                      <ProductImage
                        src={product.images[0].url}
                        alt={product.images[0].alt || product.name}
                        className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : typeof product.images === 'string' && product.images !== '' ? (
                      <ProductImage
                        src={product.images}
                        alt={product.name}
                        className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-100">
                        <span className="text-gray-400 text-xs">No image</span>
                      </div>
                    )
                  )}
                  
                  {/* Wishlist Button */}
                  <button
                    className="absolute top-2 right-2 p-1.5 bg-white rounded-full shadow-md hover:bg-gray-100 transition-colors opacity-0 group-hover:opacity-100"
                    onClick={(e) => handleToggleWishlist(product._id, e)}
                  >
                    <Heart className={`h-4 w-4 transition-colors duration-200 ${
                      isInWishlist(product._id) 
                        ? 'text-red-500 fill-current' 
                        : 'text-gray-600'
                    }`} />
                  </button>

                  {/* Badges */}
                  {product.stock <= 0 && (
                    <div className="absolute top-2 left-2 bg-red-500 text-white px-2 py-1 rounded text-xs font-semibold">
                      Out of Stock
                    </div>
                  )}
                  {product.originalPrice && product.originalPrice > product.price && (
                    <div className="absolute top-2 left-2 bg-red-500 text-white px-2 py-1 rounded text-xs font-semibold">
                      Sale
                    </div>
                  )}
                </div>

                {/* Product Info */}
                <div className="p-4">
                  {/* Product Name */}
                  <h3 className="font-semibold text-sm text-gray-900 mb-2 line-clamp-2 group-hover:text-blue-600 transition-colors">
                    {product.name}
                  </h3>

                  {/* Rating */}
                  {product.averageRating > 0 && (
                    <div className="flex items-center gap-1 mb-2">
                      <div className="flex">
                        {[...Array(5)].map((_, i) => (
                          <Star
                            key={i}
                            className={`h-3 w-3 ${
                              i < Math.floor(product.averageRating) 
                                ? 'text-yellow-400 fill-current' 
                                : 'text-gray-300'
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-gray-600">
                        ({product.averageRating.toFixed(1)})
                      </span>
                    </div>
                  )}

                  {/* Price */}
                  <div className="mb-3">
                    {product.originalPrice && product.originalPrice > product.price ? (
                      <div className="flex flex-col">
                        <p className="text-lg font-bold text-blue-600">
                          {formatPrice(product.price)}
                        </p>
                        <p className="text-xs text-gray-500 line-through">
                          {formatPrice(product.originalPrice)}
                        </p>
                      </div>
                    ) : (
                      <p className="text-lg font-bold text-blue-600">
                        {formatPrice(product.price)}
                      </p>
                    )}
                  </div>

                  {/* Add to Cart Button */}
                  <button
                    onClick={(e) => handleAddToCart(product._id, e)}
                    disabled={product.stock <= 0}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium"
                  >
                    <ShoppingCart className="h-4 w-4" />
                    <span>{product.stock <= 0 ? 'Out of Stock' : 'Add to Cart'}</span>
                  </button>
                </div>
              </div>
            </Link>
          ))}

          {/* View All Card */}
          <ViewAllCard
            href="/products?isFeatured=true"
            title="View All"
            subtitle="Featured Products"
            gradient="from-orange-500 to-red-600"
          />
        </div>
      </div>
    </section>
  );
}
