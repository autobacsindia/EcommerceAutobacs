'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import apiClient from '@/lib/api';
import { useCurrency } from '@/context/CurrencyContext';

interface Category { _id: string; name: string }

/** Dismissible chips summarising the active filters, with a Clear-all. */
export default function ActiveFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { formatPrice } = useCurrency();
  const [catNames, setCatNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await apiClient.get<{ categories?: Category[] }>('/categories', { signal: ac.signal });
        const map: Record<string, string> = {};
        res.categories?.forEach((c) => { map[c._id] = c.name; });
        setCatNames(map);
      } catch { /* non-fatal */ }
    })();
    return () => ac.abort();
  }, []);

  const chips: { key: string; label: string; remove: () => void }[] = [];
  const push = (key: string, label: string, remove: () => void) => chips.push({ key, label, remove });

  const replaceParams = (mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(searchParams.toString());
    mutate(p);
    p.delete('page');
    router.replace(`/products?${p.toString()}`, { scroll: false });
  };

  // csv params: remove a single value
  const removeFromCsv = (key: string, value: string) =>
    replaceParams((p) => {
      const rest = (p.get(key) ?? '').split(',').filter((v) => v && v !== value);
      rest.length ? p.set(key, rest.join(',')) : p.delete(key);
    });

  (searchParams.get('category') ?? '').split(',').filter(Boolean).forEach((id) =>
    push(`cat-${id}`, catNames[id] ?? 'Category', () => removeFromCsv('category', id))
  );
  (searchParams.get('brand') ?? '').split(',').filter(Boolean).forEach((b) =>
    push(`brand-${b}`, b, () => removeFromCsv('brand', b))
  );
  (searchParams.get('rating') ?? '').split(',').filter(Boolean).forEach((r) =>
    push(`rating-${r}`, `${r}★ & up`, () => removeFromCsv('rating', r))
  );

  const min = searchParams.get('minPrice');
  const max = searchParams.get('maxPrice');
  if (min || max) {
    push('price', `${formatPrice(Number(min) || 0)} – ${max ? formatPrice(Number(max)) : '∞'}`, () =>
      replaceParams((p) => { p.delete('minPrice'); p.delete('maxPrice'); })
    );
  }
  if (searchParams.get('inStock') === 'true') {
    push('stock', 'In stock', () => replaceParams((p) => p.delete('inStock')));
  }
  const mk = searchParams.get('vehicleMake');
  if (mk) {
    const md = searchParams.get('vehicleModel');
    push('vehicle', md ? `${mk} ${md}` : mk, () =>
      replaceParams((p) => { p.delete('vehicleMake'); p.delete('vehicleModel'); })
    );
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <button
          key={c.key}
          onClick={c.remove}
          className="group inline-flex items-center gap-2 border border-gold/40 px-3 py-1.5 font-display text-[11px] tracking-[0.04em] text-ink transition-colors hover:bg-gold hover:text-obsidian"
        >
          {c.label}
          <X className="h-3 w-3 text-gold transition-colors group-hover:text-obsidian" />
        </button>
      ))}
      <button
        onClick={() => replaceParams((p) => {
          ['category', 'brand', 'rating', 'minPrice', 'maxPrice', 'inStock', 'vehicleMake', 'vehicleModel'].forEach((k) => p.delete(k));
        })}
        className="font-display text-[10px] uppercase tracking-[0.2em] text-ink-muted underline-offset-4 hover:text-gold hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}
