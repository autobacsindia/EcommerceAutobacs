'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShoppingCart, Heart } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useAuth } from '@/context/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import ProductImage from '@/components/products/ProductImage';
import { toast } from 'react-hot-toast';
import { Product, productUrl } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ProductCardProps {
  product: Product;
  isCompared?: boolean;
  onToggleCompare?: (id: string) => void;
  className?: string;
}

export default function ProductCard({ 
  product, 
  isCompared = false, 
  onToggleCompare,
  className 
}: ProductCardProps) {
  const router = useRouter();
  const { formatPrice } = useCurrency();
  const { addToCart } = useCart();
  const { isAuthenticated } = useAuth();
  const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const [animating, setAnimating] = useState(false);

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent navigation if clicked inside a Link
    e.stopPropagation();

    if (!isAuthenticated) {
      toast.error('Please log in to add items to cart');
      router.push('/login');
      return;
    }

    try {
      await addToCart(product._id, 1);
      toast.success('Added to cart');
    } catch (error: any) {
      console.error('Failed to add to cart:', error);
      toast.error(error.message || 'Failed to add to cart');
    }
  };

  const handleToggleWishlist = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    setAnimating(true);
    
    try {
      if (isInWishlist(product._id)) {
        await removeFromWishlist(product._id);
        toast.success('Removed from wishlist');
      } else {
        await addToWishlist(product._id);
        toast.success('Added to wishlist');
      }
    } catch (error: any) {
       if (error.message && error.message.includes('already in wishlist')) {
        try {
          await removeFromWishlist(product._id);
          toast.success('Removed from wishlist');
        } catch (removeError) {
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

  const url = productUrl(product);  // null = product has no slug yet (rare post-migration)

  return (
    <div className={cn("bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-shadow group", className)}>
      {url ? (
        <Link href={url} className="block relative h-48 bg-gray-200">
        {product.images && (
          Array.isArray(product.images) && product.images.length > 0 && product.images[0].url ? (
            <ProductImage
              src={product.images[0].url}
              alt={product.images[0].alt || product.name}
              className="object-cover w-full h-full"
            />
          ) : typeof product.images === 'string' && product.images !== '' ? (
            <ProductImage
              src={product.images}
              alt={product.name}
              className="object-cover w-full h-full"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-100">
              <span className="text-gray-400">No image available</span>
            </div>
          )
        )}
        
        {/* Compare Checkbox */}
        {onToggleCompare && (
            <div className="absolute top-2 left-2" onClick={(e) => e.stopPropagation()}>
                <label className="flex items-center bg-white rounded-full p-1 shadow-md cursor-pointer">
                <input
                    type="checkbox"
                    className="sr-only"
                    checked={isCompared}
                    onChange={() => onToggleCompare(product._id)}
                />
                <div className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                    isCompared ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                )}>
                    {isCompared && (
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path>
                    </svg>
                    )}
                </div>
                <span className="ml-1 text-xs font-medium text-gray-700 pr-2">Compare</span>
                </label>
            </div>
        )}
        
        {/* Wishlist Button */}
        <button
          className={cn(
              "absolute top-2 right-2 p-2 bg-white rounded-full shadow-md hover:bg-gray-100 transition-colors",
              animating ? 'animate-pulse' : ''
          )}
          onClick={handleToggleWishlist}
        >
          <Heart className={cn(
              "h-5 w-5 transition-colors duration-200",
              isInWishlist(product._id) ? 'text-red-500 fill-current' : 'text-gray-600'
          )} />
        </button>

        {/* Badges */}
        <div className="absolute top-10 left-2 flex gap-1 flex-wrap">
          {product.stock <= 0 && (
            <div className="bg-red-500 text-white px-2 py-1 rounded text-xs font-semibold">
              Out of Stock
            </div>
          )}
          {product.stock > 0 && (product as any).isNew && ( 
            <div className="bg-green-500 text-white px-2 py-1 rounded text-xs font-semibold">
              New
            </div>
          )}
          {product.originalPrice && product.originalPrice > product.price && (
            <div className="bg-red-500 text-white px-2 py-1 rounded text-xs font-semibold">
              {Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}% OFF
            </div>
          )}
          {product.isFeatured && product.stock > 0 && product.originalPrice && product.originalPrice <= product.price && (
            <div className="bg-blue-500 text-white px-2 py-1 rounded text-xs font-semibold">
              Popular
            </div>
          )}
        </div>
      </Link>
      ) : (
        <div className="relative h-48 bg-gray-200">
          {product.images && (
            Array.isArray(product.images) && product.images.length > 0 && product.images[0].url ? (
              <ProductImage
                src={product.images[0].url}
                alt={product.images[0].alt || product.name}
                className="object-cover w-full h-full"
              />
            ) : typeof product.images === 'string' && product.images !== '' ? (
              <ProductImage
                src={product.images}
                alt={product.name}
                className="object-cover w-full h-full"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-100">
                <span className="text-gray-400">No image available</span>
              </div>
            )
          )}
        </div>
      )}

      {/* Product Info */}
      <div className="p-4">
        <p className="text-xs text-gray-500 uppercase mb-1">
          {product.categories && product.categories.length > 0 ? (
            product.categories[0].name.toUpperCase()
          ) : typeof product.category === 'object' && product.category !== null ? (
            (product.category as any).name?.toUpperCase() || 'UNCATEGORIZED'
          ) : typeof product.category === 'string' ? product.category.toUpperCase() : 'UNCATEGORIZED'}
        </p>

        {/* Product Name */}
        {url ? (
          <Link href={url}>
            <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2 hover:text-blue-600">
              {product.name}
            </h3>
          </Link>
        ) : (
          <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2">
            {product.name}
          </h3>
        )}

        {/* Rating */}
        {product.averageRating > 0 && (
          <div className="flex items-center gap-1 mb-2">
            <div className="flex">
              {[1, 2, 3, 4, 5].map((star) => (
                <svg
                  key={star}
                  className={cn("h-4 w-4", star <= product.averageRating ? 'text-yellow-400' : 'text-gray-300')}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
            </div>
            <span className="text-sm text-gray-600">
              ({product.averageRating.toFixed(1)})
            </span>
          </div>
        )}

        {/* Price and Actions */}
        <div className="flex items-center justify-between mt-4">
          <div>
            {product.originalPrice && product.originalPrice > product.price ? (
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold text-blue-600">
                  {formatPrice(product.price)}
                </p>
                <p className="text-sm text-gray-500 line-through">
                  {formatPrice(product.originalPrice)}
                </p>
              </div>
            ) : (
              <p className="text-2xl font-bold text-blue-600">
                {formatPrice(product.price)}
              </p>
            )}
          </div>

          <button
            onClick={handleAddToCart}
            disabled={product.stock <= 0}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            <ShoppingCart className="h-4 w-4" />
            <span className="text-sm font-medium">Add</span>
          </button>
        </div>
      </div>
    </div>
  );
}
