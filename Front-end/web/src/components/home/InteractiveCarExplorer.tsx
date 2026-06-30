'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ResolvedCarHotspot, CarRegion } from '@/lib/carHotspots';

/**
 * Render-agnostic "point at the car → open the category" explorer.
 *
 * Tier A (this implementation): hotspot markers absolutely positioned over a
 * car artwork box. The data contract (`ResolvedCarHotspot[]` with `position`)
 * is identical to what a future glTF / react-three-fiber renderer would consume
 * — only this presentational layer would be swapped, not the data or routing.
 *
 * Accessibility/SEO: the markers are real <Link>s (keyboard + crawler reachable)
 * and a parallel "Browse by part" list is always rendered, so the feature works
 * with JS disabled, on screen readers, and degrades gracefully if the artwork
 * fails to load.
 *
 * NOTE: drop the hero artwork at `/public/images/car-explorer.webp` and set
 * EXPLORER_ART below; until then a labelled placeholder renders so layout/QA
 * can proceed. Marker `position` percentages must be tuned to that artwork.
 */

const EXPLORER_ART: string | null = null; // e.g. '/images/car-explorer.webp'

const REGION_LABELS: Record<CarRegion, string> = {
  front: 'Front',
  hood: 'Hood & Engine',
  roof: 'Roof',
  side: 'Side',
  wheel: 'Wheels & Suspension',
  rear: 'Rear',
  interior: 'Interior',
};

export default function InteractiveCarExplorer({
  hotspots,
}: {
  hotspots: ResolvedCarHotspot[];
}) {
  const [active, setActive] = useState<string | null>(null);

  if (!hotspots.length) return null;

  const regions = Array.from(new Set(hotspots.map((h) => h.region)));

  return (
    <section
      aria-labelledby="car-explorer-heading"
      className="mx-auto max-w-6xl px-4 py-12"
    >
      <div className="mb-8 text-center">
        <h2
          id="car-explorer-heading"
          className="text-2xl font-bold text-gray-900 sm:text-3xl"
        >
          Find parts by where they fit
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Tap a part of the vehicle to jump straight to those products.
        </p>
      </div>

      {/* Interactive artwork + hotspots */}
      <div
        className="relative mx-auto aspect-[16/9] w-full max-w-4xl overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-b from-gray-50 to-gray-100"
        style={
          EXPLORER_ART
            ? { backgroundImage: `url(${EXPLORER_ART})`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : undefined
        }
      >
        {!EXPLORER_ART && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium uppercase tracking-widest text-gray-400">
            Vehicle artwork
          </div>
        )}

        {hotspots.map((h) => {
          const isActive = active === h.id;
          return (
            <Link
              key={h.id}
              href={h.href}
              onMouseEnter={() => setActive(h.id)}
              onMouseLeave={() => setActive((cur) => (cur === h.id ? null : cur))}
              onFocus={() => setActive(h.id)}
              onBlur={() => setActive((cur) => (cur === h.id ? null : cur))}
              aria-label={`${h.label} — view products`}
              className="group absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${h.position.x}%`, top: `${h.position.y}%` }}
            >
              {/* Pulsing dot */}
              <span className="relative flex h-4 w-4 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#3B9EE8] opacity-60 group-hover:opacity-90" />
                <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-white bg-[#3B9EE8] shadow" />
              </span>
              {/* Tooltip */}
              <span
                role="tooltip"
                className={`pointer-events-none absolute left-1/2 top-5 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-lg transition-opacity ${
                  isActive ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {h.label}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Always-rendered, crawlable, keyboard-first fallback grouped by region */}
      <div className="mt-10">
        <h3 className="sr-only">Browse by part</h3>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {regions.map((region) => (
            <div key={region}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {REGION_LABELS[region]}
              </p>
              <ul className="space-y-1">
                {hotspots
                  .filter((h) => h.region === region)
                  .map((h) => (
                    <li key={h.id}>
                      <Link
                        href={h.href}
                        className="text-sm text-gray-700 hover:text-[#3B9EE8] hover:underline"
                      >
                        {h.label}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
