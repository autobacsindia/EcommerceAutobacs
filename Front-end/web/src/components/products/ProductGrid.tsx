'use client';

import type { StockStatus } from '@/lib/stock';
import { useRouter, useSearchParams } from 'next/navigation';
import { GitCompare } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { ProductGridSkeleton } from '@/components/skeletons/ProductCardSkeleton';
import ProductCard from './ProductCard';

interface ProductGridImage {
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
  images: ProductGridImage[] | string;
  category?: { 
    name: string;
  } | string;
  categories?: Array<{ 
    _id: string;
    name: string;
    slug: string;
  }>;
  stock: StockStatus;
  averageRating: number;
  isFeatured?: boolean;
  isNew?: boolean;
  __v?: number;
}

interface ProductGridProps {
  products: Product[];
  loading?: boolean;
}

function getThumbUrl(images: ProductGridImage[] | string): string {
  if (typeof images === 'string') return images;
  if (Array.isArray(images) && images.length > 0) return images[0].url;
  return '';
}

export default function ProductGrid({ products, loading }: ProductGridProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const comparedProductIds = searchParams.get('compare')?.split(',').filter(Boolean) || [];
  const comparedProducts = comparedProductIds
    .map(id => products.find(p => p._id === id))
    .filter(Boolean) as Product[];

  if (loading) {
    return <ProductGridSkeleton count={8} />;
  }

  const updateCompareParam = (list: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    if (list.length > 0) params.set('compare', list.join(','));
    else params.delete('compare');
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  };

  const toggleCompare = (productId: string) => {
    const list = [...comparedProductIds];
    const idx = list.indexOf(productId);
    if (idx !== -1) {
      list.splice(idx, 1);
    } else {
      if (list.length >= 4) {
        toast.error('You can only compare up to 4 products at a time.');
        return;
      }
      list.push(productId);
    }
    updateCompareParam(list);
  };

  const viewComparison = () => {
    if (comparedProductIds.length < 2) {
      toast.error('Please select at least 2 products to compare.');
      return;
    }
    router.push(`/compare?ids=${comparedProductIds.join(',')}`);
  };

  return (
    <div className={comparedProductIds.length > 0 ? 'pb-24' : ''}>
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

      {/* Sticky compare bar — fixed bottom */}
      {comparedProductIds.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#252525] bg-[#0E0E0E]/95 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">

            {/* Icon + label */}
            <div className="flex items-center gap-2 shrink-0">
              <GitCompare className="h-4 w-4 text-[#3B9EE8]" />
              <span className="text-white font-condensed font-bold text-sm uppercase tracking-widest">
                Compare
              </span>
              <span className="text-[#555555] font-condensed text-sm">
                {comparedProductIds.length}/4
              </span>
            </div>

            {/* Divider */}
            <div className="hidden sm:block w-px h-10 bg-[#252525] shrink-0" />

            {/* Thumbnail slots */}
            <div className="hidden sm:flex items-center gap-2 flex-1">
              {[0, 1, 2, 3].map((slot) => {
                const product = comparedProducts[slot];
                const thumbUrl = product ? getThumbUrl(product.images) : '';
                return product ? (
                  <div key={slot} className="relative shrink-0 w-12 h-12 border border-[#3B9EE8]/40 rounded-sm bg-[#161616] overflow-hidden">
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={product.name}
                        title={product.name}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-[#555555] text-xs font-body">?</span>
                      </div>
                    )}
                    <button
                      onClick={() => toggleCompare(product._id)}
                      title={`Remove ${product.name}`}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-[#252525] border border-[#555555] rounded-full flex items-center justify-center hover:bg-red-500 hover:border-red-500 transition-colors"
                    >
                      <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div key={slot} className="shrink-0 w-12 h-12 border border-dashed border-[#252525] rounded-sm bg-[#0E0E0E] flex items-center justify-center">
                    <span className="text-[#333333] text-lg font-body leading-none">+</span>
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 ml-auto shrink-0">
              <button
                onClick={() => updateCompareParam([])}
                className="text-[#555555] hover:text-white font-condensed font-bold text-sm uppercase tracking-widest transition-colors"
              >
                Clear
              </button>
              <button
                onClick={viewComparison}
                className="bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-5 py-2 rounded-sm text-sm transition-colors"
              >
                Compare Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
