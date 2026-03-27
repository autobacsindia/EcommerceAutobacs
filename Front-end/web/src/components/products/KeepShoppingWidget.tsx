'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { useCurrency } from '@/contexts/CurrencyContext';
import ProductImage from '@/components/products/ProductImage';
import { productUrl } from '@/lib/types';

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
  stock: number;
  averageRating: number;
}

interface KeepShoppingWidgetProps {
  title: string;
  searchKeyword: string;
  viewAllLink?: string;
  className?: string;
}

export default function KeepShoppingWidget({
  title,
  searchKeyword,
  viewAllLink,
  className = ''
}: KeepShoppingWidgetProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const { formatPrice } = useCurrency();

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        params.append('search', searchKeyword);
        params.append('limit', '4'); // Only 4 products
        params.append('page', '1');
        
        const response: any = await apiClient.get(`/products?${params.toString()}`);
        setProducts(response.products?.slice(0, 4) || []);
      } catch (error) {
        console.error(`Failed to fetch products for ${title}:`, error);
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [searchKeyword, title]);

  // Loading skeleton
  if (loading) {
    return (
      <section className={`${className}`}>
        <div className="bg-white rounded p-4">
          {/* Title skeleton */}
          <div className="h-5 bg-gray-200 rounded w-40 mb-3 animate-pulse" />
          
          {/* 2x2 Grid skeleton */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-square bg-gray-200 rounded mb-1" />
                <div className="h-3 bg-gray-200 rounded mb-1" />
                <div className="h-3 bg-gray-200 rounded w-2/3" />
              </div>
            ))}
          </div>
          
          {/* See more skeleton */}
          <div className="h-4 bg-gray-200 rounded w-20 animate-pulse" />
        </div>
      </section>
    );
  }

  if (products.length === 0) {
    return null;
  }

  return (
    <section className={`${className}`}>
      {/* Amazon "Keep shopping for" Style - Compact 2x2 Grid Widget */}
      <div className="bg-white rounded p-4">
        {/* Title */}
        <h2 className="text-base font-bold text-gray-900 mb-3">
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
              <div className="relative aspect-square bg-gray-100 overflow-hidden rounded mb-1">
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
                    <div className="w-full h-full flex items-center justify-center bg-gray-100">
                      <span className="text-gray-400 text-xs">No image</span>
                    </div>
                  )
                )}
              </div>

              {/* Product Name - Truncated to 2 lines */}
              <p className="text-xs text-gray-900 line-clamp-2 mb-1 group-hover:text-blue-600">
                {product.name}
              </p>

              {/* Price */}
              <p className="text-sm font-semibold text-gray-900">
                {formatPrice(product.price)}
              </p>
            </Link>
            );
          })}
        </div>

        {/* See more Link */}
        <Link
          href={viewAllLink || `/products?search=${searchKeyword}`}
          className="text-xs text-blue-600 hover:text-orange-600 hover:underline inline-flex items-center"
        >
          See more
        </Link>
      </div>
    </section>
  );
}
