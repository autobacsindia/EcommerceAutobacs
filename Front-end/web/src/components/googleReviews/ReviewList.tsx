'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Stars } from './StarPicker';
import { useGoogleReviewQueue, useMyGoogleReviews } from '@/hooks/queries/useGoogleReviews';
import {
  describeHistory, errorText, fmtDateTime, STATUS_LABEL,
  type GoogleReview, type ReviewFilter,
} from '@/lib/googleReviews';
import { monthLabel } from '@/lib/incentives';

const TABS: { key: ReviewFilter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

/**
 * A list of submissions with status tabs and "Load more" (cursor pages).
 * `mode="mine"` — the salesperson's own; `mode="queue"` — everyone's, with Open.
 */
export default function ReviewList({ mode, onOpen, initialStatus }: {
  mode: 'mine' | 'queue';
  onOpen?: (r: GoogleReview) => void;
  initialStatus?: ReviewFilter;
}) {
  const [status, setStatus] = useState<ReviewFilter>(initialStatus || (mode === 'queue' ? 'pending' : 'all'));
  const mine = useMyGoogleReviews(status, mode === 'mine');
  const queue = useGoogleReviewQueue(status, mode === 'queue');
  const q = mode === 'mine' ? mine : queue;
  const rows = q.data?.pages.flatMap((p) => p.reviews) ?? [];
  const pendingCount = mode === 'queue' ? q.data?.pages[0]?.pendingCount : undefined;
  const firstLoad = q.isLoading && !q.data;

  return (
    <section className="space-y-3" aria-labelledby={`reviews-${mode}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`reviews-${mode}`} className="text-lg font-semibold text-gray-900">{mode === 'mine' ? 'My reviews' : 'Reviews to check'}</h2>
        <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={status === t.key} onClick={() => setStatus(t.key)}
              className={`rounded-md px-3 py-1 text-sm ${status === t.key ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
              {t.label}
              {t.key === 'pending' && pendingCount ? <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-xs text-white">{pendingCount}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {q.error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorText(q.error, 'Could not load the reviews. Please try again.')}</p>
      ) : firstLoad ? (
        <div aria-label="Loading reviews" className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
          {emptyText(mode, status)}
        </p>
      ) : (
        <ul className={`space-y-2 ${q.isFetching && !q.isFetchingNextPage ? 'opacity-70' : ''}`}>
          {rows.map((r) => <ReviewRow key={r.id} r={r} mode={mode} onOpen={onOpen} />)}
        </ul>
      )}

      {q.hasNextPage && (
        <button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}
          className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">
          {q.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}Load more
        </button>
      )}
    </section>
  );
}

function emptyText(mode: 'mine' | 'queue', status: ReviewFilter): string {
  if (mode === 'queue' && status === 'pending') return 'Nothing waiting. New reviews from the GTM team will show here.';
  if (mode === 'mine' && status === 'all') return 'You have not sent any reviews yet. Send your first one above.';
  return `No ${status === 'all' ? '' : `${status} `}reviews.`;
}

export function StatusPill({ status }: { status: GoogleReview['status'] }) {
  const s = STATUS_LABEL[status];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.text}</span>;
}

function ReviewRow({ r, mode, onOpen }: { r: GoogleReview; mode: 'mine' | 'queue'; onOpen?: (r: GoogleReview) => void }) {
  const [open, setOpen] = useState(false);
  const who = [r.customerName, r.customerPhone].filter(Boolean).join(' · ') || 'Customer';
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={r.status} />
            <span className="truncate font-medium text-gray-900">{who}</span>
            {r.orderNumber && <span className="text-xs text-gray-500">Order {r.orderNumber}</span>}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {mode === 'queue' && <>From <b className="font-medium text-gray-700">{r.submittedBy.name}</b> · </>}
            Sent {fmtDateTime(r.createdAt)}
            {r.claimedStars ? <> · said <Stars n={r.claimedStars} className="align-middle" /></> : null}
          </p>
          {r.status === 'verified' && (
            <p className="mt-1 text-sm text-green-700">
              <Stars n={r.stars} className="mr-1 align-middle" /> +{r.points} pts
              {r.creditMonth && <span className="text-xs text-gray-500"> · Roav Points {monthLabel(r.creditMonth)}</span>}
            </p>
          )}
          {r.status === 'rejected' && r.reason && <p className="mt-1 text-sm text-red-700">Reason: {r.reason}</p>}
        </div>
        <div className="flex items-center gap-2">
          {mode === 'queue' && onOpen && (
            <button onClick={() => onOpen(r)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
              {r.status === 'pending' ? 'Check' : 'Open'}
            </button>
          )}
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
            History {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {open && <ReviewHistory r={r} />}
    </li>
  );
}

export function ReviewHistory({ r }: { r: GoogleReview }) {
  return (
    <ol className="mt-3 space-y-1 border-l-2 border-gray-200 pl-3 text-sm">
      {[...r.history].reverse().map((h, i) => (
        <li key={`${h.at}-${i}`}>
          <span className="text-gray-800">{describeHistory(h)}</span>
          <span className="ml-2 text-xs text-gray-500">{fmtDateTime(h.at)}{h.month ? ` · ${monthLabel(h.month)}` : ''}</span>
        </li>
      ))}
    </ol>
  );
}
