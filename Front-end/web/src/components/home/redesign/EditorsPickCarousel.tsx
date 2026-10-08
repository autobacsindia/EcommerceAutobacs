'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ProductCard from './ProductCard';
import { ChevronLeft, ChevronRight } from './icons';
import { useCurrency } from '@/context/CurrencyContext';
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
  const { formatPrice } = useCurrency();
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
        <div>
          <p className="section-eyebrow">Hand-picked by our specialists</p>
          <h2 className="reveal">Driver&apos;s Choice</h2>
        </div>
      </div>

      <div className="bc">
        <div className="bc-track" ref={trackRef} onScroll={syncActive}>
          {items.map((p) => (
            <div className="bc-slide" key={p.name}>
              <ProductCard p={p} price={p.priceValue != null ? formatPrice(p.priceValue) : p.price} className="pc-flat" />
            </div>
          ))}
        </div>

        <button
          type="button"
          className="bc-arrow bc-prev"
          aria-label="Previous"
          onClick={() => goTo(active - 1)}
          disabled={active === 0}
        >
          <ChevronLeft />
        </button>
        <button
          type="button"
          className="bc-arrow bc-next"
          aria-label="Next"
          onClick={() => goTo(active + 1)}
          disabled={active === last}
        >
          <ChevronRight />
        </button>
      </div>

      <div className="bc-dots" role="tablist" aria-label="Driver's Choice slides">
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
