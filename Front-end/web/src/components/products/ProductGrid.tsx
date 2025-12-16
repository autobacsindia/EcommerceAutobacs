'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShoppingCart, Heart, GitCompare } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency } from '@/lib/utils';
import ProductImage from '@/components/products/ProductImage';
import { toast } from 'react-hot-toast';

interface ProductImage {
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
  images: ProductImage[] | string;
  category?: { 
    name: string;
  } | string;
  categories?: Array<{ 
    _id: string;
    name: string;
    slug: string;
  }>;
  stock: number;
  averageRating: number;
  isFeatured?: boolean;
  isNew?: boolean;
  __v?: number;
}

interface ProductGridProps {
  products: Product[];
}

export default function ProductGrid({ products }: ProductGridProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToCart } = useCart();
  const { isAuthenticated } = useAuth();
  const { isInWishlist, addToWishlist, removeFromWishlist, wishlistItems } = useWishlist();
  const [animatingItems, setAnimatingItems] = useState<Record<string, boolean>>({});

  // Get currently compared products from URL
  const comparedProductIds = searchParams.get('compare')?.split(',') || [];

  const handleAddToCart = async (productId: string) => {
    try {
      await addToCart(productId, 1);
    } catch (error) {
      console.error('Failed to add to cart:', error);
    }
  };

  const handleToggleWishlist = async (productId: string, e: React.MouseEvent) => {
    e.preventDefault();
    
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    // Trigger animation
    setAnimatingItems(prev => ({ ...prev, [productId]: true }));
    
    try {
      if (isInWishlist(productId)) {
        await removeFromWishlist(productId);
        toast.success('Removed from wishlist');
      } else {
        await addToWishlist(productId);
        toast.success('Added to wishlist');
      }
    } catch (error: any) {
      // Check if it's the "already in wishlist" error
      if (error.message && error.message.includes('already in wishlist')) {
        // If product is already in wishlist, remove it
        try {
          await removeFromWishlist(productId);
          toast.success('Removed from wishlist');
        } catch (removeError) {
          console.error('Failed to remove from wishlist:', removeError);
          toast.error('Failed to update wishlist');
        }
      } else if (error.message === 'ITEM_REMOVED') {
        // Special case: item was removed in the addToWishlist function
        toast.success('Removed from wishlist');
      } else {
        console.error('Failed to toggle wishlist:', error);
        toast.error('Failed to update wishlist');
      }
    } finally {
      // Remove animation after delay
      setTimeout(() => {
        setAnimatingItems(prev => {
          const newState = { ...prev };
          delete newState[productId];
          return newState;
        });
      }, 300);
    }
  };

  const toggleCompare = (productId: string) => {
    const currentParams = new URLSearchParams(searchParams.toString());
    const compareList = [...comparedProductIds];
    
    if (compareList.includes(productId)) {
      // Remove from comparison
      const index = compareList.indexOf(productId);
      compareList.splice(index, 1);
    } else {
      // Add to comparison (limit to 4 products)
      if (compareList.length >= 4) {
        alert('You can only compare up to 4 products at a time.');
        return;
      }
      compareList.push(productId);
    }
    
    if (compareList.length > 0) {
      currentParams.set('compare', compareList.join(','));
    } else {
      currentParams.delete('compare');
    }
    
    // Update URL without reloading the page
    const newUrl = `${window.location.pathname}?${currentParams.toString()}`;
    window.history.replaceState({}, '', newUrl);
  };

  const viewComparison = () => {
    if (comparedProductIds.length < 2) {
      alert('Please select at least 2 products to compare.');
      return;
    }
    router.push(`/compare?ids=${comparedProductIds.join(',')}`);
  };

  return (
    <div>
      {/* Compare Bar */}
      {comparedProductIds.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center">
            <GitCompare className="h-5 w-5 text-blue-600 mr-2" />
            <span className="text-blue-800 font-medium">
              {comparedProductIds.length} product{comparedProductIds.length !== 1 ? 's' : ''} selected for comparison
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const currentParams = new URLSearchParams(searchParams.toString());
                currentParams.delete('compare');
                const newUrl = `${window.location.pathname}?${currentParams.toString()}`;
                window.history.replaceState({}, '', newUrl);
              }}
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              Clear
            </button>
            <button
              onClick={viewComparison}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
            >
              Compare Now
            </button>
          </div>
        </div>
      )}
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {products.map((product) => (
          <div
            key={product._id}
            className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-shadow group"
          >
            {/* Product Image */}
            <Link href={`/products/${product._id}`} className="block relative h-48 bg-gray-200">
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
              <div className="absolute top-2 left-2">
                <label className="flex items-center bg-white rounded-full p-1 shadow-md cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={comparedProductIds.includes(product._id)}
                    onChange={() => toggleCompare(product._id)}
                  />
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${comparedProductIds.includes(product._id) ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
                    {comparedProductIds.includes(product._id) && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path>
                      </svg>
                    )}
                  </div>
                  <span className="ml-1 text-xs font-medium text-gray-700 pr-2">Compare</span>
                </label>
              </div>
              
              {/* Wishlist Button */}
              <button
                className={`absolute top-2 right-2 p-2 bg-white rounded-full shadow-md hover:bg-gray-100 transition-colors ${
                  animatingItems[product._id] ? 'animate-pulse' : ''
                }`}
                onClick={(e) => handleToggleWishlist(product._id, e)}
              >
                <Heart className={`h-5 w-5 transition-colors duration-200 ${
                  isInWishlist(product._id) 
                    ? 'text-red-500 fill-current' 
                    : 'text-gray-600'
                }`} />
              </button>

              {/* Badges */}
              <div className="absolute top-10 left-2 flex gap-1">
                {product.stock <= 0 && (
                  <div className="bg-red-500 text-white px-2 py-1 rounded text-xs font-semibold">
                    Out of Stock
                  </div>
                )}
                {product.isNew && product.stock > 0 && (
                  <div className="bg-green-500 text-white px-2 py-1 rounded text-xs font-semibold">
                    New
                  </div>
                )}
                {product.originalPrice && product.originalPrice > product.price && (
                  <div className="bg-red-500 text-white px-2 py-1 rounded text-xs font-semibold">
                    Sale
                  </div>
                )}
                {product.isFeatured && product.stock > 0 && product.originalPrice && product.originalPrice <= product.price && (
                  <div className="bg-blue-500 text-white px-2 py-1 rounded text-xs font-semibold">
                    Popular
                  </div>
                )}
              </div>
            </Link>

            {/* Product Info */}
            <div className="p-4">
              {/* Category */}
              <p className="text-xs text-gray-500 uppercase mb-1">
                {product.categories && product.categories.length > 0 ? (
                  product.categories[0].name === 'Suspension' ? 'SUSPENSION' : product.categories[0].name
                ) : typeof product.category === 'object' && product.category !== null ? (
                  (product.category as { name: string }).name === 'Suspension' ? 'SUSPENSION' : (product.category as { name: string }).name
                ) : typeof product.category === 'string' ? product.category : 'Uncategorized'}
              </p>

              {/* Product Name */}
              <Link href={`/products/${product._id}`}>
                <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2 hover:text-blue-600">
                  {product.name}
                </h3>
              </Link>

              {/* Rating */}
              {product.averageRating > 0 && (
                <div className="flex items-center gap-1 mb-2">
                  <div className="flex">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <svg
                        key={star}
                        className={`h-4 w-4 ${
                          star <= product.averageRating ? 'text-yellow-400' : 'text-gray-300'
                        }`}
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
                        {formatCurrency(product.price)}
                      </p>
                      <p className="text-sm text-gray-500 line-through">
                        {formatCurrency(product.originalPrice)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-2xl font-bold text-blue-600">
                      {formatCurrency(product.price)}
                    </p>
                  )}
                </div>

                <button
                  onClick={() => handleAddToCart(product._id)}
                  disabled={product.stock <= 0}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  <ShoppingCart className="h-4 w-4" />
                  <span className="text-sm font-medium">Add</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}