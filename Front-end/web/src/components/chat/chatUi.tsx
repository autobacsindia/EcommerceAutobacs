'use client';

import { useEffect } from 'react';
import { ArrowLeftRight, FileSpreadsheet, FileText, File as FileIcon, Hash, Image as ImageIcon, Lock, Users, X } from 'lucide-react';
import type { ChatChannel, ChatPerson } from '@/hooks/queries/useTeamChat';

/** The store green, so the panels match the rest of the brand. */
export const GREEN = '#0a5c33';

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
const AVATAR_COLOURS = [
  'bg-emerald-100 text-emerald-900',
  'bg-sky-100 text-sky-900',
  'bg-amber-100 text-amber-900',
  'bg-violet-100 text-violet-900',
  'bg-rose-100 text-rose-900',
  'bg-teal-100 text-teal-900',
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
      <span className={`grid ${box} shrink-0 place-items-center rounded-full font-bold text-white`} style={{ background: GREEN }} aria-hidden="true">
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

/** "GTM", "Procurement" … as a small coloured pill. Admins read "Admin". */
export function TeamBadge({ person }: { person: ChatPerson | null }) {
  if (!person?.teamLabel) return null;
  return (
    <span className={`rounded-full px-2 py-px text-[11px] font-medium ${person.role === 'admin' ? 'bg-gray-900 text-white' : teamColour(person.team)}`}>
      {person.teamLabel}{person.isHead ? ' · Head' : ''}
    </span>
  );
}

/** The square icon a conversation shows in the list and its header. */
export function ChannelIcon({ channel, size = 'sm' }: { channel: ChatChannel; size?: 'sm' | 'md' }) {
  const box = size === 'md' ? 'h-9 w-9 text-sm' : 'h-7 w-7 text-[11px]';
  if (channel.kind === 'dm' && channel.group) {
    return (
      <span className={`grid ${box} shrink-0 place-items-center rounded-full bg-sky-100 text-sky-800`} aria-hidden="true">
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
  if (channel.audience === 'teams') {
    return (
      <span className={`grid ${box} shrink-0 place-items-center rounded-xl ${teamColour(channel.withTeam ?? channel.teams?.[0])}`} aria-hidden="true">
        <ArrowLeftRight className="h-3.5 w-3.5" />
      </span>
    );
  }
  const Icon = channel.audience === 'members' ? Lock : Hash;
  return (
    <span className={`grid ${box} shrink-0 place-items-center rounded-xl ${channel.audience === 'team' ? teamColour(channel.team) : 'bg-emerald-100 text-emerald-800'}`} aria-hidden="true">
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
      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 ${className}`}
      role="img"
      aria-label="Online"
      title="Has team chat open"
    />
  );
}
