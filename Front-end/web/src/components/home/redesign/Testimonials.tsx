'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Img from './Img';
import { testimonials } from './homeContent';

export default function Testimonials() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);

  // Number of pages depends on cards-per-view (3 desktop, 1 mobile).
  const perView = useRef(3);

  const apply = useCallback((next: number) => {
    const track = trackRef.current;
    const wrap = track?.parentElement; // .testi-track-wrap == one page width
    if (!track || !wrap) return;
    const pv = perView.current;
    const pages = Math.max(1, Math.ceil(testimonials.length / pv));
    const clamped = Math.max(0, Math.min(pages - 1, next));
    // Each page advances by exactly one viewport width plus the inter-card gap
    // (CSS `.testi-track { gap: 24px }`), which aligns the next page's first
    // card to the left edge for both 3-up (desktop) and 1-up (mobile).
    const GAP = 24;
    track.style.transform = `translateX(-${clamped * (wrap.offsetWidth + GAP)}px)`;
    setIdx(clamped);
  }, []);

  useEffect(() => {
    const sync = () => {
      perView.current = window.matchMedia('(max-width: 768px)').matches ? 1 : 3;
      apply(0);
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [apply]);

  const pages = Math.max(1, Math.ceil(testimonials.length / perView.current));

  return (
    <section className="testimonials">
      <div className="section-header">
        <h2 className="reveal">What Enthusiasts Say</h2>
        <p className="reveal reveal-d1">Real builds. Real results. Real people.</p>
      </div>

      <div className="testi-track-wrap">
        <div className="testi-track" ref={trackRef}>
          {testimonials.map((t) => (
            <div className="testi-card" key={t.name}>
              <div className="testi-stars">★★★★★</div>
              <div className="testi-quote">{t.quote}</div>
              <div className="testi-author">
                <div className="testi-avatar">
                  <Img src={t.avatar} alt={t.name} />
                </div>
                <div>
                  <div className="testi-name">{t.name}</div>
                  <div className="testi-car">{t.detail}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="testi-controls">
        <button type="button" aria-label="Previous" onClick={() => apply(idx - 1)}>
          &#8592;
        </button>
        <div className="testi-dots">
          {Array.from({ length: pages }).map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              className={`testi-dot${i === idx ? ' active' : ''}`}
              onClick={() => apply(i)}
            />
          ))}
        </div>
        <button type="button" aria-label="Next" onClick={() => apply(idx + 1)}>
          &#8594;
        </button>
      </div>
    </section>
  );
}
