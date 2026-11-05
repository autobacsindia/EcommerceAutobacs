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
import { usePanelPhotos } from '@/hooks/queries/usePanelPhotos';
import { CalendarClock, CircleCheck, CircleDashed, CircleDot, Flag, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { DUE_TIMES, formatDue, formatDueTime, type Task, type TaskPriority, type TaskStatus } from './types';
import './tasks.css';

// ── Status ───────────────────────────────────────────────────────────────────

export const STATUS_STYLE: Record<TaskStatus, { dot: string; pill: string; bar: string; label: string }> = {
  todo: { dot: 'bg-gray-400', pill: 'bg-gray-100 text-gray-700', bar: 'border-t-gray-400', label: 'To do' },
  in_progress: { dot: 'bg-sky-500', pill: 'bg-sky-100 text-sky-800', bar: 'border-t-sky-500', label: 'In progress' },
  done: { dot: 'bg-emerald-500', pill: 'bg-emerald-100 text-emerald-800', bar: 'border-t-emerald-500', label: 'Complete' },
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

/*
  Solid faces with white initials (`.tk-face` in tasks.css). Each colour carries
  white at 4.5:1 or better, and reads on a dark page too, so no dark-mode remap.
*/
const AVATAR_COLOURS = ['#0f766e', '#b45309', '#7e22ce', '#be123c', '#0369a1', '#4338ca', '#c2410c', '#047857'];

export const initialsOf = (name: string) => {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

/** The same person always gets the same colour. */
export const colourFor = (key: string) => {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
};

export function Avatar({ name, id, size = 'sm' }: { name: string; id?: string; size?: 'xs' | 'sm' | 'md' }) {
  const dims = size === 'xs' ? 'h-5 w-5 text-[9px]' : size === 'md' ? 'h-8 w-8 text-xs' : 'h-6 w-6 text-[10px]';
  const photo = usePanelPhotos()[id ?? ''];
  return (
    <span
      title={name}
      style={{ background: colourFor(id || name) }}
      className={`tk-face inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold tracking-tight ${dims}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : initialsOf(name)}
    </span>
  );
}

/** Overlapping faces, then "+n" for the rest. Everyone is named for screen readers. */
export function AvatarStack({ people, max = 3, size = 'xs' }: { people: { id: string; name: string }[]; max?: number; size?: 'xs' | 'sm' }) {
  if (!people.length) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  const dims = size === 'xs' ? 'h-5 min-w-5 text-[10px]' : 'h-6 min-w-6 text-[11px]';
  return (
    <span className="tk-stack inline-flex items-center" role="img" aria-label={people.map((p) => p.name).join(', ')}>
      {shown.map((p) => <Avatar key={p.id || p.name} name={p.name} id={p.id} size={size} />)}
      {rest > 0 && (
        <span title={people.slice(max).map((p) => p.name).join(', ')} className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gray-200 px-1 font-semibold text-gray-700 ${dims}`}>
          +{rest}
        </span>
      )}
    </span>
  );
}

// ── Due date ─────────────────────────────────────────────────────────────────

/** What a due date says: "Late · 21 Oct", "Late · 5:30 PM" (earlier today), "Today 5:30 PM", "6 Nov, 10 AM". */
export function dueLabel(t: Pick<Task, 'dueOn' | 'dueTime' | 'overdue' | 'dueToday' | 'bucket'>): string {
  if (!t.dueOn) return '';
  if (t.bucket === 'done') return formatDue(t.dueOn, t.dueTime);
  const time = formatDueTime(t.dueTime);
  if (t.overdue) return `Late · ${t.dueToday && time ? time : formatDue(t.dueOn, t.dueTime)}`;
  if (t.dueToday) return time ? `Today ${time}` : 'Today';
  return formatDue(t.dueOn, t.dueTime);
}

/**
 * A due time, picked from a list (every 15 minutes, like ClickUp): one change
 * is one save, which a native time box (a save per digit) would not be.
 */
export function DueTimeSelect({ value, onChange, className = '', disabled = false, label = 'Due time' }: {
  value: string | null | undefined; onChange: (v: string | null) => void; className?: string; disabled?: boolean; label?: string;
}) {
  const times = value && !DUE_TIMES.includes(value) ? [...DUE_TIMES, value].sort() : DUE_TIMES;
  return (
    <select aria-label={label} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} className={className}>
      <option value="">No time</option>
      {times.map((t) => <option key={t} value={t}>{formatDueTime(t)}</option>)}
    </select>
  );
}

