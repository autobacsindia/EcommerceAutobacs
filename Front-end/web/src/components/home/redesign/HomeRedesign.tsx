'use client';

import { useEffect, useRef } from 'react';
import './home-redesign.css';

import RedesignNav from './RedesignNav';
import Hero from './Hero';
import Manifesto from './Manifesto';
import Categories from './Categories';
import Showreel from './Showreel';
import EditorsPick from './EditorsPick';
import Brands from './Brands';
import Transformation from './Transformation';
import Testimonials from './Testimonials';
import Journal from './Journal';
import RedesignFooter from './RedesignFooter';
import PromoBanner from '@/components/layout/PromoBanner';
import type { PromoBanner as PromoBannerData } from '@/lib/promoBanner';
import type { HomeData } from './homeData';

/**
 * Redesigned home page (Hero.html). All sections are scoped under `.hr` so the
 * design's styles never bleed into the rest of the app.
 *
 * This root owns two cross-cutting behaviours that the original page-level
 * script handled globally:
 *   1. scroll-reveal — fade/slide `.reveal` elements in as they enter view.
 *   2. nav background — darken the fixed nav after the first scroll.
 */
export default function HomeRedesign({
  data,
  promoBanner = null,
}: {
  data: HomeData;
  /**
   * Resolved server-side in app/page.tsx. The home page mounts the promo strip
   * itself rather than taking it from the root layout, because this page ships
   * its own `position: fixed` nav — a strip rendered above `children` in the
   * layout would end up underneath that bar. See ConditionalPromoBanner.
   */
  promoBanner?: PromoBannerData | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // 1. Scroll reveal
    const els = root.querySelectorAll('.reveal');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));

    // 2. Nav background on scroll
    const nav = root.querySelector<HTMLElement>('#hr-nav');
    const onScroll = () => {
      if (!nav) return;
      nav.style.background =
        window.scrollY > 60 ? 'rgba(11,12,12,0.97)' : 'rgba(17,18,18,0.88)';
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div className="hr" ref={rootRef}>
      <RedesignNav />
      {/*
        Promo strip directly under the nav, matching every other page — but here
        it shares a stacking wrapper with the hero rather than sitting above it
        in flow. The hero is a full-bleed 100vh stage that the fixed nav already
        overlays; stacking nav + strip on top of it in flow pushed the car down
        by ~180px and left a dead band between the strip and the artwork.

        So on desktop `.hr-promo-slot` is an overlay pinned inside the hero's own
        scroll track (see home-redesign.css): flush under the nav, scrolls away on
        the first scroll, and the hero keeps an untouched `height: 100vh` — which
        it must, because it is sticky-pinned inside .hero-pin and a shorter hero
        would leave a gap under it once pinned. On mobile the hero is a stacked,
        content-height section, so the strip stays in flow there and takes over
        the hero's nav clearance instead of adding to it.
      */}
      <div className="hr-hero-stack">
        {promoBanner && (
          <div className="hr-promo-slot">
            <PromoBanner banner={promoBanner} />
          </div>
        )}
        <Hero />
      </div>
      <Manifesto />
      <Categories categories={data.categories} />
      <Showreel hotspots={data.carHotspots} />
      <EditorsPick products={data.products} />
      <Brands brands={data.brands} />
      <Transformation />
      <Testimonials testimonials={data.testimonials} />
      <Journal posts={data.journalPosts} />
      <RedesignFooter />
    </div>
  );
}
