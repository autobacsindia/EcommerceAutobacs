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
export function StatTile({ icon: Icon, label, value, tone = 'neutral', onClick, pressed, compact = false }: {
  icon: LucideIcon; label: string; value: number; tone?: StatTone; onClick?: () => void; pressed?: boolean; compact?: boolean;
}) {
  const body = compact ? (
    <>
      <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md lg:max-xl:hidden ${TONES[tone]}`}><Icon className="h-3.5 w-3.5" /></span>
      <span className="text-sm font-bold tabular-nums text-gray-900">{value}</span>
      <span className="truncate text-xs font-medium text-gray-600">{label}</span>
    </>
  ) : (
    <>
      <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${TONES[tone]}`}><Icon className="h-[18px] w-[18px]" /></span>
      <span className="min-w-0">
        <span className="block text-[22px] font-extrabold leading-none tabular-nums text-gray-900">{value}</span>
        <span className="mt-1 block truncate text-xs font-medium text-gray-600">{label}</span>
      </span>
    </>
  );
  const shell = `tk-tile flex min-w-0 items-center text-left ${compact ? 'h-8 shrink-0 gap-1.5 rounded-lg pl-1 pr-2.5 lg:max-xl:pl-2.5' : 'gap-3 rounded-xl px-3 py-2.5'} ${tone === 'red' && value > 0 ? 'tk-tile-hot' : ''}`;
  if (!onClick) return <div className={shell}>{body}</div>;
  return <button type="button" onClick={onClick} aria-pressed={!!pressed} className={`${shell} tk-tile-press`}>{body}</button>;
}
