'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import SpinGauge from './SpinGauge';

/**
 * Post-purchase reward, on the order-success page.
 *
 * State machine, and why each state exists:
 *
 *   checking  → first eligibility call hasn't answered yet.
 *   pending   → the order is not paid YET. Razorpay's webhook is the only thing that can
 *               make it paid, and it may land seconds after this page renders. So we poll
 *               instead of showing a wheel — a spin on an unpaid order must be impossible,
 *               not merely discouraged.
 *   ready     → eligible. Dial is drawn and clickable.
 *   spinning  → POST in flight. The needle free-revs; it does NOT pretend to land.
 *   revealed  → server answered. Needle settles on the segment the server chose.
 *   none      → not eligible (no campaign, already spun elsewhere, cancelled…). Renders
 *               nothing at all rather than an error — this is a confirmation page.
 */

type Phase = 'checking' | 'pending' | 'ready' | 'spinning' | 'revealed' | 'none';

interface PrizeSnapshot {
  name: string;
  sku: string | null;
  kind: string;
  imageUrl: string | null;
  isFloorPrize?: boolean;
  /** Present only for a coupon prize — the winner's own single-use code. */
  couponCode?: string | null;
}

interface StatusResponse {
  success: boolean;
  eligible: boolean;
  alreadySpun?: boolean;
  pending?: boolean;
  reason?: string;
  campaign?: { slug: string; name: string; segmentCount: number; terms: string | null };
  segments?: Array<{ id: string; shortLabel: string; name: string }>;
  result?: { prize: PrizeSnapshot; segmentIndex: number; segmentLabels: string[]; status: string };
}

interface SpinResponse {
  success: boolean;
  alreadySpun: boolean;
  result: { prize: PrizeSnapshot; segmentIndex: number; segmentLabels: string[]; status: string };
  reviewCta: { headline: string | null; body: string | null; url: string } | null;
}

/** Poll cadence + ceiling for the "payment still confirming" window. */
const POLL_MS = 3000;
const POLL_CEILING_MS = 90_000;

