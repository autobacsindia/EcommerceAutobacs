'use client';

import { useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useGoogleReviewPolicy } from '@/hooks/queries/useGoogleReviews';
import { errorText, type GoogleReview } from '@/lib/googleReviews';
import SubmitReviewForm from './SubmitReviewForm';
import ReviewList from './ReviewList';
import ReviewDecision from './ReviewDecision';

/**
 * The Google reviews page for every panel. What shows is what the server says
 * this person may do (`/google-reviews/policy`):
 *   GTM member      → send a review + their own list with history.
 *   marketing head  → the queue: check, verify with points, reject, unverify.
 *   admin           → the queue too.
 */
export default function GoogleReviewsScreen() {
  const { user } = useAuth();
  const { data: policy, isLoading, error } = useGoogleReviewPolicy();
  const [open, setOpen] = useState<GoogleReview | null>(null);
  const [flash, setFlash] = useState('');

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Google reviews</h1>
        <p className="text-sm text-gray-500">
          {policy?.canReview
            ? 'Check each screenshot, count the stars, then verify with points or reject with a reason. Verified points go to the salesperson\'s Roav Points.'
            : 'Send screenshots of Google reviews your customers posted. Verified reviews add points to your Roav Points.'}
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorText(error, 'Could not load this page. Please try again.')}</p>
      ) : isLoading || !policy ? (
        <div aria-label="Loading" className="space-y-3">
          <div className="h-40 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-20 animate-pulse rounded-xl bg-gray-100" />
        </div>
      ) : !policy.canSubmit && !policy.canReview ? (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">Google reviews are sent by the GTM team and checked by the marketing head or an admin.</p>
      ) : (
        <>
          {flash && (
            <p role="status" className="flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{flash}</span>
              <button aria-label="Dismiss" onClick={() => setFlash('')}><X className="h-4 w-4" /></button>
            </p>
          )}
          {policy.canSubmit && (
            <>
              <SubmitReviewForm policy={policy} />
              <ReviewList mode="mine" />
            </>
          )}
          {policy.canReview && <ReviewList mode="queue" onOpen={(r) => { setFlash(''); setOpen(r); }} />}
          {open && (
            <ReviewDecision
              key={open.id}
              initial={open}
              policy={policy}
              meId={user?._id ? String(user._id) : null}
              onClose={() => setOpen(null)}
              onDone={(m) => { setOpen(null); setFlash(m); }}
            />
          )}
        </>
      )}
    </div>
  );
}
