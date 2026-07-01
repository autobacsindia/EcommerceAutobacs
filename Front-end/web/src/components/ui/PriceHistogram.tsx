'use client';

import { useId, useMemo } from 'react';

/**
 * Price-range control: a distribution area-chart with a dual-handle slider
 * underneath (obsidian + gold). Ported in spirit from the MLC reference, reskinned
 * to the storefront theme. Fully controlled.
 *
 *   value    — [lo, hi] currently selected
 *   min/max  — bounds of the slider
 *   buckets  — optional distribution heights (any positive numbers); if omitted a
 *              gentle synthetic curve is drawn so the chart never looks empty.
 *   format   — price formatter for the bubble labels
 *   onChange — fires continuously as the user drags
 */
interface Props {
  value: [number, number];
  min: number;
  max: number;
  step?: number;
  buckets?: number[];
  format: (n: number) => string;
  onChange: (next: [number, number]) => void;
}

const SYNTH = [3, 5, 8, 12, 18, 24, 30, 26, 20, 15, 11, 8, 6, 4, 3, 2];

export default function PriceHistogram({
  value,
  min,
  max,
  step = 500,
  buckets,
  format,
  onChange,
}: Props) {
  const id = useId();
  const [lo, hi] = value;
  const span = Math.max(1, max - min);
  const loPct = ((lo - min) / span) * 100;
  const hiPct = ((hi - min) / span) * 100;

  // Build the area-chart path from bucket heights (normalized to 0..1).
  const path = useMemo(() => {
    const data = buckets && buckets.length > 1 ? buckets : SYNTH;
    const peak = Math.max(...data, 1);
    const pts = data.map((v, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 100 - (v / peak) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return `M0,100 L${pts.join(' L')} L100,100 Z`;
  }, [buckets]);

  const clampLo = (n: number) => Math.min(n, hi - step);
  const clampHi = (n: number) => Math.max(n, lo + step);

  return (
    <div className="pf-range">
      {/* distribution */}
      <svg
        className="pf-range-chart"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(201,168,112,0.35)" />
            <stop offset="100%" stopColor="rgba(201,168,112,0.02)" />
          </linearGradient>
          {/* Only the selected [lo,hi] slice is fully lit. */}
          <clipPath id={`${id}-clip`} clipPathUnits="objectBoundingBox">
            <rect x={loPct / 100} y="0" width={(hiPct - loPct) / 100} height="1" />
          </clipPath>
        </defs>
        <path d={path} fill="rgba(201,168,112,0.06)" />
        <path d={path} fill={`url(#${id}-fill)`} clipPath={`url(#${id}-clip)`} />
      </svg>

      {/* dual slider */}
      <div className="pf-range-track">
        <div className="pf-range-rail" />
        <div
          className="pf-range-fill"
          style={{ left: `${loPct}%`, right: `${100 - hiPct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={lo}
          aria-label="Minimum price"
          onChange={(e) => onChange([clampLo(Number(e.target.value)), hi])}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={hi}
          aria-label="Maximum price"
          onChange={(e) => onChange([lo, clampHi(Number(e.target.value))])}
        />
      </div>

      <div className="pf-range-bubbles">
        <span>{format(lo)}</span>
        <span>{format(hi)}</span>
      </div>
    </div>
  );
}
