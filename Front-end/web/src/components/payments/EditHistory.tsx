'use client';

import { useId, useState } from 'react';
import { formatDateTimeIST } from '@/lib/datetime';
import type { PaymentEdit, PaymentRequest } from './api';

/** The small "Edited" tag on a request changed after it was submitted (lists, approvals inbox). */
export function EditedTag({ r }: { r: Pick<PaymentRequest, 'editedAt'> }) {
  if (!r.editedAt) return null;
  return (
    <span className="ml-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900" title={`Edited after submitting · ${formatDateTimeIST(r.editedAt)}`}>
      Edited
    </span>
  );
}

const SENT_BACK: Record<string, string> = { on_hold: 'was on hold', declined: 'was declined' };

/**
 * Every edit made before approval: why, who, when, and each field's old → new value.
 * Collapsed to one amber line by default (procurement found the full list cluttered,
 * 2026-11-24) — the count and the last editor stay visible so accounts still notices
 * before approving; "Show changes" opens the full list, newest first. Display only:
 * the stored history is never trimmed.
 */
export default function EditHistory({ edits }: { edits?: PaymentEdit[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!edits?.length) return null;
  const last = edits[edits.length - 1];
  const times = edits.length === 1 ? '1 time' : `${edits.length} times`;
  return (
    <section aria-label="Edit history" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
      <p className="text-sm text-amber-900">
        <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" />
        <span className="font-semibold">Edited {times} after submit</span>
        {' · '}last by {last.byName || 'someone'}, {formatDateTimeIST(last.at)}
        {' · '}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
          className="font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700"
        >
          {open ? 'Hide changes' : 'Show changes'}
        </button>
      </p>
      {open && (
        <ol id={listId} className="mt-2 space-y-3">
          {[...edits].reverse().map((e, i) => (
            <li key={`${e.at}-${i}`} className="text-sm text-gray-800">
              <p className="text-xs text-gray-600">
                {e.byName || 'Someone'} · {formatDateTimeIST(e.at)}
                {SENT_BACK[e.fromStatus] ? ` · ${SENT_BACK[e.fromStatus]}, sent back to accounts` : ''}
              </p>
              <p><span className="font-medium">Reason:</span> {e.reason}</p>
              {e.changes.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {e.changes.map((c, j) => (
                    <li key={j} className="break-words">
                      <span className="font-medium">{c.field}:</span>{' '}
                      {c.from && <span className="text-gray-500 line-through">{c.from}</span>}
                      {c.from && c.to && ' → '}
                      {c.to && <span>{c.to}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
