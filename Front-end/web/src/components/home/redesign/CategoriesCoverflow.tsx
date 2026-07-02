'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Img from './Img';
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from './icons';
import { categories as fallbackCategories, type CategoryItem } from './homeContent';

/** Autoplay cadence (ms). Paused on hover/focus/drag, hidden tab, reduced-motion. */
const AUTOPLAY_MS = 5000;
/** Min horizontal drag (px) to advance a slide. */
const DRAG_THRESHOLD = 44;
/** Side cards fanned out on each side of the active one. This variant is
 * phone-only, so one peek card each side reads best. */
const SIDE = 1;

/**
 * 3D coverflow transform for a card at circular offset `o` from the active card.
 * Center card is upright + full-size; side cards recede, rotate to face centre
 * and dim. Everything is expressed relative to the card's own size (%/deg), so
 * the layout is naturally responsive — no per-viewport measurement needed.
 */
function cardTransform(o: number, side: number) {
  const a = Math.abs(o);
  const sign = Math.sign(o);
  if (a > side) {
    // Just out of view — parked further out so it animates in/out smoothly.
    return {
      transform: `translateX(${sign * 90}%) translateZ(-180px) rotateY(${-sign * 45}deg) scale(0.55)`,
      zIndex: 0,
      opacity: 0,
      pointerEvents: 'none' as const,
      shade: 1,
    };
  }
  const tx = sign * (a === 0 ? 0 : 38 + (a - 1) * 26); // % of card width
  const ry = -sign * Math.min(a, 3) * 38; // deg — face the centre
  const scale = Math.max(1 - a * 0.13, 0.62);
  const tz = -a * 60; // px depth
  return {
    transform: `translateX(${tx}%) translateZ(${tz}px) rotateY(${ry}deg) scale(${scale})`,
    zIndex: 30 - a,
    opacity: 1,
    pointerEvents: 'auto' as const,
    shade: a === 0 ? 0 : Math.min(0.35 + a * 0.22, 0.7),
  };
}

/**
 * Featured-category carousel for phones: a 3D coverflow. md/lg screens get the
 * scroll-pinned gallery instead (see Categories.tsx dispatcher).
 */
