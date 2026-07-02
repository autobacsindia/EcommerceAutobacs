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
import Eyebrow from '@/components/ui/Eyebrow';
import Reveal from '@/components/ui/Reveal';

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
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
        <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-6 text-center max-w-md mx-4">
          <Heart className="mx-auto h-12 w-12 text-red-400 mb-4" />
          <h2 className="text-xl font-display font-light text-ink tracking-[-0.01em] mb-2">Error Loading Wishlist</h2>
          <p className="text-ink/70 font-display mb-4">{error}</p>
          <button
            onClick={fetchWishlistWrapper}
            className="bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest px-4 py-2 rounded-sm transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (wishlistItems.length === 0) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
        <div className="text-center py-12 px-6">
          <Heart className="mx-auto h-16 w-16 text-hairline mb-8" strokeWidth={1} />
          <Eyebrow className="mb-4">Saved Items</Eyebrow>
          <h2 className="text-[clamp(32px,5vw,52px)] font-light leading-tight text-ink mb-4">Your wishlist is empty</h2>
          <p className="text-ink-muted font-display font-light mb-8">Save products you love to find them here later.</p>
          <button
            onClick={() => router.push('/products')}
            className="inline-flex items-center gap-2.5 bg-gold text-obsidian font-display text-[10px] font-semibold uppercase tracking-[0.2em] px-7 py-4 transition-opacity hover:opacity-90"
          >
            Browse Products
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-obsidian-deep py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="flex flex-wrap items-end justify-between gap-4 mb-10">
          <div>
            <Eyebrow>Saved Items</Eyebrow>
            <h1 className="mt-4 text-[clamp(34px,5vw,60px)] font-light leading-[0.95] tracking-[-0.01em] text-ink">My Wishlist</h1>
          </div>
          <span className="font-display text-[13px] tracking-[0.04em] text-ink-muted"><span className="text-ink">{wishlistItems.length}</span> item{wishlistItems.length !== 1 ? 's' : ''}</span>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {wishlistItems.map((item: any) => (
            <div key={item.product._id} className="bg-obsidian border border-hairline rounded-lg hover:border-gold transition-all duration-300 group">
              <div className="relative aspect-square bg-obsidian-raised rounded-t-lg overflow-hidden">
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
                  className="absolute top-2 right-2 p-2 bg-obsidian-raised rounded-full shadow-md hover:bg-red-500/20 hover:text-red-400 transition-colors z-10"
                  aria-label="Remove from wishlist"
                >
                  <Trash2 className="h-4 w-4 text-ink/70" />
                </button>
              </div>

              <div className="p-4 flex flex-col">
                <Link href={productUrl(item.product, '/products') || '/products'} className="hover:text-gold transition-colors">
                  <h3 className="font-display font-light text-ink tracking-[-0.01em] mb-1 line-clamp-2">{item.product?.name || 'Product'}</h3>
                </Link>

                {item.product?.averageRating > 0 && (
                  <div className="flex items-center gap-1 mb-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <svg key={star} className={`h-4 w-4 ${star <= item.product?.averageRating ? 'text-gold' : 'text-hairline'}`} fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    ))}
                    <span className="text-xs text-ink/70 font-display">({item.product?.averageRating.toFixed(1)})</span>
                  </div>
                )}

                <p className="text-xl font-display font-bold text-gold mb-4">
                  {formatPrice(item.product?.price || 0)}
                </p>

                <button
                  onClick={() => handleAddToCart(item.product._id)}
                  disabled={item.product?.stock === 'out'}
                  className="w-full bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest px-4 py-2 rounded-sm disabled:bg-obsidian-raised disabled:text-ink-muted disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors text-sm"
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
