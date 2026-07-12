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
export default function HomeRedesign({ data }: { data: HomeData }) {
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
      <Hero />
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
