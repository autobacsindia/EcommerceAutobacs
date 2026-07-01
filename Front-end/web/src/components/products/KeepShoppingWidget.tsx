'use client';

import type { StockStatus } from '@/lib/stock';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { useCurrency } from '@/context/CurrencyContext';
import ProductImage from '@/components/products/ProductImage';
import { productUrl } from '@/lib/types';
import { useCachedData, CACHE_KEYS } from '@/lib/cacheService';

interface ProductImageType {
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
  images: ProductImageType[] | string;
  category: { 
    name: string;
  } | string;
  brand?: string;
  stock: StockStatus;
  averageRating: number;
}

interface KeepShoppingWidgetProps {
  title: string;
  searchKeyword: string;
  categorySlug?: string;
  viewAllLink?: string;
  className?: string;
}

export default function KeepShoppingWidget({
  title,
  searchKeyword,
  categorySlug,
  viewAllLink,
  className = ''
}: KeepShoppingWidgetProps) {
  const { formatPrice } = useCurrency();

  const cacheKey = categorySlug
    ? `products_category_widget_${encodeURIComponent(categorySlug)}`
    : CACHE_KEYS.PRODUCTS_SEARCH(searchKeyword);

  // Fetch products with global cache service
  const { data: products, loading, error: productsError } = useCachedData<Product[]>(
    cacheKey,
    async () => {
      const params = new URLSearchParams();
      if (categorySlug) {
        params.append('category', categorySlug);
        params.append('sortBy', 'averageRating');
        params.append('order', 'desc');
      } else {
        params.append('search', searchKeyword);
      }
      params.append('limit', '4');
      params.append('page', '1');
      const response: any = await apiClient.get(`/products?${params.toString()}`);
      return response.products?.slice(0, 4) || [];
    },
    60 * 60 * 1000 // 1 hour
  );

  // Loading skeleton
  if (loading) {
    return (
      <section className={`${className}`}>
        <div className="bg-obsidian rounded p-4">
          {/* Title skeleton */}
          <div className="h-5 bg-obsidian-raised rounded w-40 mb-3 animate-pulse" />
          
          {/* 2x2 Grid skeleton */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-square bg-obsidian-raised rounded mb-1" />
                <div className="h-3 bg-obsidian-raised rounded mb-1" />
                <div className="h-3 bg-obsidian-raised rounded w-2/3" />
              </div>
            ))}
          </div>
          
          {/* See more skeleton */}
          <div className="h-4 bg-obsidian-raised rounded w-20 animate-pulse" />
        </div>
      </section>
    );
  }

  if (!products || products.length === 0) {
    return null;
  }

  return (
    <section className={`${className}`}>
      {/* Amazon "Keep shopping for" Style - Compact 2x2 Grid Widget */}
      <div className="bg-obsidian rounded p-4">
        {/* Title */}
        <h2 className="text-base font-bold text-ink mb-3">
          {title}
        </h2>

        {/* 2x2 Grid - Exactly 4 Products */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          {products.slice(0, 4).map((product) => {
            const url = productUrl(product, '/products');
            return (
            <Link
              key={product._id}
              href={url}
              className="group block"
            >
              {/* Product Image - Square */}
              <div className="relative aspect-square bg-obsidian-raised overflow-hidden rounded mb-1">
                {product.images && (
                  Array.isArray(product.images) && product.images.length > 0 && product.images[0].url ? (
                    <ProductImage
                      src={product.images[0].url}
                      alt={product.images[0].alt || product.name}
                      className="object-contain w-full h-full p-2 group-hover:scale-105 transition-transform duration-200"
                    />
                  ) : typeof product.images === 'string' && product.images !== '' ? (
                    <ProductImage
                      src={product.images}
                      alt={product.name}
                      className="object-contain w-full h-full p-2 group-hover:scale-105 transition-transform duration-200"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-obsidian-raised">
                      <span className="text-ink-muted text-xs">No image</span>
                    </div>
                  )
                )}
              </div>

              {/* Product Name - Truncated to 2 lines */}
              <p className="text-xs text-ink line-clamp-2 mb-1 group-hover:text-gold">
                {product.name}
              </p>

              {/* Price */}
              <p className="text-sm font-semibold text-ink">
                {formatPrice(product.price)}
              </p>
            </Link>
            );
          })}
        </div>

        {/* See more Link */}
        <Link
          href={viewAllLink || `/products?search=${searchKeyword}`}
          className="text-xs text-gold hover:text-orange-600 hover:underline inline-flex items-center"
        >
          See more
        </Link>
      </div>
    </section>
  );
}
