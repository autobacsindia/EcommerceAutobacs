'use client';

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

      <div className="anim-stage reveal">
        {/* Decorative corner brackets — above the car, non-blocking */}
        <div className="pointer-events-none absolute inset-0 z-[3]">
          <div className="bracket bracket-tl" />
          <div className="bracket bracket-tr" />
          <div className="bracket bracket-bl" />
          <div className="bracket bracket-br" />
        </div>

        {hasCar ? (
          <CarStage hotspots={hotspots} onSelect={onSelect} />
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
            {showreel.poster ? <Img src={showreel.poster} alt="Showreel preview" className="ce-bg" /> : null}
          </>
        )}
      </div>

      {/* Crawlable / keyboard-first hub links + abstract-hub chips + credit.
          The 3D canvas isn't crawlable, so these are the real SEO/no-JS path. */}
      {hasCar && (
        <div className="px-6 pb-2 pt-6 md:px-[52px]">
          <nav aria-label="Browse by category">
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-2">
              {hotspots
                .filter((h) => !h.chip)
                .map((h) => (
                  <Link
                    key={h.id}
                    href={h.href}
                    className="text-[13px] font-light text-ink-muted transition-colors hover:text-gold"
                  >
                    {h.label}
                  </Link>
                ))}
            </div>
          </nav>

          {chips.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {chips.map((h) => (
                <Link
                  key={h.id}
                  href={h.href}
                  onClick={() => onSelect(h.id)}
                  className="rounded-full border border-hairline px-3 py-1 text-xs font-medium text-ink/90 transition-colors hover:border-gold hover:text-gold"
                >
                  {h.label}
                </Link>
              ))}
            </div>
          )}

          <CarExplorerCredit className="mt-6 text-center" />
        </div>
      )}

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
