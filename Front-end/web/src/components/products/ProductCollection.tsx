'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ShoppingCart, Heart, ChevronRight } from 'lucide-react';
import apiClient from '@/lib/api';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCurrency } from '@/contexts/CurrencyContext';
import ProductImage from '@/components/products/ProductImage';
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
  brand?: string;
  stock: number;
  averageRating: number;
}

interface ProductCollectionProps {
  title: string;
  subtitle?: string;
  productIds?: string[];
  category?: string;
  brand?: string;
  searchKeyword?: string; // New prop for keyword-based search
  limit?: number;
  className?: string;
}

export default function ProductCollection({
  title,
  subtitle,
  productIds,
  category,
  brand,
  searchKeyword,
  limit = 8,
  className = ''
}: ProductCollectionProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const { addToCart } = useCart();
  const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const { formatPrice } = useCurrency();

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        setLoading(true);
        
        // Build query parameters
        const params = new URLSearchParams();
        
        // Add filters based on props
        if (searchKeyword) {
          // Use text search for keyword-based filtering
          params.append('search', searchKeyword);
        }
        
        if (brand) {
          params.append('brand', brand);
        }
        
        if (category) {
          params.append('category', category);
        }
        
        params.append('limit', limit.toString());
        params.append('page', '1');
        
        // Fetch products with filters
        const response: any = await apiClient.get(`/products?${params.toString()}`);
        
        setProducts(response.products || []);
      } catch (err: any) {
        console.error('Failed to fetch collection products:', err);
        // Don't set error if it's just a filter issue - products might not exist
        // This prevents showing error when brand/category has no products
        setProducts([]);
      } finally {
        setLoading(false);
      }
    };

    // Only fetch if we have at least one filter
    if (brand || category || searchKeyword || (productIds && productIds.length > 0)) {
      fetchProducts();
    } else {
      setLoading(false);
    }
  }, [productIds, category, brand, searchKeyword, limit]);

  const handleAddToCart = async (productId: string, e: React.MouseEvent) => {
    e.preventDefault();
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
      toast.error('Failed to update wishlist');
    }
  };

  // Loading skeleton
  if (loading) {
    return (
      <section className={`py-16 bg-gray-50 ${className}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-12">
            <div className="h-10 bg-gray-200 rounded w-64 mb-2 animate-pulse" />
            {subtitle && <div className="h-6 bg-gray-200 rounded w-96 animate-pulse" />}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[...Array(3)].map((_, index) => (
              <div key={index} className="bg-white rounded-lg overflow-hidden animate-pulse">
                <div className="aspect-square bg-gray-200" />
                <div className="p-6">
                  <div className="h-4 bg-gray-200 rounded mb-2" />
                  <div className="h-4 bg-gray-200 rounded w-2/3 mb-4" />
                  <div className="h-8 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  // Don't show section if error
  if (error) {
    return null;
  }

  // Show empty state if no products found
  if (products.length === 0 && !loading) {
    return (
      <section className={`py-16 bg-gray-50 ${className}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section Header */}
          <div className="mb-12">
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xl text-gray-600">{subtitle}</p>
            )}
          </div>
          
          {/* Empty State */}
          <div className="text-center py-12 bg-white rounded-lg">
            <p className="text-gray-500 text-lg mb-4">
              No products found {brand && `for brand "${brand}"`}{category && `in category "${category}"`}{searchKeyword && `for "${searchKeyword}"`}
            </p>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold"
            >
              <span>Browse All Products</span>
              <ChevronRight className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`py-16 bg-gray-50 ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="mb-12">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xl text-gray-600">{subtitle}</p>
          )}
        </div>
        
        {/* Products Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {products.map((product) => (
            <Link
              key={product._id}
              href={`/products/${product._id}`}
              className="group"
            >
              <div className="bg-white rounded-lg overflow-hidden hover:shadow-2xl transition-all duration-300 h-full flex flex-col">
                {/* Product Image */}
                <div className="relative aspect-square bg-gray-100 overflow-hidden">
                  {product.images && (
                    Array.isArray(product.images) && product.images.length > 0 && product.images[0].url ? (
                      <ProductImage
                        src={product.images[0].url}
                        alt={product.images[0].alt || product.name}
                        className="object-cover w-full h-full group-hover:scale-110 transition-transform duration-500"
                      />
                    ) : typeof product.images === 'string' && product.images !== '' ? (
                      <ProductImage
                        src={product.images}
                        alt={product.name}
                        className="object-cover w-full h-full group-hover:scale-110 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-100">
                        <span className="text-gray-400">No image</span>
                      </div>
                    )
                  )}
                  
                  {/* Wishlist Button */}
                  <button
                    className="absolute top-4 right-4 p-2 bg-white rounded-full shadow-lg hover:bg-gray-100 transition-colors opacity-0 group-hover:opacity-100"
                    onClick={(e) => handleToggleWishlist(product._id, e)}
                  >
                    <Heart className={`h-5 w-5 transition-colors duration-200 ${
                      isInWishlist(product._id) 
                        ? 'text-red-500 fill-current' 
                        : 'text-gray-600'
                    }`} />
                  </button>

                  {/* Sale Badge */}
                  {product.originalPrice && product.originalPrice > product.price && (
                    <div className="absolute top-4 left-4 bg-red-500 text-white px-3 py-1 rounded-full text-sm font-bold">
                      SALE
                    </div>
                  )}
                </div>

                {/* Product Info */}
                <div className="p-6 flex-1 flex flex-col">
                  {/* Product Name */}
                  <h3 className="font-semibold text-lg text-gray-900 mb-3 line-clamp-2 group-hover:text-blue-600 transition-colors">
                    {product.name}
                  </h3>

                  {/* Brand/Category Tags */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {product.brand && (
                      <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded">
                        {product.brand}
                      </span>
                    )}
                    {typeof product.category === 'object' && product.category?.name && (
                      <span className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded">
                        {product.category.name}
                      </span>
                    )}
                  </div>

                  {/* Price */}
                  <div className="mt-auto">
                    {product.originalPrice && product.originalPrice > product.price ? (
                      <div className="mb-4">
                        <p className="text-2xl font-bold text-blue-600">
                          {formatPrice(product.price)}
                        </p>
                        <p className="text-sm text-gray-500 line-through">
                          Original price was: {formatPrice(product.originalPrice)}
                        </p>
                        <p className="text-sm text-gray-600">
                          Current price is: {formatPrice(product.price)}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">(incl. taxes)</p>
                      </div>
                    ) : (
                      <div className="mb-4">
                        <p className="text-2xl font-bold text-gray-900">
                          {formatPrice(product.price)}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">(incl. taxes)</p>
                      </div>
                    )}

                    {/* Add to Cart Button */}
                    <button
                      onClick={(e) => handleAddToCart(product._id, e)}
                      disabled={product.stock <= 0}
                      className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
                    >
                      <ShoppingCart className="h-5 w-5" />
                      <span>{product.stock <= 0 ? 'Out of Stock' : 'Add to Cart'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* View More Link */}
        <div className="mt-12 text-center">
          <Link
            href={brand ? `/products?brand=${brand}` : category ? `/products?category=${category}` : '/products'}
            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold text-lg group"
          >
            <span>View All Products</span>
            <ChevronRight className="h-5 w-5 group-hover:translate-x-2 transition-transform" />
          </Link>
        </div>
      </div>
    </section>
  );
}
