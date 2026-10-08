'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Img from './Img';
import { ChevronLeft, ChevronRight } from './icons';
import { testimonials as fallbackTestimonials, type TestimonialItem } from './homeContent';

export default function Testimonials({ testimonials }: { testimonials?: TestimonialItem[] }) {
  // Live featured reviews from the DB; static placeholders if none resolved.
  const items = testimonials?.length ? testimonials : fallbackTestimonials;
  const trackRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);

  // Number of pages depends on cards-per-view (3 desktop, 1 mobile).
  const perView = useRef(3);

  const apply = useCallback((next: number) => {
    const track = trackRef.current;
    const wrap = track?.parentElement; // .testi-track-wrap == one page width
    if (!track || !wrap) return;
    const pv = perView.current;
    const pages = Math.max(1, Math.ceil(items.length / pv));
    const clamped = Math.max(0, Math.min(pages - 1, next));
    // Each page advances by exactly one viewport width plus the inter-card gap
    // (CSS `.testi-track { gap: 24px }`), which aligns the next page's first
    // card to the left edge for both 3-up (desktop) and 1-up (mobile).
    const GAP = 24;
    track.style.transform = `translateX(-${clamped * (wrap.offsetWidth + GAP)}px)`;
    setIdx(clamped);
  }, [items.length]);

  useEffect(() => {
    const sync = () => {
      perView.current = window.matchMedia('(max-width: 768px)').matches ? 1 : 3;
      apply(0);
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [apply]);

  const pages = Math.max(1, Math.ceil(items.length / perView.current));

  return (
    <section className="testimonials">
      <div className="section-header">
        <p className="section-eyebrow">Customer reviews</p>
        <h2 className="reveal">What Enthusiasts Say</h2>
        <p className="reveal reveal-d1">Real builds. Real results. Real people.</p>
      </div>

      <div className="testi-track-wrap">
        <div className="testi-track" ref={trackRef}>
          {items.map((t) => {
            // Real stars when the review carries a rating; curated fallbacks keep five.
            const stars = Math.max(0, Math.min(5, Math.round(t.rating ?? 5)));
            const initial = (t.name.trim()[0] || '?').toUpperCase();
            return (
              <article className="testi-card" key={t.name}>
                <div className="testi-head">
                  <div className="testi-stars" role="img" aria-label={`Rated ${stars} out of 5`}>
                    {'★'.repeat(stars)}<span className="testi-stars-off">{'★'.repeat(5 - stars)}</span>
                  </div>
                  <span className="testi-mark" aria-hidden="true">&ldquo;</span>
                </div>
                <blockquote className="testi-quote">{t.quote}</blockquote>
                <div className="testi-author">
                  <div className="testi-avatar" aria-hidden="true">
                    {t.avatar ? <Img src={t.avatar} alt="" sizes="44px" /> : <span>{initial}</span>}
                  </div>
                  <div className="testi-who">
                    <div className="testi-name">
                      {t.name}
                      {t.verified && <span className="testi-verified">Verified purchase</span>}
                    </div>
                  </div>
                </div>
                {t.detail && (
                  t.productHref ? (
                    <Link href={t.productHref} className="testi-product">
                      {t.productImage && <Img src={t.productImage} alt="" sizes="44px" className="testi-product-img" />}
                      <span className="testi-product-name">{t.detail}</span>
                      <span className="testi-product-go" aria-hidden="true">→</span>
                    </Link>
                  ) : (
                    <div className="testi-product">
                      <span className="testi-product-name">{t.detail}</span>
                    </div>
                  )
                )}
              </article>
            );
          })}
        </div>
      </div>

      <div className="testi-controls">
        <button type="button" aria-label="Previous reviews" onClick={() => apply(idx - 1)} disabled={idx === 0}>
          <ChevronLeft />
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
        <button type="button" aria-label="More reviews" onClick={() => apply(idx + 1)} disabled={idx >= pages - 1}>
          <ChevronRight />
        </button>
      </div>
    </section>
  );
}
