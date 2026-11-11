'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { errorMessage } from '@/components/staff/sales/types';
import RichTextBox from '@/components/ui/RichTextBox';
import { isRichTextEmpty, richTextToPlain } from '@/lib/richText';
import { FOLLOW_UP_NOTE_MAX, FOLLOW_UP_OPTIONS, followUpOption, type FollowUpStatus } from './followUpStatus';
import NextFollowUpPicker from './NextFollowUpPicker';
import { formatDateTimeIST } from '@/lib/datetime';

/** Meta leads only: ask when the next follow-up is due, and why a missed one is late. */
export type FollowUpDeadline = {
  /** Statuses that close the lead and so need no next follow-up. */
  closing: readonly FollowUpStatus[];
  /** The current deadline passed unexplained: a reason is required. */
  lateReasonNeeded: boolean;
  dueAt: string | null;
};
const REASON_MIN = 5;

export type FollowUpWrite<L> = { success: boolean; outcome: string; message?: string; warning?: string; lead: L };

/**
 * "How did it go?" — one tap on a status, an optional note (required for Others),
 * Save. Shared by Website leads and Meta leads. Never optimistic: the badge and
 * history change only to what the server saved. `path` is the lead's API path.
 */
export default function FollowUpRecorder<L>({ path, hints, deadline, onSaved, onClose }: {
  path: string;
  deadline?: FollowUpDeadline;
  /** Replaces a status's hint where it means something different on this list. */
  hints?: Partial<Record<FollowUpStatus, string>>;
  onSaved: (res: FollowUpWrite<L>) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<FollowUpStatus | ''>('');
  const [note, setNote] = useState('');
  const [nextAt, setNextAt] = useState('');
  const [lateReason, setLateReason] = useState('');
  const [error, setError] = useState('');
  const asksNext = !!deadline && !!status && !deadline.closing.includes(status);
  const asksLate = !!deadline?.lateReasonNeeded;
  const save = useMutation({
    mutationFn: () => apiClient.post<FollowUpWrite<L>>(`${path}/follow-ups`, {
      status,
      note: isRichTextEmpty(note) ? '' : note.trim(),
      ...(asksNext && { nextAt }),
      ...(asksLate && { lateReason: lateReason.trim() }),
    }),
    onSuccess: (res) => { setStatus(''); setNote(''); setNextAt(''); setLateReason(''); setError(''); onSaved(res); },
    onError: (e: unknown) => {
      const body = (e as { rawData?: FollowUpWrite<L> })?.rawData;
      if (body?.lead) onSaved({ ...body, warning: body.message });
      else setError(errorMessage(e, 'Could not save the follow-up. Please try again.'));
    },
  });
  const needsNote = status === 'other' && isRichTextEmpty(note);
  const missing = needsNote || (asksNext && !nextAt) || (asksLate && lateReason.trim().length < REASON_MIN);
  const chosen = followUpOption(status);
  const noteId = `fu-note-${path.replace(/\W/g, '')}`;

  return (
    <form
      className="mt-3 space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3"
      onSubmit={(e) => { e.preventDefault(); if (status && !missing && !save.isPending) save.mutate(); }}
    >
      <fieldset>
        <legend className="text-sm font-semibold text-gray-900">How did the follow-up go?</legend>
        <div role="radiogroup" aria-label="Follow-up status" className="mt-2 flex flex-wrap gap-2">
          {FOLLOW_UP_OPTIONS.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={status === o.value}
              onClick={() => { setStatus(o.value); setError(''); }}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${status === o.value ? `${o.tone} ring-2 ring-blue-500` : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
              {o.label}
            </button>
          ))}
        </div>
        {chosen && <p className="mt-1.5 text-xs text-gray-600">{hints?.[chosen.value] ?? chosen.hint}</p>}
      </fieldset>
      {status && (
        <div>
          <label htmlFor={noteId} className="block text-sm font-medium text-gray-800">
            {status === 'other' ? 'What happened? (required)' : 'Note (optional)'}
          </label>
          <RichTextBox id={noteId} value={note} maxLength={FOLLOW_UP_NOTE_MAX} minHeightClass="min-h-[3.5rem]"
            onChange={setNote}
            ariaLabel={status === 'other' ? 'What happened' : 'Note'}
            placeholder={status === 'other' ? 'e.g. Asked us to call back after Diwali' : 'e.g. Rang twice, will try tomorrow'}
            className={`mt-1 ${needsNote ? 'border-red-400' : ''}`} />
          <p className="text-right text-xs text-gray-500">{richTextToPlain(note).length}/{FOLLOW_UP_NOTE_MAX}</p>
        </div>
      )}
      {asksNext && <NextFollowUpPicker id={`${noteId}-next`} value={nextAt} onChange={setNextAt} />}
      {asksLate && (
        <div>
          <label htmlFor={`${noteId}-late`} className="block text-sm font-medium text-red-800">
            This follow-up was due {deadline?.dueAt ? formatDateTimeIST(deadline.dueAt) : 'earlier'}. Why is it late? (required)
          </label>
          <textarea id={`${noteId}-late`} value={lateReason} maxLength={500} rows={2} onChange={(e) => setLateReason(e.target.value)}
            placeholder="e.g. Customer was driving, asked to call back in the evening"
            className="mt-1 w-full rounded-lg border border-red-300 px-3 py-2 text-sm" />
          <p className="text-xs text-gray-500">Saved in the history. The admin and Marketing head can see it.</p>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!status || missing || save.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save follow-up
        </button>
        <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  );
}
