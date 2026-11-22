'use client';

import { useEffect, useId, useState } from 'react';
import apiClient from '@/lib/api';

/**
 * "Where should this product's old link go?" — asked when a product is deleted
 * or switched off, so its Google ranking and old links land on a real page
 * instead of a 404. Emits a site path ("/products/<slug>" or
 * "/categories/<slug>") or null for the default.
 *
 * The backend re-validates the choice (live product/category only), stores it
 * in the redirect table, and the website starts using it within ~5 minutes.
 */
type Mode = 'default' | 'product' | 'category';
type Option = { slug: string; name: string };

export function modeOf(value: string | null): Mode {
  if (value?.startsWith('/products/')) return 'product';
  if (value?.startsWith('/categories/')) return 'category';
  return 'default';
}

export default function OldLinkTarget({
  value,
  onChange,
  defaultLabel,
  excludeSlug,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  /** What "no choice" means here, e.g. "Its own category (automatic)". */
  defaultLabel: string;
  /** The product being removed — never offered as its own replacement. */
  excludeSlug?: string | null;
}) {
  const id = useId();
  const [mode, setMode] = useState<Mode>(modeOf(value));
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMode(modeOf(value)), [value]);

  // Categories: loaded once, when that option is picked.
  useEffect(() => {
    if (mode !== 'category' || categories.length) return;
    let cancelled = false;
    apiClient.get<{ categories?: Option[] }>('/categories')
      .then((body) => {
        if (cancelled) return;
        const list = (body?.categories ?? []).filter((c) => c?.slug && c?.name);
        setCategories(list.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => !cancelled && setError('Could not load categories'));
    return () => { cancelled = true; };
  }, [mode, categories.length]);

  // Product search: debounced, live products only (the public list endpoint).
  useEffect(() => {
    if (mode !== 'product' || query.trim().length < 2) { setProducts([]); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      apiClient.get<{ products?: Option[] }>(`/products?search=${encodeURIComponent(query.trim())}&limit=8`)
        .then((body) => {
          if (!cancelled) setProducts((body?.products ?? []).filter((p) => p?.slug && p.slug !== excludeSlug));
        })
        .catch(() => !cancelled && setError('Search failed — try again'));
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [mode, query, excludeSlug]);

  const pick = (next: Mode) => {
    setMode(next);
    setError(null);
    if (next === 'default') onChange(null);
  };

  return (
    <fieldset className="space-y-2 text-sm">
      <legend className="font-medium text-gray-700">Where should its old link go?</legend>
      <p className="text-xs text-gray-500">So Google and old links land on a real page instead of &quot;page not found&quot;.</p>

      {([
        ['default', defaultLabel],
        ['product', 'A replacement product'],
        ['category', 'A category'],
      ] as Array<[Mode, string]>).map(([m, label]) => (
        <label key={m} className="flex items-center gap-2">
          <input type="radio" name={`${id}-mode`} checked={mode === m} onChange={() => pick(m)} />
          {label}
        </label>
      ))}

      {mode === 'product' && (
        <div className="ml-6 space-y-1">
          {value && modeOf(value) === 'product' && (
            <p className="text-xs text-gray-600">Chosen: <code>{value}</code></p>
          )}
          <input
            type="search"
            aria-label="Search for the replacement product"
            placeholder="Type a product name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1"
          />
          <ul className="max-h-40 overflow-auto">
            {products.map((p) => (
              <li key={p.slug}>
                <button
                  type="button"
                  onClick={() => onChange(`/products/${p.slug}`)}
                  className={`w-full rounded px-2 py-1 text-left hover:bg-gray-100 ${value === `/products/${p.slug}` ? 'bg-blue-50 font-medium' : ''}`}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mode === 'category' && (
        <select
          aria-label="Category for the old link"
          value={modeOf(value) === 'category' ? value ?? '' : ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="ml-6 w-[calc(100%-1.5rem)] rounded border border-gray-300 px-2 py-1"
        >
          <option value="">Choose a category…</option>
          {categories.map((c) => (
            <option key={c.slug} value={`/categories/${c.slug}`}>{c.name}</option>
          ))}
        </select>
      )}

      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </fieldset>
  );
}
