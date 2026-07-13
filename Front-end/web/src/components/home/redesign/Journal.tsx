'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Img from './Img';
import { ArrowRightLong } from './icons';
import { journal, journalPosts as fallbackJournalPosts, type JournalItem } from './homeContent';

const AUTOPLAY_MS = 3400;

// Card geometry (matches the imported "Scrapbook Carousel" design: 760×500 base).
const MAX_CARD_W = 620;
const CARD_RATIO = 500 / 760;

// Per-distance fan geometry, indexed by clamped |offset| (0 = active card).
// Values are px at the 760px reference width; scaled by `sf` for responsiveness.
const FAN_TX = [0, 240, 390, 480, 540]; // translateX magnitude
const FAN_ROT = [0, 52, 68, 78, 84]; // rotateY magnitude (deg)

/**
 * The Garage Journal carousel — a 3D perspective "scrapbook deck": the active
 * article sits face-on in the centre while neighbours fan back into depth,
 * rotated on the Y axis. Ported from the Claude Design "Scrapbook Carousel"
 * and themed to the site (obsidian + gold), driven by live blog posts.
 *
 * Interactions: prev/next arrows, ←/→ keys, pointer drag / touch swipe, and
 * autoplay (paused on hover, focus, drag, and prefers-reduced-motion). Clicking
 * a side card brings it to centre; clicking the active card opens the article.
 *
 * Hydration-safe: initial state is deterministic (activeIndex 0, base card
 * width); the responsive width is only measured client-side after mount.
 */
