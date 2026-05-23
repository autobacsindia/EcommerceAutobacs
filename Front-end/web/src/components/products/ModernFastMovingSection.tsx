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
import { toast } from 'react-hot-toast';
import { productUrl } from '@/lib/types';
import { ProductCardSkeleton } from '@/components/skeletons/ProductCardSkeleton';
import dynamic from 'next/dynamic';

const ProductImage = dynamic(() => import('@/components/products/ProductImage'), {
  loading: () => <div className="w-full h-full bg-[#161616] animate-pulse" />
});

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
    const cacheKey = `fastMoving_${limit}`;

    const cachedProducts = localStorage.getItem(cacheKey);
    if (cachedProducts) {
      try {
        const parsedProducts = JSON.parse(cachedProducts);
        setProducts(parsedProducts);
        setLoading(false);
        return;
      } catch (e) {
        console.warn('Failed to parse cached fast-moving products:', e);
      }
    }

    const fetchFastMovingProducts = async () => {
      try {
        setLoading(true);
        setError(null);

        const response: any = await apiClient.get(`/products?isFastMoving=true&limit=${limit}`);
        const productsData = response.products || [];
        setProducts(productsData);

        try {
          localStorage.setItem(cacheKey, JSON.stringify(productsData));
        } catch (e) {
          console.warn('Failed to cache fast-moving products in localStorage:', e);
        }
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
    e.stopPropagation();

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
      <section className={`py-16 bg-[#080808] ${className}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-2">Top Sellers</p>
            <h2 className="text-3xl font-condensed font-bold text-white uppercase tracking-wide mb-2">Fast-Moving Products</h2>
            <p className="text-[#C4C4C4] font-body">Top picks flying off the shelves</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[...Array(limit)].map((_, index) => (
              <ProductCardSkeleton key={index} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (error || products.length === 0) return null;

  return (
    <section className={`py-16 bg-[#080808] ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="animate-in slide-in-from-bottom duration-700 fade-in">
            <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-2">Top Sellers</p>
            <h2 className="text-3xl font-condensed font-bold text-white uppercase tracking-wide mb-2">Fast-Moving Products</h2>
            <p className="text-[#C4C4C4] font-body mb-4">Top picks flying off the shelves</p>
            <Link
              href="/products?isFastMoving=true"
              className="inline-flex items-center text-[#3B9EE8] font-condensed font-semibold hover:text-white transition-colors group"
            >
              View All Collection
              <ArrowRight className="ml-2 w-5 h-5 transform group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {products.map((product, index) => {
            const url = productUrl(product, '/products');
            return (
            <div
              key={product._id}
              className="group bg-[#0E0E0E] border border-[#252525] rounded-lg hover:border-[#3B9EE8] transition-all duration-300 overflow-hidden flex flex-col relative"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {/* Product Image */}
              <div className="relative aspect-4/3 overflow-hidden bg-[#161616]">
                <Link href={url}>
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
                      <div className="w-full h-full flex items-center justify-center bg-[#161616]">
                        <span className="text-[#555555]">No Image</span>
                      </div>
                    )}
                </Link>

                {/* Overlay Actions */}
                <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transform translate-x-4 group-hover:translate-x-0 transition-all duration-300">
                  <button
                    onClick={(e) => handleToggleWishlist(product._id, e)}
                    className={`p-3 rounded-full shadow-lg ${
                      isAuthenticated && isInWishlist(product._id)
                        ? 'bg-[#252525] text-red-500'
                        : 'bg-[#252525] text-[#C4C4C4] hover:text-red-500'
                    } transition-colors`}
                    title="Add to Wishlist"
                  >
                    <Heart className={`w-5 h-5 ${isAuthenticated && isInWishlist(product._id) ? 'fill-current' : ''}`} />
                  </button>
                  <button
                    onClick={(e) => handleAddToCart(product._id, e)}
                    className="p-3 bg-[#252525] text-[#C4C4C4] hover:text-[#3B9EE8] rounded-full shadow-lg transition-colors"
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
              <div className="p-4 grow flex flex-col">
                <div className="text-xs text-[#3B9EE8] font-condensed font-bold mb-2 uppercase tracking-widest">
                  {typeof product.category === 'string' ? 'Auto Parts' : product.category?.name}
                </div>
                <Link href={url} className="block mb-2">
                  <h3 className="font-condensed font-bold text-white uppercase tracking-wide line-clamp-2 group-hover:text-[#3B9EE8] transition-colors">
                    {product.name}
                  </h3>
                </Link>

                <div className="mt-auto pt-4 flex items-center justify-between border-t border-[#252525]">
                  <div className="flex flex-col">
                    <span className="text-xl font-condensed font-bold text-[#3B9EE8]">
                      {formatPrice(product.price)}
                    </span>
                    {product.originalPrice && product.originalPrice > product.price && (
                      <span className="text-sm text-[#555555] line-through">
                        {formatPrice(product.originalPrice)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center text-[#EF9F27] text-sm font-medium">
                    <span className="text-[#C4C4C4] mr-1">{product.averageRating?.toFixed(1) || '0.0'}</span>
                    ★
                  </div>
                </div>
              </div>
            </div>
            );
          })}

          {/* "See More" Card */}
           <Link
            href="/products?isFastMoving=true"
            className="group bg-[#3B9EE8] hover:bg-[#1A6FB5] rounded-lg transition-all duration-300 overflow-hidden flex flex-col items-center justify-center p-8 text-center text-white h-full min-h-100"
          >
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
              <ArrowRight className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-2xl font-condensed font-bold uppercase tracking-wide mb-2">View All Collection</h3>
            <p className="text-blue-100 font-body mb-6">Discover our complete range of fast-moving products</p>
            <span className="inline-block px-6 py-2 border-2 border-white/30 rounded-sm font-condensed font-bold uppercase tracking-widest group-hover:bg-white group-hover:text-[#3B9EE8] transition-all duration-300">
              Browse Now
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
