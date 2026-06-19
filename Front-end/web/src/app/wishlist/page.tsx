'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShoppingCart, Trash2, Heart } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useCurrency } from '@/context/CurrencyContext';
import EnhancedImage from '@/components/layout/EnhancedImage';
import { productUrl } from '@/lib/types';
import { toast } from 'react-hot-toast';

export default function WishlistPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { wishlistItems, loading, removeFromWishlist, fetchWishlist } = useWishlist();
  const { formatPrice } = useCurrency();
  const { addToCart } = useCart();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) { router.push('/login'); return; }
    if (isAuthenticated) fetchWishlistWrapper();
  }, [isAuthenticated, authLoading]);

  const fetchWishlistWrapper = async () => {
    try { setError(null); await fetchWishlist(); }
    catch (err: any) { setError(err.message || 'Failed to load wishlist'); }
  };

  const handleAddToCart = async (productId: string) => {
    try { await addToCart(productId, 1); toast.success('Item added to cart'); }
    catch (err: any) { toast.error('Failed to add item to cart'); }
  };

  const handleRemoveFromWishlist = async (productId: string) => {
    try { await removeFromWishlist(productId); toast.success('Removed from wishlist'); }
    catch { toast.error('Failed to remove from wishlist'); }
  };

  const getFirstImageUrl = (images: any): string | null => {
    if (!images) return null;
    if (typeof images === 'string') return images;
    if (Array.isArray(images) && images.length > 0) {
      const first = images[0];
      if (typeof first === 'string') return first;
      if (first?.url) return first.url;
    }
    return null;
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#3B9EE8]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-6 text-center max-w-md mx-4">
          <Heart className="mx-auto h-12 w-12 text-red-400 mb-4" />
          <h2 className="text-xl font-condensed font-bold text-white uppercase tracking-wide mb-2">Error Loading Wishlist</h2>
          <p className="text-[#C4C4C4] font-body mb-4">{error}</p>
          <button
            onClick={fetchWishlistWrapper}
            className="bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-4 py-2 rounded-sm transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (wishlistItems.length === 0) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="text-center py-12">
          <Heart className="mx-auto h-16 w-16 text-[#252525] mb-4" />
          <h2 className="text-2xl font-condensed font-bold text-white uppercase tracking-wide mb-2">Your wishlist is empty</h2>
          <p className="text-[#C4C4C4] font-body mb-6">Add products to your wishlist to save them for later</p>
          <button
            onClick={() => router.push('/products')}
            className="bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors"
          >
            Browse Products
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080808] py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-1">Saved Items</p>
            <h1 className="text-3xl font-condensed font-bold text-white uppercase tracking-wide">My Wishlist</h1>
          </div>
          <span className="text-[#555555] font-body">({wishlistItems.length} items)</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {wishlistItems.map((item: any) => (
            <div key={item.product._id} className="bg-[#0E0E0E] border border-[#252525] rounded-lg hover:border-[#3B9EE8] transition-all duration-300 group">
              <div className="relative aspect-square bg-[#161616] rounded-t-lg overflow-hidden">
                <Link href={productUrl(item.product, '/products') || '/products'} className="block w-full h-full">
                  <EnhancedImage
                    src={getFirstImageUrl(item.product?.images)}
                    alt={item.product?.name || 'Product'}
                    width={300}
                    height={300}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    context="product"
                  />
                </Link>
                <button
                  onClick={() => handleRemoveFromWishlist(item.product._id)}
                  className="absolute top-2 right-2 p-2 bg-[#252525] rounded-full shadow-md hover:bg-red-500/20 hover:text-red-400 transition-colors z-10"
                  aria-label="Remove from wishlist"
                >
                  <Trash2 className="h-4 w-4 text-[#C4C4C4]" />
                </button>
              </div>

              <div className="p-4 flex flex-col">
                <Link href={productUrl(item.product, '/products') || '/products'} className="hover:text-[#3B9EE8] transition-colors">
                  <h3 className="font-condensed font-bold text-white uppercase tracking-wide mb-1 line-clamp-2">{item.product?.name || 'Product'}</h3>
                </Link>

                {item.product?.averageRating > 0 && (
                  <div className="flex items-center gap-1 mb-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <svg key={star} className={`h-4 w-4 ${star <= item.product?.averageRating ? 'text-[#EF9F27]' : 'text-[#252525]'}`} fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    ))}
                    <span className="text-xs text-[#C4C4C4] font-body">({item.product?.averageRating.toFixed(1)})</span>
                  </div>
                )}

                <p className="text-xl font-condensed font-bold text-[#3B9EE8] mb-4">
                  {formatPrice(item.product?.price || 0)}
                </p>

                <button
                  onClick={() => handleAddToCart(item.product._id)}
                  disabled={item.product?.stock === 'out'}
                  className="w-full bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-4 py-2 rounded-sm disabled:bg-[#252525] disabled:text-[#555555] disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors text-sm"
                >
                  <ShoppingCart className="h-4 w-4" />
                  {item.product?.stock === 'out' ? 'Out of Stock' : 'Add to Cart'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
