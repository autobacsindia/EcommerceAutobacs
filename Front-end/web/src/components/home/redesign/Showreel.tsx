'use client';

import Img from './Img';
import { ArrowRight } from './icons';
import { showreel } from './homeContent';

export default function Showreel() {
  const hasVideo = Boolean(showreel.video);

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
        <div className="bracket bracket-tl" />
        <div className="bracket bracket-tr" />
        <div className="bracket bracket-bl" />
        <div className="bracket bracket-br" />

        {hasVideo ? (
          <video
            src={showreel.video}
            poster={showreel.poster || undefined}
            autoPlay
            muted
            loop
            playsInline
          />
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
            <div className="anim-data anim-data-1">
              <div className="anim-data-val">4K · 60fps</div>
              <div className="anim-data-line" />
              <div className="anim-data-desc">Visual Quality</div>
            </div>
            <div className="anim-data anim-data-2">
              <div className="anim-data-val">[ YOUR VIDEO HERE ]</div>
              <div className="anim-data-line" />
              <div className="anim-data-desc">Set showreel.video in homeContent.ts</div>
            </div>
            <div className="anim-data anim-data-3">
              <div className="anim-data-val">2:34 min</div>
              <div className="anim-data-line" />
              <div className="anim-data-desc">Showreel Duration</div>
            </div>
          </>
        )}
        {/* Poster fallback for the empty-video state */}
        {!hasVideo && showreel.poster ? (
          <Img src={showreel.poster} alt="Showreel preview" className="ce-bg" />
        ) : null}
      </div>

      <div className="anim-strip">
        <span className="anim-strip-label">Animation / Video Showcase</span>
        <span className="anim-strip-link">
          View Full Gallery <ArrowRight />
        </span>
      </div>
    </section>
  );
}
