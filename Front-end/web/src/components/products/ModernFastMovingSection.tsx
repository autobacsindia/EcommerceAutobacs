'use client';

import type { StockStatus } from '@/lib/stock';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ShoppingCart, Heart, ArrowRight } from 'lucide-react';
import apiClient from '@/lib/api';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCurrency } from '@/context/CurrencyContext';
import { toast } from 'react-hot-toast';
import { productUrl } from '@/lib/types';
import { ProductCardSkeleton } from '@/components/skeletons/ProductCardSkeleton';
import dynamic from 'next/dynamic';

const ProductImage = dynamic(() => import('@/components/products/ProductImage'), {
  loading: () => <div className="w-full h-full bg-obsidian-raised animate-pulse" />
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
  stock: StockStatus;
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
    // Bump CACHE_VERSION whenever the cached product shape changes so stale
    // payloads (e.g. older entries missing the `images` array) are discarded
    // rather than served indefinitely. Entries also expire via CACHE_TTL_MS.
    const CACHE_VERSION = 'v2';
    const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
    const cacheKey = `fastMoving_${CACHE_VERSION}_${limit}`;

    const cachedRaw = localStorage.getItem(cacheKey);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw);
        const isFresh = cached?.cachedAt && Date.now() - cached.cachedAt < CACHE_TTL_MS;
        if (isFresh && Array.isArray(cached.products)) {
          setProducts(cached.products);
          setLoading(false);
          return;
        }
        localStorage.removeItem(cacheKey);
      } catch (e) {
        console.warn('Failed to parse cached fast-moving products:', e);
        localStorage.removeItem(cacheKey);
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
          localStorage.setItem(
            cacheKey,
            JSON.stringify({ products: productsData, cachedAt: Date.now() })
          );
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

    toast.success('Added to cart!');
    try {
      await addToCart(productId, 1);
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
      <section className={`py-16 bg-obsidian-deep ${className}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Top Sellers</p>
            <h2 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-2">Fast-Moving Products</h2>
            <p className="text-ink/70 font-display">Top picks flying off the shelves</p>
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
    <section className={`py-16 bg-obsidian-deep ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="animate-in slide-in-from-bottom duration-700 fade-in">
            <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Top Sellers</p>
            <h2 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-2">Fast-Moving Products</h2>
            <p className="text-ink/70 font-display mb-4">Top picks flying off the shelves</p>
            <Link
              href="/products?isFastMoving=true"
              className="inline-flex items-center text-gold font-display font-semibold hover:text-ink transition-colors group"
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
              className="group bg-obsidian border border-hairline rounded-lg hover:border-gold transition-all duration-300 overflow-hidden flex flex-col relative"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {/* Product Image */}
              <div className="relative aspect-4/3 overflow-hidden bg-obsidian-raised">
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
                      <div className="w-full h-full flex items-center justify-center bg-obsidian-raised">
                        <span className="text-ink-muted">No Image</span>
                      </div>
                    )}
                </Link>

                {/* Overlay Actions */}
                <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transform translate-x-4 group-hover:translate-x-0 transition-all duration-300">
                  <button
                    onClick={(e) => handleToggleWishlist(product._id, e)}
                    className={`p-3 rounded-full shadow-lg ${
                      isAuthenticated && isInWishlist(product._id)
                        ? 'bg-obsidian-raised text-red-500'
                        : 'bg-obsidian-raised text-ink/70 hover:text-red-500'
                    } transition-colors`}
                    title="Add to Wishlist"
                  >
                    <Heart className={`w-5 h-5 ${isAuthenticated && isInWishlist(product._id) ? 'fill-current' : ''}`} />
                  </button>
                  <button
                    onClick={(e) => handleAddToCart(product._id, e)}
                    className="p-3 bg-obsidian-raised text-ink/70 hover:text-gold rounded-full shadow-lg transition-colors"
                    title="Add to Cart"
                  >
                    <ShoppingCart className="w-5 h-5" />
                  </button>
                </div>

                {/* Badge */}
                {(product.originalPrice && product.originalPrice > product.price) && (
                  <div className="absolute top-4 left-4 bg-red-500 text-ink text-xs font-bold px-3 py-1 rounded-full shadow-md">
                    -{Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}%
                  </div>
                )}
              </div>

              {/* Product Info */}
              <div className="p-4 grow flex flex-col">
                <div className="text-xs text-gold font-display font-bold mb-2 uppercase tracking-widest">
                  {typeof product.category === 'string' ? 'Auto Parts' : product.category?.name}
                </div>
                <Link href={url} className="block mb-2">
                  <h3 className="font-display font-light text-ink tracking-[-0.01em] line-clamp-2 group-hover:text-gold transition-colors">
                    {product.name}
                  </h3>
                </Link>

                <div className="mt-auto pt-4 flex items-center justify-between border-t border-hairline">
                  <div className="flex flex-col">
                    <span className="text-xl font-display font-bold text-gold">
                      {formatPrice(product.price)}
                    </span>
                    {product.originalPrice && product.originalPrice > product.price && (
                      <span className="text-sm text-ink-muted line-through">
                        {formatPrice(product.originalPrice)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center text-gold text-sm font-medium">
                    <span className="text-ink/70 mr-1">{product.averageRating?.toFixed(1) || '0.0'}</span>
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
            className="group bg-gold hover:opacity-90 rounded-lg transition-all duration-300 overflow-hidden flex flex-col items-center justify-center p-8 text-center text-obsidian h-full min-h-100"
          >
            <div className="w-16 h-16 bg-obsidian/20 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
              <ArrowRight className="w-8 h-8 text-ink" />
            </div>
            <h3 className="text-2xl font-display font-bold uppercase tracking-wide mb-2">View All Collection</h3>
            <p className="text-gold font-display mb-6">Discover our complete range of fast-moving products</p>
            <span className="inline-block px-6 py-2 border-2 border-hairline/30 rounded-sm font-display font-bold uppercase tracking-widest group-hover:bg-obsidian group-hover:text-gold transition-all duration-300">
              Browse Now
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
