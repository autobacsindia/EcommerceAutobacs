'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ShoppingCart, Heart, ChevronLeft, ChevronRight } from 'lucide-react';
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
  stock: number;
  averageRating: number;
}

interface CollectionConfig {
  title: string;
  subtitle?: string;
  searchKeyword: string;
  viewAllLink?: string;
  badge?: string;
  badgeColor?: string;
}

interface CuratedCollectionCarouselProps {
  collection: CollectionConfig;
  productsLimit?: number;
  className?: string;
}

export default function CuratedCollectionCarousel({
  collection,
  productsLimit = 10,
  className = ''
}: CuratedCollectionCarouselProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  const { addToCart } = useCart();
  const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const { isAuthenticated } = useAuth();
  const { formatPrice } = useCurrency();
  const router = useRouter();

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        params.append('search', collection.searchKeyword);
        params.append('limit', productsLimit.toString());
        params.append('page', '1');
        
        const response: any = await apiClient.get(`/products?${params.toString()}`);
        setProducts(response.products || []);
      } catch (error) {
        console.error(`Failed to fetch products for ${collection.title}:`, error);
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [collection.searchKeyword, collection.title, productsLimit]);

  useEffect(() => {
    checkScrollButtons();
  }, [products]);

  const checkScrollButtons = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      setCanScrollLeft(scrollLeft > 10);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
    }
  };

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const cardWidth = 220; // Approximate card width + gap
      const scrollAmount = cardWidth * 4; // Scroll 4 cards at a time
      const newScrollPosition = direction === 'left' 
        ? scrollContainerRef.current.scrollLeft - scrollAmount
        : scrollContainerRef.current.scrollLeft + scrollAmount;
      
      scrollContainerRef.current.scrollTo({
        left: newScrollPosition,
        behavior: 'smooth'
      });
      
      setTimeout(checkScrollButtons, 300);
    }
  };



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
    e.stopPropagation();
    
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

  const getBadgeStyles = () => {
    const baseClasses = "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider";
    
    switch (collection.badgeColor) {
      case 'red':
        return `${baseClasses} bg-red-600 text-white`;
      case 'orange':
        return `${baseClasses} bg-orange-600 text-white`;
      case 'blue':
        return `${baseClasses} bg-blue-600 text-white`;
      case 'green':
        return `${baseClasses} bg-green-600 text-white`;
      default:
        return `${baseClasses} bg-gray-900 text-white`;
    }
  };

  // Loading skeleton
  if (loading) {
    return (
      <section className={`py-4 ${className}`}>
        <div className="bg-white rounded-lg p-6">
          {/* Header skeleton */}
          <div className="flex items-center justify-between mb-4">
            <div className="h-6 bg-gray-200 rounded w-64 animate-pulse" />
            <div className="h-5 bg-gray-200 rounded w-20 animate-pulse" />
          </div>
          
          {/* Horizontal cards skeleton */}
          <div className="flex gap-4 overflow-hidden">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex-shrink-0 w-52 animate-pulse">
                <div className="aspect-square bg-gray-200 rounded mb-2" />
                <div className="h-4 bg-gray-200 rounded mb-2" />
                <div className="h-5 bg-gray-200 rounded w-1/2" />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (products.length === 0) {
    return null;
  }

  return (
    <section className={`py-4 ${className}`}>
      {/* Amazon India Style - Horizontal Scroll with Vertical Cards */}
      <div className="bg-white rounded-lg p-6">
        {/* Collection Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">
            {collection.title}
          </h2>
          
          {/* See All Link */}
          <Link
            href={collection.viewAllLink || `/products?search=${collection.searchKeyword}`}
            className="text-sm text-blue-600 hover:text-orange-600 hover:underline"
          >
            See all
          </Link>
        </div>

        {/* Horizontal Scrollable Container */}
        <div className="relative group">
          {/* Left Scroll Button */}
          {canScrollLeft && (
            <button
              onClick={() => scroll('left')}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white shadow-lg rounded-sm p-3 opacity-90 hover:opacity-100 transition-opacity"
              style={{ marginLeft: '-12px' }}
              aria-label="Scroll left"
            >
              <ChevronLeft className="h-8 w-8 text-gray-900" />
            </button>
          )}

          {/* Products Horizontal Scroll */}
          <div
            ref={scrollContainerRef}
            onScroll={checkScrollButtons}
            className="flex gap-4 overflow-x-auto scrollbar-hide scroll-smooth"
            style={{ 
              scrollbarWidth: 'none',
              msOverflowStyle: 'none'
            }}
          >
            {products.map((product) => {
              const url = productUrl(product, '/products');
              return (
              <Link
                key={product._id}
                href={url}
                className="group/card flex-shrink-0 w-52 hover:shadow-lg transition-shadow duration-200 rounded"
              >
                {/* Vertical Card Layout - Amazon Style */}
                <div className="relative">
                  {/* Large Product Image */}
                  <div className="relative aspect-square bg-gray-100 overflow-hidden rounded mb-2">
                    {product.images && (
                      Array.isArray(product.images) && product.images.length > 0 && product.images[0].url ? (
                        <ProductImage
                          src={product.images[0].url}
                          alt={product.images[0].alt || product.name}
                          className="object-cover w-full h-full group-hover/card:scale-105 transition-transform duration-300"
                        />
                      ) : typeof product.images === 'string' && product.images !== '' ? (
                        <ProductImage
                          src={product.images}
                          alt={product.name}
                          className="object-cover w-full h-full group-hover/card:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gray-100">
                          <span className="text-gray-400 text-xs">No image</span>
                        </div>
                      )
                    )}
                    
                    {/* Sale Badge */}
                    {product.originalPrice && product.originalPrice > product.price && (
                      <div className="absolute top-2 left-2 bg-red-600 text-white px-2 py-1 rounded-sm text-xs font-bold">
                        {Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}% off
                      </div>
                    )}

                    {/* Wishlist Button */}
                    <button
                      className="absolute top-2 right-2 p-1.5 bg-white rounded-full shadow-md hover:bg-gray-50 transition-colors"
                      onClick={(e) => handleToggleWishlist(product._id, e)}
                    >
                      <Heart className={`h-4 w-4 transition-colors duration-200 ${
                        isInWishlist(product._id) 
                          ? 'text-red-500 fill-current' 
                          : 'text-gray-600'
                      }`} />
                    </button>
                  </div>

                  {/* Product Info Below Image */}
                  <div>
                    {/* Product Name */}
                    <h3 className="text-sm text-gray-900 mb-1 line-clamp-2 min-h-[40px] group-hover/card:text-blue-600 transition-colors">
                      {product.name}
                    </h3>

                    {/* Price */}
                    <div className="mb-2">
                      {product.originalPrice && product.originalPrice > product.price ? (
                        <div>
                          <div className="flex items-baseline gap-2">
                            <span className="text-lg font-bold text-gray-900">
                              {formatPrice(product.price)}
                            </span>
                            <span className="text-xs text-gray-500 line-through">
                              {formatPrice(product.originalPrice)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-lg font-bold text-gray-900">
                          {formatPrice(product.price)}
                        </p>
                      )}
                    </div>

                    {/* Stock Warning */}
                    {product.stock > 0 && product.stock <= 5 && (
                      <p className="text-xs text-red-600 mb-2">
                        Only {product.stock} left in stock
                      </p>
                    )}

                    {/* Add to Cart Button - Amazon Orange Style */}
                    <button
                      onClick={(e) => handleAddToCart(product._id, e)}
                      disabled={product.stock <= 0}
                      className="w-full bg-yellow-400 hover:bg-yellow-500 text-gray-900 px-3 py-2 rounded-lg transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium shadow-sm"
                    >
                      {product.stock <= 0 ? 'Out of Stock' : 'Add to Cart'}
                    </button>
                  </div>
                </div>
              </Link>
              );
            })}

            {/* See All Card at the End */}
            <Link
              href={collection.viewAllLink || `/products?search=${collection.searchKeyword}`}
              className="flex-shrink-0 w-52 bg-linear-to-br from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 rounded flex items-center justify-center transition-all duration-200"
              style={{ minHeight: '380px' }}
            >
              <div className="text-center p-6">
                <ChevronRight className="h-12 w-12 text-blue-600 mx-auto mb-3" />
                <p className="text-base font-semibold text-blue-900 mb-1">See all offers</p>
                <p className="text-xs text-blue-700">View more products</p>
              </div>
            </Link>
          </div>

          {/* Right Scroll Button */}
          {canScrollRight && (
            <button
              onClick={() => scroll('right')}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-white shadow-lg rounded-sm p-3 opacity-90 hover:opacity-100 transition-opacity"
              style={{ marginRight: '-12px' }}
              aria-label="Scroll right"
            >
              <ChevronRight className="h-8 w-8 text-gray-900" />
            </button>
          )}
        </div>
      </div>

      {/* Hide scrollbar CSS */}
      <style jsx>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </section>
  );
}