export default function Journal({ posts }: { posts?: JournalItem[] }) {
  // Live blog posts from the DB; static placeholders if none resolved.
  const items = posts?.length ? posts : fallbackJournalPosts;
  const n = items.length;

  const stageRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cardW, setCardW] = useState(MAX_CARD_W);

  // Pointer drag state. The live delta lives in a ref (read synchronously by the
  // click handler to distinguish a tap from a swipe); mirrored to state only to
  // drive the rubber-band transform while dragging. `captured` tracks whether we
  // have taken pointer capture yet — we defer it until the pointer actually moves
  // (see onPointerMove) so a plain tap's `click` still reaches the card's <Link>.
  const drag = useRef({ active: false, startX: 0, delta: 0, pointerId: -1, captured: false });
  const [dragDelta, setDragDelta] = useState(0);
  const [dragging, setDragging] = useState(false);

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const goTo = useCallback(
    (i: number) => setActive(((i % n) + n) % n),
    [n],
  );

  // Measure the stage so cards scale down on narrow viewports.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const w = el.offsetWidth || window.innerWidth;
      setCardW(Math.min(MAX_CARD_W, Math.max(200, w * 0.8)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Autoplay — advance one card; paused on hover/focus/drag and reduced motion.
  useEffect(() => {
    if (n <= 1 || paused || dragging || prefersReducedMotion()) return;
    const id = window.setInterval(() => setActive((a) => (a + 1) % n), AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [n, paused, dragging]);

  // Movement past this many px promotes a press into a drag (takes pointer
  // capture, starts the rubber-band). Below it, the gesture stays a tap so the
  // browser still fires a real `click` on the card's <Link> and it navigates.
  const DRAG_THRESHOLD = 6;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (n <= 1) return;
    // Note: no setPointerCapture here — capturing eagerly retargets the click and
    // breaks tap-to-open. We capture lazily on the first real move instead.
    drag.current = { active: true, startX: e.clientX, delta: 0, pointerId: e.pointerId, captured: false };
    setDragDelta(0);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) return;
    drag.current.delta = e.clientX - drag.current.startX;
    // Promote to a real drag once the pointer has actually moved.
    if (!drag.current.captured && Math.abs(drag.current.delta) > DRAG_THRESHOLD) {
      drag.current.captured = true;
      setDragging(true);
      stageRef.current?.setPointerCapture?.(e.pointerId);
    }
    if (drag.current.captured) setDragDelta(drag.current.delta);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) return;
    const { delta: d, captured } = drag.current;
    drag.current.active = false;
    drag.current.captured = false;
    setDragging(false);
    setDragDelta(0);
    if (captured) {
      stageRef.current?.releasePointerCapture?.(e.pointerId);
      if (d < -55) goTo(active + 1);
      else if (d > 55) goTo(active - 1);
    }
    // A tap (never captured) falls through to the card's click handler / <Link>.
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goTo(active - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goTo(active + 1);
    }
  };

  const sf = cardW / 760; // responsive scale factor
  const cardH = Math.round(cardW * CARD_RATIO);

  return (
    <section
      className="journal"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="journal-head journal-inner">
        <div className="journal-head-copy">
          <div className="journal-eyebrow reveal">{journal.eyebrow}</div>
          <h2 className="reveal reveal-d1">
            {journal.titleTop} <em>{journal.titleAccent}</em>
          </h2>
          <p className="journal-desc reveal reveal-d2">{journal.body}</p>
        </div>
      </div>

      <div className="jf reveal">
        <div
          className="jf-stage"
          ref={stageRef}
          role="group"
          aria-roledescription="carousel"
          aria-label="The Garage Journal articles"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {items.map((p, i) => {
            const offset = i - active;
            const absOff = Math.abs(offset);
            const sign = offset >= 0 ? 1 : -1;
            const isActive = i === active;
            const clamped = Math.min(absOff, 4);

            const dragShift = dragging
              ? dragDelta * (isActive ? 0.55 : absOff === 1 ? 0.3 : 0.1)
              : 0;
            const tx = sign * FAN_TX[clamped] * sf + dragShift;
            const rotY = sign * -FAN_ROT[clamped];
            const opacity = isActive ? 1 : Math.max(0.12, 1 - absOff * 0.28);
            const zIndex = isActive ? 100 : Math.max(1, 20 - absOff * 3);
            const transition = dragging
              ? 'opacity 0.12s ease'
              : 'transform 0.52s cubic-bezier(0.25,0.46,0.45,0.94), opacity 0.52s ease, box-shadow 0.3s ease';

            return (
              <Link
                key={p.href}
                href={p.href}
                className={`jf-card${isActive ? ' is-active' : ''}`}
                aria-label={`Read article: ${p.title}`}
                aria-current={isActive ? 'true' : undefined}
                aria-hidden={isActive ? undefined : true}
                tabIndex={isActive ? 0 : -1}
                draggable={false}
                style={{
                  width: cardW,
                  height: cardH,
                  transform: `translateX(${tx}px) rotateY(${rotY}deg)`,
                  opacity,
                  zIndex,
                  transition,
                }}
                onClick={(e) => {
                  // A completed drag/swipe should never navigate.
                  if (Math.abs(drag.current.delta) > 8) {
                    e.preventDefault();
                    return;
                  }
                  // Side cards recentre instead of opening the article.
                  if (!isActive) {
                    e.preventDefault();
                    goTo(i);
                  }
                }}
              >
                <div className="jf-photo">
                  <Img src={p.image} alt={p.title} draggable={false} />
                </div>
                <div className="jf-cap">
                  <span className="jf-cat">{p.category}</span>
                  <h3 className="jf-title">{p.title}</h3>
                </div>
                {n > 1 ? (
                  <span className="jf-badge" aria-hidden>
                    {active + 1} / {n}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>

        {n > 1 ? (
          <>
            <button
              type="button"
              className="jf-arrow jf-prev"
              onClick={() => goTo(active - 1)}
              aria-label="Previous article"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <path
                  d="M11.5 3.5L6 9l5.5 5.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="jf-arrow jf-next"
              onClick={() => goTo(active + 1)}
              aria-label="Next article"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <path
                  d="M6.5 3.5L12 9l-5.5 5.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </>
        ) : null}
      </div>

      <div className="journal-foot reveal">
        <Link className="journal-cta" href="/blog">
          All Articles <ArrowRightLong />
        </Link>
      </div>
    </section>
  );
}
