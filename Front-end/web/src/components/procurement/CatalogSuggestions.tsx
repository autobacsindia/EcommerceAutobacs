'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { enquiryKeys, searchCatalog, type CatalogProduct } from './enquiry';

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Catalogue matches for what is typed (2+ letters), shared by the enquiry form and the shipping calculator. */
export function CatalogSuggestions({ query, onPick }: { query: string; onPick: (p: CatalogProduct) => void }) {
  const q = useDebounced(query.trim(), 300);
  const res = useQuery({
    queryKey: enquiryKeys.products(q.toLowerCase()),
    queryFn: () => searchCatalog(q),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });
  const rows = res.data?.products ?? [];
  if (q.length < 2 || !rows.length) return null;
  if (rows.length === 1 && rows[0].name.toLowerCase() === q.toLowerCase()) return null;
  return (
    <ul role="listbox" aria-label="Catalogue products" className="mt-1 max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-blue-200 bg-white shadow-sm">
      {rows.map((p) => (
        <li key={p.id}>
          <button type="button" role="option" aria-selected={false} onClick={() => onPick(p)} className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50">
            <span className="font-medium text-gray-900">{p.name}</span>
            {p.sku && <span className="block text-xs text-gray-500">SKU {p.sku}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
