'use client';

import { useEffect, useLayoutEffect, type RefObject } from 'react';
import { ArrowLeftRight, FileSpreadsheet, FileText, File as FileIcon, Hash, Image as ImageIcon, Lock, Users, X } from 'lucide-react';
import type { ChatChannel, ChatPerson } from '@/hooks/queries/useTeamChat';

/**
 * A pop-up hanging below its message (⋮ menu, emoji picker) on one of the last
 * messages would run under the composer. If it is cut at the bottom of the
 * scrolling list and fits above, open it upwards instead.
 */
export function useOpenUpwardIfCut(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    const anchor = el?.offsetParent;
    if (!el || !anchor) return;
    let scroller = el.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const bounds = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const box = el.getBoundingClientRect();
    const roomAbove = anchor.getBoundingClientRect().top - bounds.top;
    if (box.bottom > bounds.bottom && roomAbove >= box.height) {
      el.style.top = 'auto';
      el.style.bottom = '100%';
    }
  }, [ref]);
}

/** The chat's primary fill (a solid blue badge / button); `text-white` reads dark on it in dark mode. */
export const PRIMARY_FILL = 'bg-blue-600 text-white';

export const newClientId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';

/**
 * A stable colour per person, so the same face is the same colour everywhere.
 * Derived from the name, not from list position, which would shuffle on reorder.
 */
// Solid circles with white initials. Fixed hex, so dark mode keeps them; white on each is ≥4.6:1.
const AVATAR_COLOURS = [
  'bg-[#1967d2] text-[#fff]',
  'bg-[#137333] text-[#fff]',
  'bg-[#b06000] text-[#fff]',
  'bg-[#8430ce] text-[#fff]',
  'bg-[#c5221f] text-[#fff]',
  'bg-[#00796b] text-[#fff]',
];
export function colourFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

/** A list timestamp: the time today, otherwise the date. */
export function shortWhen(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? timeOf(iso)
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileKindIcon({ mime, className = 'h-5 w-5' }: { mime: string; className?: string }) {
  if (mime.startsWith('image/')) return <ImageIcon className={className} aria-hidden="true" />;
  if (mime === 'application/pdf') return <FileText className={className} aria-hidden="true" />;
  if (mime.includes('sheet') || mime === 'text/csv') return <FileSpreadsheet className={className} aria-hidden="true" />;
  return <FileIcon className={className} aria-hidden="true" />;
}

export function Avatar({
  person,
  system,
  size = 'md',
  online,
}: {
  person: ChatPerson | null;
  system?: boolean;
  size?: 'sm' | 'md';
  /** Draw the green "has chat open" dot. */
  online?: boolean;
}) {
  const box = size === 'sm' ? 'h-7 w-7 text-[11px]' : 'h-9 w-9 text-sm';
  if (system) {
    return (
      <span className={`grid ${box} shrink-0 place-items-center rounded-full font-bold ${PRIMARY_FILL}`} aria-hidden="true">
        R
      </span>
    );
  }
  const name = person?.name ?? '?';
  const face = (
    <span className={`grid ${box} shrink-0 place-items-center rounded-full font-bold ${colourFor(name)}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
  if (!online) return face;
  return (
    <span className="relative inline-flex shrink-0">
      {face}
      <OnlineDot />
    </span>
  );
}

/** One colour per team, used for its badge and its conversation icon. */
const TEAM_COLOURS: Record<string, string> = {
  sales: 'bg-sky-100 text-sky-800',
  procurement: 'bg-amber-100 text-amber-800',
  accounts: 'bg-violet-100 text-violet-800',
  operations: 'bg-teal-100 text-teal-800',
  marketing: 'bg-rose-100 text-rose-800',
};
export const teamColour = (team: string | null | undefined) =>
  (team && TEAM_COLOURS[team]) || 'bg-gray-100 text-gray-700';

/** "GTM", "Procurement" … in quiet grey beside a name. Admins read "Admin". */
export function TeamBadge({ person }: { person: ChatPerson | null }) {
  if (!person?.teamLabel) return null;
  return (
    <span className="text-xs text-gray-500">
      {person.teamLabel}{person.isHead ? ' · Head' : ''}
    </span>
  );
}

export function ChannelIcon({ channel, size = 'sm' }: { channel: ChatChannel; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-10 w-10 text-sm' : size === 'md' ? 'h-9 w-9 text-sm' : 'h-7 w-7 text-[11px]';
  // People keep their colour (a face you recognise); spaces and team pairs are a
  // calm grey circle, so the list is not a wall of coloured tiles.
  const quiet = `grid ${box} shrink-0 place-items-center rounded-full bg-gray-200/70 text-gray-600`;
  if (channel.kind === 'dm' && channel.group) {
    return (
      <span className={quiet} aria-hidden="true">
        <Users className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (channel.kind === 'dm') {
    return (
      <span className={`grid ${box} shrink-0 place-items-center rounded-full font-bold ${colourFor(channel.name)}`} aria-hidden="true">
        {initials(channel.name)}
      </span>
    );
  }
  const Icon = channel.audience === 'teams' ? ArrowLeftRight : channel.audience === 'members' ? Lock : Hash;
  return (
    <span className={quiet} aria-hidden="true">
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

/** Centre-screen on desktop, bottom sheet on phones. Closes on Escape. */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The green dot: this person has team chat open. Placed on an avatar's corner. */
export function OnlineDot({ className = '' }: { className?: string }) {
  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--gc-card,#fff)] bg-green-600 ${className}`}
      role="img"
      aria-label="Online"
      title="Has team chat open"
    />
  );
}
