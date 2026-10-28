'use client';

/**
 * Small building blocks every task screen shares: people's initials, status dots
 * and pills, priority flags, due-date pills, chips and loading rows.
 *
 * Colours: inside the panel `blue-*` IS the brand green (components/panel/
 * panel.css), so "in progress" uses `sky-*` to stay blue. Tinted chips use the
 * 100 background + 800 text steps, which the panel's dark theme re-maps; dots
 * and flags use mid steps that read on either theme.
 */
import { CalendarClock, Flag } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDueDay, type Task, type TaskPriority, type TaskStatus } from './types';

// ── Status ───────────────────────────────────────────────────────────────────

export const STATUS_STYLE: Record<TaskStatus, { dot: string; pill: string; bar: string; label: string }> = {
  todo: { dot: 'bg-gray-400', pill: 'bg-gray-100 text-gray-700', bar: 'border-t-gray-400', label: 'To do' },
  in_progress: { dot: 'bg-sky-500', pill: 'bg-sky-100 text-sky-800', bar: 'border-t-sky-500', label: 'In progress' },
  waiting: { dot: 'bg-amber-500', pill: 'bg-amber-100 text-amber-800', bar: 'border-t-amber-500', label: 'Waiting' },
  done: { dot: 'bg-emerald-500', pill: 'bg-emerald-100 text-emerald-800', bar: 'border-t-emerald-500', label: 'Done' },
};

/**
 * The panel styles every form control white with a grey border (globals.css
 * `.admin-panel select/input`), which outranks a single utility class. A status
 * dropdown that IS the coloured pill, or a borderless inline control, has to win
 * that with `!` — only on these few controls, never page-wide. Written out in
 * full: Tailwind only generates classes it can see in the source.
 */
const STATUS_SELECT: Record<TaskStatus, string> = {
  todo: 'bg-gray-100! text-gray-700!',
  in_progress: 'bg-sky-100! text-sky-800!',
  waiting: 'bg-amber-100! text-amber-800!',
  done: 'bg-emerald-100! text-emerald-800!',
};
export const statusSelectClass = (status: TaskStatus) =>
  `cursor-pointer rounded-full border-0! px-3 py-1 text-xs font-semibold ${STATUS_SELECT[status]}`;
/** A dropdown or field that looks like plain text until hovered or focused. */
export const quietControl = 'rounded-md border px-1.5 py-1 text-sm border-transparent! bg-transparent! hover:border-gray-200! hover:bg-gray-50! focus:border-blue-500!';

export function StatusDot({ status, className = '' }: { status: TaskStatus; className?: string }) {
  return <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_STYLE[status].dot} ${className}`} />;
}

export function StatusPill({ status, children }: { status: TaskStatus; children?: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status].pill}`}>
      <StatusDot status={status} />{children ?? STATUS_STYLE[status].label}
    </span>
  );
}

// ── Priority ─────────────────────────────────────────────────────────────────

export const PRIORITY_STYLE: Record<TaskPriority, { flag: string; label: string }> = {
  urgent: { flag: 'text-red-500', label: 'Urgent' },
  high: { flag: 'text-orange-500', label: 'High' },
  normal: { flag: 'text-sky-500', label: 'Normal' },
  low: { flag: 'text-gray-400', label: 'Low' },
};

export function PriorityFlag({ priority, withLabel = false }: { priority: TaskPriority; withLabel?: boolean }) {
  const s = PRIORITY_STYLE[priority];
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-700" title={`${s.label} priority`}>
      <Flag aria-hidden className={`h-3.5 w-3.5 ${s.flag}`} fill={priority === 'urgent' || priority === 'high' ? 'currentColor' : 'none'} />
      {withLabel ? s.label : <span className="sr-only">{s.label} priority</span>}
    </span>
  );
}

// ── People ───────────────────────────────────────────────────────────────────

// Families the panel's dark theme re-maps (100 background, 800 text).
const AVATAR_TONES = [
  'bg-teal-100 text-teal-800', 'bg-amber-100 text-amber-800', 'bg-purple-100 text-purple-800',
  'bg-rose-100 text-rose-800', 'bg-sky-100 text-sky-800', 'bg-indigo-100 text-indigo-800',
  'bg-orange-100 text-orange-800', 'bg-emerald-100 text-emerald-800',
];

export const initialsOf = (name: string) => {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

/** The same person always gets the same colour. */
export const toneFor = (key: string) => {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
};

export function Avatar({ name, id, size = 'sm' }: { name: string; id?: string; size?: 'xs' | 'sm' | 'md' }) {
  const dims = size === 'xs' ? 'h-5 w-5 text-[10px]' : size === 'md' ? 'h-8 w-8 text-xs' : 'h-6 w-6 text-[11px]';
  return (
    <span
      title={name}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${dims} ${toneFor(id || name)}`}
    >
      {initialsOf(name)}
    </span>
  );
}

// ── Due date ─────────────────────────────────────────────────────────────────

/** "Late · 21 Oct" (red), "Today" (amber), otherwise the day — or nothing. */
export function DuePill({ t, empty = null }: { t: Pick<Task, 'dueOn' | 'overdue' | 'dueToday' | 'bucket'>; empty?: ReactNode }) {
  if (!t.dueOn) return <>{empty}</>;
  const tone = t.overdue
    ? 'bg-red-100 text-red-800'
    : t.dueToday ? 'bg-amber-100 text-amber-800' : 'border border-gray-200 text-gray-600';
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${t.bucket === 'done' ? 'border border-gray-200 text-gray-400' : tone}`}>
      <CalendarClock aria-hidden className="h-3 w-3" />
      {t.bucket !== 'done' && t.overdue ? 'Late · ' : ''}{t.bucket !== 'done' && t.dueToday ? 'Today' : formatDueDay(t.dueOn)}
    </span>
  );
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export function Chip({ children, tone = 'bg-gray-100 text-gray-700', title }: { children: ReactNode; tone?: string; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>{children}</span>;
}

/** Grey bars in the shape of task rows, while a list loads. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 rounded-lg px-2 py-2.5">
          <span className="h-4 w-4 rounded-full bg-gray-200" />
          <span className="h-3.5 flex-1 rounded bg-gray-200" style={{ maxWidth: `${60 + ((i * 17) % 30)}%` }} />
          <span className="h-6 w-6 rounded-full bg-gray-200" />
          <span className="h-5 w-16 rounded-full bg-gray-200" />
        </div>
      ))}
    </div>
  );
}
