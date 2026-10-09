'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Img from '../redesign/Img';

export interface BannerSlide {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  cta: string;
  href: string;
  /** Product photos shown on the right of the slide. */
  images: string[];
  /** Visual theme of the slide background. */
  tone: 'green' | 'mint' | 'sand';
}

const AUTOPLAY_MS = 6000;
/** Horizontal travel (px) that counts as a swipe rather than a tap. */
const SWIPE_PX = 40;

/**
 * Amazon-style hero carousel. Until your team uploads banner artwork (admin
 * builder, a later phase) the slides are composed from real catalogue content —
 * the live deals, the vehicle finder, the specialist service — so nothing on them
 * is invented. Auto-advances (paused on hover/focus, off for reduced motion).
 */
export default function HeroBanners({ slides }: { slides: BannerSlide[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = slides.length;
  const go = useCallback((n: number) => setI(((n % count) + count) % count), [count]);
  const reduce = useRef(false);

  useEffect(() => {
    reduce.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);
  useEffect(() => {
    if (paused || count < 2 || reduce.current) return;
    const t = window.setTimeout(() => go(i + 1), AUTOPLAY_MS);
    return () => window.clearTimeout(t);
  }, [i, paused, count, go]);

  // Swipe / drag between slides (phones especially — there are no arrows there).
  // A horizontal move past SWIPE_PX changes slide; anything smaller is a tap, so
  // the slide's button still works. A real drag swallows the click that follows,
  // so lifting the finger over the CTA does not also open it.
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const dragged = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (count < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    dragged.current = false;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      dragged.current = true;
      go(dx < 0 ? i + 1 : i - 1);
    }
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (dragged.current) {
      e.preventDefault();
      e.stopPropagation();
      dragged.current = false;
    }
  };

  if (!count) return null;

  return (
    <section
      className="sh-hero"
      aria-roledescription="carousel"
      aria-label="Offers"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { drag.current = null; }}
      onClickCapture={onClickCapture}
    >
      <div className="sh-hero-track" style={{ transform: `translateX(-${i * 100}%)` }}>
        {slides.map((s, n) => (
          <div
            key={s.id}
            className={`sh-slide sh-slide-${s.tone}`}
            role="group"
            aria-roledescription="slide"
            aria-label={`${n + 1} of ${count}`}
            aria-hidden={n !== i}
            inert={n !== i}
          >
            <div className="sh-slide-copy">
              <p className="sh-slide-eyebrow">{s.eyebrow}</p>
              <h2 className="sh-slide-title">{s.title}</h2>
              <p className="sh-slide-sub">{s.subtitle}</p>
              <Link href={s.href} className="sh-btn sh-btn-primary sh-btn-lg">{s.cta}</Link>
            </div>
            <div className={`sh-slide-art sh-slide-art-${Math.min(s.images.length, 3)}`} aria-hidden="true">
              {s.images.slice(0, 3).map((src, k) => (
                <div className="sh-slide-pic" key={k}>
                  <Img src={src} alt="" className="sh-slide-img" sizes="(max-width: 768px) 40vw, 300px" priority={n === 0 && k === 0} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {count > 1 && (
        <>
          <button type="button" className="sh-hero-arrow sh-hero-prev" aria-label="Previous offer" onClick={() => go(i - 1)}>‹</button>
          <button type="button" className="sh-hero-arrow sh-hero-next" aria-label="Next offer" onClick={() => go(i + 1)}>›</button>
          <div className="sh-hero-dots" role="tablist" aria-label="Choose offer">
            {slides.map((s, n) => (
              <button key={s.id} type="button" role="tab" aria-selected={n === i} aria-label={`Offer ${n + 1}`} className={n === i ? 'is-on' : undefined} onClick={() => go(n)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
