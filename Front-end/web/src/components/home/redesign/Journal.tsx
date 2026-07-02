'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Img from './Img';
import { ArrowRight, ArrowRightLong, ChevronLeft, ChevronRight } from './icons';
import { journal, journalPosts as fallbackJournalPosts, type JournalItem } from './homeContent';

const AUTOPLAY_MS = 6000;
// Past this drag distance (px) a release advances the carousel; below it, the
// gesture is treated as a click/tap and navigation is allowed.
const DRAG_THRESHOLD = 60;

/**
 * Shortest signed distance from `active` to card `i` on a ring of `n` cards.
 * Lets the coverflow wrap infinitely in either direction.
 */
function ringOffset(i: number, active: number, n: number): number {
  let d = i - active;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
}

export default function Journal({ posts }: { posts?: JournalItem[] }) {
  // Live blog posts from the DB; static placeholders if none resolved.
  const items = posts?.length ? posts : fallbackJournalPosts;
  const n = items.length;

  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const drag = useRef({ startX: 0, dx: 0, dragging: false, moved: false });

  const go = (dir: 1 | -1) => setActive((a) => (a + dir + n) % n);
  const jumpTo = (i: number) => setActive(((i % n) + n) % n);

  // Autoplay — paused on hover/focus/drag and when the user prefers reduced
  // motion. Single card or empty set never autoplays.
  useEffect(() => {
    if (n <= 1 || paused) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const id = window.setInterval(() => setActive((a) => (a + 1) % n), AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [n, paused]);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { startX: e.clientX, dx: 0, dragging: true, moved: false };
    setPaused(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.dragging) return;
    d.dx = e.clientX - d.startX;
    if (Math.abs(d.dx) > 6) d.moved = true;
  };
  const endDrag = () => {
    const d = drag.current;
    if (!d.dragging) return;
    if (d.dx <= -DRAG_THRESHOLD) go(1);
    else if (d.dx >= DRAG_THRESHOLD) go(-1);
    d.dragging = false;
    setPaused(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    }
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

      <div
        className="mc reveal"
        role="group"
        aria-roledescription="carousel"
        aria-label="The Garage Journal articles"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <button
          type="button"
          className="mc-arrow mc-prev"
          aria-label="Previous article"
          onClick={() => go(-1)}
        >
          <ChevronLeft />
        </button>

        <div
          className="mc-stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onPointerCancel={endDrag}
        >
          {items.map((p, i) => {
            const off = ringOffset(i, active, n);
            const visible = Math.abs(off) <= 2;
            const isCenter = off === 0;
            return (
              <Link
                href={p.href}
                className={`mc-card${isCenter ? ' is-center' : ''}`}
                key={p.title}
                data-off={off}
                aria-hidden={!isCenter}
                tabIndex={isCenter ? 0 : -1}
                style={{ visibility: visible ? 'visible' : 'hidden' }}
                onClick={(e) => {
                  // Suppress navigation for drags and for taps on a side card
                  // (a side tap re-centres it instead of opening the article).
                  if (drag.current.moved || !isCenter) {
                    e.preventDefault();
                    if (!drag.current.moved && !isCenter) jumpTo(i);
                  }
                }}
              >
                <div className="thumb">
                  <span className="cat">{p.category}</span>
                  <Img src={p.image} alt={p.title} draggable={false} />
                </div>
                <div className="mc-body">
                  <div className="journal-meta">
                    <span>{p.date}</span>
                    {p.readTime && (
                      <>
                        <span className="dot" />
                        <span>{p.readTime}</span>
                      </>
                    )}
                  </div>
                  <h3>{p.title}</h3>
                  <p>{p.excerpt}</p>
                  <span className="journal-readlink">
                    Read Article <ArrowRight />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        <button
          type="button"
          className="mc-arrow mc-next"
          aria-label="Next article"
          onClick={() => go(1)}
        >
          <ChevronRight />
        </button>
      </div>

      <div className="mc-dots" role="tablist" aria-label="Select article">
        {items.map((p, i) => (
          <button
            key={p.title}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-label={`Go to article ${i + 1}`}
            className={`mc-dot${i === active ? ' active' : ''}`}
            onClick={() => jumpTo(i)}
          />
        ))}
      </div>
    </section>
  );
}
