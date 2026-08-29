'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Animated counter row for the About page's "By the numbers" band.
 *
 * The only interactive part of /about-us, so it lives here as a client leaf
 * while the page itself stays a server component. Counts up once, when the row
 * first scrolls into view; under prefers-reduced-motion it renders the final
 * figures immediately and never animates.
 */
export interface Stat {
  /** Numeric part of the figure — the value that counts up. */
  value: number;
  /** Rendered immediately after the number (e.g. "+", " years"). */
  suffix?: string;
  label: string;
}

const DURATION_MS = 1600;
// easeOutExpo: fast start, long settle — reads as "landing on" the number.
const ease = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

const format = (n: number) => n.toLocaleString('en-IN');

function useCountUp(target: number, start: boolean) {
  const [n, setN] = useState(start ? target : 0);

  useEffect(() => {
    if (!start) return;
    // Respect the OS setting: jump straight to the final value.
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setN(target);
      return;
    }

    let frame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / DURATION_MS, 1);
      setN(Math.round(target * ease(p)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, start]);

  return n;
}

function Counter({ stat, start }: { stat: Stat; start: boolean }) {
  const n = useCountUp(stat.value, start);

  return (
    <div className="text-center">
      {/*
        The animated digits are aria-hidden and the settled figure is exposed
        once via the label, so a screen reader is not read a ticking number.
      */}
      <div
        aria-hidden
        className="font-display text-4xl md:text-5xl font-light text-gold tabular-nums tracking-[-0.02em]"
      >
        {format(n)}
        {stat.suffix}
      </div>
      <div className="mt-2 font-display text-[11px] uppercase tracking-[0.22em] text-ink/60">
        <span className="sr-only">{`${format(stat.value)}${stat.suffix ?? ''} `}</span>
        {stat.label}
      </div>
    </div>
  );
}

export default function StatCounters({ stats }: { stats: Stat[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    // Without IntersectionObserver (older browsers, jsdom) show the figures
    // rather than a row of zeros.
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-testid="about-stats"
      className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-10"
    >
      {stats.map((stat) => (
        <Counter key={stat.label} stat={stat} start={visible} />
      ))}
    </div>
  );
}
