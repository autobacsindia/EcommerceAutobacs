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

/**
 * Fallback bounds, used ONLY until the facet response arrives (and if it never
 * does). These were previously the real, hardcoded bounds: PRICE_MAX was 100000
 * against a catalogue whose most expensive product is ₹814,200, so 176 products —
 * 19% of the catalogue — could not be reached by the price filter at all. Worse,
 * `commit` wrote `hi < PRICE_MAX ? set : delete`, so parking the max handle at
 * ₹100,000 DELETED maxPrice and silently meant "no upper limit".
 *
 * Real bounds now come from facets.price.{min,max}, derived from the current
 * result set, so the control cannot disagree with the catalogue again.
 */
const FALLBACK_PRICE_MIN = 0;
const FALLBACK_PRICE_MAX = 100000;

/** Read a comma-separated URL param as a list of non-empty values. */
const csvParam = (sp: URLSearchParams | ReturnType<typeof useSearchParams>, key: string): string[] =>
  (sp.get(key) ?? '').split(',').filter(Boolean);

/**
 * The facet response is the SINGLE SOURCE OF TRUTH for this panel — values,
 * counts, ordering and price bounds.
 *
 * It previously assembled its own values from three global reference lists
 * (/categories, /brands, /vehicles) and looked counts up afterwards. That is why
 * every value with zero results in the current context still rendered and was
 * still clickable — a dead end on each one — and why vehicle, rating and
 * availability had no counts at all.
 */
