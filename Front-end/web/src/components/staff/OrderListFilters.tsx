'use client';

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { STAGE_TONE, type LineStage } from '@/components/staff/work/types';

/**
 * Search / filter / sort bar for the team order lists. The server does the
 * filtering (utils/orderListFilters.js), so every page of results honours it —
 * this only collects what the person wants.
 */
export type ListFilters = { q: string; step: '' | LineStage; source: '' | 'website' | 'sales'; sort: 'newest' | 'oldest' };
export const NO_FILTERS: ListFilters = { q: '', step: '', source: '', sort: 'newest' };

/** `&q=…&step=…` for the API (empty values left out). */
export function filterQuery(f: ListFilters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.step) p.set('step', f.step);
  if (f.source) p.set('source', f.source);
  if (f.sort !== 'newest') p.set('sort', f.sort);
  const s = p.toString();
  return s ? `&${s}` : '';
}

export const isFiltered = (f: ListFilters) => !!(f.q.trim() || f.step || f.source);

const STEPS: { value: LineStage; label: string }[] = [
  { value: 'stock_check', label: 'New Order' },
  { value: 'to_ship', label: 'In Stock' },
  { value: 'payment_pending', label: 'Payment Pending' },
  { value: 'with_supplier', label: 'Ordered From Supplier' },
  { value: 'customer_decision', label: 'Out of stock — ask customer' },
  { value: 'accounts_approval', label: 'Refund — waiting for accounts' },
  { value: 'shipped', label: 'Dispatched' },
];

const field = 'rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

export default function OrderListFilters({
  value, onChange, showStage = false,
}: { value: ListFilters; onChange: (f: ListFilters) => void; showStage?: boolean }) {
  // Typing is local; the list reloads once the person pauses (not on every key).
  const [text, setText] = useState(value.q);
  useEffect(() => { setText(value.q); }, [value.q]);
  useEffect(() => {
    if (text === value.q) return undefined;
    const t = setTimeout(() => onChange({ ...value, q: text }), 350);
    return () => clearTimeout(t);
  }, [text, value, onChange]);

  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Search and filter orders">
      <label className="relative min-w-[12rem] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search customer, phone, product, order #, city"
          aria-label="Search orders"
          maxLength={60}
          className={`${field} w-full pl-8`}
        />
      </label>
      {showStage && (
        <select aria-label="Stage" value={value.step} onChange={(e) => onChange({ ...value, step: e.target.value as ListFilters['step'] })}
          className={`${field} ${value.step ? STAGE_TONE[value.step] : ''}`}>
          <option value="">All stages</option>
          {STEPS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      )}
      <select aria-label="Sold by" value={value.source} onChange={(e) => onChange({ ...value, source: e.target.value as ListFilters['source'] })} className={field}>
        <option value="">Website + salesmen</option>
        <option value="website">Website orders</option>
        <option value="sales">Salesman orders</option>
      </select>
      <select aria-label="Sort" value={value.sort} onChange={(e) => onChange({ ...value, sort: e.target.value as ListFilters['sort'] })} className={field}>
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
      </select>
      {isFiltered(value) && (
        <button type="button" onClick={() => { setText(''); onChange({ ...NO_FILTERS, sort: value.sort }); }}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      )}
    </div>
  );
}
