import { formatDateIST } from '@/lib/datetime';
import { payLaterTone, LINK_BLOCKED_TEXT, type PayLaterState } from './api';

/** "Shipped – payment due" and its dates, for any row that carries a pay-later block. */
export default function PayLaterBadge({ state, detail = false }: { state: PayLaterState | null | undefined; detail?: boolean }) {
  if (!state) return null;
  return (
    <div className="space-y-1">
      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${payLaterTone(state.label)}`}>{state.label}</span>
      {detail && state.due && (
        <p className="text-xs text-gray-600">
          {state.dueAt
            ? <>Pay by <strong>{formatDateIST(state.dueAt)}</strong>{state.overdueDays > 0 ? ` — ${state.overdueDays} day${state.overdueDays === 1 ? '' : 's'} late` : ''}.</>
            : 'The due date starts when the parcel is sent.'}
          {state.reminders > 0 ? ` Reminded ${state.reminders} time${state.reminders === 1 ? '' : 's'}.` : ''}
        </p>
      )}
      {detail && state.linkBlocked && (
        <p role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{LINK_BLOCKED_TEXT[state.linkBlocked] ?? 'No payment link went out. Check this order.'}</p>
      )}
    </div>
  );
}
