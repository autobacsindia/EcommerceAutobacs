'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Img from './Img';
import { ArrowRight, ScrollArrow } from './icons';
import { categories as fallbackCategories, type CategoryItem } from './homeContent';

export default function Categories({ categories }: { categories?: CategoryItem[] }) {
  // Live category hubs from the DB; static placeholders if none resolved.
  const items = categories?.length ? categories : fallbackCategories;
  const outerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState('01');

  useEffect(() => {
    const outer = outerRef.current;
    const track = trackRef.current;
    if (!outer || !track) return;

    // Desktop-only scroll pinning. On mobile the track is a native horizontal
    // swipe (see CSS), so we leave inline styles cleared.
    const desktop = window.matchMedia('(min-width: 769px)');
    let distance = 0;
    const count = items.length;

    const layout = () => {
      if (!desktop.matches) {
        outer.style.height = '';
        track.style.transform = '';
        return;
      }
      const prev = track.style.transform;
      track.style.transform = 'translateX(0px)';
      const trackWidth = track.scrollWidth;
      track.style.transform = prev;
      distance = Math.max(0, trackWidth - window.innerWidth);
      outer.style.height = window.innerHeight + distance + 'px';
    };

    const update = () => {
      if (!desktop.matches) return;
      const rect = outer.getBoundingClientRect();
      const total = outer.offsetHeight - window.innerHeight;
      const scrolled = Math.min(Math.max(-rect.top, 0), total);
      const progress = total > 0 ? scrolled / total : 0;
      track.style.transform = `translateX(${-progress * distance}px)`;
      if (barRef.current) barRef.current.style.width = progress * 100 + '%';
      const idx = Math.min(count, Math.max(1, Math.round(progress * (count - 1)) + 1));
      setCurrent(String(idx).padStart(2, '0'));
    };

    const onResize = () => {
      layout();
      update();
    };

    layout();
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('load', onResize);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('load', onResize);
    };
  }, [items.length]);

  return (
    <section className="categories">
      <div className="cat-scroll-outer" ref={outerRef}>
        <div className="cat-sticky">
          <div className="cat-head">
            <h2 className="reveal">Shop by Category</h2>
            <div className="cat-head-meta">
              <div className="cat-counter">
                <b>{current}</b> / {String(items.length).padStart(2, '0')}
              </div>
              <div className="cat-progress">
                <div className="cat-progress-bar" ref={barRef} />
              </div>
              <div className="cat-scroll-hint">
                <span>Scroll to explore</span>
                <ScrollArrow />
              </div>
            </div>
          </div>

          <div className="cat-track-wrap">
            <div className="cat-track" ref={trackRef}>
              {items.map((cat, i) => (
                <Link href={cat.href} className="cat-card" key={cat.name}>
                  <Img src={cat.image} alt={cat.name.replace('\n', ' ')} />
                  <div className="cat-num-ghost">{String(i + 1).padStart(2, '0')}</div>
                  <div className="cat-info">
                    <div className="cat-tag">{cat.tag}</div>
                    <div className="cat-name">
                      {cat.name.split('\n').map((line, j) => (
                        <span key={j}>
                          {line}
                          {j < cat.name.split('\n').length - 1 && <br />}
                        </span>
                      ))}
                    </div>
                    <div className="cat-underline" />
                    <div className="cat-explore">
                      <span>Explore Range</span>
                      <ArrowRight />
                    </div>
                  </div>
                </Link>
              ))}
              <div className="cat-end-card">
                <div className="ec-eyebrow">12,000+ parts</div>
                <div className="ec-title">
                  Browse the
                  <br />
                  full catalog
                </div>
                <Link href="/categories" className="ec-btn">
                  View All Categories
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
