'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Img from './Img';
import { ArrowRight, ChevronLeft, ChevronRight } from './icons';
import { transformation, stats } from './homeContent';

/** Pixels a touch must travel before we decide "slider drag" vs "page scroll". */
const DIRECTION_LOCK_PX = 8;

export default function Transformation() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(50);
  const [touched, setTouched] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Read by the intro peek's timers, which must not move a divider the visitor has taken.
  const touchedRef = useRef(false);
  touchedRef.current = touched;

  const pctFromX = useCallback((clientX: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  /*
    ── Drag without stealing the page's scroll ────────────────────────────────
    This used to set `touch-action: none` on the whole photo and start a drag on
    any touch. On a phone the photo (3:4) fills most of the screen, so a swipe
    that began on it could not scroll the page at all.

    Now the photo allows vertical panning (`touch-action: pan-y`) and a touch only
    becomes a slider drag once it has clearly moved sideways. A mouse drags
    straight away, as before.
  */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let start: { x: number; y: number; id: number; touch: boolean } | null = null;
    let locked: 'x' | 'y' | null = null;

    const down = (e: PointerEvent) => {
      start = { x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType !== 'mouse' };
      locked = start.touch ? null : 'x';
      if (locked === 'x') {
        setTouched(true);
        setDragging(true);
        setPct(pctFromX(e.clientX));
      }
    };
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      if (!locked) {
        const dx = Math.abs(e.clientX - start.x);
        const dy = Math.abs(e.clientY - start.y);
        if (dx < DIRECTION_LOCK_PX && dy < DIRECTION_LOCK_PX) return;
        locked = dx > dy ? 'x' : 'y';
        if (locked === 'x') {
          setTouched(true);
          setDragging(true);
          el.setPointerCapture?.(e.pointerId);
        }
      }
      if (locked === 'x') setPct(pctFromX(e.clientX));
    };
    const up = () => {
      start = null;
      locked = null;
      setDragging(false);
    };

    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [pctFromX]);

  /*
    A one-time "peek" when the comparison first comes into view, so it is obvious
    the divider moves. Skipped for reduced motion and once the visitor has touched it.
  */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timers: number[] = [];
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        const steps: Array<[number, number]> = [[400, 68], [1100, 32], [1800, 50]];
        timers = steps.map(([at, to]) => window.setTimeout(() => setPct((p) => (touchedRef.current ? p : to)), at));
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    const stepBy = e.shiftKey ? 20 : 5;
    if (e.key === 'ArrowLeft') { setPct((p) => Math.max(0, p - stepBy)); setTouched(true); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setPct((p) => Math.min(100, p + stepBy)); setTouched(true); e.preventDefault(); }
    if (e.key === 'Home') { setPct(0); setTouched(true); e.preventDefault(); }
    if (e.key === 'End') { setPct(100); setTouched(true); e.preventDefault(); }
  };

  return (
    <section className="transformation">
      <div className="section-header reveal">
        <div className="eyebrow">{transformation.eyebrow}</div>
        <h2>
          {transformation.titleTop} <em>{transformation.titleAccent}</em>
          <br />
          {transformation.titleBottom}
        </h2>
        <p className="tf-sub">Real builds from our workshop. Drag the divider to see the difference.</p>
      </div>

      <figure className="tf-frame reveal reveal-d1">
        <div
          className={`split-reveal${dragging ? ' dragging' : ''}`}
          ref={wrapRef}
        >
          <Img src={transformation.after} alt="After the Autobacs transformation" className="split-after" draggable={false} sizes="(min-width: 1444px) 1340px, 100vw" />
          <div className="split-before-wrap" style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}>
            <Img src={transformation.before} alt="Before" className="split-before" draggable={false} sizes="(min-width: 1444px) 1340px, 100vw" />
          </div>
          <div className="split-label split-label-before">Before</div>
          <div className="split-label split-label-after">After</div>
          {!touched && <div className="split-hint">Drag to compare</div>}
          <div className="split-handle" style={{ left: `${pct}%` }}>
            <div
              className="split-grip"
              role="slider"
              tabIndex={0}
              aria-label="Before and after comparison"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pct)}
              aria-valuetext={`${Math.round(pct)}% before`}
              onKeyDown={onKey}
            >
              <ChevronLeft />
              <ChevronRight />
            </div>
          </div>
        </div>
        <figcaption className="tf-caption">
          <div>
            <span className="tf-caption-eyebrow">Featured build</span>
            <span className="tf-caption-title">BMW 7 Series</span>
          </div>
          <Link href="/consultation" className="tf-cta">
            Plan your build <ArrowRight />
          </Link>
        </figcaption>
      </figure>

      <div className="transform-stats reveal reveal-d2">
        {stats.map((s) => (
          <div className="transform-stat" key={s.label}>
            <div className="num">
              {s.value}
              <sup>{s.suffix}</sup>
            </div>
            <div className="desc">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
