'use client';

import { useRef } from 'react';
import HeroSequence from './HeroSequence';
import { hero } from './homeContent';

export default function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const parallaxRef = useRef<HTMLDivElement>(null);

  function onMouseMove(e: React.MouseEvent) {
    const el = heroRef.current;
    const px = parallaxRef.current;
    if (!el || !px) return;
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
      <div className="bg-glow" />

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
          <HeroSequence sectionRef={pinRef} />
        </div>
      </div>
    </section>
    </div>
  );
}
