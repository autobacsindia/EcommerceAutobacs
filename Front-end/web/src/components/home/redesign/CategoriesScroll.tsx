'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Img from './Img';
import { ArrowRight, ChevronLeft, ChevronRight } from './icons';
import { categories as fallbackCategories, type CategoryItem } from './homeContent';

/**
 * Featured-category gallery for md/lg screens: a sideways-scrolling row with arrow
 * buttons. It never pins the page or hijacks its scroll (see the effect below).
 * Phones get the coverflow variant instead (see Categories.tsx dispatcher).
 */
export default function CategoriesScroll({ categories }: { categories?: CategoryItem[] }) {
  // Live category hubs from the DB; static placeholders if none resolved.
  const items = categories?.length ? categories : fallbackCategories;
  const secRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState('01');
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

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

  /*
    ── A normal sideways row, never a scroll trap ──────────────────────────────
    This used to be a sticky 100vh panel inside a track ~3,700px tall: the page's
    vertical scroll was converted into sideways card movement, so the page stopped
    moving down for several screens. Customers read that as the site being stuck.

    Now the row scrolls on its own axis — trackpad swipe, shift+wheel, touch, or the
    arrow buttons — and the page's own scroll is never touched. The counter and the
    progress bar follow the ROW's scroll position.
  */
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = track.scrollWidth - track.clientWidth;
      const progress = max > 0 ? track.scrollLeft / max : 0;
      if (barRef.current) barRef.current.style.width = `${Math.max(progress, 0.04) * 100}%`;
      const idx = Math.min(items.length, Math.max(1, Math.round(progress * (items.length - 1)) + 1));
      setCurrent(String(idx).padStart(2, '0'));
      setAtStart(track.scrollLeft <= 4);
      setAtEnd(track.scrollLeft >= max - 4);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    track.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      track.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [items.length]);

  /** One card (plus its gap) per press. */
  const nudge = (dir: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>('.cat-card');
    const stepPx = card ? card.offsetWidth + 22 : track.clientWidth * 0.8;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollBy({ left: dir * stepPx, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <section ref={secRef} className="categories categories-scroll">
      <div className="cat-scroll-outer">
        <div className="cat-sticky">
          <div className="cat-head">
            <h2 className="reveal">Shop by Category</h2>
            <div className="cat-head-meta">
              <div className="cat-counter">
                <b>{current}</b> / {String(items.length).padStart(2, '0')}
              </div>
              <div className="cat-progress">
                <div className="cat-progress-bar" ref={barRef} />
              </div>
              <div className="cat-nav" role="group" aria-label="Browse categories">
                <button type="button" className="cat-nav-btn" aria-label="Previous categories" onClick={() => nudge(-1)} disabled={atStart}>
                  <ChevronLeft />
                </button>
                <button type="button" className="cat-nav-btn" aria-label="More categories" onClick={() => nudge(1)} disabled={atEnd}>
                  <ChevronRight />
                </button>
              </div>
            </div>
          </div>

          <div className="cat-track-wrap">
            <div className="cat-track" ref={trackRef}>
              {items.map((cat, i) => (
                <Link href={cat.href} className="cat-card" key={cat.name}>
                  <Img src={cat.image} alt={cat.name.replace('\n', ' ')} sizes="(max-width: 768px) 80vw, 400px" />
                  <div className="cat-num-ghost">{String(i + 1).padStart(2, '0')}</div>
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
              ))}
              <div className="cat-end-card">
                <div className="ec-eyebrow">12,000+ parts</div>
                <div className="ec-title">
                  Browse the
                  <br />
                  full catalog
                </div>
                <Link href="/categories" className="ec-btn">
                  View All Categories
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
