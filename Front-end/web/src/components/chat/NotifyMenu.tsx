'use client';

import { useEffect, useRef, useState } from 'react';
import { AtSign, Bell, BellOff, Check } from 'lucide-react';
import { notifyOf, useSetNotify } from '@/hooks/queries/useTeamChat';
import type { ChatChannel, NotifyLevel } from '@/hooks/queries/useTeamChat';

export const NOTIFY_OPTIONS: { level: NotifyLevel; label: string; hint: string }[] = [
  { level: 'all', label: 'All messages', hint: 'Pop-ups, sound and badge for every message' },
  { level: 'mentions', label: 'Only @mentions', hint: 'Only when someone @mentions you or your team' },
  { level: 'off', label: 'Off', hint: 'No pop-ups, sound or badge. Messages still arrive.' },
];

export function NotifyIcon({ level, className = 'h-4 w-4' }: { level: NotifyLevel; className?: string }) {
  if (level === 'off') return <BellOff className={className} aria-hidden="true" />;
  if (level === 'mentions') return <AtSign className={className} aria-hidden="true" />;
  return <Bell className={className} aria-hidden="true" />;
}

/**
 * "Notifications" for one conversation, in its header — the person's own
 * setting, as in Google Chat. Applies to every device they use.
 */
export default function NotifyMenu({ channel }: { channel: ChatChannel }) {
  const [open, setOpen] = useState(false);
  const set = useSetNotify();
  const level = notifyOf(channel);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = NOTIFY_OPTIONS.find((o) => o.level === level)!;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Notifications: ${current.label}`}
        title={`Notifications: ${current.label}`}
        className={`rounded-lg p-2 hover:bg-gray-100 ${level === 'all' ? 'text-gray-600' : 'text-amber-700'}`}
      >
        <NotifyIcon level={level} />
      </button>
      {open && (
        <div role="menu" aria-label="Notifications for this conversation"
          className="absolute right-0 top-10 z-30 w-72 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl">
          <p className="px-3 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Notifications</p>
          {NOTIFY_OPTIONS.map((o) => (
            <button
              key={o.level}
              type="button"
              role="menuitemradio"
              aria-checked={o.level === level}
              onClick={() => { if (o.level !== level) set.mutate({ channelId: channel.id, notify: o.level }); setOpen(false); }}
              className="flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left hover:bg-gray-100"
            >
              <span className="mt-0.5 text-gray-600"><NotifyIcon level={o.level} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900">{o.label}</span>
                <span className="block text-xs text-gray-500">{o.hint}</span>
              </span>
              {o.level === level && <Check className="mt-0.5 h-4 w-4 text-emerald-700" aria-hidden="true" />}
            </button>
          ))}
          {set.isError && <p role="alert" className="px-3 py-1 text-xs text-red-600">Couldn’t save that. Please try again.</p>}
        </div>
      )}
    </div>
  );
}
