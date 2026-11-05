'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';

/**
 * The pieces of a staff / admin list's search-and-filter bar. The server does
 * the searching and filtering (utils/listQuery.js), so every page of results
 * honours them — these only collect what the person wants. Each list lays out
 * the pieces it needs; they look and behave the same everywhere.
 */

export const listField = 'max-w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

/** The search box. Typing is local; the list reloads once the person pauses (not on every key). */
export function ListSearch({ value, onChange, placeholder, label }: {
  value: string;
  onChange: (q: string) => void;
  placeholder: string;
  label: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  useEffect(() => {
    if (text === value) return undefined;
    const t = setTimeout(() => onChange(text), 350);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return (
    <label className="relative block min-w-[12rem] flex-1">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onChange(text); }}
        placeholder={placeholder}
        aria-label={label}
        maxLength={60}
        className={`${listField} w-full pl-8`}
      />
    </label>
  );
}

export type Option = { value: string; label: string };

/** A dropdown filter; the empty value is "all". */
export function ListSelect({ label, value, onChange, options, allLabel }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly Option[];
  /** The "no filter" choice; omit for a select that always has a value (sort). */
  allLabel?: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
      className={`${listField} ${allLabel && value ? 'border-blue-500 bg-blue-50 text-blue-800' : ''}`}>
      {allLabel !== undefined && <option value="">{allLabel}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** From / to dates (India time; both days included — the server reads them that way). */
export function ListDateRange({ label, from, to, onChange, children }: {
  label: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** Optional control before the dates (e.g. "raised" / "paid"). */
  children?: ReactNode;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5 text-sm text-gray-600">
      <legend className="sr-only">{label}</legend>
      {children}
      <input type="date" aria-label={`${label}: from`} value={from} max={to || undefined}
        onChange={(e) => onChange(e.target.value, to)} className={listField} />
      <span aria-hidden>to</span>
      <input type="date" aria-label={`${label}: to`} value={to} min={from || undefined}
        onChange={(e) => onChange(from, e.target.value)} className={listField} />
    </fieldset>
  );
}

/** Rupee bounds. Applied when the box loses focus or Enter is pressed — not mid-typing. */
export function ListAmountRange({ min, max, onChange }: {
  min: string;
  max: string;
  onChange: (min: string, max: string) => void;
}) {
  const [lo, setLo] = useState(min);
  const [hi, setHi] = useState(max);
  useEffect(() => { setLo(min); }, [min]);
  useEffect(() => { setHi(max); }, [max]);
  const clean = (s: string) => s.replace(/[^\d.]/g, '');
  const apply = () => { if (lo !== min || hi !== max) onChange(lo, hi); };
  const box = (v: string, set: (s: string) => void, name: string) => (
    <input inputMode="decimal" aria-label={name} placeholder={name === 'Amount: from' ? '₹ min' : '₹ max'} value={v}
      onChange={(e) => set(clean(e.target.value))} onBlur={apply} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
      className={`${listField} w-24`} />
  );
  return (
    <fieldset className="flex items-center gap-1.5 text-sm text-gray-600">
      <legend className="sr-only">Amount</legend>
      {box(lo, setLo, 'Amount: from')}
      <span aria-hidden>to</span>
      {box(hi, setHi, 'Amount: to')}
    </fieldset>
  );
}

/** "Clear all" — shown only while something is filtered. */
export function ListClear({ onClear }: { onClear: () => void }) {
  return (
    <button type="button" onClick={onClear}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
      <X className="h-3.5 w-3.5" aria-hidden /> Clear all
    </button>
  );
}

/**
 * "48 payments found · total ₹3,42,500". The server stops counting at a cap
 * (it reports `capped`), so a huge match reads "1,000+" and asks for a narrower
 * range instead of showing a total that would be wrong.
 */
export function ListResultLine({ count, capped, noun, total, formatTotal }: {
  count: number;
  capped: boolean;
  noun: [string, string];
  total?: number | null;
  formatTotal?: (n: number) => string;
}) {
  const n = capped ? `${count.toLocaleString('en-IN')}+` : count.toLocaleString('en-IN');
  const word = !capped && count === 1 ? noun[0] : noun[1];
  return (
    <p role="status" className="text-sm text-gray-600">
      <span className="font-semibold text-gray-900">{n}</span> {word} found
      {!capped && total != null && formatTotal && count > 0 && <> · total <span className="font-semibold text-gray-900">{formatTotal(total)}</span></>}
      {capped && formatTotal && <> — narrow the dates or filters to see the total</>}
    </p>
  );
}
