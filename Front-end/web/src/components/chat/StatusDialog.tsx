'use client';

import { useState } from 'react';
import { useSetStatus } from '@/hooks/queries/useTeamChat';
import type { ChatStatus } from '@/hooks/queries/useTeamChat';
import { Dialog } from './chatUi';

export const STATUS_PRESETS = ['📅 In a meeting', '📞 On a call', '🏠 Working from home', '🌴 On leave', '🤒 Out sick', '🚚 Out on a delivery'];

export type ClearAfter = 'never' | '1h' | '4h' | 'today' | 'week';
const CLEAR_OPTIONS: { value: ClearAfter; label: string }[] = [
  { value: 'never', label: "Don't clear" },
  { value: '1h', label: 'In 1 hour' },
  { value: '4h', label: 'In 4 hours' },
  { value: 'today', label: 'At the end of today' },
  { value: 'week', label: 'At the end of this week' },
];

/** When a "clear after" choice ends, from `now` in the person's own time zone (staff are in India). */
export function clearAt(choice: ClearAfter, now = new Date()): string | null {
  const d = new Date(now);
  switch (choice) {
    case '1h': return new Date(now.getTime() + 3_600_000).toISOString();
    case '4h': return new Date(now.getTime() + 4 * 3_600_000).toISOString();
    case 'today': d.setHours(23, 59, 0, 0); return d.toISOString();
    case 'week': {
      // To Sunday night: the working week is over.
      d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
      d.setHours(23, 59, 0, 0);
      return d.toISOString();
    }
    default: return null;
  }
}

/** Set, change or clear my status — seen by everyone in team chat. */
export default function StatusDialog({ current, onClose }: { current: ChatStatus | null; onClose: () => void }) {
  const set = useSetStatus();
  const [text, setText] = useState(current?.text ?? '');
  const [clear, setClear] = useState<ClearAfter>(current ? 'never' : 'today');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    await set.mutateAsync({ text: value, until: clearAt(clear) });
    onClose();
  };

  return (
    <Dialog title="Your status" onClose={onClose}>
      <form onSubmit={(e) => void save(e).catch(() => {})}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={80}
          placeholder="What's your status?"
          aria-label="Status"
          autoFocus
          className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-emerald-600"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {STATUS_PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => setText(p)}
              className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:border-emerald-600">
              {p}
            </button>
          ))}
        </div>
        <label className="mt-3 block text-sm text-gray-700">
          Clear status
          <select value={clear} onChange={(e) => setClear(e.target.value as ClearAfter)}
            className="mt-1 block h-10 w-full rounded-lg border border-gray-300 px-2 text-sm">
            {CLEAR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {set.isError && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {set.error instanceof Error && set.error.message ? set.error.message : 'Couldn’t save your status.'}
          </p>
        )}
        <div className="mt-4 flex items-center justify-between">
          {current ? (
            <button type="button" onClick={() => void set.mutateAsync(null).then(onClose).catch(() => {})}
              className="text-sm font-medium text-red-700 hover:underline">
              Clear status
            </button>
          ) : <span />}
          <button type="submit" disabled={!text.trim() || set.isPending}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
            {set.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
