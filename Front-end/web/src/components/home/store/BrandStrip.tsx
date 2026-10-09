'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Img from '../redesign/Img';
import type { StoreBrand } from './storeData';

/**
 * Every brand (most products first; logo, or the name when there is none) in two rows that scroll sideways — arrows
 * on desktop, swipe on phones — so the whole range is one gesture away without a
 * separate "see all" page.
 */
export default function BrandStrip({ brands }: { brands: StoreBrand[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  const update = () => {
    const el = track.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  if (brands.length < 4) return null;
  const page = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.85, behavior: 'smooth' });

  return (
    <section className="st-card" aria-labelledby="sh-brands">
      <div className="st-row-head">
        <h2 id="sh-brands" className="st-h2">Shop by brand</h2>
      </div>
      <div className="st-row-wrap">
        <div className="sh-brands" ref={track} onScroll={update}>
          {brands.map((b) => (
            <Link key={b.href} href={b.href} className="sh-brand" aria-label={b.name}>
              {b.logo ? (
                <Img src={b.logo} alt={b.name} className="sh-brand-img" sizes="160px" />
              ) : (
                <span className="sh-brand-name">{b.name}</span>
              )}
            </Link>
          ))}
        </div>
        <button type="button" className="st-arrow st-arrow-l sh-brand-arrow" aria-label="Previous brands" onClick={() => page(-1)} disabled={edge.start}>‹</button>
        <button type="button" className="st-arrow st-arrow-r sh-brand-arrow" aria-label="More brands" onClick={() => page(1)} disabled={edge.end}>›</button>
      </div>
    </section>
  );
}
