'use client';

import { useMemo, useRef } from 'react';
import Link from 'next/link';
import HeroSequence from './HeroSequence';
import HeroSpinSlide from './HeroSpinSlide';
import useHeroCarousel from './useHeroCarousel';
import { hero } from './homeContent';
import type { SpinTeaser } from './homeData';

/**
 * The hero stage, and (when a campaign is live) a carousel over it.
 *
 * ── Why the carousel lives HERE and not around .hero-pin ─────────────────────
 * `.hero-pin` is a 300vh / 180vh scroll track; `.hero` sticks inside it while
 * HeroSequence scrubs the car's frame sequence against scroll position. That machinery
 * reads `.hero-pin`'s own bounding box, so the carousel is nested INSIDE `.hero`,
 * below the level anything measures:
 *
 *   - HeroSequence.tsx is unchanged and still receives `pinRef`. Its scrub maths,
 *     IntersectionObserver, ResizeObserver and ACTIVE_CLASS handling never see this.
 *   - The canvas is never unmounted. Changing slide only translates the track, so the
 *     decoded ImageBitmaps, the abort controller and the preload state all survive.
 *   - `.hero-slide` is `position: absolute; inset: 0`, so every hero-relative offset
 *     the design already depends on (`.hero-left { left: 52px }`, `.center-img`,
 *     `.hero-consult-wrap`) resolves exactly as it did before the wrapper existed.
 *
 * And useHeroCarousel locks to slide 0 the moment the user scrolls, so the pinned
 * sequence always plays over the car rather than behind the poster.
 *
 * With no live campaign there is one slide, the hook is inert, and the rendered
 * output is what it has always been.
 */
export default function Hero({ spinTeaser = null }: { spinTeaser?: SpinTeaser | null }) {
  const heroRef = useRef<HTMLElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const parallaxRef = useRef<HTMLDivElement>(null);

  /*
    A campaign that ended between this page being cached and being viewed must not be
    advertised. The page is ISR (revalidate = 300) and nothing writes to a campaign
    when it expires, so no cache tag can fire at `endsAt` — this check is what closes
    that window. Evaluated at render: the slide is gone on the next navigation or
    refresh rather than lingering for up to five minutes.
  */
  const teaser = useMemo(() => {
    if (!spinTeaser) return null;
    const ends = new Date(spinTeaser.endsAt).getTime();
    if (Number.isFinite(ends) && ends <= Date.now()) return null;
    return spinTeaser;
  }, [spinTeaser]);

  const slideCount = teaser ? 2 : 1;
  // `pinRef` — not `heroRef` — drives the scroll lock: `.hero` is sticky, so its top
  // stays at 0 for the whole pin and cannot report scrub progress. The pin can.
  const { index, goTo, locked } = useHeroCarousel(slideCount, heroRef, pinRef);

  function onMouseMove(e: React.MouseEvent) {
    const el = heroRef.current;
    const px = parallaxRef.current;
    // Parallax belongs to the car slide only — nudging the stage while the poster is
    // showing would drag the (hidden) canvas around for no visible reason.
    if (!el || !px || index !== 0) return;
    const cx = el.offsetWidth / 2;
    const cy = el.offsetHeight / 2;
    const dx = (e.clientX - cx) / cx;
    const dy = (e.clientY - cy) / cy;
    px.style.transform = `translate(${dx * 16}px, ${dy * 10}px)`;
  }

  function onMouseLeave() {
    if (parallaxRef.current) parallaxRef.current.style.transform = 'translate(0,0)';
  }

  return (
    // .hero-pin is the tall scroll track (desktop only); .hero sticks inside it,
    // so the whole screen stays fixed while the frame sequence scrubs, then the
    // page scrolls on once the sequence finishes. On mobile the wrapper collapses
    // and the hero is a normal stacked section.
    <div className="hero-pin" ref={pinRef}>
    <section
      className="hero"
      ref={heroRef}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      {/* Shared backdrop, deliberately OUTSIDE the track: both slides sit on the same
          ground, so it must not translate with them. */}
      <div className="bg-glow" />

      {/*
        `is-snapping-back` swaps the 0.8s "change of subject" slide for a 200ms one
        while the scroll lock is what is moving the track. An advance the viewer asked
        for (timer, dot) should feel unhurried; a correction that gets out of the way of
        their scroll should not still be sliding once they are into the scrub.
      */}
      <div
        className={`hero-carousel${locked ? ' is-snapping-back' : ''}`}
        style={{ transform: `translate3d(-${index * 100}%, 0, 0)` }}
      >
        <div className="hero-slide" aria-hidden={index !== 0} inert={index !== 0}>
          <div className="hero-left">
            <div className="eyebrow">{hero.eyebrow}</div>
            <h1 className="headline">
              {hero.headlineTop}
              <br />
              <em>{hero.headlineAccent}</em>
            </h1>
            <p className="tagline">{hero.tagline}</p>
          </div>

          <div className="floor-glow" />

          <div className="center-img">
            <div ref={parallaxRef} style={{ transition: 'transform 0.9s cubic-bezier(0.16,1,0.3,1)' }}>
              {/*
                Mounted once, for the life of the page. `pinRef` — not a slide ref —
                is what it measures; see the note at the top of this file.
              */}
              <HeroSequence sectionRef={pinRef} />
            </div>
          </div>

          {/* Bottom-right on md/lg (absolute); flows below the hero image on small screens (static). */}
          <div className="hero-consult-wrap">
            <Link href="/consultation" className="hero-consult">
              <span>Consult a specialist</span>
              <span className="hero-consult-arrow" aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        {teaser && (
          <div className="hero-slide" aria-hidden={index !== 1} inert={index !== 1}>
            <HeroSpinSlide teaser={teaser} active={index === 1} />
          </div>
        )}
      </div>

      {/* Hidden once the scrub owns the screen — dots over a pinned animation are
          just clutter, and they control nothing while the carousel is locked. */}
      {slideCount > 1 && !locked && (
        <div className="hero-dots" role="tablist" aria-label="Hero slides">
          {Array.from({ length: slideCount }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={index === i}
              aria-label={i === 0 ? 'Featured collection' : 'Spin to Win'}
              className={`bc-dot${index === i ? ' is-active' : ''}`}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}
    </section>
    </div>
  );
}
