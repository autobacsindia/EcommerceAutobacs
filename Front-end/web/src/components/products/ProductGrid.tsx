'use client';

import Link from 'next/link';
import { ShoppingCart, Heart } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { formatCurrency } from '@/lib/utils';
import ProductImage from '@/components/products/ProductImage';

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
  images: ProductImage[] | string;
  category: { 
    name: string;
  } | string;
  stock: number;
  averageRating: number;
  __v?: number;
}

interface ProductGridProps {
  products: Product[];
}

export default function ProductGrid({ products }: ProductGridProps) {
  const { addToCart } = useCart();

  const handleAddToCart = async (productId: string) => {
    try {
      await addToCart(productId, 1);
    } catch (error) {
      console.error('Failed to add to cart:', error);
    }
  };

  return (
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
            
            {/* Wishlist Button */}
            <button
              className="absolute top-2 right-2 p-2 bg-white rounded-full shadow-md hover:bg-gray-100 transition-colors"
              onClick={(e) => {
                e.preventDefault();
                // TODO: Add to wishlist
              }}
            >
              <Heart className="h-5 w-5 text-gray-600" />
            </button>

            {/* Stock Badge */}
            {product.stock <= 0 && (
              <div className="absolute top-2 left-2 bg-red-500 text-white px-2 py-1 rounded text-xs font-semibold">
                Out of Stock
              </div>
            )}
          </Link>

          {/* Product Info */}
          <div className="p-4">
            {/* Category */}
            <p className="text-xs text-gray-500 uppercase mb-1">
              {typeof product.category === 'object' && product.category !== null ? product.category.name : typeof product.category === 'string' ? product.category : 'Uncategorized'}
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
                <p className="text-2xl font-bold text-blue-600">
                  {formatCurrency(product.price)}
                </p>
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
  );
}