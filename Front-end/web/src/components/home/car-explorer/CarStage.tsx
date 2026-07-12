'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { ResolvedCarHotspot } from '@/lib/carHotspots';
import { useCanRender3D } from './useCanRender3D';
import CarStatic from './CarStatic';

// 3D chunk is fetched only when actually rendered (desktop-capable + in view).
const Car3D = dynamic(() => import('./Car3D'), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-black/20" />,
});

/**
 * Embeddable renderer: fills its (sized) parent with either the 3D car
 * (desktop-capable + in view) or the light static/SVG fallback. No section
 * chrome — the host (Showreel stage, preview box) provides size + framing.
 */
export default function CarStage({
  hotspots,
  onSelect,
}: {
  hotspots: ResolvedCarHotspot[];
  onSelect?: (id: string) => void;
}) {
  const canRender3D = useCanRender3D();
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  const handleSelect = (id: string) => onSelect?.(id);

  return (
    <div ref={ref} className="absolute inset-0 z-[2]">
      {canRender3D && inView ? (
        <Car3D hotspots={hotspots} onSelect={handleSelect} />
      ) : (
        <CarStatic hotspots={hotspots} onSelect={handleSelect} />
      )}
    </div>
  );
}
