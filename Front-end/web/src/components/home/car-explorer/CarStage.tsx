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
  activeId = null,
  onHover,
}: {
  hotspots: ResolvedCarHotspot[];
  onSelect?: (id: string) => void;
  /** Part highlighted from the side panel (or by hovering a marker). */
  activeId?: string | null;
  onHover?: (id: string | null) => void;
}) {
  const canRender3D = useCanRender3D();
  const [inView, setInView] = useState(false);
  // The 3D model is ~3.9 MB. Until it is on screen the still render (captured
  // from the same model) stands in, so the stage is never an empty dark box.
  const [ready3D, setReady3D] = useState(false);
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
  const show3D = canRender3D && inView;

  return (
    <div ref={ref} className="absolute inset-0 z-[2]">
      <div className={`absolute inset-0 transition-opacity duration-700 ${show3D && ready3D ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
        <CarStatic hotspots={hotspots} onSelect={handleSelect} activeId={activeId} onHover={onHover} />
      </div>
      {show3D && (
        <div className={`absolute inset-0 transition-opacity duration-700 ${ready3D ? 'opacity-100' : 'opacity-0'}`}>
          <Car3D hotspots={hotspots} onSelect={handleSelect} activeId={activeId} onHover={onHover} onReady={() => setReady3D(true)} />
        </div>
      )}
      {show3D && !ready3D && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-[4] -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#f0ede7]/75 backdrop-blur">
          Loading 3D view…
        </div>
      )}
    </div>
  );
}
