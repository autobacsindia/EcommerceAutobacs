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

/** Read a comma-separated URL param as a list of non-empty values. */
const csvParam = (sp: URLSearchParams | ReturnType<typeof useSearchParams>, key: string): string[] =>
  (sp.get(key) ?? '').split(',').filter(Boolean);

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
  /**
   * Route that filter changes navigate to. Defaults to `/products`. On a
   * category or search page, pass the current path (e.g. `/categories/brakes`)
   * so filtering stays in context instead of bouncing to the global catalog.
   */
  basePath?: string;
  /** Hide the Category group — e.g. on a category page you're already inside one. */
  hideCategories?: boolean;
}

export default function Filters({ onApplied, basePath = '/products', hideCategories = false }: FiltersProps) {
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

  // ── selection (DERIVED from the URL — never mirrored into state) ──
  // The chip strip, the active-filter chips and this sidebar all write the same
  // query params. Seeding local state from the URL once at mount meant any
  // navigation by one of the others left this panel showing a stale selection,
  // which `commit` would then write back and silently revert. The URL is the
  // single source of truth.
  const urlMin = Number(searchParams.get('minPrice')) || PRICE_MIN;
  const urlMax = Number(searchParams.get('maxPrice')) || PRICE_MAX;

  // Price is the one exception: the slider needs local state to stay smooth
  // while dragging, so it re-syncs from the URL whenever the URL price moves.
  const [price, setPrice] = useState<[number, number]>([urlMin, urlMax]);
  useEffect(() => { setPrice([urlMin, urlMax]); }, [urlMin, urlMax]);

  const selCats = useMemo(() => csvParam(searchParams, 'category'), [searchParams]);
  const selBrands = useMemo(() => csvParam(searchParams, 'brand'), [searchParams]);
  const ratings = useMemo(
    () => csvParam(searchParams, 'rating').map(Number).filter((n) => !isNaN(n)),
    [searchParams]
  );
  const inStock = searchParams.get('inStock') === 'true';
  const make = searchParams.get('vehicleMake') ?? '';
  const model = searchParams.get('vehicleModel') ?? '';

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
  // Patches ONLY the keys it is handed, on top of the CURRENT url. It must not
  // rebuild the whole query from this component's view of the world, or a
  // change here would clobber a param another control just set.
  const commit = useCallback(
    (next: {
      price?: [number, number]; cats?: string[]; brands?: string[];
      ratings?: number[]; inStock?: boolean; make?: string; model?: string;
    }) => {
      const p = new URLSearchParams(searchParams.toString());
      p.delete('page'); // any filter change resets pagination

      const set = (k: string, arr: string[] | number[]) =>
        arr.length ? p.set(k, arr.join(',')) : p.delete(k);

      if (next.price) {
        const [lo, hi] = next.price;
        lo > PRICE_MIN ? p.set('minPrice', String(lo)) : p.delete('minPrice');
        hi < PRICE_MAX ? p.set('maxPrice', String(hi)) : p.delete('maxPrice');
      }
      if (next.cats) set('category', next.cats);
      if (next.brands) set('brand', next.brands);
      if (next.ratings) set('rating', next.ratings);
      if (next.inStock !== undefined) {
        next.inStock ? p.set('inStock', 'true') : p.delete('inStock');
      }
      // Make and model move together: clearing the make clears the model, and
      // switching make discards a model that belonged to the previous one.
      if (next.make !== undefined) {
        if (next.make) {
          p.set('vehicleMake', next.make);
          next.model ? p.set('vehicleModel', next.model) : p.delete('vehicleModel');
        } else {
          p.delete('vehicleMake');
          p.delete('vehicleModel');
        }
      } else if (next.model !== undefined) {
        next.model ? p.set('vehicleModel', next.model) : p.delete('vehicleModel');
      }

      const qs = p.toString();
      router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
      onApplied?.();
    },
    [searchParams, router, onApplied, basePath]
  );

  // The debounced price commit fires after the URL may have moved on, so it has
  // to reach for the LATEST commit rather than the one captured when the drag
  // started — otherwise releasing the slider writes back a pre-drag query.
  const commitRef = useRef(commit);
  useEffect(() => { commitRef.current = commit; });

  // Debounce only the price slider so dragging stays smooth.
  const priceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPriceChange = (next: [number, number]) => {
    setPrice(next);
    if (priceTimer.current) clearTimeout(priceTimer.current);
    priceTimer.current = setTimeout(() => commitRef.current({ price: next }), 350);
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
            onChange={(e) => commit({ make: e.target.value, model: '' })}
            className="w-full appearance-none border border-hairline bg-obsidian-raised px-3.5 py-2.5 text-[13px] text-ink outline-none focus:border-gold/55"
            aria-label="Vehicle make"
          >
            <option value="">All makes</option>
            {makes.map((mk) => <option key={mk} value={mk}>{mk}</option>)}
          </select>
          <select
            value={model}
            disabled={!make}
            onChange={(e) => commit({ model: e.target.value })}
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
      {!hideCategories && categories.length > 0 && (
        <Group title="Category">
          <div className="max-h-64 overflow-y-auto sf-noscroll">
            {categories.map((c) => (
              <CheckRow
                key={c._id}
                label={c.name}
                count={facetCategories[c._id]}
                checked={selCats.includes(c._id)}
                onChange={() => commit({ cats: toggle(selCats, c._id) })}
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
                onChange={() => commit({ brands: toggle(selBrands, b.name) })}
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
              onChange={() => commit({ ratings: toggle(ratings, r) })}
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
          onChange={() => commit({ inStock: !inStock })}
        />
      </Group>
    </div>
  );
}
