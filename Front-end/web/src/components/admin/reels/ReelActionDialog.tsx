'use client';

import { useEffect, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reelKeys } from '@/hooks/queries/keys';
import { REJECT_PRESETS, REJECT_REASON_MAX, errorText, rejectReel, removeReel, type Reel } from './api';

export type ReelAction = 'reject' | 'remove';

/**
 * Confirmation for the two destructive actions. Reject needs a reason (the
 * creator sees it in "My reels"); Remove takes a live reel down.
 */
export default function ReelActionDialog({ reel, action, onClose }: { reel: Reel; action: ReelAction; onClose: () => void }) {
  const titleId = useId();
  const qc = useQueryClient();
  const [preset, setPreset] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const reason = [preset, note.trim()].filter(Boolean).join('. ').slice(0, REJECT_REASON_MAX);
  const needsReason = action === 'reject';
  const canSubmit = !needsReason || reason.length > 0;

  const mutation = useMutation({
    mutationFn: () => (action === 'reject' ? rejectReel(reel.id, reason) : removeReel(reel.id)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: reelKeys.admin() });
      onClose();
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !mutation.isPending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mutation.isPending, onClose]);

  const title = action === 'reject' ? 'Reject this reel?' : 'Remove this live reel?';
  const confirmLabel = action === 'reject' ? 'Reject reel' : 'Remove reel';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => !mutation.isPending && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId} className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="mt-1 text-sm text-gray-600">
          {action === 'reject'
            ? `${reel.creator?.name || 'The creator'} will see the reason you give.`
            : 'Shoppers will stop seeing it straight away. It moves to the Removed tab.'}
        </p>

        {needsReason && (
          <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); if (canSubmit) mutation.mutate(); }}>
            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Pick a reason</legend>
              <div className="flex flex-wrap gap-2">
                {REJECT_PRESETS.map((r) => (
                  <button key={r} type="button" aria-pressed={preset === r} onClick={() => setPreset(preset === r ? null : r)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium ${preset === r ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
                    {r}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Details (needed if you did not pick a reason)</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={REJECT_REASON_MAX} rows={3}
                className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm focus:border-gray-900 focus:outline-none" />
            </label>
            {!canSubmit && <p className="text-xs text-gray-500">A reason is needed to reject.</p>}
          </form>
        )}

        {mutation.isError && (
          <p role="alert" className="mt-3 text-sm text-red-700">{errorText(mutation.error, 'That did not work. Please try again.')}</p>
        )}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} disabled={mutation.isPending}
            className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60">Cancel</button>
          <button type="button" onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}
            className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
            {mutation.isPending ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
