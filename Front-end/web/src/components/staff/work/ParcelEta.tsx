'use client';

import { useState } from 'react';
import { CalendarClock, History } from 'lucide-react';
import { formatDateTimeIST } from '@/lib/datetime';
import type { EtaState, WorkOrder, WorkRow } from './types';

/*
  Expected delivery date on a parcel in transit (Back-end utils/parcelEta.js).
  Staff only — the customer never sees it. The server decides "due today" /
  "overdue" and re-checks the date on save; the picker's min / max only save a
  wasted round trip.
*/

/** Same limit as the server (ETA_MAX_DAYS). */
export const ETA_MAX_DAYS = 60;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Today in India as 'YYYY-MM-DD', plus `days`. */
export const istDay = (days = 0, now = Date.now()) => new Date(now + IST_OFFSET_MS + days * DAY_MS).toISOString().slice(0, 10);

/** '2026-10-28' → '28/10/2026', how the team writes dates. */
export function formatEtaDay(day: string) {
  const [y, m, d] = day.split('-');
  return y && m && d ? `${d}/${m}/${y}` : day;
}

const TONE = {
  overdue: 'bg-red-100 text-red-800 ring-1 ring-red-300',
  due_today: 'bg-amber-100 text-amber-900 ring-1 ring-amber-300',
  upcoming: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200',
  none: 'bg-gray-100 text-gray-700',
} as const;
const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold';

/** One parcel's badge: Overdue / Due today (no badge for a future date or a delivered parcel). */
export function EtaBadge({ state }: { state: EtaState | null | undefined }) {
  if (state === 'overdue') return <span className={`${pill} ${TONE.overdue}`}>Overdue</span>;
  if (state === 'due_today') return <span className={`${pill} ${TONE.due_today}`}>Due today</span>;
  return null;
}

/** A list row's summary of its parcels in transit — the most urgent wins. */
export function EtaRowBadge({ eta }: { eta: WorkRow['eta'] }) {
  if (!eta) return null;
  if (eta.overdue) return <span className={`${pill} ${TONE.overdue}`}>Overdue{eta.overdue > 1 ? ` · ${eta.overdue} parcels` : ''}</span>;
  if (eta.dueToday) return <span className={`${pill} ${TONE.due_today}`}>Due today</span>;
  if (eta.earliest) return <span className={`${pill} ${TONE.upcoming}`}><CalendarClock className="h-3 w-3" /> Expected {formatEtaDay(eta.earliest)}</span>;
  if (eta.missing) return <span className={`${pill} ${TONE.none}`}>No delivery date</span>;
  return null;
}

type Parcel = WorkOrder['parcels'][number];
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50';

/**
 * The parcel's expected delivery date: shown to everyone who sees the order,
 * set / changed by procurement, operations and admin while it is in transit.
 * `onSave(date, previousDate)` — previousDate is what this screen showed, so a
 * change someone else made meanwhile is refused rather than overwritten.
 */
export default function ParcelEta({ parcel, saving, onSave }: {
  parcel: Parcel;
  saving: boolean;
  onSave: (date: string, previousDate: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const current = parcel.eta?.date || '';
  const history = parcel.etaHistory || [];
  if (!current && !parcel.canSetEta) return null;

  return (
    <div className="space-y-1 pt-1">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <CalendarClock className="h-3.5 w-3.5 text-gray-500" aria-hidden />
        {current ? (
          <span className="text-gray-800">
            Expected delivery <strong>{formatEtaDay(current)}</strong>
            {parcel.eta?.setBy && <span className="text-gray-500"> · set by {parcel.eta.setBy}</span>}
          </span>
        ) : (
          <span className="text-gray-500">No expected delivery date yet</span>
        )}
        <EtaBadge state={parcel.etaState} />
        {parcel.canSetEta && !editing && (
          <button type="button" className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}
            onClick={() => { setDate(current && current >= istDay() ? current : ''); setEditing(true); }}>
            {current ? 'Change date' : 'Set expected delivery'}
          </button>
        )}
        {history.length > 0 && (
          <button type="button" className="inline-flex items-center gap-1 text-gray-500 underline-offset-2 hover:underline"
            aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
            <History className="h-3 w-3" /> Date changes ({history.length})
          </button>
        )}
      </div>
      {editing && (
        <form className="flex flex-wrap items-center gap-2" aria-label={`Expected delivery for parcel ${parcel.sequence}`}
          onSubmit={(e) => { e.preventDefault(); if (date) { onSave(date, current); setEditing(false); } }}>
          <input type="date" required aria-label={`Expected delivery date for parcel ${parcel.sequence}`}
            min={istDay()} max={istDay(ETA_MAX_DAYS)} value={date} onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          <button type="submit" disabled={saving || !date} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>Save date</button>
          <button type="button" className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`} onClick={() => setEditing(false)}>Cancel</button>
          <p className="basis-full text-xs text-gray-500">Team chat will remind you at 9:00 AM on this date (and each morning after, if it is still in transit) to update the delivery status.</p>
        </form>
      )}
      {showHistory && (
        <ol className="space-y-0.5 border-l-2 border-gray-200 pl-2" aria-label={`Date changes for parcel ${parcel.sequence}`}>
          {history.map((h, i) => (
            <li key={`${h.at}-${i}`} className="text-xs text-gray-600">
              {h.from ? `${formatEtaDay(h.from)} → ${formatEtaDay(h.to)}` : `Set to ${formatEtaDay(h.to)}`}
              <span className="text-gray-500"> — {h.by || 'Staff'}, {formatDateTimeIST(h.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
