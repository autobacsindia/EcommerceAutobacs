'use client';

import { useState } from 'react';
import { ChevronDown, Pin, PinOff } from 'lucide-react';
import { usePinMessage, usePins } from '@/hooks/queries/useTeamChat';
import type { ChatMessage } from '@/hooks/queries/useTeamChat';
import { timeOf, dayLabel } from './chatUi';

const previewOf = (m: ChatMessage) => m.text || (m.attachments.length ? '📎 Shared a file' : '');
const authorOf = (m: ChatMessage) => (m.kind === 'system' ? 'Roavion updates' : m.sender?.name ?? 'Former member');

/**
 * The conversation's pinned messages, under its header — the newest pin on
 * one line; open it for all of them. Tapping one scrolls to it in the
 * conversation. Shows nothing when nothing is pinned.
 */
export default function PinnedStrip({ channelId, onJump }: { channelId: string; onJump: (id: string) => void }) {
  const { data: pins = [] } = usePins(channelId);
  const unpin = usePinMessage(channelId);
  const [open, setOpen] = useState(false);
  if (!pins.length) return null;
  const [latest] = pins;

  return (
    <div className="border-b border-gray-100 bg-amber-50/60 px-4 py-1.5 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <Pin className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-gray-800">
          <span className="font-medium">{authorOf(latest)}:</span> {previewOf(latest)}
        </span>
        <span className="shrink-0 text-xs font-semibold text-amber-800">{pins.length} pinned</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-amber-800 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <ul className="mt-1.5 max-h-60 space-y-1 overflow-y-auto pb-1" aria-label="Pinned messages">
          {pins.map((m) => (
            <li key={m.id} className="flex items-start gap-2 rounded-lg bg-white px-2.5 py-1.5 shadow-sm">
              <button type="button" onClick={() => { setOpen(false); onJump(m.threadRoot ?? m.id); }} className="min-w-0 flex-1 text-left">
                <span className="block text-xs text-gray-500">
                  <span className="font-semibold text-gray-700">{authorOf(m)}</span> · {dayLabel(m.createdAt)} {timeOf(m.createdAt)}
                  {m.pinned?.by ? ` · pinned by ${m.pinned.by}` : ''}
                </span>
                <span className="line-clamp-2 block text-sm text-gray-800">{previewOf(m)}</span>
              </button>
              <button
                type="button"
                onClick={() => unpin.mutate({ id: m.id, on: false })}
                className="shrink-0 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Unpin"
                title="Unpin"
              >
                <PinOff className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
