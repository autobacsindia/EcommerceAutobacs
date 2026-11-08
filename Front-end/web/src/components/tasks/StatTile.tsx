'use client';

import type { LucideIcon } from 'lucide-react';

const TONES = {
  neutral: 'bg-gray-100 text-gray-600',
  violet: 'bg-blue-100 text-blue-700',
  red: 'bg-red-100 text-red-700',
  amber: 'bg-amber-100 text-amber-700',
  sky: 'bg-sky-100 text-sky-700',
  green: 'bg-emerald-100 text-emerald-700',
} as const;

export type StatTone = keyof typeof TONES;

/** One number with its label. Quiet at zero; pressable only when it has somewhere to go. */
export function StatTile({ icon: Icon, label, value, tone = 'neutral', onClick, pressed }: {
  icon: LucideIcon; label: string; value: number; tone?: StatTone; onClick?: () => void; pressed?: boolean;
}) {
  const shownTone = value > 0 ? tone : 'neutral';
  const body = (
    <>
      <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${TONES[shownTone]}`}><Icon className="h-[18px] w-[18px]" /></span>
      <span className="min-w-0">
        <span className="block text-[22px] font-extrabold leading-none tabular-nums text-gray-900">{value}</span>
        <span className="mt-1 block truncate text-xs font-medium text-gray-500">{label}</span>
      </span>
    </>
  );
  const shell = `tk-tile flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left ${tone === 'red' && value > 0 ? 'tk-tile-hot' : ''}`;
  if (!onClick) return <div className={shell}>{body}</div>;
  return <button type="button" onClick={onClick} aria-pressed={!!pressed} className={`${shell} tk-tile-press`}>{body}</button>;
}
