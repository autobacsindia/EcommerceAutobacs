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

interface CollectionConfig {
  title: string;
  subtitle: string;
  searchKeyword: string;
  viewAllLink?: string;
}

interface ProductCollectionsRowProps {
  collections: CollectionConfig[];
  productsPerCollection?: number;
  className?: string;
}

export default function ProductCollectionsRow({
  collections,
  productsPerCollection = 3,
  className = ''
}: ProductCollectionsRowProps) {
  const [collectionsData, setCollectionsData] = useState<{ [key: string]: Product[] }>({});
  const [loading, setLoading] = useState(true);
  const { addToCart } = useCart();
  const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const { formatPrice } = useCurrency();

  useEffect(() => {
    const fetchAllCollections = async () => {
      try {
        setLoading(true);
        
        // Fetch products for each collection
        const promises = collections.map(async (collection) => {
          try {
            const params = new URLSearchParams();
            params.append('search', collection.searchKeyword);
            params.append('limit', productsPerCollection.toString());
            params.append('page', '1');
            
            const response: any = await apiClient.get(`/products?${params.toString()}`);
            return {
              key: collection.title,
              products: response.products || []
            };
          } catch (error) {
            console.error(`Failed to fetch products for ${collection.title}:`, error);
            return {
              key: collection.title,
              products: []
            };
          }
        });
        
        const results = await Promise.all(promises);
        
        // Convert array to object for easy lookup
        const data: { [key: string]: Product[] } = {};
        results.forEach(result => {
          data[result.key] = result.products;
        });
        
        setCollectionsData(data);
      } catch (error) {
        console.error('Failed to fetch collections:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAllCollections();
  }, [collections, productsPerCollection]);

  const handleAddToCart = async (product: Product, e: React.MouseEvent) => {
    // Variable products can't be quick-added — let the click bubble to the card
    // <Link> so it opens the PDP where a model is selected.
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
      <section className={`py-16 bg-obsidian ${className}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {collections.map((collection, idx) => (
              <div key={idx} className="space-y-6">
                {/* Header skeleton */}
                <div className="mb-6">
                  <div className="h-8 bg-obsidian-raised rounded w-48 mb-2 animate-pulse" />
                  <div className="h-6 bg-obsidian-raised rounded w-32 animate-pulse" />
                </div>
                
                {/* Products skeleton */}
                {[...Array(productsPerCollection)].map((_, i) => (
                  <div key={i} className="bg-obsidian-deep rounded-lg overflow-hidden animate-pulse">
                    <div className="aspect-[4/3] bg-obsidian-raised" />
                    <div className="p-4">
                      <div className="h-4 bg-obsidian-raised rounded mb-2" />
                      <div className="h-4 bg-obsidian-raised rounded w-2/3 mb-3" />
                      <div className="h-6 bg-obsidian-raised rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`py-16 bg-obsidian ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Three Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {collections.map((collection, collectionIdx) => {
            const products = collectionsData[collection.title] || [];
            
            return (
              <div key={collectionIdx} className="space-y-6">
                {/* Collection Header */}
                <div className="mb-6">
                  <h2 className="text-3xl md:text-4xl font-bold text-ink mb-2">
                    {collection.title}
                  </h2>
                  <p className="text-xl text-ink-muted">
                    {collection.subtitle}
                  </p>
                </div>

                {/* Products List */}
                {products.length > 0 ? (
                  <div className="space-y-6">
                    {products.map((product) => {
                      const url = productUrl(product, '/products');
                      return (
                      <Link
                        key={product._id}
                        href={url}
                        className="group block"
                      >
                        <div className="bg-obsidian-deep rounded-lg overflow-hidden hover:shadow-lg transition-all duration-300">
                          {/* Compact Product Image - Reduced Size */}
                          <div className="relative aspect-[4/3] bg-obsidian-raised overflow-hidden">
                            {product.images && (
                              Array.isArray(product.images) && product.images.length > 0 && product.images[0].url ? (
                                <ProductImage
                                  src={product.images[0].url}
                                  alt={product.images[0].alt || product.name}
                                  className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500"
                                />
                              ) : typeof product.images === 'string' && product.images !== '' ? (
                                <ProductImage
                                  src={product.images}
                                  alt={product.name}
                                  className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-obsidian-raised">
                                  <span className="text-ink-muted text-sm">No image</span>
                                </div>
                              )
                            )}
                            
                            {/* Wishlist Button - Smaller for compact view */}
                            <button
                              className="absolute top-2 right-2 p-1.5 bg-obsidian rounded-full shadow-md hover:bg-obsidian-raised transition-colors opacity-0 group-hover:opacity-100"
                              onClick={(e) => handleToggleWishlist(product._id, e)}
                            >
                              <Heart className={`h-4 w-4 transition-colors duration-200 ${
                                isInWishlist(product._id) 
                                  ? 'text-red-500 fill-current' 
                                  : 'text-ink-muted'
                              }`} />
                            </button>

                            {/* Sale Badge - Smaller */}
                            {product.originalPrice && product.originalPrice > product.price && (
                              <div className="absolute top-2 left-2 bg-red-500 text-ink px-2 py-0.5 rounded-full text-xs font-bold">
                                SALE
                              </div>
                            )}
                          </div>

                          {/* Compact Product Info */}
                          <div className="p-4">
                            {/* Product Name - 2 lines max */}
                            <h3 className="font-semibold text-sm text-ink mb-2 line-clamp-2 group-hover:text-gold transition-colors min-h-[40px]">
                              {product.name}
                            </h3>

                            {/* Brand Tag - Compact */}
                            {product.brand && (
                              <span className="inline-block text-xs px-2 py-0.5 bg-obsidian-raised text-ink-muted rounded mb-2">
                                {product.brand}
                              </span>
                            )}

                            {/* Price - Compact */}
                            <div className="mt-2">
                              {product.productType === 'variable' ? (
                                <p className="text-lg font-bold text-ink">
                                  {(product.priceMax ?? product.price) > (product.priceMin ?? product.price) && (
                                    <span className="text-xs uppercase tracking-[0.14em] text-ink-muted mr-1">From</span>
                                  )}
                                  {formatPrice(product.priceMin ?? product.price)}
                                </p>
                              ) : product.originalPrice && product.originalPrice > product.price ? (
                                <div>
                                  <p className="text-lg font-bold text-gold">
                                    {formatPrice(product.price)}
                                  </p>
                                  <p className="text-xs text-ink-muted line-through">
                                    {formatPrice(product.originalPrice)}
                                  </p>
                                </div>
                              ) : (
                                <p className="text-lg font-bold text-ink">
                                  {formatPrice(product.price)}
                                </p>
                              )}
                            </div>

                            {/* Compact Add to Cart / Select button */}
                            <button
                              onClick={(e) => handleAddToCart(product, e)}
                              disabled={product.stock === 'out'}
                              className="w-full mt-3 flex items-center justify-center gap-2 bg-gold text-obsidian px-4 py-2 rounded-lg hover:bg-gold transition-colors disabled:bg-obsidian-raised disabled:cursor-not-allowed text-sm font-medium"
                            >
                              {product.productType === 'variable' ? <SlidersHorizontal className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
                              <span>{product.stock === 'out' ? 'Out of Stock' : product.productType === 'variable' ? 'Select model' : 'Add to Cart'}</span>
                            </button>
                          </div>
                        </div>
                      </Link>
                      );
                    })}
                  </div>
                ) : (
                  /* Empty State */
                  <div className="text-center py-12 bg-obsidian-deep rounded-lg">
                    <p className="text-ink-muted text-sm mb-3">
                      No products found
                    </p>
                    <Link
                      href="/products"
                      className="inline-flex items-center gap-1 text-gold hover:text-gold font-semibold text-sm"
                    >
                      <span>Browse All</span>
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                )}

                {/* View All Link for each column */}
                {products.length > 0 && (
                  <div className="mt-6">
                    <Link
                      href={collection.viewAllLink || `/products?search=${collection.searchKeyword}`}
                      className="inline-flex items-center gap-2 text-gold hover:text-gold font-semibold text-sm group"
                    >
                      <span>View All</span>
                      <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
