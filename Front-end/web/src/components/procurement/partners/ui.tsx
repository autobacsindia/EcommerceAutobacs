'use client';

import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { formatDateIST } from '@/lib/datetime';
import { errorMessage } from './api';

/** Small shared pieces of the partner screens. */

export const btn = {
  primary: 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50',
  secondary: 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50',
  danger: 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50',
};

export const when = (iso: string | null) => (iso ? formatDateIST(iso) : '—');

export function Pills<T extends string>({ value, options, onChange, label }: {
  value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-2">
      {options.map(([key, text]) => (
        <button key={key} type="button" role="tab" aria-selected={value === key} onClick={() => onChange(key)}
          className={`rounded-full px-3 py-1.5 text-sm font-medium ${value === key ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Loading() {
  return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
}

export function LoadError({ error, retry, what }: { error: unknown; retry: () => void; what: string }) {
  return (
    <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
      {errorMessage(error, `Could not load ${what}.`)} <button type="button" className="underline" onClick={retry}>Try again</button>
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">{children}</p>;
}

export function MoreButton({ hasMore, loading, onMore }: { hasMore: boolean; loading: boolean; onMore: () => void }) {
  if (!hasMore) return null;
  return (
    <button type="button" onClick={onMore} disabled={loading}
      className="w-full rounded-lg border border-gray-300 bg-white py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
      {loading ? 'Loading…' : 'Show more'}
    </button>
  );
}

/**
 * "Ask to fix" / "Reject" / "Pause": a note the supplier will read, then confirm.
 * The note is required (the server says so too).
 */
export function NoteAction({ label, title, hint, placeholder, danger = false, busy, onSubmit, needNote = true }: {
  label: string; title: string; hint: string; placeholder: string; danger?: boolean; busy: boolean;
  onSubmit: (note: string) => void; needNote?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  if (!open) {
    return <button type="button" className={danger ? btn.danger : btn.secondary} onClick={() => setOpen(true)}>{label}</button>;
  }
  return (
    <div className="w-full space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="text-xs text-gray-500">{hint}</p>
      {needNote && (
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} placeholder={placeholder}
          aria-label={title} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || (needNote && note.trim().length < 5)} className={danger ? btn.danger : btn.primary}
          onClick={() => onSubmit(note.trim())}>
          {busy ? 'Saving…' : label}
        </button>
        <button type="button" className={btn.secondary} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
