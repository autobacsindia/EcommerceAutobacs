'use client';

import { Star } from 'lucide-react';

/** 1–5 star buttons. `value` null = none chosen. Clicking the chosen star again clears it when `clearable`. */
export default function StarPicker({ value, onChange, label, clearable = false, disabled = false }: {
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
  clearable?: boolean;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value != null && n <= value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            disabled={disabled}
            onClick={() => onChange(clearable && value === n ? null : n)}
            className="rounded p-0.5 hover:bg-amber-50 disabled:opacity-50"
          >
            <Star className={`h-6 w-6 ${on ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
          </button>
        );
      })}
    </div>
  );
}

/** Read-only stars, e.g. "★★★★☆". */
export function Stars({ n, className = '' }: { n: number | null; className?: string }) {
  if (!n) return <span className={`text-gray-400 ${className}`}>—</span>;
  return (
    <span className={`inline-flex items-center ${className}`} aria-label={`${n} star${n === 1 ? '' : 's'}`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} aria-hidden className={`h-3.5 w-3.5 ${i <= n ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />)}
    </span>
  );
}
