'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart, Trash2, Heart } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatCurrency } from '@/lib/utils';
import EnhancedImage from '@/components/layout/EnhancedImage';

export default function WishlistPage() {
  const [wishlistItems, setWishlistItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }

    if (isAuthenticated) {
      fetchWishlist();
    }
  }, [isAuthenticated, authLoading]);

  const fetchWishlist = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get(API_ENDPOINTS.WISHLIST);
      setWishlistItems(response.wishlist?.items || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load wishlist');
    } finally {
      setLoading(false);
    }
  };

  const handleAddToCart = async (productId: string) => {
    try {
      await apiClient.post(API_ENDPOINTS.CART_ADD, { productId });
      // Optionally show a success message
    } catch (err: any) {
      console.error('Failed to add to cart:', err);
    }
  };

  const handleRemoveFromWishlist = async (productId: string) => {
    try {
      await apiClient.delete(API_ENDPOINTS.WISHLIST_REMOVE(productId));
      setWishlistItems(prev => prev.filter(item => item.product._id !== productId));
    } catch (err: any) {
      console.error('Failed to remove from wishlist:', err);
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
            onClick={fetchWishlist}
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
      <h1 className="text-3xl font-bold mb-8">My Wishlist ({wishlistItems.length} items)</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {wishlistItems.map((item: any) => (
          <div key={item._id} className="border rounded-lg p-4 hover:shadow-lg transition">
            <div className="aspect-square bg-gray-100 rounded-lg mb-4 overflow-hidden">
              <EnhancedImage
                src={getFirstImageUrl(item.product?.images)}
                alt={item.product?.name || 'Product'}
                width={300}
                height={300}
                className="w-full h-full object-cover"
                context="product"
              />
            </div>

            <h3 className="font-semibold text-lg mb-2">{item.product?.name || 'Product'}</h3>
            <p className="text-xl font-bold text-blue-600 mb-4">
              {formatCurrency(item.product?.price || 0)}
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => handleAddToCart(item.product._id)}
                disabled={item.product?.stock === 0}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <ShoppingCart className="h-4 w-4" />
                {item.product?.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
              </button>
              <button
                onClick={() => handleRemoveFromWishlist(item.product._id)}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 flex items-center justify-center"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}