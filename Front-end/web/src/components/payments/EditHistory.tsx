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
 * Every edit made before approval, newest first: why, who, when, and each field's
 * old → new value. Shown on the request so accounts checks it before approving.
 */
export default function EditHistory({ edits }: { edits?: PaymentEdit[] }) {
  if (!edits?.length) return null;
  return (
    <section aria-label="Edit history" className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <h3 className="text-sm font-semibold text-amber-900">Edited after submit ({edits.length})</h3>
      <ol className="mt-2 space-y-3">
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
    </section>
  );
}
