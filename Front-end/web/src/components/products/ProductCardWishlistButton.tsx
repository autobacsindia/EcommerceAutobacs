'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useWishlist } from '@/context/WishlistContext';
import { toast } from 'react-hot-toast';
import { cn } from '@/lib/utils';

export default function ProductCardWishlistButton({ productId }: { productId: string }) {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const [animating, setAnimating] = useState(false);

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    setAnimating(true);
    try {
      if (isInWishlist(productId)) {
        await removeFromWishlist(productId);
        toast.success('Removed from wishlist');
      } else {
        await addToWishlist(productId);
        toast.success('Added to wishlist');
      }
    } catch (error: any) {
      if (error.message?.includes('already in wishlist')) {
        try {
          await removeFromWishlist(productId);
          toast.success('Removed from wishlist');
        } catch {
          toast.error('Failed to update wishlist');
        }
      } else if (error.message === 'ITEM_REMOVED') {
        toast.success('Removed from wishlist');
      } else {
        toast.error('Failed to update wishlist');
      }
    } finally {
      setTimeout(() => setAnimating(false), 300);
    }
  };

  return (
    <button
      className={cn(
        'absolute top-2 right-2 p-2 bg-obsidian-raised rounded-full hover:bg-gold/20 transition-colors',
        animating && 'animate-pulse'
      )}
      onClick={handleToggle}
    >
      <Heart
        className={cn(
          'h-5 w-5 transition-colors duration-200',
          isInWishlist(productId) ? 'text-red-500 fill-current' : 'text-ink-muted'
        )}
      />
    </button>
  );
}