/** The due date as a pill: red when late, amber today, otherwise quiet — or nothing. */
export function DuePill({ t, empty = null }: { t: Pick<Task, 'dueOn' | 'dueTime' | 'overdue' | 'dueToday' | 'bucket'>; empty?: ReactNode }) {
  if (!t.dueOn) return <>{empty}</>;
  const tone = t.overdue
    ? 'bg-red-100 text-red-800'
    : t.dueToday ? 'bg-amber-100 text-amber-800' : 'border border-gray-200 text-gray-600';
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${t.bucket === 'done' ? 'border border-gray-200 text-gray-400' : tone}`}>
      <CalendarClock aria-hidden className="h-3 w-3" />
      {dueLabel(t)}
    </span>
  );
}

// ── Tags ─────────────────────────────────────────────────────────────────────

// Families the panel's dark theme re-maps (100 tint, 800 ink).
const TAG_TONES = [
  'bg-sky-100 text-sky-800', 'bg-violet-100 text-violet-800', 'bg-teal-100 text-teal-800', 'bg-rose-100 text-rose-800',
  'bg-amber-100 text-amber-800', 'bg-indigo-100 text-indigo-800', 'bg-emerald-100 text-emerald-800', 'bg-orange-100 text-orange-800',
  'bg-pink-100 text-pink-800', 'bg-purple-100 text-purple-800',
];
/** The same tag is the same colour everywhere, for everyone. */
export const tagTone = (tag: string) => {
  let h = 7;
  for (const ch of tag) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return TAG_TONES[h % TAG_TONES.length];
};

/** A tag. `onClick` makes it a filter; `onRemove` shows a ×. */
export function TagChip({ tag, onClick, onRemove, active = false }: {
  tag: string; onClick?: () => void; onRemove?: () => void; active?: boolean;
}) {
  const cls = `inline-flex max-w-[11rem] items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tagTone(tag)} ${active ? 'ring-2 ring-current' : ''}`;
  const text = <span className="truncate">{tag}</span>;
  return (
    <span className={cls}>
      {onClick ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} title={`Show only “${tag}”`} className="truncate hover:underline">{text}</button>
      ) : text}
      {onRemove && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={`Remove tag ${tag}`} className="-mr-0.5 rounded opacity-70 hover:opacity-100">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

/**
 * A group heading as a pill. A status is solid colour with a white label
 * (`.tk-pill` in tasks.css; the Tailwind tone is the fallback outside Tasks),
 * anything else neutral.
 */
/** The icon in a status pill: an empty ring to do, a dot in progress, a tick done. */
const STATUS_ICON: Record<TaskStatus, LucideIcon> = {
  todo: CircleDashed, in_progress: CircleDot, done: CircleCheck,
};

export function GroupPill({ status, children }: { status?: TaskStatus; children: ReactNode }) {
  if (status) {
    const Icon = STATUS_ICON[status];
    return (
      <span data-status={status} className={`tk-pill inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLE[status].pill}`}>
        <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />{children}
      </span>
    );
  }
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-gray-100 px-2 text-[11px] font-bold uppercase tracking-wide text-gray-800">
      {children}
    </span>
  );
}

/** The number beside a group pill, in the status colour. */
export function GroupCount({ status, children }: { status?: TaskStatus; children: ReactNode }) {
  return <span data-status={status} className={`${status ? 'tk-count' : 'text-gray-500'} text-[13px] font-semibold tabular-nums`}>{children}</span>;
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
