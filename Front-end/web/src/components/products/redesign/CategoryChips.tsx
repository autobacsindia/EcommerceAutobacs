'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import apiClient from '@/lib/api';
import { cn } from '@/lib/utils';
import './redesign.css';

interface Category { _id: string; name: string; parent?: unknown }

/**
 * Sticky horizontal category chip row (MLC reference), obsidian + gold.
 * Single-select: a chip sets `category` to that hub id (replacing sidebar
 * multi-select); "All" clears it. Complements the multi-select sidebar.
 */
export default function CategoryChips() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [cats, setCats] = useState<Category[]>([]);
  const active = searchParams.get('category') ?? '';

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await apiClient.get<{ categories?: Category[] }>('/categories', { signal: ac.signal });
        setCats((res.categories ?? []).filter((c) => !c.parent));
      } catch { /* non-fatal */ }
    })();
    return () => ac.abort();
  }, []);

  const select = (id: string) => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete('page');
    id ? p.set('category', id) : p.delete('category');
    router.replace(`/products?${p.toString()}`, { scroll: false });
  };

  const chip = (label: string, id: string, on: boolean) => (
    <button
      key={id || 'all'}
      onClick={() => select(id)}
      className={cn(
        'whitespace-nowrap px-5 py-2.5 font-display text-[11px] uppercase tracking-[0.16em] transition-colors',
        on
          ? 'bg-gold text-obsidian'
          : 'border border-hairline text-ink-muted hover:border-gold/50 hover:text-ink'
      )}
    >
      {label}
    </button>
  );

  if (cats.length === 0) return null;

  return (
    <div className="sf-noscroll flex gap-2.5 overflow-x-auto">
      {chip('All categories', '', active === '')}
      {cats.map((c) => chip(c.name, c._id, active === c._id))}
    </div>
  );
}
