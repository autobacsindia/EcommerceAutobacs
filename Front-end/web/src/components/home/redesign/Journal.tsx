'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Img from './Img';
import { ArrowRightLong } from './icons';
import { journal, journalPosts as fallbackJournalPosts, type JournalItem } from './homeContent';

const AUTOPLAY_MS = 6000;
// Past this horizontal drag/swipe distance (px), a release advances the slide.
const SWIPE_THRESHOLD = 60;

export default function Journal({ posts }: { posts?: JournalItem[] }) {
  // Live blog posts from the DB; static placeholders if none resolved.
  const items = posts?.length ? posts : fallbackJournalPosts;
  const n = items.length;

  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const swipe = useRef({ startX: 0, dragging: false, moved: false });

  const go = (dir: 1 | -1) => setActive((a) => (a + dir + n) % n);
  const current = items[active];

  // Autoplay — paused on hover/focus and when reduced motion is preferred.
  useEffect(() => {
    if (n <= 1 || paused) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setActive((a) => (a + 1) % n), AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [n, paused]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    swipe.current = { startX: e.clientX, dragging: true, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (swipe.current.dragging && Math.abs(e.clientX - swipe.current.startX) > 8) {
      swipe.current.moved = true;
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!swipe.current.dragging) return;
    const dx = e.clientX - swipe.current.startX;
    swipe.current.dragging = false;
    if (dx <= -SWIPE_THRESHOLD) go(1);
    else if (dx >= SWIPE_THRESHOLD) go(-1);
  };

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
        <Link className="journal-cta reveal reveal-d2" href="/blog">
          All Articles <ArrowRightLong />
        </Link>
      </div>

      <div className="mc reveal">
        <div
          className="mc-frame"
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
        >
          {items.map((p, i) => (
            <div
              className={`mc-slide${i === active ? ' active' : ''}`}
              key={p.title}
              aria-hidden={i !== active}
            >
              <Img src={p.image} alt={p.title} draggable={false} />
            </div>
          ))}

          {/* Full-frame link to the current article (kept out of the nav bar so
              we never nest a <button> inside an <a>). */}
          <Link
            className="mc-open"
            href={current.href}
            aria-label={`Read article: ${current.title}`}
            onClick={(e) => {
              // A swipe ends in a click on this overlay — don't navigate then.
              if (swipe.current.moved) e.preventDefault();
            }}
          />

          <div className="mc-bar">
            <div className="mc-title" aria-live="polite">
              {current.title}
            </div>
            <div className="mc-nav">
              <button type="button" className="mc-btn mc-back" onClick={() => go(-1)}>
                <ArrowRightLong className="mc-arrow-flip" aria-hidden />
                <span>Back</span>
              </button>
              <button type="button" className="mc-btn mc-next" onClick={() => go(1)}>
                <span>Next</span>
                <ArrowRightLong aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
