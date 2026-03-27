'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import EnhancedImage from '@/components/layout/EnhancedImage';
import productService from '@/lib/services/productService';
import { useCurrency } from '@/contexts/CurrencyContext';
import { Product, productUrl } from '@/lib/types';

interface ProductCardProps {
  product: Product;
}

const ProductCard = ({ product }: ProductCardProps) => {
  const { formatPrice } = useCurrency();
  const url = productUrl(product, '/products');
  // Get primary image or fallback
  const primaryImage = product.images && Array.isArray(product.images) 
    ? product.images.find(img => img.isPrimary)?.url || product.images[0]?.url
    : '/images/fallback-product.png';

  // Get category name for display
  const categoryName = product.categories && product.categories.length > 0 
    ? product.categories[0].name 
    : typeof product.category === 'object' && product.category !== null 
      ? (product.category as any).name 
      : typeof product.category === 'string' 
        ? product.category 
        : 'Uncategorized';

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-300">
      <div className="aspect-square overflow-hidden relative">
        <EnhancedImage 
          src={primaryImage} 
          alt={product.name} 
          width={300}
          height={300}
          className="w-full h-full object-cover"
          context="product"
        />
      </div>
      <div className="p-4">
        <div className="text-xs text-gray-500 uppercase mb-1">
          {categoryName === 'Suspension' ? 'SUSPENSION' : categoryName}
        </div>
        <h3 className="font-semibold text-lg mb-1 line-clamp-2">{product.name}</h3>
        <p className="text-gray-600 text-sm mb-2 line-clamp-2">
          {product.shortDescription || product.description.substring(0, 100) + '...'}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold text-blue-600">
            {formatPrice(product.price)}
          </span>
          {product.stock > 0 ? (
            <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
              In Stock
            </span>
          ) : (
            <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">
              Out of Stock
            </span>
          )}
        </div>
        <Link 
          href={url}
          className="mt-3 inline-block w-full text-center bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 transition-colors"
        >
          View Details
        </Link>
      </div>
    </div>
  );
};

export default function ProductShowcase() {
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadProducts = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Try to load from static data first for better performance
        const staticProducts = await productService.getFeaturedProducts(4, true);
        
        if (staticProducts.length > 0) {
          // Format products for display
          const formattedProducts = staticProducts.map(product => 
            productService.formatProductForDisplay(product)
          );
          setFeaturedProducts(formattedProducts);
        } else {
          // Fallback to API if static data is not available
          console.warn('Static product data not available, falling back to API');
          const apiProducts = await productService.getFeaturedProducts(4, false);
          setFeaturedProducts(apiProducts as any);
        }
      } catch (err) {
        console.error('Error loading featured products:', err);
        setError('Failed to load products. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    loadProducts();
  }, []);

  if (loading) {
    return (
      <div className="py-8">
        <h2 className="text-2xl font-bold mb-6">Featured Products</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, index) => (
            <div key={index} className="bg-white rounded-lg shadow-md overflow-hidden animate-pulse">
              <div className="aspect-square bg-gray-200"></div>
              <div className="p-4">
                <div className="h-4 bg-gray-200 rounded mb-2"></div>
                <div className="h-3 bg-gray-200 rounded mb-4"></div>
                <div className="h-6 bg-gray-200 rounded mb-3"></div>
                <div className="h-10 bg-gray-200 rounded"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center">
        <h2 className="text-2xl font-bold mb-6">Featured Products</h2>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-800">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="mt-4 bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Featured Products</h2>
        <Link href="/products" className="text-blue-600 hover:text-blue-800 font-medium">
          View All Products →
        </Link>
      </div>
      
      {featuredProducts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {featuredProducts.map((product) => (
            <ProductCard key={product._id} product={product} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-500">No featured products available at the moment.</p>
        </div>
      )}
    </div>
  );
}