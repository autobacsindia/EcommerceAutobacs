'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Tag, ArrowLeft, RefreshCw } from 'lucide-react';
import apiClient from '@/lib/api';

interface Brand {
  id?: string;
  name: string;
  slug: string;
  logo?: string;
  description?: string;
  productCount?: number;
}

interface BrandsResponse {
  success: boolean;
  message?: string;
  brands: any[];
}

function sanitizeBrand(brand: any): Brand | null {
  if (!brand || !brand.slug || !brand.name) return null;
  if (!/^[a-z0-9-]+$/.test(brand.slug)) return null;
  const raw = brand.logo;
  const logo = typeof raw === 'string' && raw ? raw
             : raw && typeof raw === 'object' && raw.url ? String(raw.url)
             : undefined;
  return {
    id: brand.id || undefined,
    name: brand.name,
    slug: brand.slug,
    logo,
    description: brand.description || undefined,
    productCount: typeof brand.productCount === 'number' && brand.productCount >= 0 ? brand.productCount : 0
  };
}

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrands = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.get('/products/brands') as BrandsResponse;
      if (!data || typeof data !== 'object') throw new Error('Invalid response format');
      if (data.success === false) throw new Error(data.message || 'Failed to fetch brands');
      if (!Array.isArray(data.brands)) throw new Error('Invalid brands data format');
      const sanitizedBrands = data.brands
        .map(sanitizeBrand)
        .filter((b: Brand | null): b is Brand => b !== null);
      setBrands(sanitizedBrands);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch brands');
      console.error('Error fetching brands:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBrands(); }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-full p-4 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <Tag className="h-8 w-8 text-red-400" />
          </div>
          <h1 className="text-2xl font-display font-bold text-ink uppercase tracking-wide mb-4">Error Loading Brands</h1>
          <p className="text-ink/70 font-display mb-6">{error}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={fetchBrands}
              className="inline-flex items-center justify-center px-6 py-3 bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest rounded-sm transition-colors"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </button>
            <Link
              href="/"
              className="inline-flex items-center justify-center px-6 py-3 bg-obsidian-raised border border-hairline hover:border-gold text-ink/70 hover:text-ink font-display font-bold uppercase tracking-widest rounded-sm transition-all"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Hero */}
      <div className="bg-obsidian border-b border-hairline py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-gold/10 border border-gold/30 rounded-full p-4">
              <Tag className="h-12 w-12 text-gold" />
            </div>
          </div>
          <p className="text-gold font-display font-bold text-sm uppercase tracking-widest mb-3">Our Partners</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-ink uppercase tracking-wide mb-4">
            Premium Automotive Brands
          </h1>
          <p className="text-ink/70 font-display text-lg max-w-3xl mx-auto">
            Explore our curated collection of world-class automotive brands. Find authentic parts and accessories from trusted manufacturers.
          </p>
          {!loading && brands.length > 0 && (
            <div className="mt-6 flex items-center justify-center gap-2 text-ink/70">
              <div className="w-2 h-2 bg-gold rounded-full animate-pulse" />
              <span className="text-sm font-display font-bold uppercase tracking-widest">{brands.length} Brands Available</span>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="bg-obsidian border border-hairline rounded-lg p-8 animate-pulse">
                <div className="flex flex-col items-center text-center">
                  <div className="bg-obsidian-raised rounded-lg w-32 h-32 mb-6" />
                  <div className="h-5 bg-obsidian-raised rounded w-32 mb-3" />
                  <div className="h-4 bg-obsidian-raised rounded w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : brands.length > 0 ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {brands.map((brand, index) => (
                <Link
                  key={brand.slug}
                  href={`/brands/${brand.slug}`}
                  className="group bg-obsidian border border-hairline rounded-lg overflow-hidden hover:border-gold transition-all duration-300 flex flex-col"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  {/* Logo area */}
                  <div className="bg-obsidian-raised p-8 flex items-center justify-center min-h-50">
                    {brand.logo ? (
                      <div className="relative w-full h-32 flex items-center justify-center">
                        <img
                          src={brand.logo}
                          alt={brand.name}
                          className="max-w-full max-h-full object-contain group-hover:scale-110 transition-transform duration-300"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const fallback = document.createElement('div');
                            fallback.className = 'bg-obsidian-raised rounded-lg p-6 w-32 h-32 flex items-center justify-center';
                            fallback.innerHTML = `<span class="text-3xl font-bold text-gold">${brand.name.charAt(0)}</span>`;
                            target.parentElement!.appendChild(fallback);
                          }}
                        />
                      </div>
                    ) : (
                      <div className="bg-obsidian-raised rounded-lg w-32 h-32 flex items-center justify-center group-hover:bg-gold/10 transition-colors duration-300">
                        <span className="text-3xl font-display font-bold text-gold">{brand.name.charAt(0)}</span>
                      </div>
                    )}
                  </div>

                  {/* Brand info */}
                  <div className="p-5 border-t border-hairline text-center flex-1 flex flex-col">
                    <h3 className="text-lg font-display font-bold text-ink uppercase tracking-wide mb-1 group-hover:text-gold transition-colors">
                      {brand.name}
                    </h3>
                    <div className="flex items-center justify-center gap-1 text-sm text-ink-muted mb-3">
                      <svg className="h-4 w-4 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                      <span className="font-display font-bold text-ink/70">{brand.productCount ?? 0}</span>
                      <span className="text-ink-muted">product{brand.productCount !== 1 ? 's' : ''}</span>
                    </div>
                    {brand.description && (
                      <p className="text-xs text-ink-muted font-display line-clamp-2 mb-3">{brand.description}</p>
                    )}
                    <div className="mt-auto pt-3 opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all duration-300">
                      <div className="bg-gold hover:bg-gold text-obsidian text-center py-2 rounded-sm font-display font-bold text-sm uppercase tracking-widest transition-colors">
                        View Products →
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {/* Stats bar */}
            <div className="mt-16 bg-obsidian border border-hairline rounded-lg p-8 md:p-12">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center divide-y md:divide-y-0 md:divide-x divide-hairline">
                <div className="space-y-1 py-4 md:py-0">
                  <div className="text-4xl md:text-5xl font-display font-bold text-gold">{brands.length}+</div>
                  <div className="text-ink/70 font-display">Premium Brands</div>
                </div>
                <div className="space-y-1 py-4 md:py-0">
                  <div className="text-4xl md:text-5xl font-display font-bold text-gold">
                    {brands.reduce((sum, b) => sum + (b.productCount || 0), 0)}+
                  </div>
                  <div className="text-ink/70 font-display">Quality Products</div>
                </div>
                <div className="space-y-1 py-4 md:py-0">
                  <div className="text-4xl md:text-5xl font-display font-bold text-gold">100%</div>
                  <div className="text-ink/70 font-display">Authentic Parts</div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-20">
            <div className="bg-obsidian-raised border border-hairline rounded-full p-8 w-32 h-32 mx-auto mb-6 flex items-center justify-center">
              <Tag className="h-16 w-16 text-ink-muted" />
            </div>
            <h3 className="text-2xl font-display font-bold text-ink uppercase tracking-wide mb-3">No Brands Available</h3>
            <p className="text-ink/70 font-display mb-8 max-w-md mx-auto">
              We&apos;re currently updating our brand catalog. Please check back later or browse our product collection.
            </p>
            <Link
              href="/products"
              className="inline-flex items-center px-8 py-4 bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest rounded-sm transition-colors"
            >
              Browse All Products
            </Link>
          </div>
        )}

        {brands.length > 0 && (
          <div className="mt-16 text-center pt-12 border-t border-hairline">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-gold hover:text-ink font-display font-bold uppercase tracking-widest transition-colors group"
            >
              <ArrowLeft className="h-5 w-5 transform group-hover:-translate-x-1 transition-transform" />
              Back to Home
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
