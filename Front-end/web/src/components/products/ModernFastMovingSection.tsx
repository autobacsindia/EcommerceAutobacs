'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ShoppingCart, Heart, ArrowRight } from 'lucide-react';
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
  stock: number;
  averageRating: number;
  isFeatured?: boolean;
  isNew?: boolean;
}

interface ModernFastMovingSectionProps {
  limit?: number;
  className?: string;
}

export default function ModernFastMovingSection({
  limit = 4,
  className = ''
}: ModernFastMovingSectionProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { addToCart } = useCart();
  const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const { isAuthenticated } = useAuth();
  const { formatPrice } = useCurrency();
  const router = useRouter();

  useEffect(() => {
    const fetchFastMovingProducts = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch fast moving products
        const response: any = await apiClient.get(`/products?isFastMoving=true&limit=${limit}`);
        setProducts(response.products || []);
      } catch (err: any) {
        console.error('Failed to fetch fast-moving products:', err);
        setError('Failed to load fast-moving products.');
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
      router.push('/login?redirect=/'); // Redirect to login
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
      toast.error('Failed to update wishlist');
    }
  };

  if (loading) {
    return (
      <section className={`py-16 bg-gray-50 ${className}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Fast-Moving Products</h2>
            <p className="text-gray-600">Top picks flying off the shelves</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[...Array(limit)].map((_, index) => (
              <div key={index} className="bg-white rounded-2xl shadow-sm overflow-hidden h-96 animate-pulse">
                <div className="h-48 bg-gray-200" />
                <div className="p-6 space-y-4">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                  <div className="h-8 bg-gray-200 rounded w-1/3 mt-4" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (error || products.length === 0) return null;

  return (
    <section className={`py-16 bg-gray-50 ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="animate-in slide-in-from-bottom duration-700 fade-in">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Fast-Moving Products</h2>
            <p className="text-gray-600 mb-4">Top picks flying off the shelves</p>
            <Link 
              href="/products?isFastMoving=true"
              className="inline-flex items-center text-blue-600 font-semibold hover:text-blue-700 transition-colors group"
            >
              View All Collection
              <ArrowRight className="ml-2 w-5 h-5 transform group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {products.map((product, index) => (
            <div 
              key={product._id} 
              className="group bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 overflow-hidden flex flex-col relative"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {/* Product Image */}
              <div className="relative aspect-[4/3] overflow-hidden bg-gray-100">
                <Link href={`/products/${product._id}`}>
                  <div className="w-full h-full transform group-hover:scale-110 transition-transform duration-500">
                    {product.images && Array.isArray(product.images) && product.images.length > 0 ? (
                      <ProductImage 
                        src={product.images[0].url} 
                        alt={product.images[0].alt || product.name}
                        priority={index < 2}
                        className="object-cover w-full h-full"
                      />
                    ) : typeof product.images === 'string' && product.images ? (
                      <ProductImage 
                        src={product.images} 
                        alt={product.name}
                        priority={index < 2}
                        className="object-cover w-full h-full"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-100">
                        <span className="text-gray-400">No Image</span>
                      </div>
                    )}
                  </div>
                </Link>
                
                {/* Overlay Actions */}
                <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transform translate-x-4 group-hover:translate-x-0 transition-all duration-300">
                  <button
                    onClick={(e) => handleToggleWishlist(product._id, e)}
                    className={`p-3 rounded-full shadow-lg ${
                      isAuthenticated && isInWishlist(product._id)
                        ? 'bg-red-50 text-red-500'
                        : 'bg-white text-gray-600 hover:text-red-500'
                    } transition-colors`}
                    title="Add to Wishlist"
                  >
                    <Heart className={`w-5 h-5 ${isAuthenticated && isInWishlist(product._id) ? 'fill-current' : ''}`} />
                  </button>
                  <button
                    onClick={(e) => handleAddToCart(product._id, e)}
                    className="p-3 bg-white text-gray-600 hover:text-blue-600 rounded-full shadow-lg transition-colors"
                    title="Add to Cart"
                  >
                    <ShoppingCart className="w-5 h-5" />
                  </button>
                </div>

                {/* Badge */}
                {(product.originalPrice && product.originalPrice > product.price) && (
                  <div className="absolute top-4 left-4 bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md">
                    -{Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}%
                  </div>
                )}
              </div>

              {/* Product Info */}
              <div className="p-6 flex-grow flex flex-col">
                <div className="text-xs text-blue-600 font-semibold mb-2 uppercase tracking-wide">
                  {typeof product.category === 'string' ? 'Auto Parts' : product.category?.name}
                </div>
                <Link href={`/products/${product._id}`} className="block mb-2">
                  <h3 className="text-lg font-bold text-gray-900 line-clamp-2 group-hover:text-blue-600 transition-colors">
                    {product.name}
                  </h3>
                </Link>
                
                <div className="mt-auto pt-4 flex items-center justify-between border-t border-gray-100">
                  <div className="flex flex-col">
                    <span className="text-xl font-bold text-gray-900">
                      {formatPrice(product.price)}
                    </span>
                    {product.originalPrice && product.originalPrice > product.price && (
                      <span className="text-sm text-gray-400 line-through">
                        {formatPrice(product.originalPrice)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center text-yellow-400 text-sm font-medium">
                    <span className="text-gray-600 mr-1">{product.averageRating?.toFixed(1) || '0.0'}</span>
                    ★
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* "See More" Card as the last item if we have products */}
           <Link 
            href="/products?isFastMoving=true"
            className="group bg-blue-600 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 overflow-hidden flex flex-col items-center justify-center p-8 text-center text-white h-full min-h-[400px]"
          >
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
              <ArrowRight className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-2xl font-bold mb-2">View All Collection</h3>
            <p className="text-blue-100 mb-6">Discover our complete range of fast-moving products</p>
            <span className="inline-block px-6 py-2 border-2 border-white/30 rounded-full font-semibold group-hover:bg-white group-hover:text-blue-600 transition-all duration-300">
              Browse Now
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
