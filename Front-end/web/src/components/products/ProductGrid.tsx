'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShoppingCart, Heart, GitCompare } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useAuth } from '@/context/AuthContext';
import { useCurrency } from '@/context/CurrencyContext';
import ProductImage from '@/components/products/ProductImage';
import { toast } from 'react-hot-toast';
import { ProductGridSkeleton } from '@/components/skeletons/ProductCardSkeleton';
import ProductCard from './ProductCard';

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
  loading?: boolean;
}

export default function ProductGrid({ products, loading }: ProductGridProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Get currently compared products from URL
  const comparedProductIds = searchParams.get('compare')?.split(',') || [];

  if (loading) {
    return <ProductGridSkeleton count={8} />;
  }

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
        toast.error('You can only compare up to 4 products at a time.');
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
      toast.error('Please select at least 2 products to compare.');
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
      
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
        {products.map((product) => (
          <ProductCard
            key={product._id}
            product={product as any}
            isCompared={comparedProductIds.includes(product._id)}
            onToggleCompare={toggleCompare}
          />
        ))}
      </div>
    </div>
  );
}
