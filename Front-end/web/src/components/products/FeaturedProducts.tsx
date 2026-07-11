'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ShoppingCart, Heart, Star, ArrowRight } from 'lucide-react';
import apiClient from '@/lib/api';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCurrency } from '@/context/CurrencyContext';
import ProductImage from '@/components/products/ProductImage';
import type { StockStatus } from '@/lib/stock';
import { toast } from 'react-hot-toast';
import { productUrl } from '@/lib/types';
import { ProductCardSkeleton } from '@/components/skeletons/ProductCardSkeleton';

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

interface FeaturedProductsProps {
  limit?: number;
  className?: string;
}

export default function FeaturedProducts({
  limit = 4,
  className = ''
}: FeaturedProductsProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { addToCart } = useCart();
  const { formatPrice } = useCurrency();
  const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  const fetchProducts = async () => {
    try {
      setLoading(true);
      setError(null);
      const response: any = await apiClient.get(`/products/featured?limit=${limit}`);
      const productsData = response.products || [];
      setProducts(productsData);
    } catch (err: any) {
      console.error('Failed to fetch featured products:', err);
      if (err.status === 429) {
        console.warn('[FeaturedProducts] Rate limited');
      } else if (err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))) {
        setError('Unable to connect to the server. Please check your internet connection.');
      } else {
        setError('Failed to load featured products. Please try again later.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // No localStorage caching: stock is volatile and per-browser caches diverged,
    // showing stale "Out of Stock" badges in one browser but not another.
    // Server already caches /products/featured.
    fetchProducts();
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

  const handleToggleWishlist = async (productId: string, e: React.MouseEvent, meta?: { name?: string; price?: number }) => {
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
        await addToWishlist(productId, meta);
        toast.success('Added to wishlist');
      }
    } catch (error: any) {
      if (error.message && error.message.includes('already in wishlist')) {
        try {
          await removeFromWishlist(productId);
          toast.success('Removed from wishlist');
        } catch {
          toast.error('Failed to update wishlist');
        }
      } else {
        toast.error('Failed to update wishlist');
      }
    }
  };

  if (loading) {
    return (
      <section className={`py-16 bg-obsidian border-y border-hairline ${className}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Curated For You</p>
            <h2 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-2">Featured Products</h2>
            <p className="text-ink/70 font-display">Popular products customers love to buy</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
            {[...Array(limit)].map((_, index) => (
              <ProductCardSkeleton key={index} />
            ))}
            <div className="bg-obsidian-raised rounded-lg animate-pulse min-h-100" />
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={`py-16 bg-obsidian border-y border-hairline ${className}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Curated For You</p>
            <h2 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-2">Featured Products</h2>
            <p className="text-ink/70 font-display">Popular products customers love to buy</p>
          </div>
          <div className="text-center py-12">
            <div className="text-red-400 font-display mb-4">{error}</div>
            <button
              onClick={() => fetchProducts()}
              className="px-6 py-3 bg-gold hover:opacity-90 text-obsidian rounded-sm font-display font-bold uppercase tracking-widest transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (products.length === 0) return null;

  return (
    <section className={`py-16 bg-obsidian border-y border-hairline ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-12">
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Curated For You</p>
          <h2 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-2">Featured Products</h2>
          <p className="text-ink/70 font-display max-w-2xl mx-auto">Popular products customers love to buy</p>
        </div>

        {/* Products Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
          {products.map((product) => {
            const url = productUrl(product, '/products');
            return (
            <Link key={product._id} href={url} className="group">
              <div className="bg-obsidian border border-hairline rounded-lg overflow-hidden hover:border-gold transition-all duration-300 h-full flex flex-col">
                {/* Product Image */}
                <div className="relative aspect-square bg-obsidian-raised overflow-hidden">
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
                      <div className="w-full h-full flex items-center justify-center bg-obsidian-raised">
                        <span className="text-ink-muted text-xs">No image</span>
                      </div>
                    )
                  )}

                  {/* Wishlist Button */}
                  <button
                    className="absolute top-2 right-2 p-1.5 bg-obsidian-raised rounded-full shadow-md hover:bg-gold/20 transition-colors opacity-0 group-hover:opacity-100"
                    onClick={(e) => handleToggleWishlist(product._id, e, { name: product.name, price: product.price })}
                  >
                    <Heart className={`h-4 w-4 transition-colors duration-200 ${
                      isInWishlist(product._id)
                        ? 'text-red-500 fill-current'
                        : 'text-ink/70'
                    }`} />
                  </button>

                  {/* Badges */}
                  {product.stock === 'out' && (
                    <div className="absolute top-2 left-2 bg-red-500 text-ink px-2 py-1 rounded text-xs font-semibold">
                      Out of Stock
                    </div>
                  )}
                  {product.stock !== 'out' && product.originalPrice && product.originalPrice > product.price && (
                    <div className="absolute top-2 left-2 bg-red-500 text-ink px-2 py-1 rounded text-xs font-bold">
                      Sale
                    </div>
                  )}
                </div>

                {/* Product Info */}
                <div className="p-4 flex flex-col flex-1">
                  {/* Product Name */}
                  <h3 className="font-display font-bold text-ink text-sm mb-2 line-clamp-2 group-hover:text-gold transition-colors uppercase tracking-wide">
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
                                ? 'text-gold fill-current'
                                : 'text-hairline'
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-ink/70">
                        ({product.averageRating.toFixed(1)})
                      </span>
                    </div>
                  )}

                  {/* Price */}
                  <div className="mb-3 mt-auto">
                    {product.originalPrice && product.originalPrice > product.price ? (
                      <div className="flex flex-col">
                        <p className="text-lg font-display font-bold text-gold">
                          {formatPrice(product.price)}
                        </p>
                        <p className="text-xs text-ink-muted line-through">
                          {formatPrice(product.originalPrice)}
                        </p>
                      </div>
                    ) : (
                      <p className="text-lg font-display font-bold text-gold">
                        {formatPrice(product.price)}
                      </p>
                    )}
                  </div>

                  {/* Add to Cart Button */}
                  <button
                    onClick={(e) => handleAddToCart(product._id, e)}
                    disabled={product.stock === 'out'}
                    className="w-full flex items-center justify-center gap-2 bg-gold hover:opacity-90 text-obsidian px-4 py-2 rounded-sm transition-colors disabled:bg-obsidian-raised disabled:text-ink-muted disabled:cursor-not-allowed font-display font-bold text-sm uppercase tracking-wider"
                  >
                    <ShoppingCart className="h-4 w-4" />
                    <span>{product.stock === 'out' ? 'Out of Stock' : 'Add to Cart'}</span>
                  </button>
                </div>
              </div>
            </Link>
            );
          })}

          {/* View All Card */}
          <Link
            href="/products?isFeatured=true"
            className="group block"
          >
            <div className="bg-gold hover:opacity-90 rounded-lg overflow-hidden transition-all duration-300 h-full flex flex-col items-center justify-center p-6 min-h-100">
              <div className="text-ink text-center">
                <div className="mb-4 flex items-center justify-center">
                  <div className="bg-obsidian/20 rounded-full p-4 group-hover:bg-obsidian/30 group-hover:scale-110 transition-all duration-300">
                    <ArrowRight className="h-12 w-12 text-ink group-hover:translate-x-1 transition-transform duration-300" />
                  </div>
                </div>
                <h3 className="text-xl font-display font-bold uppercase tracking-wide mb-2">View All</h3>
                <p className="text-sm text-ink/90 font-display">Featured Products</p>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </section>
  );
}
