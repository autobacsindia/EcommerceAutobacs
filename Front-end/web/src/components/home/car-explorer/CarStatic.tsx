'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ResolvedCarHotspot } from '@/lib/carHotspots';
import MarkerDot from './Marker';

/**
 * Light fallback + mobile renderer: 2D markers positioned (in %) over a static
 * car image derived from the same glTF model (captured render), so it matches
 * the desktop 3D view. Used on small screens, reduced-motion, no-WebGL, and as
 * the SSR/first-paint baseline. No WebGL, negligible weight.
 */

const CAR_IMAGE = '/images/car-explorer.webp'; // captured from the 3D model

export default function CarStatic({
  hotspots,
  onSelect,
  activeId = null,
  onHover,
}: {
  hotspots: ResolvedCarHotspot[];
  onSelect: (id: string) => void;
  activeId?: string | null;
  onHover?: (id: string | null) => void;
}) {
  const [imgOk, setImgOk] = useState(true);
  const markers = hotspots.filter((h) => !h.chip);

  // Fills its parent (host supplies size), but the image + markers live in an
  // inner 16:9 box (the capture's aspect) centred inside — so marker %s always
  // align with the car regardless of the host stage's aspect ratio.
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="ce-static-box relative aspect-[16/9] max-h-full w-full max-w-full">
        {imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={CAR_IMAGE}
            alt="Explore parts on the vehicle"
            className="absolute inset-0 h-full w-full object-contain"
            onError={() => setImgOk(false)}
            loading="lazy"
          />
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium uppercase tracking-widest text-ink-muted">
            Vehicle
          </div>
        )}

        {markers.map((h, i) => (
          <Link
            key={h.id}
            href={h.href}
            onClick={() => onSelect(h.id)}
            onMouseEnter={() => onHover?.(h.id)}
            onMouseLeave={() => onHover?.(null)}
            onFocus={() => onHover?.(h.id)}
            onBlur={() => onHover?.(null)}
            aria-label={`${h.label} — view products`}
            className={`group/mk absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center ${activeId === h.id ? 'z-10' : ''}`}
            style={{ left: `${h.position.x}%`, top: `${h.position.y}%` }}
          >
            {/* 44px+ hit area for touch, dot centred inside */}
            <span className="flex h-11 w-11 items-center justify-center">
              <MarkerDot n={i + 1} label={h.label} active={activeId === h.id} />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