export default function CategoriesCoverflow({ categories }: { categories?: CategoryItem[] }) {
  // Live category hubs from the DB; static placeholders if none resolved.
  const items = categories?.length ? categories : fallbackCategories;
  const count = items.length;

  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true); // user intent (WCAG 2.2.2 pause)
  const [visible, setVisible] = useState(false); // in viewport (and not display:none)
  const [reduceMotion, setReduceMotion] = useState(false);
  const secRef = useRef<HTMLElement>(null);
  const dragX = useRef<number | null>(null);
  const dragged = useRef(false);
  const paused = useRef(false); // transient pause during hover/drag

  // Defensive local scroll-reveal: HomeRedesign's global observer normally
  // reveals `.reveal` elements, but scanning it locally too keeps the heading
  // from getting stuck invisible if this component is mounted on its own or
  // after that observer has already run.
  useEffect(() => {
    const root = secRef.current;
    if (!root) return;
    const els = root.querySelectorAll('.reveal:not(.in)');
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Shortest circular distance from `active` → true carousel loop.
  const offsetOf = useCallback(
    (i: number) => {
      let o = i - active;
      if (o > count / 2) o -= count;
      if (o < -count / 2) o += count;
      return o;
    },
    [active, count]
  );

  const go = useCallback(
    (delta: number) => setActive((a) => ((a + delta) % count + count) % count),
    [count]
  );

  // Track the reduced-motion preference (live — user can toggle it at runtime).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Visibility gate: autoplay only runs while the carousel is on screen. A
  // `display:none` element (this variant on md/lg) never intersects, so this
  // also stops the timer on desktop where the scroll variant is shown instead.
  useEffect(() => {
    const root = secRef.current;
    if (!root) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      threshold: 0.2,
    });
    io.observe(root);
    return () => io.disconnect();
  }, []);

  // Autoplay — gated on user intent + visibility + reduced-motion + item count,
  // and transiently paused during hover/drag or when the tab is backgrounded.
  const autoOn = playing && visible && !reduceMotion && count > 1;
  useEffect(() => {
    if (!autoOn) return;
    const id = window.setInterval(() => {
      if (!paused.current && !document.hidden) go(1);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [autoOn, go]);

  // Keyboard navigation when the carousel has focus.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    }
  };

  // Pointer drag / touch swipe.
  const onPointerDown = (e: React.PointerEvent) => {
    dragX.current = e.clientX;
    dragged.current = false;
    paused.current = true;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragX.current !== null) {
      const dx = e.clientX - dragX.current;
      if (Math.abs(dx) > DRAG_THRESHOLD) {
        dragged.current = true; // suppress the click that follows a real swipe
        go(dx < 0 ? 1 : -1);
      }
    }
    dragX.current = null;
    paused.current = false;
  };

  const hold = () => {
    paused.current = true;
  };
  const release = () => {
    paused.current = false;
  };

  return (
    <section
      ref={secRef}
      className="categories categories-cf"
      aria-roledescription="carousel"
      aria-label="Shop by category"
    >
      <div className="cat-head">
        <h2 className="reveal">Shop by Category</h2>
        <div className="cat-head-meta">
          <div className="cat-counter">
            <b>{String(active + 1).padStart(2, '0')}</b> / {String(count).padStart(2, '0')}
          </div>
          <div className="cat-nav">
            {count > 1 && !reduceMotion && (
              <button
                type="button"
                className="cat-nav-btn"
                aria-label={playing ? 'Pause automatic rotation' : 'Resume automatic rotation'}
                aria-pressed={!playing}
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? <Pause /> : <Play />}
              </button>
            )}
            <button type="button" className="cat-nav-btn" aria-label="Previous category" onClick={() => go(-1)}>
              <ChevronLeft />
            </button>
            <button type="button" className="cat-nav-btn" aria-label="Next category" onClick={() => go(1)}>
              <ChevronRight />
            </button>
          </div>
        </div>
      </div>

      <div
        className="cat-stage"
        role="group"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseEnter={hold}
        onMouseLeave={release}
        onFocus={hold}
        onBlur={release}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {items.map((cat, i) => {
          const o = offsetOf(i);
          const t = cardTransform(o, SIDE);
          const isActive = o === 0;
          return (
            <Link
              href={cat.href}
              key={cat.name}
              className={`cat-card${isActive ? ' is-active' : ''}`}
              style={{
                transform: t.transform,
                zIndex: t.zIndex,
                opacity: t.opacity,
                pointerEvents: t.pointerEvents,
              }}
              aria-hidden={t.opacity === 0}
              tabIndex={isActive ? 0 : -1}
              aria-label={`${cat.name.replace('\n', ' ')} — ${isActive ? 'view category' : 'bring to front'}`}
              onClick={(e) => {
                // A real swipe shouldn't also trigger navigation/selection.
                if (dragged.current) {
                  e.preventDefault();
                  dragged.current = false;
                  return;
                }
                // Only the centre card navigates; a side card just steps to it.
                if (!isActive) {
                  e.preventDefault();
                  setActive(i);
                }
              }}
            >
              <Img src={cat.image} alt={cat.name.replace('\n', ' ')} draggable={false} />
              <div className="cat-shade" style={{ opacity: t.shade }} />
              <div className="cat-num">{String(i + 1).padStart(2, '0')}</div>
              <div className="cat-info">
                <div className={`cat-tag${cat.featured ? ' cat-tag-featured' : ''}`}>{cat.tag}</div>
                <div className="cat-name">
                  {cat.name.split('\n').map((line, j) => (
                    <span key={j}>
                      {line}
                      {j < cat.name.split('\n').length - 1 && <br />}
                    </span>
                  ))}
                </div>
                <div className="cat-underline" />
                <div className="cat-explore">
                  <span>Explore Range</span>
                  <ArrowRight />
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="cat-dots" role="tablist" aria-label="Select category">
        {items.map((cat, i) => (
          <button
            key={cat.name}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-label={cat.name.replace('\n', ' ')}
            className={`cat-dot${i === active ? ' is-active' : ''}`}
            onClick={() => setActive(i)}
          />
        ))}
      </div>

      <div className="cat-cta">
        <Link href="/categories" className="ec-btn">
          View All Categories
        </Link>
      </div>
    </section>
  );
}
