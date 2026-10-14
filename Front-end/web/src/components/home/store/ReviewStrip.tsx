'use client';

/**
 * "What customers say" — every review an admin flagged as a testimonial.
 *
 * ── Why it slides ───────────────────────────────────────────────────────────
 * A grid showed three and hid the rest, so flagging a fourth review did nothing
 * visible. This shows all of them, three at a time on a desktop, advancing on
 * its own so the later ones are seen without anyone having to do anything.
 *
 * The track is a plain scroll-snap container, not a transform carousel: that is
 * what makes it swipeable on a phone, draggable with a trackpad and reachable
 * by keyboard for free, and it degrades to a scrollable row if the JavaScript
 * never runs. Auto-advance is then just `scrollTo`.
 *
 * ── Why it pauses ───────────────────────────────────────────────────────────
 * Movement that cannot be stopped is a genuine accessibility failure (WCAG
 * 2.2.2) and an irritation besides: it slides away mid-sentence. So it stops on
 * hover, on keyboard focus, while a finger is down, when the tab is hidden, and
 * permanently for a visitor who has asked for reduced motion.
 *
 * ── Why the text is clipped ─────────────────────────────────────────────────
 * One 150-word review made its card four times the height of the others and
 * pushed the whole section down the page. Cards are now a fixed height with the
 * quote clamped, and the full text opens in a dialog — which also keeps every
 * slide the same size, without which the snapping looks broken.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Stars } from './ProductTile';
import type { StoreReview } from './storeData';

/** Long enough to read a short review before it moves. */
const ADVANCE_MS = 6000;

export default function ReviewStrip({ reviews }: { reviews: StoreReview[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState<StoreReview | null>(null);
  // Which quotes are actually cut off. Measured rather than guessed from the
  // character count, because the cut depends on the rendered width.
  const [clipped, setClipped] = useState<Record<number, boolean>>({});

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const next: Record<number, boolean> = {};
    track.querySelectorAll<HTMLElement>('[data-quote]').forEach((el) => {
      const i = Number(el.dataset.quote);
      next[i] = el.scrollHeight - el.clientHeight > 2;
    });
    setClipped(next);
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, reviews]);

  useEffect(() => {
    if (reviews.length < 2) return;
    const track = trackRef.current;
    if (!track) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const tick = () => {
      if (paused || document.hidden) return;
      const card = track.querySelector<HTMLElement>('[data-card]');
      if (!card) return;
      // One card plus the gap between them, read from the DOM so the step stays
      // right at every breakpoint without duplicating the CSS here.
      const step = card.offsetWidth + parseFloat(getComputedStyle(track).columnGap || '0');
      const end = track.scrollWidth - track.clientWidth;
      // A 2px tolerance: fractional widths mean the last position is rarely
      // exactly `end`, and without it the track would never wrap around.
      const atEnd = track.scrollLeft >= end - 2;
      track.scrollTo({ left: atEnd ? 0 : track.scrollLeft + step, behavior: 'smooth' });
    };

    const id = setInterval(tick, ADVANCE_MS);
    return () => clearInterval(id);
  }, [paused, reviews.length]);

  // Escape closes the full-review dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!reviews.length) return null;

  const hold = () => setPaused(true);
  const release = () => setPaused(false);

  return (
    <section className="st-card" aria-labelledby="sh-reviews">
      <div className="st-row-head">
        <h2 id="sh-reviews" className="st-h2">What customers say</h2>
      </div>

      <div
        ref={trackRef}
        className="sh-reviews"
        onMouseEnter={hold}
        onMouseLeave={release}
        onFocusCapture={hold}
        onBlurCapture={release}
        onTouchStart={hold}
        onTouchEnd={release}
        // A labelled group, so a screen reader announces what the moving region
        // is; `aria-live=off` because the slides are not news, they are content.
        role="group"
        aria-label={`${reviews.length} customer reviews`}
        aria-live="off"
      >
        {reviews.map((r, k) => (
          <article className="sh-review" key={k} data-card>
            <Stars rating={r.rating} />
            <blockquote className="sh-review-quote" data-quote={k}>{r.quote}</blockquote>
            {clipped[k] && (
              <button type="button" className="sh-review-more" onClick={() => setOpen(r)}>
                View full review
              </button>
            )}
            <div className="sh-review-who">
              <span className="sh-review-avatar" aria-hidden="true">{(r.name.trim()[0] || '?').toUpperCase()}</span>
              <span>
                <span className="sh-review-name">{r.name}</span>
                {r.verified && <span className="sh-review-verified">Verified purchase</span>}
              </span>
            </div>
            {r.product && <Link href={r.product.href} className="sh-review-product">{r.product.name}</Link>}
          </article>
        ))}
      </div>

      {open && (
        <div className="sh-rev-backdrop" role="dialog" aria-modal="true" aria-label={`Review by ${open.name}`}>
          {/* Click-outside-to-close. Named differently from the visible Close
              button below so a screen reader does not read out two identical
              controls in the same dialog. */}
          <button type="button" className="sh-rev-dismiss" aria-label="Close the review" onClick={() => setOpen(null)} />
          <div className="sh-rev-modal">
            <Stars rating={open.rating} />
            <p className="sh-rev-full">{open.quote}</p>
            <div className="sh-review-who">
              <span className="sh-review-avatar" aria-hidden="true">{(open.name.trim()[0] || '?').toUpperCase()}</span>
              <span>
                <span className="sh-review-name">{open.name}</span>
                {open.verified && <span className="sh-review-verified">Verified purchase</span>}
              </span>
            </div>
            {open.product && (
              <Link href={open.product.href} className="sh-review-product">{open.product.name}</Link>
            )}
            <button type="button" className="sh-btn sh-btn-outline sh-rev-close" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
