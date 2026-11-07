'use client';

import { useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useListParams } from '@/lib/hooks/useListParams';
import {
  ListAmountRange, ListClear, ListDateRange, ListResultLine, ListSearch, ListSelect, listField, type Option,
} from '@/components/panel/ListControls';
import { rupees, type ListSummary } from '@/components/staff/sales/types';
import type { LineStage } from '@/components/staff/work/types';

/**
 * Search / filter / sort for the team order lists, kept in the page address (so
 * Back, a refresh or a shared link reopens the same view). The server does the
 * filtering (utils/orderListFilters.js), so every page of results honours it —
 * this only collects what the person wants. Three kinds of list use it:
 *
 *   work  — the work lists (Procurement, Deliveries, …): stage, website / salesman,
 *           expected delivery (Deliveries), ordered-on dates; newest / oldest
 *   paid  — Order processing / Delivered: website / salesman, ordered-on dates,
 *           order total; newest / oldest / amount
 *   sales — a seller's own orders (the head's: the team's): paid or not,
 *           salesman (head only), ordered-on dates; newest / oldest / amount;
 *           and which tab (`view`: active / on hold)
 *
 * The component using it must sit inside <Suspense> (the address is read with useSearchParams).
 */
export type OrderListKind = 'work' | 'paid' | 'sales';

const DEFAULTS = {
  q: '', step: '', source: '', eta: '', paid: '', seller: '', from: '', to: '', min: '', max: '', sort: 'newest', view: 'active',
};
type Key = keyof typeof DEFAULTS;
const FILTER_KEYS: Key[] = ['q', 'step', 'source', 'eta', 'paid', 'seller', 'from', 'to', 'min', 'max'];

export const STEPS: { value: LineStage; label: string }[] = [
  { value: 'stock_check', label: 'New Order' },
  { value: 'to_ship', label: 'In Stock' },
  { value: 'own_stock', label: 'Our Warehouse' },
  { value: 'payment_pending', label: 'Payment Pending' },
  { value: 'with_supplier', label: 'Ordered From Supplier' },
  { value: 'customer_decision', label: 'Out of stock — ask customer' },
  { value: 'accounts_approval', label: 'Refund — waiting for accounts' },
  { value: 'shipped', label: 'Dispatched' },
];
const SOURCES: Option[] = [{ value: 'website', label: 'Website orders' }, { value: 'sales', label: 'Salesman orders' }];
const ETAS: Option[] = [
  { value: 'due_today', label: 'Due today' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'none', label: 'No delivery date set' },
];
const PAID: Option[] = [{ value: 'paid', label: 'Paid' }, { value: 'unpaid', label: 'Not paid yet' }];
const DATE_SORTS: Option[] = [{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }];
const AMOUNT_SORTS: Option[] = [
  ...DATE_SORTS,
  { value: 'amount_desc', label: 'Amount: high to low' },
  { value: 'amount_asc', label: 'Amount: low to high' },
];

/** Which filters a kind of list offers (anything else in the address is ignored). */
const OFFERS: Record<OrderListKind, Key[]> = {
  work: ['q', 'step', 'source', 'eta', 'from', 'to'],
  paid: ['q', 'source', 'from', 'to', 'min', 'max'],
  sales: ['q', 'paid', 'seller', 'from', 'to'],
};
const valid: Partial<Record<Key, (v: string) => boolean>> = {
  step: (v) => STEPS.some((s) => s.value === v),
  source: (v) => SOURCES.some((s) => s.value === v),
  eta: (v) => ETAS.some((s) => s.value === v),
  paid: (v) => PAID.some((s) => s.value === v),
};

/**
 * The list's settings from the page address, and `params` — what to send to
 * the server (only what is set and offered). `showEta`: the Deliveries list.
 */
