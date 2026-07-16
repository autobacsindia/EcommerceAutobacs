'use client';

import type { StockStatus } from '@/lib/stock';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ShoppingCart, Heart, ChevronRight, SlidersHorizontal } from 'lucide-react';
import apiClient from '@/lib/api';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCurrency } from '@/context/CurrencyContext';
import ProductImage from '@/components/products/ProductImage';
import { toast } from 'react-hot-toast';
import { productUrl } from '@/lib/types';

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
  stock: StockStatus;
  averageRating: number;
  slug?: string;
  productType?: 'simple' | 'variable' | 'grouped';
  priceMin?: number;
  priceMax?: number;
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

  const handleAddToCart = async (product: Product, e: React.MouseEvent) => {
    // Variable products can't be quick-added (a model must be picked): let the
    // click bubble to the wrapping card <Link> so it opens the PDP.
    if (product.productType === 'variable') return;
    e.preventDefault();
    toast.success('Added to cart!');
    try {
      await addToCart(product._id, 1);
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
      toast.error('Failed to update wishlist');
    }
  };

  // Loading skeleton
  if (loading) {
    return (
      <section className={`py-16 bg-obsidian-deep ${className}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-12">
            <div className="h-10 bg-obsidian-raised rounded w-64 mb-2 animate-pulse" />
            {subtitle && <div className="h-6 bg-obsidian-raised rounded w-96 animate-pulse" />}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[...Array(3)].map((_, index) => (
              <div key={index} className="bg-obsidian rounded-lg overflow-hidden animate-pulse">
                <div className="aspect-square bg-obsidian-raised" />
                <div className="p-6">
                  <div className="h-4 bg-obsidian-raised rounded mb-2" />
                  <div className="h-4 bg-obsidian-raised rounded w-2/3 mb-4" />
                  <div className="h-8 bg-obsidian-raised rounded w-1/2" />
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
      <section className={`py-16 bg-obsidian-deep ${className}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section Header */}
          <div className="mb-12">
            <h2 className="text-4xl md:text-5xl font-bold text-ink mb-3">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xl text-ink-muted">{subtitle}</p>
            )}
          </div>
          
          {/* Empty State */}
          <div className="text-center py-12 bg-obsidian rounded-lg">
            <p className="text-ink-muted text-lg mb-4">
              No products found {brand && `for brand "${brand}"`}{category && `in category "${category}"`}{searchKeyword && `for "${searchKeyword}"`}
            </p>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 text-gold hover:text-gold font-semibold"
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
    <section className={`py-16 bg-obsidian-deep ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="mb-12">
          <h2 className="text-4xl md:text-5xl font-bold text-ink mb-3">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xl text-ink-muted">{subtitle}</p>
          )}
        </div>
        
        {/* Products Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {products.map((product) => {
            const url = productUrl(product, '/products');
            return (
            <Link
              key={product._id}
              href={url}
              className="group"
            >
              <div className="bg-obsidian rounded-lg overflow-hidden hover:shadow-2xl transition-all duration-300 h-full flex flex-col">
                {/* Product Image */}
                <div className="relative aspect-square bg-obsidian-raised overflow-hidden">
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
                      <div className="w-full h-full flex items-center justify-center bg-obsidian-raised">
                        <span className="text-ink-muted">No image</span>
                      </div>
                    )
                  )}
                  
                  {/* Wishlist Button */}
                  <button
                    className="absolute top-4 right-4 p-2 bg-obsidian rounded-full shadow-lg hover:bg-obsidian-raised transition-colors opacity-0 group-hover:opacity-100"
                    onClick={(e) => handleToggleWishlist(product._id, e, { name: product.name, price: product.price })}
                  >
                    <Heart className={`h-5 w-5 transition-colors duration-200 ${
                      isInWishlist(product._id) 
                        ? 'text-red-500 fill-current' 
                        : 'text-ink-muted'
                    }`} />
                  </button>

                  {/* Sale Badge */}
                  {product.originalPrice && product.originalPrice > product.price && (
                    <div className="absolute top-4 left-4 bg-red-500 text-ink px-3 py-1 rounded-full text-sm font-bold">
                      SALE
                    </div>
                  )}
                </div>

                {/* Product Info */}
                <div className="p-6 flex-1 flex flex-col">
                  {/* Product Name */}
                  <h3 className="font-semibold text-lg text-ink mb-3 line-clamp-2 group-hover:text-gold transition-colors">
                    {product.name}
                  </h3>

                  {/* Brand/Category Tags */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {product.brand && (
                      <span className="text-xs px-2 py-1 bg-obsidian-raised text-ink-muted rounded">
                        {product.brand}
                      </span>
                    )}
                    {typeof product.category === 'object' && product.category?.name && (
                      <span className="text-xs px-2 py-1 bg-gold/10 text-gold rounded">
                        {product.category.name}
                      </span>
                    )}
                  </div>

                  {/* Price */}
                  <div className="mt-auto">
                    {product.productType === 'variable' ? (
                      <div className="mb-4">
                        <p className="text-2xl font-bold text-ink">
                          {(product.priceMax ?? product.price) > (product.priceMin ?? product.price) && (
                            <span className="text-xs uppercase tracking-[0.14em] text-ink-muted mr-1">From</span>
                          )}
                          {formatPrice(product.priceMin ?? product.price)}
                        </p>
                        <p className="text-xs text-ink-muted mt-1">(incl. taxes)</p>
                      </div>
                    ) : product.originalPrice && product.originalPrice > product.price ? (
                      <div className="mb-4">
                        <p className="text-2xl font-bold text-gold">
                          {formatPrice(product.price)}
                        </p>
                        <p className="text-sm text-ink-muted line-through">
                          Original price was: {formatPrice(product.originalPrice)}
                        </p>
                        <p className="text-sm text-ink-muted">
                          Current price is: {formatPrice(product.price)}
                        </p>
                        <p className="text-xs text-ink-muted mt-1">(incl. taxes)</p>
                      </div>
                    ) : (
                      <div className="mb-4">
                        <p className="text-2xl font-bold text-ink">
                          {formatPrice(product.price)}
                        </p>
                        <p className="text-xs text-ink-muted mt-1">(incl. taxes)</p>
                      </div>
                    )}

                    {/* Add to Cart / Select — variable products route to the PDP */}
                    <button
                      onClick={(e) => handleAddToCart(product, e)}
                      disabled={product.stock === 'out'}
                      className="w-full flex items-center justify-center gap-2 bg-gold text-obsidian px-6 py-3 rounded-lg hover:bg-gold transition-colors disabled:bg-obsidian-raised disabled:cursor-not-allowed font-medium"
                    >
                      {product.productType === 'variable' ? <SlidersHorizontal className="h-5 w-5" /> : <ShoppingCart className="h-5 w-5" />}
                      <span>{product.stock === 'out' ? 'Out of Stock' : product.productType === 'variable' ? 'Select model' : 'Add to Cart'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </Link>
            );
          })}
        </div>

        {/* View More Link */}
        <div className="mt-12 text-center">
          <Link
            href={brand ? `/products?brand=${brand}` : category ? `/products?category=${category}` : '/products'}
            className="inline-flex items-center gap-2 text-gold hover:text-gold font-semibold text-lg group"
          >
            <span>View All Products</span>
            <ChevronRight className="h-5 w-5 group-hover:translate-x-2 transition-transform" />
          </Link>
        </div>
      </div>
    </section>
  );
}
