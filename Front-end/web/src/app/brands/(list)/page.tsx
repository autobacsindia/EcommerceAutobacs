'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Tag, RefreshCw } from 'lucide-react';
import apiClient from '@/lib/api';
import StorePageHeader from '@/components/store/StorePageHeader';

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

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = brands
    .filter((b) => !q || b.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="sp sh-theme">
      <StorePageHeader
        crumbs={[{ label: 'Brands' }]}
        title="Shop by brand"
        subtitle="Authentic parts and accessories from manufacturers we trust."
        aside={!loading && !error && brands.length > 0 ? `${brands.length} brands` : undefined}
      >
        {/* From the first paint (disabled while loading) so the grid does not jump. */}
        {!error && (
          <input
            disabled={loading}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a brand"
            aria-label="Find a brand"
            className="mt-4 h-11 w-full max-w-md rounded-full border border-[#c9cfcd] bg-white px-5 text-[15px] text-ink outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
          />
        )}
      </StorePageHeader>

      <div className="sp-wrap">
        {error ? (
          <div className="sp-section sp-card sp-empty">
            <p className="sp-empty-title">We couldn&apos;t load the brands</p>
            <p>{error}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <button type="button" onClick={fetchBrands} className="sh-btn sh-btn-primary">
                <RefreshCw className="h-4 w-4" /> Try again
              </button>
              <Link href="/" className="sh-btn sh-btn-outline">Back to home</Link>
            </div>
          </div>
        ) : loading ? (
          <div className="sp-section grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5 xl:grid-cols-6" aria-busy="true">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="sp-tile">
                <div className="aspect-[3/2] animate-pulse bg-obsidian-deep" />
                <div className="sp-tile-body"><div className="h-4 w-2/3 animate-pulse rounded bg-obsidian-deep" /></div>
              </div>
            ))}
          </div>
        ) : shown.length > 0 ? (
          <div className="sp-section grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5 xl:grid-cols-6">
            {shown.map((brand) => (
              <Link key={brand.slug} href={`/brands/${brand.slug}`} className="sp-tile">
                <div className="flex aspect-[3/2] items-center justify-center bg-white p-5">
                  <BrandLogo name={brand.name} logo={brand.logo} />
                </div>
                <div className="sp-tile-body border-t border-hairline">
                  <div className="min-w-0">
                    <p className="sp-tile-name truncate">{brand.name}</p>
                    <p className="sp-tile-sub">
                      {brand.productCount ?? 0} product{brand.productCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <span className="sp-tile-go" aria-hidden="true">›</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="sp-section sp-card sp-empty">
            <Tag className="mx-auto mb-3 h-10 w-10 text-ink-muted" />
            <p className="sp-empty-title">{brands.length ? 'No brand matches that' : 'No brands yet'}</p>
            <p>Try another name, or browse every product we carry.</p>
            <Link href="/products" className="sh-btn sh-btn-primary">Browse all products</Link>
          </div>
        )}
      </div>
    </div>
  );
}

/** Brand logo, falling back to the brand's initial when there is none or it fails to load. */
function BrandLogo({ name, logo }: { name: string; logo?: string }) {
  const [failed, setFailed] = useState(false);
  if (!logo || failed) {
    return (
      <span className="grid h-16 w-16 place-items-center rounded-full bg-gold/10 font-display text-2xl font-bold text-gold">
        {name.charAt(0)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logo}
      alt={name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-105"
    />
  );
}
