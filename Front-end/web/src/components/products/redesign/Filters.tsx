'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import apiClient from '@/lib/api';
import productService from '@/lib/services/productService';
import { useCurrency } from '@/context/CurrencyContext';
import Eyebrow from '@/components/ui/Eyebrow';
import PriceHistogram from '@/components/ui/PriceHistogram';
import './redesign.css';

const PRICE_MIN = 0;
const PRICE_MAX = 100000;

interface Category { _id: string; name: string; slug: string; parent?: unknown }
interface Brand { _id: string; name: string }
interface Vehicle { _id: string; make: string; model: string }

/** Collapsible section wrapper with an uppercase gold eyebrow. */
function Group({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-hairline py-5 first:border-t-0 first:pt-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <Eyebrow as="span">{title}</Eyebrow>
        <ChevronDown
          className={`h-3.5 w-3.5 text-ink-muted transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  );
}

/** A gold-check filter row. */
function CheckRow({
  label,
  count,
  checked,
  onChange,
}: {
  label: React.ReactNode;
  count?: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-1.5 group">
      <input type="checkbox" className="pf-check" checked={checked} onChange={onChange} />
      <span
        className={`flex-1 font-display text-[13px] tracking-[0.02em] transition-colors ${
          checked ? 'text-ink' : 'text-ink-muted group-hover:text-ink'
        }`}
      >
        {label}
      </span>
      {count != null && <span className="font-display text-[11px] text-ink-muted">{count}</span>}
    </label>
  );
}

interface FiltersProps {
  /** Called after a filter is applied — used to close the mobile drawer. */
  onApplied?: () => void;
}

export default function Filters({ onApplied }: FiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { formatPrice } = useCurrency();

  // ── data ──
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [facetBrands, setFacetBrands] = useState<Record<string, number>>({});
  const [facetCategories, setFacetCategories] = useState<Record<string, number>>({});
  const [brandsExpanded, setBrandsExpanded] = useState(false);

  // ── selection (initialized from URL) ──
  const [price, setPrice] = useState<[number, number]>(() => [
    Number(searchParams.get('minPrice')) || PRICE_MIN,
    Number(searchParams.get('maxPrice')) || PRICE_MAX,
  ]);
  const [selCats, setSelCats] = useState<string[]>(
    () => searchParams.get('category')?.split(',').filter(Boolean) ?? []
  );
  const [selBrands, setSelBrands] = useState<string[]>(
    () => searchParams.get('brand')?.split(',').filter(Boolean) ?? []
  );
  const [ratings, setRatings] = useState<number[]>(
    () => searchParams.get('rating')?.split(',').map(Number).filter((n) => !isNaN(n)) ?? []
  );
  const [inStock, setInStock] = useState(() => searchParams.get('inStock') === 'true');
  const [make, setMake] = useState(() => searchParams.get('vehicleMake') ?? '');
  const [model, setModel] = useState(() => searchParams.get('vehicleModel') ?? '');

  // ── fetch reference data ──
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await apiClient.get<{ categories?: Category[] }>('/categories', { signal: ac.signal });
        setCategories((res.categories ?? []).filter((c) => !c.parent));
      } catch { /* non-fatal */ }
    })();
    (async () => {
      try { setBrands(await productService.getBrands()); } catch { /* non-fatal */ }
    })();
    (async () => {
      try {
        const res = await apiClient.get<{ vehicles?: Vehicle[]; data?: Vehicle[] }>('/vehicles?limit=1000');
        setVehicles(res.vehicles ?? res.data ?? []);
      } catch { /* non-fatal */ }
    })();
    return () => ac.abort();
  }, []);

  // ── live facet counts for the current query context ──
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const qs = searchParams.toString();
        const res = await apiClient.get<{ facets?: { brands?: { name: string; count: number }[]; categories?: { categoryId: string; count: number }[] } }>(
          `/products/facets${qs ? `?${qs}` : ''}`
        );
        if (ignore) return;
        const b: Record<string, number> = {};
        res.facets?.brands?.forEach((x) => { if (x.name) b[x.name.toLowerCase()] = x.count; });
        const c: Record<string, number> = {};
        res.facets?.categories?.forEach((x) => { c[x.categoryId] = x.count; });
        setFacetBrands(b);
        setFacetCategories(c);
      } catch { /* non-fatal */ }
    })();
    return () => { ignore = true; };
  }, [searchParams]);

  const makes = useMemo(
    () => Array.from(new Set(vehicles.map((v) => v.make).filter(Boolean))).sort(),
    [vehicles]
  );
  const models = useMemo(
    () => Array.from(new Set(vehicles.filter((v) => v.make === make).map((v) => v.model).filter(Boolean))).sort(),
    [vehicles, make]
  );

  // ── URL writer (live-apply) ──
  const commit = useCallback(
    (next: {
      price?: [number, number]; cats?: string[]; brands?: string[];
      ratings?: number[]; inStock?: boolean; make?: string; model?: string;
    }) => {
      const p = new URLSearchParams(searchParams.toString());
      p.delete('page'); // any filter change resets pagination

      const pr = next.price ?? price;
      pr[0] > PRICE_MIN ? p.set('minPrice', String(pr[0])) : p.delete('minPrice');
      pr[1] < PRICE_MAX ? p.set('maxPrice', String(pr[1])) : p.delete('maxPrice');

      const set = (k: string, arr: string[] | number[]) =>
        arr.length ? p.set(k, arr.join(',')) : p.delete(k);
      set('category', next.cats ?? selCats);
      set('brand', next.brands ?? selBrands);
      set('rating', next.ratings ?? ratings);

      (next.inStock ?? inStock) ? p.set('inStock', 'true') : p.delete('inStock');

      const mk = next.make ?? make;
      const md = next.model ?? model;
      if (mk) { p.set('vehicleMake', mk); md ? p.set('vehicleModel', md) : p.delete('vehicleModel'); }
      else { p.delete('vehicleMake'); p.delete('vehicleModel'); }

      router.replace(`/products?${p.toString()}`, { scroll: false });
      onApplied?.();
    },
    [searchParams, price, selCats, selBrands, ratings, inStock, make, model, router, onApplied]
  );

  // Debounce only the price slider so dragging stays smooth.
  const priceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPriceChange = (next: [number, number]) => {
    setPrice(next);
    if (priceTimer.current) clearTimeout(priceTimer.current);
    priceTimer.current = setTimeout(() => commit({ price: next }), 350);
  };

  const toggle = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const visibleBrands = brandsExpanded ? brands : brands.slice(0, 6);

  return (
    <div className="font-display">
      {/* Vehicle fitment */}
      <Group title="My Vehicle" defaultOpen={!!make}>
        <div className="space-y-2">
          <select
            value={make}
            onChange={(e) => { setMake(e.target.value); setModel(''); commit({ make: e.target.value, model: '' }); }}
            className="w-full appearance-none border border-hairline bg-obsidian-raised px-3.5 py-2.5 text-[13px] text-ink outline-none focus:border-gold/55"
            aria-label="Vehicle make"
          >
            <option value="">All makes</option>
            {makes.map((mk) => <option key={mk} value={mk}>{mk}</option>)}
          </select>
          <select
            value={model}
            disabled={!make}
            onChange={(e) => { setModel(e.target.value); commit({ model: e.target.value }); }}
            className="w-full appearance-none border border-hairline bg-obsidian-raised px-3.5 py-2.5 text-[13px] text-ink outline-none focus:border-gold/55 disabled:opacity-50"
            aria-label="Vehicle model"
          >
            <option value="">{make ? 'All models' : 'Select a make first'}</option>
            {models.map((md) => <option key={md} value={md}>{md}</option>)}
          </select>
        </div>
      </Group>

      {/* Price */}
      <Group title="Price Range">
        <PriceHistogram
          value={price}
          min={PRICE_MIN}
          max={PRICE_MAX}
          step={500}
          format={formatPrice}
          onChange={onPriceChange}
        />
      </Group>

      {/* Categories */}
      {categories.length > 0 && (
        <Group title="Category">
          <div className="max-h-64 overflow-y-auto sf-noscroll">
            {categories.map((c) => (
              <CheckRow
                key={c._id}
                label={c.name}
                count={facetCategories[c._id]}
                checked={selCats.includes(c._id)}
                onChange={() => { const n = toggle(selCats, c._id); setSelCats(n); commit({ cats: n }); }}
              />
            ))}
          </div>
        </Group>
      )}

      {/* Brands */}
      {brands.length > 0 && (
        <Group title="Brand">
          <div>
            {visibleBrands.map((b) => (
              <CheckRow
                key={b._id}
                label={b.name}
                count={facetBrands[b.name.toLowerCase()]}
                checked={selBrands.includes(b.name)}
                onChange={() => { const n = toggle(selBrands, b.name); setSelBrands(n); commit({ brands: n }); }}
              />
            ))}
            {brands.length > 6 && (
              <button
                type="button"
                onClick={() => setBrandsExpanded((v) => !v)}
                className="mt-2 font-display text-[10px] uppercase tracking-[0.2em] text-gold hover:opacity-80"
              >
                {brandsExpanded ? 'Show less' : `More brands (${brands.length - 6})`}
              </button>
            )}
          </div>
        </Group>
      )}

      {/* Rating */}
      <Group title="Rating">
        <div>
          {[4, 3, 2, 1].map((r) => (
            <CheckRow
              key={r}
              checked={ratings.includes(r)}
              onChange={() => { const n = toggle(ratings, r); setRatings(n); commit({ ratings: n }); }}
              label={
                <span className="flex items-center gap-1.5">
                  <span className="text-gold tracking-[2px]">{'★'.repeat(r)}<span className="text-hairline">{'★'.repeat(5 - r)}</span></span>
                  <span className="text-[11px]">&amp; up</span>
                </span>
              }
            />
          ))}
        </div>
      </Group>

      {/* Availability */}
      <Group title="Availability">
        <CheckRow
          label="In stock only"
          checked={inStock}
          onChange={() => { const n = !inStock; setInStock(n); commit({ inStock: n }); }}
        />
      </Group>
    </div>
  );
}
