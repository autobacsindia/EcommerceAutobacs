import type { ReactNode } from 'react';

export type ChipTone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

const TONES: Record<ChipTone, string> = {
  ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  bad: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-sky-50 text-sky-800 ring-sky-200',
  muted: 'bg-gray-100 text-gray-600 ring-gray-200',
};

export default function StatusChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}
