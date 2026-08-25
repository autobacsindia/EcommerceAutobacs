'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import apiClient from '@/lib/api';
import { cn } from '@/lib/utils';
import './redesign.css';

interface Category { _id: string; name: string; parent?: unknown }

/**
 * Sticky horizontal category chip row (MLC reference), obsidian + gold.
 * Single-select on click: a chip sets `category` to that hub id, replacing any
 * multi-select made in the sidebar; "All" clears it. The HIGHLIGHT, though, is
 * membership-based — the sidebar writes a comma-separated `category`, so every
 * selected hub lights up here rather than none of them.
 */
export default function CategoryChips() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [cats, setCats] = useState<Category[]>([]);
  const active = useMemo(
    () => new Set((searchParams.get('category') ?? '').split(',').filter(Boolean)),
    [searchParams]
  );

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
    // A highlighted chip is expected to undo itself, but only when it IS the
    // whole selection — clicking one of several selected hubs narrows to it.
    const clear = !id || (active.has(id) && active.size === 1);
    clear ? p.delete('category') : p.set('category', id);
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
      {chip('All categories', '', active.size === 0)}
      {cats.map((c) => chip(c.name, c._id, active.has(c._id)))}
    </div>
  );
}