export default function SpinSection({ orderId }: { orderId: string }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [labels, setLabels] = useState<string[]>([]);
  const [terms, setTerms] = useState<string | null>(null);
  const [prize, setPrize] = useState<PrizeSnapshot | null>(null);
  const [winningIndex, setWinningIndex] = useState<number | null>(null);
  const [reviewCta, setReviewCta] = useState<SpinResponse['reviewCta']>(null);
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const [settled, setSettled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startedAt = useRef(Date.now());
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyExistingResult = (r: NonNullable<StatusResponse['result']>) => {
    setLabels(r.segmentLabels ?? []);
    setPrize(r.prize);
    setWinningIndex(r.segmentIndex);
    setSettled(true);
    setPhase('revealed');
  };

  const check = useCallback(async () => {
    try {
      const res = await apiClient.get<StatusResponse>(API_ENDPOINTS.SPIN_ORDER_STATUS(orderId));

      // Already spun (refresh, second tab, came back later) — show what they won.
      if (res.alreadySpun && res.result) { applyExistingResult(res.result); return; }

      if (res.eligible) {
        setLabels((res.segments ?? []).map((s) => s.shortLabel || s.name));
        setTerms(res.campaign?.terms ?? null);
        setPhase('ready');
        return;
      }

      // Payment still confirming — keep asking, within a bound.
      if (res.pending) {
        setPhase('pending');
        if (Date.now() - startedAt.current < POLL_CEILING_MS) {
          pollTimer.current = setTimeout(() => { void check(); }, POLL_MS);
        } else {
          // Gave up waiting. The webhook may still land; the spin is not lost, it just
          // isn't offered on this render. Say nothing rather than imply failure.
          setPhase('none');
        }
        return;
      }

      setPhase('none');
    } catch {
      // A confirmation page must never show a broken widget over a successful order.
      setPhase('none');
    }
  }, [orderId]);

  useEffect(() => {
    void check();
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [check]);

  const spin = async () => {
    if (phase !== 'ready') return;
    setPhase('spinning');
    setError(null);
    try {
      const res = await apiClient.post<SpinResponse>(API_ENDPOINTS.SPIN_ORDER_SPIN(orderId), {});
      // The authoritative slice set comes back WITH the outcome — the labels shown before
      // the click were only a preview, so re-render them before the needle settles.
      setLabels(res.result.segmentLabels ?? []);
      setPrize(res.result.prize);
      setWinningIndex(res.result.segmentIndex);
      setReviewCta(res.reviewCta);
      setPhase('revealed');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not spin. Please refresh.');
      setPhase('ready');
    }
  };

  const openReview = () => {
    if (!reviewCta?.url) return;
    // Fire-and-forget analytics. Must never delay or block opening the link.
    void apiClient.post(API_ENDPOINTS.SPIN_ORDER_REVIEW_CLICKED(orderId), {}).catch(() => {});
    window.open(reviewCta.url, '_blank', 'noopener,noreferrer');
  };

  if (phase === 'checking' || phase === 'none') return null;

  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-[#1e3a5f] bg-gradient-to-b from-[#0b1626] to-[#060d18] p-6 text-white shadow-xl">
      <div className="mb-4 text-center">
        <h2 className="text-xl font-bold tracking-tight text-[#f5b32c]">
          {phase === 'revealed' ? 'You won!' : 'Rev it up — you’ve earned a spin'}
        </h2>
        <p className="mt-1 text-sm text-[#9fb3cc]">
          {phase === 'pending'
            ? 'Confirming your payment…'
            : phase === 'revealed'
              ? 'Your prize is reserved and attached to this order.'
              : 'Every spin wins something.'}
        </p>
      </div>

      {phase === 'pending' ? (
        <div className="flex flex-col items-center py-10">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#1e3a5f] border-t-[#f5b32c]" />
          <p className="mt-4 max-w-xs text-center text-xs text-[#7c92ad]">
            We&apos;ll unlock your spin the moment your payment is confirmed. This page updates
            on its own — no need to refresh.
          </p>
        </div>
      ) : (
        <>
          <SpinGauge
            labels={labels}
            winningIndex={winningIndex}
            spinning={phase === 'spinning'}
            onSettled={() => setSettled(true)}
          />

          {error && (
            <p className="mt-3 rounded-lg bg-red-500/15 px-3 py-2 text-center text-sm text-red-300">{error}</p>
          )}

          {phase === 'ready' && (
            <button
              onClick={spin}
              className="mx-auto mt-5 block rounded-full bg-[#f5b32c] px-10 py-3 text-base font-bold text-[#1a1205] shadow-lg transition hover:bg-[#ffc850] active:scale-95"
            >
              SPIN
            </button>
          )}

          {phase === 'spinning' && (
            <p className="mt-5 text-center text-sm font-semibold text-[#9fb3cc]">Spinning…</p>
          )}

          {phase === 'revealed' && prize && settled && (
            <div className="mt-5 animate-[fadeIn_400ms_ease]">
              <div className="rounded-xl bg-[#f5b32c] px-5 py-4 text-center text-[#1a1205]">
                <div className="text-xs font-semibold uppercase tracking-wider opacity-70">Your prize</div>
                <div className="mt-0.5 text-lg font-bold">{prize.name}</div>
                <div className="mt-1 text-xs opacity-80">
                  {prize.kind === 'goodie'
                    ? 'We’ll pack it with your order — nothing else to do.'
                    : prize.couponCode
                      ? 'Use this code at checkout on your next order.'
                      : 'It has been added to your account.'}
                </div>

                {/*
                  The code is rendered here AND emailed. This screen is transient — the
                  customer may close the tab — so the email is the durable copy, and this
                  is the immediate one. Monospaced and selectable because it gets retyped.
                */}
                {prize.couponCode && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(prize.couponCode as string);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="w-full rounded-lg border-2 border-dashed border-[#1a1205]/40 bg-white/40 px-4 py-3 font-mono text-xl font-bold tracking-[0.15em] text-[#1a1205] transition hover:bg-white/60"
                      title="Copy code"
                    >
                      {prize.couponCode}
                    </button>
                    <div className="mt-1 text-[11px] opacity-70">
                      {copied ? '✓ Copied' : 'Tap to copy · also sent to your email'}
                    </div>
                  </div>
                )}
              </div>

              {/*
                Shown only AFTER the prize is granted and persisted, and freely dismissible.
                It must never gate the reward: Google prohibits incentivised reviews and
                enforces at Business-Profile level, so making a prize conditional on one
                risks the removal of existing legitimate reviews.
              */}
              {reviewCta?.url && !reviewDismissed && (
                <div className="mt-4 rounded-xl border border-[#2a4a73] bg-[#0f1e33] p-4 text-center">
                  <p className="text-sm font-semibold text-white">
                    {reviewCta.headline || 'Loved your order?'}
                  </p>
                  {reviewCta.body && <p className="mt-1 text-xs text-[#9fb3cc]">{reviewCta.body}</p>}
                  <div className="mt-3 flex items-center justify-center gap-3">
                    <button onClick={openReview}
                      className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#0b1626] hover:bg-gray-100">
                      ⭐ Review us on Google
                    </button>
                    <button onClick={() => setReviewDismissed(true)}
                      className="text-xs text-[#7c92ad] underline hover:text-[#9fb3cc]">
                      No thanks
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {terms && phase !== 'revealed' && (
            <p className="mx-auto mt-4 max-w-md text-center text-[10px] leading-relaxed text-[#5d7a9e]">{terms}</p>
          )}
        </>
      )}
    </section>
  );
}
