'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import apiClient from '@/lib/api';
import { useCurrency } from '@/contexts/CurrencyContext';
import EnhancedImage from '@/components/layout/EnhancedImage';

interface ProductImage {
  url: string;
  alt?: string;
  isPrimary?: boolean;
  _id?: string;
}

interface Product {
  _id: string;
  name: string;
  description: string;
  shortDescription?: string;
  price: number;
  originalPrice?: number;
  category: { _id: string; name: string; slug: string } | string;
  brand?: string;
  images: ProductImage[] | string;
  stock: number;
  sku?: string;
  specifications?: Array<{ key: string; value: string; _id?: string }> | string;
  features?: string[] | string;
  isActive: boolean;
  isFeatured: boolean;
  averageRating: number;
  totalReviews: number;
  tags?: string[] | string;
  createdAt: string;
  updatedAt: string;
  __v?: number;
}

export default function ProductComparison() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { formatPrice } = useCurrency();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const idsParam = searchParams.get('ids') || '';
  const productIds = idsParam ? idsParam.split(',') : [];

  useEffect(() => {
    if (!idsParam) { setProducts([]); setLoading(false); return; }

    const fetchProducts = async () => {
      try {
        setLoading(true);
        setError(null);
        const ids = idsParam.split(',');
        const responses = await Promise.all(ids.map(id => apiClient.get(`/products/${id}`)));
        setProducts(responses.map(r => (r as any).product).filter(Boolean));
      } catch (err: any) {
        setError('Failed to load products for comparison');
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [idsParam]);

  const removeProduct = (productId: string) => {
    const newProductIds = productIds.filter(id => id !== productId);
    const params = new URLSearchParams(searchParams.toString());
    if (newProductIds.length > 0) params.set('ids', newProductIds.join(','));
    else params.delete('ids');
    router.push(`/compare?${params.toString()}`);
  };

  const rowClass = 'grid grid-cols-1 md:grid-cols-[180px_repeat(auto-fill,minmax(220px,1fr))] gap-4 p-5 border-b border-[#252525]';
  const labelClass = 'text-xs font-condensed font-bold text-[#555555] uppercase tracking-widest self-start pt-1';

  if (productIds.length === 0) {
    return (
      <div className="py-24 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-2">Compare</p>
          <h1 className="text-3xl font-condensed font-bold text-white uppercase tracking-wide mb-4">Product Comparison</h1>
          <p className="text-[#C4C4C4] font-body mb-8">No products selected for comparison</p>
          <button
            onClick={() => router.push('/products')}
            className="bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors"
          >
            Browse Products
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-condensed font-bold text-white uppercase tracking-wide mb-8">Product Comparison</h1>
          <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-6 animate-pulse">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="border border-[#252525] rounded-sm p-4">
                  <div className="h-48 bg-[#161616] rounded-sm mb-4" />
                  <div className="h-5 bg-[#252525] rounded-sm mb-2" />
                  <div className="h-4 bg-[#252525] rounded-sm w-2/3 mb-4" />
                  <div className="space-y-2">
                    <div className="h-4 bg-[#252525] rounded-sm" />
                    <div className="h-4 bg-[#252525] rounded-sm" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-condensed font-bold text-white uppercase tracking-wide mb-8">Product Comparison</h1>
          <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-8 text-center">
            <p className="text-red-400 font-body mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const allSpecKeys = Array.from(
    new Set(products.flatMap(p => Array.isArray(p.specifications) ? p.specifications.map(s => s.key) : []))
  ).sort();

  return (
    <div className="py-12 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-1">Compare</p>
            <h1 className="text-3xl font-condensed font-bold text-white uppercase tracking-wide">Product Comparison</h1>
          </div>
          <button
            onClick={() => router.push('/products')}
            className="mt-4 md:mt-0 bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-4 py-2.5 rounded-sm transition-colors text-sm"
          >
            Add More Products
          </button>
        </div>

        {products.length === 0 ? (
          <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-8 text-center">
            <p className="text-[#C4C4C4] font-body">No products found for comparison</p>
          </div>
        ) : (
          <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm overflow-hidden">
            {/* Product Headers */}
            <div className="grid grid-cols-1 md:grid-cols-[180px_repeat(auto-fill,minmax(220px,1fr))] gap-4 p-5 border-b border-[#252525]">
              <div />
              {products.map((product) => (
                <div key={product._id} className="flex flex-col items-center">
                  <button
                    onClick={() => removeProduct(product._id)}
                    className="self-end text-[#555555] hover:text-red-400 mb-2 transition-colors"
                    aria-label="Remove product"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>

                  <div className="w-32 h-32 mb-4 relative bg-[#161616] border border-[#252525] rounded-sm overflow-hidden">
                    {Array.isArray(product.images) && product.images.length > 0 ? (
                      <EnhancedImage
                        src={product.images[0].url}
                        alt={product.images[0].alt || product.name}
                        width={128} height={128}
                        className="w-full h-full object-contain"
                        context="product"
                      />
                    ) : typeof product.images === 'string' ? (
                      <EnhancedImage
                        src={product.images}
                        alt={product.name}
                        width={128} height={128}
                        className="w-full h-full object-contain"
                        context="product"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-[#555555] font-body text-xs">No image</span>
                      </div>
                    )}
                  </div>

                  <h3 className="font-condensed font-bold text-white text-center text-sm uppercase tracking-wide mb-2 line-clamp-2">{product.name}</h3>

                  <div className="text-center mb-3">
                    {product.originalPrice && product.originalPrice > product.price ? (
                      <div className="flex flex-col items-center">
                        <span className="text-xl font-condensed font-bold text-[#3B9EE8]">{formatPrice(product.price)}</span>
                        <span className="text-xs text-[#555555] font-body line-through">{formatPrice(product.originalPrice)}</span>
                      </div>
                    ) : (
                      <span className="text-xl font-condensed font-bold text-[#3B9EE8]">{formatPrice(product.price)}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 mb-3">
                    {[...Array(5)].map((_, i) => (
                      <svg key={i} className={`w-3.5 h-3.5 ${i < Math.floor(product.averageRating) ? 'text-[#EF9F27]' : 'text-[#252525]'}`} fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    ))}
                    <span className="ml-1 text-xs text-[#555555] font-body">({product.totalReviews})</span>
                  </div>

                  <div>
                    {product.stock > 0 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-condensed font-bold uppercase tracking-wide bg-green-500/10 border border-green-500/30 text-green-400">
                        In Stock ({product.stock})
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-condensed font-bold uppercase tracking-wide bg-red-500/10 border border-red-500/30 text-red-400">
                        Out of Stock
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Comparison Rows */}
            <div>
              {/* Category */}
              <div className={rowClass}>
                <div className={labelClass}>Category</div>
                {products.map((p) => (
                  <div key={`${p._id}-cat`} className="text-center text-[#C4C4C4] font-body text-sm">
                    {typeof p.category === 'object' && p.category !== null ? p.category.name : typeof p.category === 'string' ? p.category : 'Uncategorized'}
                  </div>
                ))}
              </div>

              {/* Brand */}
              <div className={rowClass}>
                <div className={labelClass}>Brand</div>
                {products.map((p) => (
                  <div key={`${p._id}-brand`} className="text-center text-[#C4C4C4] font-body text-sm">{p.brand || '—'}</div>
                ))}
              </div>

              {/* Description */}
              <div className={rowClass}>
                <div className={labelClass}>Description</div>
                {products.map((p) => (
                  <div key={`${p._id}-desc`} className="text-center text-[#C4C4C4] font-body text-sm leading-relaxed line-clamp-3">
                    {p.description || <span className="text-[#555555]">No description</span>}
                  </div>
                ))}
              </div>

              {/* Short Description */}
              {products.some(p => p.shortDescription) && (
                <div className={rowClass}>
                  <div className={labelClass}>Short Desc</div>
                  {products.map((p) => (
                    <div key={`${p._id}-short`} className="text-center text-[#C4C4C4] font-body text-sm">
                      {p.shortDescription || <span className="text-[#555555]">—</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Dynamic Specs */}
              {allSpecKeys.map((specKey) => (
                <div key={specKey} className={rowClass}>
                  <div className={labelClass}>{specKey}</div>
                  {products.map((p) => {
                    const spec = Array.isArray(p.specifications) ? p.specifications.find(s => s.key === specKey) : null;
                    return (
                      <div key={`${p._id}-${specKey}`} className="text-center text-[#C4C4C4] font-body text-sm">
                        {spec ? spec.value : <span className="text-[#555555]">—</span>}
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* Actions */}
              <div className={rowClass.replace('border-b border-[#252525]', '')}>
                <div className={labelClass}>Actions</div>
                {products.map((p) => (
                  <div key={`${p._id}-actions`} className="flex flex-col gap-2">
                    <button
                      onClick={() => router.push(`/products/${p._id}`)}
                      className="w-full bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-4 py-2 rounded-sm text-xs transition-colors"
                    >
                      View Details
                    </button>
                    <button
                      disabled={p.stock <= 0}
                      className="w-full bg-[#161616] border border-[#252525] text-[#C4C4C4] hover:border-[#3B9EE8] hover:text-white font-condensed font-bold uppercase tracking-widest px-4 py-2 rounded-sm text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Add to Cart
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
