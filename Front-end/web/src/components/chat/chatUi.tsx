'use client';

import { useEffect } from 'react';
import { FileSpreadsheet, FileText, File as FileIcon, Hash, Image as ImageIcon, Lock, X } from 'lucide-react';
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
}: {
  person: ChatPerson | null;
  system?: boolean;
  size?: 'sm' | 'md';
}) {
  const box = size === 'sm' ? 'h-7 w-7 text-[11px]' : 'h-9 w-9 text-sm';
  if (system) {
    return (
      <span className={`grid ${box} shrink-0 place-items-center rounded-lg font-bold text-white`} style={{ background: GREEN }} aria-hidden="true">
        R
      </span>
    );
  }
  const name = person?.name ?? '?';
  return (
    <span className={`grid ${box} shrink-0 place-items-center rounded-lg font-bold ${colourFor(name)}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function ChannelIcon({ channel }: { channel: ChatChannel }) {
  if (channel.kind === 'dm') {
    return (
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-bold ${colourFor(channel.name)}`} aria-hidden="true">
        {initials(channel.name)}
      </span>
    );
  }
  const Icon = channel.audience === 'members' ? Lock : Hash;
  return <Icon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />;
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