interface FacetValue { value: string; label: string; count: number; selected: boolean }
interface FacetCategory { categoryId: string; label: string; parentId: string | null; count: number; selected: boolean }
interface FacetVehicle { value: string; make?: string; count: number; selected: boolean }
interface FacetPrice {
  min: number; max: number;
  selectedMin: number | null; selectedMax: number | null;
  histogram: { from: number; to: number | null; count: number }[];
}
interface FacetRating { value: number; count: number; selected: boolean }
interface Facets {
  total: number | null;
  brands: FacetValue[];
  categories: FacetCategory[];
  vehicleMakes: FacetVehicle[];
  vehicleModels: FacetVehicle[];
  price: FacetPrice;
  ratings: FacetRating[];
  availability: FacetValue[];
}

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
  disabled = false,
  onChange,
}: {
  label: React.ReactNode;
  count?: number;
  checked: boolean;
  /** Zero results in the current context. Rendered but not selectable. */
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    // Disabled rather than hidden: a shopper looking for a specific brand should
    // see that it exists and simply has nothing under the current filters, rather
    // than silently not finding it. Previously every zero-count value was fully
    // clickable and led to an empty grid.
    <label
      className={`flex items-center gap-3 py-1.5 group ${
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
      }`}
      aria-disabled={disabled || undefined}
    >
      <input
        type="checkbox"
        className="pf-check"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
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
  const [facets, setFacets] = useState<Facets | null>(null);
  const [brandsExpanded, setBrandsExpanded] = useState(false);
  const [brandQuery, setBrandQuery] = useState('');

  // ── selection (DERIVED from the URL — never mirrored into state) ──
  // The chip strip, the active-filter chips and this sidebar all write the same
  // query params. Seeding local state from the URL once at mount meant any
  // navigation by one of the others left this panel showing a stale selection,
  // which `commit` would then write back and silently revert. The URL is the
  // single source of truth.
  // Bounds come from the facet response once it lands. Until then the fallbacks
  // stand in — but they are never used to decide whether to WRITE a bound (see
  // `commit`), which is what made the old hardcoded ceiling silently mean
  // "no maximum".
  const priceMin = facets?.price?.min ?? FALLBACK_PRICE_MIN;
  const priceMax = facets?.price?.max || FALLBACK_PRICE_MAX;
  const urlMin = Number(searchParams.get('minPrice')) || priceMin;
  const urlMax = Number(searchParams.get('maxPrice')) || priceMax;

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

  // ── one request: the facet response drives every group below ──
  // Replaces three separate reference fetches (/categories, /brands, /vehicles)
  // whose values were global rather than contextual, so they rendered options that
  // matched nothing under the current filters.
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const qs = searchParams.toString();
        const res = await apiClient.get<{ facets?: Facets }>(
          `/products/facets${qs ? `?${qs}` : ''}`,
          { signal: ac.signal }
        );
        if (res.facets) setFacets(res.facets);
      } catch { /* non-fatal: the panel keeps its previous values */ }
    })();
    return () => ac.abort();
  }, [searchParams]);

  const makes = facets?.vehicleMakes ?? [];
  // Models are already scoped to the selected make by the facet query's own
  // filters, so no client-side narrowing is needed — and unlike the old global
  // vehicle list, every entry here has at least one matching product.
  const models = facets?.vehicleModels ?? [];

  // Category tree: the panel used to render only top-level hubs (`!c.parent`)
  // though the taxonomy is two levels deep. parentId lets the children nest.
  const topCategories = (facets?.categories ?? []).filter((c) => !c.parentId);
  const childrenOf = (id: string) => (facets?.categories ?? []).filter((c) => c.parentId === id);

  const visibleBrandList = (facets?.brands ?? []).filter((b) =>
    brandQuery ? b.label.toLowerCase().includes(brandQuery.toLowerCase()) : true
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
        // Compared against the DATA bounds, not a hardcoded ceiling. With the old
        // constant, dragging the max handle to ₹100,000 deleted `maxPrice`
        // entirely — so selecting a maximum silently meant "no maximum", the exact
        // opposite of the shopper's intent, for every product above that price.
        lo > priceMin ? p.set('minPrice', String(lo)) : p.delete('minPrice');
        hi < priceMax ? p.set('maxPrice', String(hi)) : p.delete('maxPrice');
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
      // push, not replace: shoppers expect Back to undo a filter. `replace` made
      // the browser Back button skip the entire filtering session and leave the
      // listing altogether.
      router.push(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
      onApplied?.();
    },
    [searchParams, router, onApplied, basePath, priceMin, priceMax]
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


  // A dimension the catalogue cannot support must not render. Driven by the facet
  // response, never hardcoded: 926 of 931 products carry no rating, so four
  // clickable rating rows were four dead ends. The same rule hides the vehicle
  // group inside a category with no fitment data.
  const hasRatingSignal = (facets?.ratings ?? []).some((r) => r.count > 0);
  const hasVehicleSignal = makes.length > 0;
  const hasPriceSignal = (facets?.price?.max ?? 0) > (facets?.price?.min ?? 0);
  const total = facets?.total ?? null;

  return (
    <div className="font-display">
      {/* Live result count. Also what the mobile drawer's apply button reads, and
          announced politely so a screen-reader user hears the set change. */}
      {total != null && (
        <p className="sr-only" role="status" aria-live="polite">
          {total} {total === 1 ? 'product' : 'products'} match the current filters
        </p>
      )}

      {/* Nothing matches — name the way out rather than leaving a dead panel. */}
      {total === 0 && (
        <div className="mb-4 border border-hairline bg-obsidian-raised px-3.5 py-3">
          <p className="font-display text-[12px] font-light text-ink-muted">
            No products match every filter.
          </p>
          <button
            type="button"
            onClick={() => router.push(basePath, { scroll: false })}
            className="mt-2 font-display text-[10px] uppercase tracking-[0.2em] text-gold hover:opacity-80"
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* Vehicle fitment */}
      {hasVehicleSignal && (
        <Group title="My Vehicle" defaultOpen={!!make}>
          <div className="space-y-2">
            <select
              value={make}
              onChange={(e) => commit({ make: e.target.value, model: '' })}
              className="w-full appearance-none border border-hairline bg-obsidian-raised px-3.5 py-2.5 text-[13px] text-ink outline-none focus:border-gold/55"
              aria-label="Vehicle make"
            >
              <option value="">All makes</option>
              {/* Counts come from the facet response, so a make with no matching
                  product under the current filters is never offered. */}
              {makes.map((mk) => (
                <option key={mk.value} value={mk.value}>{mk.value} ({mk.count})</option>
              ))}
            </select>
            <select
              value={model}
              disabled={!make || models.length === 0}
              onChange={(e) => commit({ model: e.target.value })}
              className="w-full appearance-none border border-hairline bg-obsidian-raised px-3.5 py-2.5 text-[13px] text-ink outline-none focus:border-gold/55 disabled:opacity-50"
              aria-label="Vehicle model"
            >
              <option value="">{make ? 'All models' : 'Select a make first'}</option>
              {models.map((md) => (
                <option key={md.value} value={md.value}>{md.value} ({md.count})</option>
              ))}
            </select>
          </div>
        </Group>
      )}

      {/* Price — bounds and distribution both come from the current result set */}
      {hasPriceSignal && (
        <Group title="Price Range">
          <PriceHistogram
            value={price}
            min={priceMin}
            max={priceMax}
            step={Math.max(1, Math.round((priceMax - priceMin) / 200))}
            // The real distribution. This prop already existed and was simply
            // never passed, so the component fell back to SYNTH — a hardcoded
            // decorative bell curve unrelated to the catalogue.
            buckets={(facets?.price?.histogram ?? []).map((b) => b.count)}
            format={formatPrice}
            onChange={onPriceChange}
          />
        </Group>
      )}

      {/* Categories — two levels, per the real taxonomy */}
      {!hideCategories && topCategories.length > 0 && (
        <Group title="Category">
          <div className="max-h-72 overflow-y-auto sf-noscroll">
            {topCategories.map((c) => (
              <div key={c.categoryId}>
                <CheckRow
                  label={c.label}
                  count={c.count}
                  checked={selCats.includes(c.categoryId)}
                  disabled={c.count === 0 && !selCats.includes(c.categoryId)}
                  onChange={() => commit({ cats: toggle(selCats, c.categoryId) })}
                />
                {childrenOf(c.categoryId).length > 0 && (
                  <div className="ml-4 border-l border-hairline pl-3">
                    {childrenOf(c.categoryId).map((child) => (
                      <CheckRow
                        key={child.categoryId}
                        label={child.label}
                        count={child.count}
                        checked={selCats.includes(child.categoryId)}
                        disabled={child.count === 0 && !selCats.includes(child.categoryId)}
                        onChange={() => commit({ cats: toggle(selCats, child.categoryId) })}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Group>
      )}

      {/* Brands */}
      {(facets?.brands?.length ?? 0) > 0 && (
        <Group title="Brand">
          <div>
            {/* Search-within-facet. 37 brands today and growing; a flat list past
                ~8 entries stops being scannable. */}
            {(facets?.brands?.length ?? 0) > 8 && (
              <input
                type="search"
                value={brandQuery}
                onChange={(e) => setBrandQuery(e.target.value)}
                placeholder="Search brands"
                aria-label="Search brands"
                className="mb-2 w-full border border-hairline bg-obsidian-raised px-3 py-2 text-[12px] text-ink outline-none focus:border-gold/55"
              />
            )}
            {(brandsExpanded || brandQuery ? visibleBrandList : visibleBrandList.slice(0, 8)).map((b) => (
              <CheckRow
                key={b.value}
                label={b.label}
                count={b.count}
                checked={selBrands.includes(b.value)}
                disabled={b.count === 0 && !b.selected}
                onChange={() => commit({ brands: toggle(selBrands, b.value) })}
              />
            ))}
            {!brandQuery && visibleBrandList.length > 8 && (
              <button
                type="button"
                onClick={() => setBrandsExpanded((v) => !v)}
                className="mt-2 font-display text-[10px] uppercase tracking-[0.2em] text-gold hover:opacity-80"
              >
                {brandsExpanded ? 'Show less' : `More brands (${visibleBrandList.length - 8})`}
              </button>
            )}
          </div>
        </Group>
      )}

      {/* Rating — hidden entirely when the catalogue has no rating signal */}
      {hasRatingSignal && (
        <Group title="Rating">
          <div>
            {(facets?.ratings ?? []).map((r) => (
              <CheckRow
                key={r.value}
                count={r.count}
                checked={ratings.includes(r.value)}
                disabled={r.count === 0 && !r.selected}
                onChange={() => commit({ ratings: toggle(ratings, r.value) })}
                label={
                  <span className="flex items-center gap-1.5">
                    <span className="text-gold tracking-[2px]">
                      {'★'.repeat(r.value)}<span className="text-hairline">{'★'.repeat(5 - r.value)}</span>
                    </span>
                    <span className="text-[11px]">&amp; up</span>
                  </span>
                }
              />
            ))}
          </div>
        </Group>
      )}

      {/* Availability */}
      <Group title="Availability">
        <CheckRow
          label="In stock only"
          count={facets?.availability?.[0]?.count}
          checked={inStock}
          onChange={() => commit({ inStock: !inStock })}
        />
      </Group>
    </div>
  );
}
