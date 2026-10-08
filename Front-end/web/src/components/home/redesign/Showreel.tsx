'use client';

import { useState } from 'react';
import Link from 'next/link';
import Img from './Img';
import { ArrowRight } from './icons';
import { showreel } from './homeContent';
import CarStage from '../car-explorer/CarStage';
import CarExplorerCredit from '../car-explorer/CarExplorerCredit';
import type { ResolvedCarHotspot } from '@/lib/carHotspots';

/**
 * Showreel section — repurposed into the interactive "shop by fitment" car.
 * When hub hotspots resolve, the framed stage hosts the 3D/rotatable Hilux
 * (desktop) or the static fallback (mobile/reduced-motion), and clicking a part
 * opens that category hub. Falls back to the original video/placeholder stage if
 * no hotspots resolve, so the section never renders broken.
 */
export default function Showreel({ hotspots = [] }: { hotspots?: ResolvedCarHotspot[] }) {
  const hasCar = hotspots.length > 0;
  const hasVideo = Boolean(showreel.video);
  const chips = hotspots.filter((h) => h.chip);
  const points = hotspots.filter((h) => !h.chip);
  // The part highlighted on the car — from the side panel or a marker.
  const [activeId, setActiveId] = useState<string | null>(null);

  const onSelect = (id: string) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('car-explorer:select', { detail: { id } }));
    }
  };

  return (
    <section className="showcase">
      <div className="anim-header">
        <div>
          <div className="anim-eyebrow reveal">{showreel.eyebrow}</div>
          <h2 className="anim-title reveal reveal-d1">
            {showreel.titleTop}
            <br />
            <em>{showreel.titleAccent}</em>
          </h2>
        </div>
        <div className="anim-header-right reveal reveal-d2">{showreel.body}</div>
      </div>

      <div className={hasCar ? 'ce-layout' : undefined}>
      <div className="anim-stage reveal">
        {/* Decorative corner brackets — above the car, non-blocking */}
        <div className="pointer-events-none absolute inset-0 z-[3]">
          <div className="bracket bracket-tl" />
          <div className="bracket bracket-tr" />
          <div className="bracket bracket-bl" />
          <div className="bracket bracket-br" />
        </div>

        {hasCar ? (
          <>
            <CarStage hotspots={hotspots} onSelect={onSelect} activeId={activeId} onHover={setActiveId} />
            <div className="ce-hint" aria-hidden="true">
              <span className="ce-hint-dot" /> Drag to rotate · Click a point to shop
            </div>
          </>
        ) : hasVideo ? (
          <video src={showreel.video} poster={showreel.poster || undefined} autoPlay muted loop playsInline />
        ) : (
          <>
            <div className="scanlines" />
            <div className="anim-placeholder">
              <div className="anim-placeholder-grid">
                {Array.from({ length: 72 }).map((_, i) => (
                  <div key={i} />
                ))}
              </div>
            </div>
            <div className="anim-pulse" />
            <div className="anim-center">
              <div className="anim-play-ring">
                <div className="anim-play-icon" />
              </div>
              <span className="anim-cta-text">Play Showreel</span>
            </div>
            {showreel.poster ? <Img src={showreel.poster} alt="Showreel preview" className="ce-bg" sizes="100vw" /> : null}
          </>
        )}
      </div>

      {/* Side panel: the same hub links as the markers, numbered to match, so a
          shopper can pick a part by name — and hovering one highlights it on the
          car. These are real links: the crawlable / keyboard / no-JS path too. */}
      {hasCar && (
        <aside className="ce-panel" aria-label="Browse by part of the car">
          <p className="ce-panel-eyebrow">Choose an area</p>
          <ol className="ce-list">
            {points.map((h, i) => (
              <li key={h.id}>
                <Link
                  href={h.href}
                  onClick={() => onSelect(h.id)}
                  onMouseEnter={() => setActiveId(h.id)}
                  onMouseLeave={() => setActiveId(null)}
                  onFocus={() => setActiveId(h.id)}
                  onBlur={() => setActiveId(null)}
                  className={`ce-item${activeId === h.id ? ' is-active' : ''}`}
                >
                  <span className="ce-num" aria-hidden="true">{i + 1}</span>
                  <span className="ce-label">{h.label}</span>
                  <ArrowRight className="ce-arrow" />
                </Link>
              </li>
            ))}
          </ol>
          {chips.length > 0 && (
            <div className="ce-chips">
              <span className="ce-chips-label">Also explore</span>
              {chips.map((h) => (
                <Link key={h.id} href={h.href} onClick={() => onSelect(h.id)} className="ce-chip">
                  {h.label}
                </Link>
              ))}
            </div>
          )}
          <CarExplorerCredit className="ce-credit" />
        </aside>
      )}
      </div>

      <div className="anim-strip">
        <span className="anim-strip-label">
          {hasCar ? 'Interactive Fitment Explorer' : 'Animation / Video Showcase'}
        </span>
        <Link href="/categories" className="anim-strip-link">
          {hasCar ? 'All Categories' : 'View Full Gallery'} <ArrowRight />
        </Link>
      </div>
    </section>
  );
}
