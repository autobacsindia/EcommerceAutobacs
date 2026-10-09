'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ProductTile from './ProductTile';
import type { StoreProduct } from './storeData';

/**
 * A titled, sideways-scrolling shelf of products with "See all" and arrow buttons.
 * Native horizontal scroll (touch, trackpad, arrows) — it never touches the page's
 * own vertical scrolling.
 */
export default function ProductRow({
  title,
  subtitle,
  href,
  products,
  rankBadges = 0,
  id,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  products: StoreProduct[];
  /** Label the first N tiles "#1 Best seller", "#2 Best seller", … (serialisable for SSR). */
  rankBadges?: number;
  id?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const t = trackRef.current;
    if (!t) return;
    const update = () => {
      setAtStart(t.scrollLeft <= 4);
      setAtEnd(t.scrollLeft >= t.scrollWidth - t.clientWidth - 4);
    };
    update();
    t.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      t.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  if (!products.length) return null;

  const nudge = (dir: 1 | -1) => {
    const t = trackRef.current;
    if (!t) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    t.scrollBy({ left: dir * t.clientWidth * 0.85, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <section className="st-card st-row" aria-labelledby={id}>
      <div className="st-row-head">
        <div>
          <h2 id={id} className="st-h2">{title}</h2>
          {subtitle && <p className="st-sub">{subtitle}</p>}
        </div>
        {href && <Link href={href} className="st-link">See all</Link>}
      </div>
      <div className="st-row-wrap">
        <button type="button" className="st-arrow st-arrow-l" aria-label={`Previous ${title}`} onClick={() => nudge(-1)} disabled={atStart}>‹</button>
        <div className="st-track" ref={trackRef}>
          {products.map((p, i) => (
            <div className="st-track-item" key={p.id}>
              <ProductTile p={p} badge={i < rankBadges ? `#${i + 1} Best seller` : undefined} />
            </div>
          ))}
        </div>
        <button type="button" className="st-arrow st-arrow-r" aria-label={`More ${title}`} onClick={() => nudge(1)} disabled={atEnd}>›</button>
      </div>
    </section>
  );
}
