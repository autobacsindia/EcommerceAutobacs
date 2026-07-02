'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Img from './Img';
import { ArrowRightLong } from './icons';
import { journal, journalPosts as fallbackJournalPosts, type JournalItem } from './homeContent';

const AUTOPLAY_MS = 5000;

/**
 * Scrapbook-style journal carousel: a horizontally scroll-snapping row of
 * tilted "pinned photo" cards, each with a 1–2 line title in its bottom caption.
 *
 * Tilt is CSS-only (deterministic `:nth-child` angles) so there's no SSR/client
 * hydration mismatch. Scrolling is native scroll-snap; autoplay just nudges the
 * track to the next card and pauses on hover/focus/reduced-motion.
 */
export default function Journal({ posts }: { posts?: JournalItem[] }) {
  // Live blog posts from the DB; static placeholders if none resolved.
  const items = posts?.length ? posts : fallbackJournalPosts;
  const n = items.length;

  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Snap card `i` into view by scrolling the track to its offset.
  const scrollToCard = useCallback((i: number) => {
    const track = trackRef.current;
    const card = track?.children[i] as HTMLElement | undefined;
    if (!track || !card) return;
    track.scrollTo({
      left: card.offsetLeft - track.offsetLeft,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, []);

  const go = useCallback(
    (dir: 1 | -1) => {
      setActive((a) => {
        const next = (a + dir + n) % n;
        scrollToCard(next);
        return next;
      });
    },
    [n, scrollToCard],
  );

  // Autoplay — advance one card; paused on hover/focus and reduced motion.
  useEffect(() => {
    if (n <= 1 || paused || prefersReducedMotion()) return;
    const id = window.setInterval(() => {
      setActive((a) => {
        const next = (a + 1) % n;
        scrollToCard(next);
        return next;
      });
    }, AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [n, paused, scrollToCard]);

  // Keep `active` in sync when the user scrolls/drags the track by hand, so
  // autoplay resumes from wherever they landed (nearest card to the centre).
  const onScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const center = track.scrollLeft + track.clientWidth / 2;
    let nearest = 0;
    let best = Infinity;
    Array.from(track.children).forEach((el, i) => {
      const c = el as HTMLElement;
      const cardCenter = c.offsetLeft - track.offsetLeft + c.clientWidth / 2;
      const d = Math.abs(cardCenter - center);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    setActive(nearest);
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

      <div className="sb reveal">
        <div
          className="sb-track"
          ref={trackRef}
          role="group"
          aria-roledescription="carousel"
          aria-label="The Garage Journal articles"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onScroll={onScroll}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          {items.map((p, i) => (
            <Link
              className={`sb-card${i === active ? ' is-active' : ''}`}
              key={p.title}
              href={p.href}
              aria-label={`Read article: ${p.title}`}
              aria-current={i === active ? 'true' : undefined}
              draggable={false}
            >
              <div className="sb-photo">
                <Img src={p.image} alt={p.title} draggable={false} />
                {/* Title-only caption, overlaid at the bottom and revealed on the
                    focused/active (or hovered) card — clean photos otherwise. */}
                <div className="sb-cap">
                  <h3 className="sb-title">{p.title}</h3>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {n > 1 ? (
          <div className="sb-nav">
            <button type="button" className="sb-btn sb-back" onClick={() => go(-1)}>
              <ArrowRightLong className="sb-arrow-flip" aria-hidden />
              <span>Back</span>
            </button>
            <button type="button" className="sb-btn sb-next" onClick={() => go(1)}>
              <span>Next</span>
              <ArrowRightLong aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
