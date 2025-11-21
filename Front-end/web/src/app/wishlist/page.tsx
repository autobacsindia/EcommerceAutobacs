'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { ShoppingCart, Trash2, Heart } from 'lucide-react';

interface Product {
  _id: string;
  name: string;
  price: number;
  images?: { url: string }[];
  stock: number;
  isActive: boolean;
  averageRating: number;
}

interface WishlistItem {
  _id: string;
  product: Product;
  addedAt: string;
}

export default function WishlistPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { addToCart } = useCart();
  const { wishlistItems, loading, removeFromWishlist, fetchWishlist } = useWishlist();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, authLoading, router]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchWishlist();
    }
  }, [isAuthenticated, fetchWishlist]);

  const handleRemoveFromWishlist = async (productId: string) => {
    try {
      await removeFromWishlist(productId);
    } catch (err: any) {
      alert(err.message || 'Failed to remove item');
    }
  };

  const handleAddToCart = async (productId: string) => {
    try {
      await addToCart(productId, 1);
      alert('Added to cart!');
    } catch (err: any) {
      alert(err.message || 'Failed to add to cart');
    }
  };

  if (authLoading || loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center text-red-500">{error}</div>
      </div>
    );
  }

  if (wishlistItems.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="text-center">
          <Heart className="mx-auto h-16 w-16 text-gray-300 mb-4" />
          <h2 className="text-2xl font-bold text-gray-700 mb-2">Your wishlist is empty</h2>
          <p className="text-gray-500 mb-6">Save items you love for later</p>
          <button
            onClick={() => router.push('/products')}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700"
          >
            Browse Products
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">My Wishlist ({wishlistItems.length} items)</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {wishlistItems.map((item: any) => (
          <div key={item._id} className="border rounded-lg p-4 hover:shadow-lg transition">
            <div className="aspect-square bg-gray-100 rounded-lg mb-4 overflow-hidden">
              {item.product?.images && item.product.images[0] ? (
                <img
                  src={item.product.images[0].url}
                  alt={item.product.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400">
                  No image
                </div>
              )}
            </div>

            <h3 className="font-semibold text-lg mb-2">{item.product?.name || 'Product'}</h3>
            <p className="text-xl font-bold text-blue-600 mb-4">
              ₹{item.product?.price ? item.product.price.toFixed(2) : '0.00'}
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