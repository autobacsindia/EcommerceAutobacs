'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, X } from 'lucide-react';
import StarPicker, { Stars } from './StarPicker';
import { ReviewHistory, StatusPill } from './ReviewList';
import { useGoogleReview, useRejectGoogleReview, useVerifyGoogleReview } from '@/hooks/queries/useGoogleReviews';
import { errorText, fmtDateTime, suggestedPoints, type GoogleReview, type ReviewPolicy } from '@/lib/googleReviews';
import EntityLink from '@/components/ui/EntityLink';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

/**
 * The marketing head / admin checks one submission: reads the screenshot,
 * counts the stars, and verifies with points or rejects with a reason.
 *
 * Nothing about points is shown as done until the server answers — the server
 * decides (self-check, maximum, someone-else-changed-it) and writes the ledger.
 */
export default function ReviewDecision({ initial, policy, meId, onClose, onDone }: {
  initial: GoogleReview;
  policy: ReviewPolicy;
  meId: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { data: r = initial, isFetching } = useGoogleReview(initial.id, initial);
  const verify = useVerifyGoogleReview();
  const reject = useRejectGoogleReview();
  const [stars, setStars] = useState<number | null>(r.stars ?? r.claimedStars ?? null);
  const [pts, setPts] = useState<string>(() => String(r.status === 'verified' ? r.points : suggestedPoints(policy, r.stars ?? r.claimedStars ?? null) || ''));
  const [ptsTouched, setPtsTouched] = useState(r.status === 'verified');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgState, setImgState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => { closeRef.current?.focus(); }, []);
  // A cached image can finish before React attaches onLoad.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setImgState('ok');
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const own = !!meId && r.submittedBy.id === meId;
  const busy = verify.isPending || reject.isPending;
  const max = policy.maxPoints;
  const suggestion = suggestedPoints(policy, stars);

  const chooseStars = (v: number | null) => {
    setStars(v);
    if (!ptsTouched) setPts(String(suggestedPoints(policy, v) || ''));
  };

  async function doVerify() {
    setError('');
    const p = Number(pts);
    if (!stars) { setError('Count the stars on the screenshot first.'); return; }
    if (!Number.isInteger(p) || p < 1 || p > max) { setError(`Points must be a whole number from 1 to ${max}. To give none, reject it instead.`); return; }
    try {
      const out = await verify.mutateAsync({ id: r.id, stars, points: p, expectedVersion: r.version });
      onDone(r.status === 'verified' ? `Points changed to ${out.points} for ${out.submittedBy.name}.` : `Verified — +${out.points} pts to ${out.submittedBy.name}.`);
    } catch (e) {
      setError(errorText(e, 'Could not save. Please try again.'));
    }
  }

  async function doReject() {
    setError('');
    if (reason.trim().length < 3) { setError('Write the reason, so the salesperson knows what was wrong.'); return; }
    try {
      await reject.mutateAsync({ id: r.id, reason: reason.trim(), expectedVersion: r.version });
      onDone(r.status === 'verified' ? `Unverified — the ${r.points} pts were taken back.` : 'Rejected.');
    } catch (e) {
      setError(errorText(e, 'Could not save. Please try again.'));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-2 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="review-title" className="w-full max-w-4xl rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-2 border-b border-gray-100 p-4">
          <div>
            <h2 id="review-title" className="flex flex-wrap items-center gap-2 text-lg font-semibold text-gray-900">
              Google review from {r.submittedBy.name} <StatusPill status={r.status} />
              {isFetching && <Loader2 aria-label="Refreshing" className="h-4 w-4 animate-spin text-gray-400" />}
            </h2>
            <p className="text-sm text-gray-500">Sent {fmtDateTime(r.createdAt)}</p>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div>
            <a href={r.screenshotUrl} target="_blank" rel="noreferrer" className="group block">
              <div className="relative min-h-48 rounded-lg border border-gray-200 bg-gray-50">
                {imgState !== 'ok' && (
                  <div className="absolute inset-0 flex items-center justify-center gap-2 p-4 text-center text-sm text-gray-500">
                    {imgState === 'error'
                      ? <span role="alert" className="text-red-700">Could not load the screenshot. Try &ldquo;Open full size&rdquo;, or close and open this review again.</span>
                      : <><Loader2 className="h-4 w-4 animate-spin" />Loading screenshot…</>}
                  </div>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element -- a private image served through our API */}
                <img ref={imgRef} src={r.screenshotUrl} alt={`Screenshot of the review from ${r.customerName || 'the customer'}`}
                  onLoad={() => setImgState('ok')} onError={() => setImgState('error')}
                  className={`max-h-[60vh] w-full rounded-lg object-contain ${imgState === 'ok' ? '' : 'invisible'}`} />
              </div>
              <span className="mt-1 inline-flex items-center gap-1 text-xs text-blue-700 group-hover:underline">Open full size <ExternalLink className="h-3 w-3" /></span>
            </a>
          </div>

          <div className="space-y-4">
            <dl className="grid grid-cols-3 gap-x-2 gap-y-1 text-sm">
              <dt className="text-gray-500">Customer</dt><dd className="col-span-2 text-gray-900">{r.customerName || '—'}</dd>
              <dt className="text-gray-500">Phone</dt><dd className="col-span-2 text-gray-900">{r.customerPhone || '—'}</dd>
              <dt className="text-gray-500">Order</dt><dd className="col-span-2 text-gray-900">{r.orderNumber ? <EntityLink type="order" id={r.orderId} value={r.orderNumber} label="Order number" /> : '—'}</dd>
              <dt className="text-gray-500">They said</dt><dd className="col-span-2"><Stars n={r.claimedStars} /></dd>
              {r.notes && (<><dt className="text-gray-500">Notes</dt><dd className="col-span-2 whitespace-pre-wrap text-gray-900">{r.notes}</dd></>)}
              {r.status === 'verified' && (<><dt className="text-gray-500">Credited</dt><dd className="col-span-2 font-medium text-green-700">{r.points} pts ({r.stars}★) by {r.reviewedByName}</dd></>)}
              {r.status === 'rejected' && r.reason && (<><dt className="text-gray-500">Reason</dt><dd className="col-span-2 text-red-700">{r.reason}</dd></>)}
            </dl>

            {own ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">This is your own submission, so someone else must check it.</p>
            ) : !rejecting ? (
              <div className="space-y-3 rounded-lg border border-gray-200 p-3">
                <div className="text-sm">
                  <span className="font-medium text-gray-800">Stars on the screenshot</span>
                  <StarPicker value={stars} onChange={chooseStars} label="Stars on the screenshot" disabled={busy} />
                </div>
                <label className="block text-sm">
                  <span className="font-medium text-gray-800">Points</span>
                  <input type="number" inputMode="numeric" min={1} max={max} step={1} value={pts} disabled={busy}
                    onChange={(e) => { setPts(e.target.value); setPtsTouched(true); }} className={input} />
                  <span className="text-xs text-gray-500">
                    Suggested for {stars ? `${stars}★` : 'this'}: {suggestion ? `${suggestion} pts` : 'none (usually rejected)'} · most {max} pts
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={doVerify} disabled={busy} className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
                    {verify.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    {r.status === 'verified' ? 'Save new points' : 'Verify and add points'}
                  </button>
                  {r.status !== 'rejected' && (
                    <button onClick={() => { setRejecting(true); setError(''); }} disabled={busy} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                      {r.status === 'verified' ? 'Unverify' : 'Reject'}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border border-red-200 p-3">
                <label className="block text-sm">
                  <span className="font-medium text-gray-800">{r.status === 'verified' ? `Why unverify? The ${r.points} pts will be taken back.` : 'Why reject?'}</span>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} disabled={busy} className={input}
                    placeholder="e.g. Screenshot is not of our Google page" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={doReject} disabled={busy} className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                    {reject.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{r.status === 'verified' ? 'Unverify' : 'Reject'}
                  </button>
                  <button onClick={() => { setRejecting(false); setError(''); }} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">Back</button>
                </div>
              </div>
            )}

            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div>
              <h3 className="text-sm font-semibold text-gray-800">History</h3>
              <ReviewHistory r={r} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