export function useOrderListParams(kind: OrderListKind, { showEta = false }: { showEta?: boolean } = {}) {
  const { values: raw, set, clear } = useListParams(DEFAULTS);
  const offered = OFFERS[kind].filter((k) => k !== 'eta' || showEta);
  const sorts = kind === 'work' ? DATE_SORTS : AMOUNT_SORTS;
  const v = { ...raw };
  for (const k of FILTER_KEYS) {
    const check = valid[k];
    if (!offered.includes(k) || (v[k] && check && !check(v[k]))) v[k] = '';
  }
  // A sort this list does not offer (an old link) falls back to newest.
  if (!sorts.some((s) => s.value === v.sort)) v.sort = 'newest';
  if (kind !== 'sales' || v.view !== 'on_hold') v.view = 'active';
  const params: Record<string, string> = Object.fromEntries([
    ...FILTER_KEYS.filter((k) => v[k]).map((k) => [k, v[k]]),
    ...(v.sort !== 'newest' ? [['sort', v.sort]] : []),
    ...(kind === 'sales' ? [['view', v.view]] : []),
  ]);
  const filtered = FILTER_KEYS.some((k) => v[k]);
  return { kind, v, set, clear, params, filtered, sorts, offered };
}

export type OrderListState = ReturnType<typeof useOrderListParams>;

/**
 * The bar itself. `summary`: the server's count (and total) for the paid and
 * sales lists; a work list passes `shown` instead — how many are loaded, with
 * `more` when another page follows ("25+").
 */
export default function OrderListFilters({ list, summary, shown, sellers = [], children }: {
  list: OrderListState;
  summary?: ListSummary;
  shown?: { count: number; more: boolean };
  /** The "Salesman" choices (sales lists, head only). */
  sellers?: { id: string; name: string }[];
  /** Anything else for the result row (a Refresh button). */
  children?: ReactNode;
}) {
  const { v, set, clear, filtered, sorts, offered } = list;
  const [showFilters, setShowFilters] = useState(false);
  const has = (k: Key) => offered.includes(k);
  const filtersOn = [v.step, v.source, v.eta, v.paid, v.seller, v.from || v.to, v.min || v.max].filter(Boolean).length;
  const id = `order-filters-${list.kind}`;

  return (
    <div role="search" aria-label="Search and filter orders" className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ListSearch value={v.q} onChange={(text) => set({ q: text.trim() })} label="Search orders"
          placeholder="Search order #, customer, phone, email, product, city" />
        <ListSelect label="Sort" value={v.sort} onChange={(x) => set({ sort: x })} options={sorts} />
        <button type="button" onClick={() => setShowFilters((x) => !x)} aria-expanded={showFilters} aria-controls={id}
          className={`${listField} inline-flex items-center gap-1.5 sm:hidden`}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden /> Filters{filtersOn ? ` · ${filtersOn} on` : ''}
        </button>
      </div>
      <div id={id} className={`${showFilters ? 'flex' : 'hidden'} flex-wrap items-center gap-2 sm:flex`}>
        {has('step') && <ListSelect label="Stage" value={v.step} onChange={(x) => set({ step: x })} options={STEPS} allLabel="All stages" />}
        {has('eta') && <ListSelect label="Expected delivery" value={v.eta} onChange={(x) => set({ eta: x })} options={ETAS} allLabel="All delivery dates" />}
        {has('source') && <ListSelect label="Sold by" value={v.source} onChange={(x) => set({ source: x })} options={SOURCES} allLabel="Website + salesmen" />}
        {has('paid') && <ListSelect label="Payment" value={v.paid} onChange={(x) => set({ paid: x })} options={PAID} allLabel="Paid or not" />}
        {has('seller') && sellers.length > 0 && (
          <ListSelect label="Salesman" value={v.seller} onChange={(x) => set({ seller: x })} allLabel="Any salesman"
            options={sellers.map((p) => ({ value: p.id, label: p.name }))} />
        )}
        <ListDateRange label="Paid / created on" from={v.from} to={v.to} onChange={(from, to) => set({ from, to })}>
          <span>Ordered</span>
        </ListDateRange>
        {has('min') && <ListAmountRange min={v.min} max={v.max} onChange={(min, max) => set({ min, max })} />}
      </div>
      <div className="flex min-h-[1.75rem] flex-wrap items-center justify-between gap-2">
        {summary
          ? <ListResultLine count={summary.count} capped={summary.capped} total={summary.total} noun={['order', 'orders']} formatTotal={rupees} />
          : shown
            ? <ListResultLine count={shown.count} capped={shown.more} noun={['order', 'orders']} />
            : <span />}
        <div className="flex items-center gap-2">
          {filtered && <ListClear onClear={() => clear(['sort', 'view'])} />}
          {children}
        </div>
      </div>
    </div>
  );
}
