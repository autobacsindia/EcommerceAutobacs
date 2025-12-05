'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ShoppingCart, Heart, ChevronRight } from 'lucide-react';
import apiClient from '@/lib/api';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils';
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
      <section className={`py-16 bg-white ${className}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {collections.map((collection, idx) => (
              <div key={idx} className="space-y-6">
                {/* Header skeleton */}
                <div className="mb-6">
                  <div className="h-8 bg-gray-200 rounded w-48 mb-2 animate-pulse" />
                  <div className="h-6 bg-gray-200 rounded w-32 animate-pulse" />
                </div>
                
                {/* Products skeleton */}
                {[...Array(productsPerCollection)].map((_, i) => (
                  <div key={i} className="bg-gray-50 rounded-lg overflow-hidden animate-pulse">
                    <div className="aspect-[4/3] bg-gray-200" />
                    <div className="p-4">
                      <div className="h-4 bg-gray-200 rounded mb-2" />
                      <div className="h-4 bg-gray-200 rounded w-2/3 mb-3" />
                      <div className="h-6 bg-gray-200 rounded w-1/2" />
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
    <section className={`py-16 bg-white ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Three Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {collections.map((collection, collectionIdx) => {
            const products = collectionsData[collection.title] || [];
            
            return (
              <div key={collectionIdx} className="space-y-6">
                {/* Collection Header */}
                <div className="mb-6">
                  <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">
                    {collection.title}
                  </h2>
                  <p className="text-xl text-gray-600">
                    {collection.subtitle}
                  </p>
                </div>

                {/* Products List */}
                {products.length > 0 ? (
                  <div className="space-y-6">
                    {products.map((product) => (
                      <Link
                        key={product._id}
                        href={`/products/${product._id}`}
                        className="group block"
                      >
                        <div className="bg-gray-50 rounded-lg overflow-hidden hover:shadow-lg transition-all duration-300">
                          {/* Compact Product Image - Reduced Size */}
                          <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden">
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
                                <div className="w-full h-full flex items-center justify-center bg-gray-100">
                                  <span className="text-gray-400 text-sm">No image</span>
                                </div>
                              )
                            )}
                            
                            {/* Wishlist Button - Smaller for compact view */}
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

                            {/* Sale Badge - Smaller */}
                            {product.originalPrice && product.originalPrice > product.price && (
                              <div className="absolute top-2 left-2 bg-red-500 text-white px-2 py-0.5 rounded-full text-xs font-bold">
                                SALE
                              </div>
                            )}
                          </div>

                          {/* Compact Product Info */}
                          <div className="p-4">
                            {/* Product Name - 2 lines max */}
                            <h3 className="font-semibold text-sm text-gray-900 mb-2 line-clamp-2 group-hover:text-blue-600 transition-colors min-h-[40px]">
                              {product.name}
                            </h3>

                            {/* Brand Tag - Compact */}
                            {product.brand && (
                              <span className="inline-block text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded mb-2">
                                {product.brand}
                              </span>
                            )}

                            {/* Price - Compact */}
                            <div className="mt-2">
                              {product.originalPrice && product.originalPrice > product.price ? (
                                <div>
                                  <p className="text-lg font-bold text-blue-600">
                                    {formatCurrency(product.price)}
                                  </p>
                                  <p className="text-xs text-gray-500 line-through">
                                    {formatCurrency(product.originalPrice)}
                                  </p>
                                </div>
                              ) : (
                                <p className="text-lg font-bold text-gray-900">
                                  {formatCurrency(product.price)}
                                </p>
                              )}
                            </div>

                            {/* Compact Add to Cart Button */}
                            <button
                              onClick={(e) => handleAddToCart(product._id, e)}
                              disabled={product.stock <= 0}
                              className="w-full mt-3 flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium"
                            >
                              <ShoppingCart className="h-4 w-4" />
                              <span>{product.stock <= 0 ? 'Out of Stock' : 'Add to Cart'}</span>
                            </button>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  /* Empty State */
                  <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <p className="text-gray-500 text-sm mb-3">
                      No products found
                    </p>
                    <Link
                      href="/products"
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-semibold text-sm"
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
                      className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold text-sm group"
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
