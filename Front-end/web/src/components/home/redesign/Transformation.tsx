'use client';

import { useEffect, useRef } from 'react';
import Img from './Img';
import { ChevronLeft, ChevronRight } from './icons';
import { transformation, stats } from './homeContent';

export default function Transformation() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const beforeRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sr = wrapRef.current;
    const before = beforeRef.current;
    const handle = handleRef.current;
    const hint = hintRef.current;
    if (!sr || !before || !handle) return;

    let dragging = false;

    const setPos = (clientX: number) => {
      const rect = sr.getBoundingClientRect();
      let pct = ((clientX - rect.left) / rect.width) * 100;
      pct = Math.max(0, Math.min(100, pct));
      before.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
      handle.style.left = pct + '%';
    };

    const start = (e: MouseEvent | TouchEvent) => {
      dragging = true;
      sr.classList.add('dragging');
      if (hint) hint.style.opacity = '0';
      const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
      setPos(x);
    };
    const move = (e: MouseEvent | TouchEvent) => {
      if (!dragging) return;
      e.preventDefault();
      const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
      setPos(x);
    };
    const end = () => {
      dragging = false;
      sr.classList.remove('dragging');
    };

    sr.addEventListener('mousedown', start);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    sr.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    return () => {
      sr.removeEventListener('mousedown', start);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      sr.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
    };
  }, []);

  return (
    <section className="transformation">
      <div className="section-header reveal">
        <div className="eyebrow">{transformation.eyebrow}</div>
        <h2>
          {transformation.titleTop} <em>{transformation.titleAccent}</em>
          <br />
          {transformation.titleBottom}
        </h2>
      </div>

      <div className="split-reveal reveal reveal-d1" ref={wrapRef}>
        <Img src={transformation.after} alt="After" className="split-after" draggable={false} sizes="100vw" />
        <div ref={beforeRef} className="split-before-wrap">
          <Img src={transformation.before} alt="Before" className="split-before" draggable={false} sizes="100vw" />
        </div>
        <div className="split-label split-label-before">Before</div>
        <div className="split-label split-label-after">After</div>
        <div className="split-hint" ref={hintRef}>
          Drag to compare
        </div>
        <div className="split-handle" ref={handleRef}>
          <div className="split-grip">
            <ChevronLeft />
            <ChevronRight />
          </div>
        </div>
      </div>

      <div className="transform-stats reveal reveal-d2">
        {stats.map((s) => (
          <div className="transform-stat" key={s.label}>
            <div className="num">
              {s.value}
              <sup>{s.suffix}</sup>
            </div>
            <div className="desc">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
