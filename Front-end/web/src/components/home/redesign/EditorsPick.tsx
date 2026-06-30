'use client';

import { useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import Img from './Img';
import { Diagonal } from './icons';
import { products } from './homeContent';

export default function EditorsPick() {
  const trackRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const idxRef = useRef(0);

  const slide = useCallback((dir: number) => {
    const track = trackRef.current;
    if (!track || !track.children.length) return;
    const total = track.children.length;
    const cardW = (track.children[0] as HTMLElement).offsetWidth + 20;
    const wrapW = (track.parentElement as HTMLElement).offsetWidth;
    const visible = Math.max(1, Math.floor((wrapW + 20) / cardW));
    const maxIdx = Math.max(0, total - visible);

    idxRef.current = Math.max(0, Math.min(maxIdx, idxRef.current + dir));
    track.style.transform = `translateX(-${idxRef.current * cardW}px)`;

    const bar = barRef.current;
    if (bar) {
      const barW = Math.min(100, (visible / total) * 100);
      const leftPct = maxIdx === 0 ? 0 : (idxRef.current / maxIdx) * (100 - barW);
      bar.style.width = barW + '%';
      bar.style.left = leftPct + '%';
    }
  }, []);

  useEffect(() => {
    slide(0);
    const onResize = () => {
      idxRef.current = 0;
      slide(0);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [slide]);

  return (
    <section className="products">
      <div className="section-header">
        <h2 className="reveal">Editor&apos;s Pick</h2>
        <div className="prod-nav">
          <button type="button" aria-label="Previous" onClick={() => slide(-1)}>
            &#8592;
          </button>
          <button type="button" aria-label="Next" onClick={() => slide(1)}>
            &#8594;
          </button>
        </div>
      </div>

      <div className="ce-track-wrap">
        <div className="prod-track reveal reveal-d1" ref={trackRef}>
          {products.map((p) => (
            <Link href={p.href} className="ce-card" key={p.name}>
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
            </Link>
          ))}
        </div>
        <div className="prod-progress">
          <div className="prod-progress-bar" ref={barRef} />
        </div>
      </div>
    </section>
  );
}
