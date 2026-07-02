'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Img from './Img';
import { Diagonal } from './icons';
import { products as fallbackProducts, type ProductItem } from './homeContent';

/**
 * Editor's Pick — phone/tablet (≤1024px) variant: a "basic carousel" (one slide
 * per view, prev/next arrows + pagination dots), modelled on the Framer
 * community Basic Carousel. Slides snap natively so touch swipe works without
 * JS; the arrows/dots drive `scrollTo` and the active index is derived from
 * scroll position so all three stay in sync. Rendered alongside
 * EditorsPickTrack and CSS `display`-toggled by breakpoint (no layout shift).
 */
export default function EditorsPickCarousel({ products }: { products?: ProductItem[] }) {
  // Live featured products from the DB; static placeholders if none resolved.
  const items = products?.length ? products : fallbackProducts;
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const last = items.length - 1;

  // Derive the active slide from scroll offset (covers swipe, arrows, dots).
  const syncActive = useCallback(() => {
    const track = trackRef.current;
    if (!track || !track.clientWidth) return;
    const idx = Math.round(track.scrollLeft / track.clientWidth);
    setActive(Math.max(0, Math.min(last, idx)));
  }, [last]);

  const goTo = useCallback(
    (idx: number) => {
      const track = trackRef.current;
      if (!track) return;
      const clamped = Math.max(0, Math.min(last, idx));
      track.scrollTo({ left: clamped * track.clientWidth, behavior: 'smooth' });
    },
    [last]
  );

  // Keep the active index correct if the viewport width changes mid-scroll.
  useEffect(() => {
    window.addEventListener('resize', syncActive);
    return () => window.removeEventListener('resize', syncActive);
  }, [syncActive]);

  return (
    <section className="products products-basic">
      <div className="section-header">
        <h2 className="reveal">Editor&apos;s Pick</h2>
      </div>

      <div className="bc">
        <div className="bc-track" ref={trackRef} onScroll={syncActive}>
          {items.map((p) => (
            <Link href={p.href} className="bc-slide" key={p.name}>
              <div className="ce-card">
                <Img src={p.image} alt={p.name} className="ce-bg" />
                <div className="ce-overlay" />
                <div className="ce-circle" />
                <div className="ce-content">
                  <div className="ce-top">
                    <span className="ce-cat">{p.category}</span>
                    <div className="ce-iconbtn">
                      <Diagonal />
                    </div>
                  </div>
                  <div className="ce-bottom">
                    <div className="ce-brand">{p.brand}</div>
                    <div className="ce-name">{p.name}</div>
                    <div className="ce-price">{p.price}</div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <button
          type="button"
          className="bc-arrow bc-prev"
          aria-label="Previous"
          onClick={() => goTo(active - 1)}
          disabled={active === 0}
        >
          &#8592;
        </button>
        <button
          type="button"
          className="bc-arrow bc-next"
          aria-label="Next"
          onClick={() => goTo(active + 1)}
          disabled={active === last}
        >
          &#8594;
        </button>
      </div>

      <div className="bc-dots" role="tablist" aria-label="Editor's Pick slides">
        {items.map((p, i) => (
          <button
            type="button"
            key={p.name}
            className={i === active ? 'bc-dot is-active' : 'bc-dot'}
            aria-label={`Go to slide ${i + 1}`}
            aria-selected={i === active}
            role="tab"
            onClick={() => goTo(i)}
          />
        ))}
      </div>
    </section>
  );
}
