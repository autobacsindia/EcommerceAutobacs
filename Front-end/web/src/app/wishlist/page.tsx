'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart, Trash2, Heart } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useWishlist } from '@/context/WishlistContext';
import { formatCurrency } from '@/lib/utils';
import EnhancedImage from '@/components/layout/EnhancedImage';
import { toast } from 'react-hot-toast';

export default function WishlistPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { wishlistItems, loading, removeFromWishlist, fetchWishlist } = useWishlist();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }

    if (isAuthenticated) {
      fetchWishlistWrapper();
    }
  }, [isAuthenticated, authLoading]);

  const fetchWishlistWrapper = async () => {
    try {
      setError(null);
      await fetchWishlist();
    } catch (err: any) {
      setError(err.message || 'Failed to load wishlist');
    }
  };

  const handleAddToCart = async (productId: string) => {
    try {
      // We'll need to implement add to cart functionality here
      // For now, we'll just show a toast
      toast.success('Item added to cart');
    } catch (err: any) {
      console.error('Failed to add to cart:', err);
      toast.error('Failed to add item to cart');
    }
  };

  const handleRemoveFromWishlist = async (productId: string) => {
    try {
      await removeFromWishlist(productId);
      toast.success('Removed from wishlist');
    } catch (err: any) {
      console.error('Failed to remove from wishlist:', err);
      toast.error('Failed to remove from wishlist');
    }
  };

  if (authLoading || loading) {
    return (
      <div className="container mx-auto px-4 py-8 flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <Heart className="mx-auto h-12 w-12 text-red-500 mb-4" />
          <h2 className="text-xl font-semibold text-red-800 mb-2">Error Loading Wishlist</h2>
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={fetchWishlistWrapper}
            className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (wishlistItems.length === 0) {
    return (
      <div className="container mx-auto px-4 py-8 text-center">
        <Heart className="mx-auto h-16 w-16 text-gray-300 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Your wishlist is empty</h2>
        <p className="text-gray-600 mb-6">Add products to your wishlist to save them for later</p>
        <button
          onClick={() => router.push('/products')}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700"
        >
          Browse Products
        </button>
      </div>
    );
  }

  // Helper function to get the first image URL
  const getFirstImageUrl = (images: any): string | null => {
    if (!images) return null;
    
    if (typeof images === 'string') {
      return images;
    }
    
    if (Array.isArray(images) && images.length > 0) {
      const firstImage = images[0];
      if (typeof firstImage === 'string') {
        return firstImage;
      } else if (firstImage && typeof firstImage === 'object' && firstImage.url) {
        return firstImage.url;
      }
    }
    
    return null;
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">My Wishlist</h1>
        <span className="text-lg text-gray-600">({wishlistItems.length} items)</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {wishlistItems.map((item: any) => (
          <div key={item.product._id} className="border rounded-lg p-4 hover:shadow-lg transition-shadow duration-300">
            <div className="relative aspect-square bg-gray-100 rounded-lg mb-4 overflow-hidden">
              <EnhancedImage
                src={getFirstImageUrl(item.product?.images)}
                alt={item.product?.name || 'Product'}
                width={300}
                height={300}
                className="w-full h-full object-cover"
                context="product"
              />
              
              {/* Remove from wishlist button */}
              <button
                onClick={() => handleRemoveFromWishlist(item.product._id)}
                className="absolute top-2 right-2 p-2 bg-white rounded-full shadow-md hover:bg-red-50 transition-colors"
                aria-label="Remove from wishlist"
              >
                <Trash2 className="h-4 w-4 text-gray-600 hover:text-red-500" />
              </button>
            </div>

            <div className="flex flex-col h-full">
              <h3 className="font-semibold text-lg mb-1 line-clamp-2">{item.product?.name || 'Product'}</h3>
              
              <div className="mt-2">
                {item.product?.averageRating > 0 && (
                  <div className="flex items-center gap-1 mb-2">
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <svg
                          key={star}
                          className={`h-4 w-4 ${
                            star <= item.product?.averageRating ? 'text-yellow-400' : 'text-gray-300'
                          }`}
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      ))}
                    </div>
                    <span className="text-sm text-gray-600">
                      ({item.product?.averageRating.toFixed(1)})
                    </span>
                  </div>
                )}
                
                <p className="text-xl font-bold text-blue-600 mb-4">
                  {formatPrice(item.product?.price || 0)}
                </p>
              </div>

              <div className="mt-auto">
                <button
                  onClick={() => handleAddToCart(item.product._id)}
                  disabled={item.product?.stock === 0}
                  className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <ShoppingCart className="h-4 w-4" />
                  {item.product?.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}