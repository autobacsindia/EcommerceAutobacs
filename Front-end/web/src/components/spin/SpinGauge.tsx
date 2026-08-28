'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import cloudinaryLoader from '@/lib/cloudinaryLoader';

/**
 * The speedometer.
 *
 * A tachometer-style dial: prizes are wedges along a 240° arc, and a needle revs to
 * full-scale, overshoots, then settles onto the winning wedge.
 *
 * ── The one rule that matters ────────────────────────────────────────────────
 * This component NEVER decides anything. `winningIndex` arrives from the server, which
 * already committed the outcome to the database inside a transaction before this ever
 * animates. The needle is theatre over a decision that has been made. Any future
 * temptation to "pick a random segment and verify after" would invert that and make the
 * client authoritative over physical stock.
 *
 * Pass `winningIndex = null` to idle (needle at zero, dial fully drawn and ready).
 *
 * Motion is pure CSS transform on an SVG group, so it runs on the compositor and stays
 * smooth on a mid-range phone — which is what most customers will be holding right after
 * checkout. `prefers-reduced-motion` skips straight to the result rather than animating.
 */

/** Arc geometry. 240° reads as a speedometer; a full 360° would read as a pie chart. */
const ARC_START = -210; // degrees, SVG convention (0° = 3 o'clock)
const ARC_SWEEP = 240;
const CX = 200;
const CY = 190;
const R_OUTER = 160;
const R_INNER = 108;
// Prize icon radius, and the clip that makes it a disc. Sized so the badge (icon + its
// 2px ring) stays inside R_OUTER at its mounting radius — an icon that overflows the
// wedge reads as a rendering bug rather than a prize.
const ICON_R = 13;

/*
  Prize artwork is stored as Cloudinary's raw `secure_url`, which carries NO delivery
  transform — so Cloudinary serves the FULL-RESOLUTION original for every request, and
  the wheel was downloading a multi-megabyte photo to paint a 26px icon. The wheel drew
  immediately with empty slices while those bytes were still in flight; the artwork only
  appeared once the browser had them cached, i.e. on a refresh. It read like a caching
  bug and was the opposite: nothing was cached the first time.

  Sized for the largest sensible device pixel ratio (26 CSS px × 3), so a phone at DPR 3
  still gets a crisp icon while the transfer drops from megabytes to a few kB. The shared
  loader also adds `f_auto` (AVIF/WebP) and never upscales past the original, and it
  leaves non-Cloudinary URLs untouched — so a locally-hosted or external image still works.
*/
const ICON_PX = ICON_R * 2 * 3;
const iconSrc = (url: string) => cloudinaryLoader({ src: url, width: ICON_PX });
const ICON_CLIP = 'spin-icon-clip';

/** Wedge fills — deliberately not the brand gold, so the winner's highlight can be. */
const WEDGE_COLORS = [
  '#1e3a5f', '#2a4a73', '#1e3a5f', '#2a4a73',
  '#1e3a5f', '#2a4a73', '#1e3a5f', '#2a4a73',
  '#1e3a5f', '#2a4a73', '#1e3a5f', '#2a4a73',
];

const polar = (cx: number, cy: number, r: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

/** Donut-segment path for one wedge. */
const wedgePath = (startDeg: number, endDeg: number) => {
  const o1 = polar(CX, CY, R_OUTER, startDeg);
  const o2 = polar(CX, CY, R_OUTER, endDeg);
  const i2 = polar(CX, CY, R_INNER, endDeg);
  const i1 = polar(CX, CY, R_INNER, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${o2.x} ${o2.y}`,
    `L ${i2.x} ${i2.y}`,
    `A ${R_INNER} ${R_INNER} 0 ${large} 0 ${i1.x} ${i1.y}`,
    'Z',
  ].join(' ');
};

export interface SpinGaugeProps {
  labels: string[];
  /**
   * Prize artwork, index-aligned with `labels`. Shorter than `labels`, or holding
   * nulls, is normal and expected: any slice without art just shows its text label as
   * before, so a half-configured campaign still renders a complete wheel.
   */
  images?: (string | null)[];
  /** Server-decided winner. null = idle. */
  winningIndex: number | null;
  /** True while the POST is in flight — needle free-revs until the answer lands. */
  spinning: boolean;
  onSettled?: () => void;
}

export default function SpinGauge({ labels, images = [], winningIndex, spinning, onSettled }: SpinGaugeProps) {
  const count = Math.max(labels.length, 1);
  const segAngle = ARC_SWEEP / count;

  const [needleDeg, setNeedleDeg] = useState(ARC_START);
  const [settled, setSettled] = useState(false);
  const settledRef = useRef(false);

  const reduced = useMemo(
    () => typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  /** Centre of a wedge — where the needle must come to rest. */
  const angleFor = (i: number) => ARC_START + segAngle * i + segAngle / 2;

  // ── Free-rev while waiting for the server ────────────────────────────────
  // The needle sweeps the dial on a loop. It is honest: nothing has been decided yet, so
  // it must not appear to be approaching an answer. A fake landing before the response
  // arrives would be a lie the UI cannot take back if the request then fails.
  useEffect(() => {
    if (!spinning || winningIndex !== null || reduced) return;
    let raf = 0;
    let t = 0;
    const tick = () => {
      t += 0.06;
      // Ease in and out of full-scale so it reads as engine revs, not a metronome.
      const pulse = (Math.sin(t) + 1) / 2;
      setNeedleDeg(ARC_START + ARC_SWEEP * pulse);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spinning, winningIndex, reduced]);

  // ── Rev, overshoot, settle ───────────────────────────────────────────────
  useEffect(() => {
    if (winningIndex === null) {
      setSettled(false);
      settledRef.current = false;
      setNeedleDeg(ARC_START);
      return;
    }
    if (settledRef.current) return;

    const target = angleFor(winningIndex);

    if (reduced) {
      setNeedleDeg(target);
      setSettled(true);
      settledRef.current = true;
      onSettled?.();
      return;
    }

    // Redline slam → overshoot past the target → settle back. Timed with the CSS
    // transitions below rather than animated frame-by-frame, so the browser can run it
    // on the compositor.
    const overshoot = Math.min(target + segAngle * 0.9, ARC_START + ARC_SWEEP);
    const timers = [
      setTimeout(() => setNeedleDeg(ARC_START + ARC_SWEEP), 60),     // slam to redline
      setTimeout(() => setNeedleDeg(overshoot), 900),                 // swing past
      setTimeout(() => setNeedleDeg(target), 1900),                   // settle on
      setTimeout(() => {
        setSettled(true);
        settledRef.current = true;
        onSettled?.();
      }, 2500),
    ];
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winningIndex, reduced]);

  const transition = !spinning || winningIndex !== null
    ? 'transform 900ms cubic-bezier(0.22, 1, 0.36, 1)'
    : 'none';

  return (
    <div className="relative mx-auto w-full max-w-[420px]">
      <svg viewBox="0 0 400 260" className="w-full" role="img"
        aria-label={winningIndex !== null ? `You won ${labels[winningIndex]}` : 'Prize speedometer'}>
        <defs>
          <linearGradient id="spin-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f1e33" />
            <stop offset="100%" stopColor="#060d18" />
          </linearGradient>
          <filter id="spin-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/*
            objectBoundingBox units so ONE clip serves every icon regardless of where it
            sits on the dial — a user-space circle would need re-declaring per segment.
          */}
          <clipPath id={ICON_CLIP} clipPathUnits="objectBoundingBox">
            <circle cx="0.5" cy="0.5" r="0.5" />
          </clipPath>
        </defs>

        <circle cx={CX} cy={CY} r={R_OUTER + 14} fill="url(#spin-face)" />

        {labels.map((label, i) => {
          const start = ARC_START + segAngle * i;
          const end = start + segAngle;
          const isWinner = settled && winningIndex === i;
          const mid = start + segAngle / 2;
          const art = images[i] || null;
          // Keep label text upright on the left half of the dial.
          const flip = mid > 90 || mid < -90;
          const rot = flip ? mid + 180 : mid;
          const base = polar(CX, CY, (R_OUTER + R_INNER) / 2, mid);
          // Icon and label share ONE rotated frame, and stack inside it.
          //
          // The offsets below are applied BEFORE the rotation, so they are measured in
          // the label's own reading frame: -y is "above the words", whichever way round
          // the dial this wedge sits. Offsetting along the radius instead — the obvious
          // thing — puts the icon beside the text, because the label reads radially, so
          // the radius runs along the baseline rather than across it.
          //
          // Stacking is tangential, which is also the roomy direction: the wedge is
          // ~105px across the arc at 8 slices versus a 52px radial band.
          const iconDy = art ? -(ICON_R + 6) : 0;
          const textDy = art ? ICON_R - 1 : 0;
          return (
            <g key={`${label}-${i}`}>
              <path
                d={wedgePath(start + 0.6, end - 0.6)}
                fill={isWinner ? '#f5b32c' : WEDGE_COLORS[i % WEDGE_COLORS.length]}
                stroke={isWinner ? '#ffd97a' : '#0a1424'}
                strokeWidth={isWinner ? 2.5 : 1}
                filter={isWinner ? 'url(#spin-glow)' : undefined}
                style={{ transition: 'fill 350ms ease' }}
              />
              {/*
                One frame for the whole slice's content, counter-rotated on the left half
                so prizes are never upside down. Because icon and label rotate together,
                the icon stays directly above the words on every wedge.

                No onError handling is possible on an SVG <image>; a dead URL simply
                paints nothing and the label underneath still names the prize, which is
                why the label is never replaced by the icon.
              */}
              <g transform={`rotate(${rot} ${base.x} ${base.y})`}>
                {art && (
                  <>
                    <circle
                      cx={base.x} cy={base.y + iconDy} r={ICON_R + 2}
                      fill={isWinner ? '#fff7e0' : '#0d1a2d'}
                      stroke={isWinner ? '#ffd97a' : '#31435c'}
                      strokeWidth={1}
                    />
                    <image
                      href={iconSrc(art)}
                      x={base.x - ICON_R} y={base.y + iconDy - ICON_R}
                      width={ICON_R * 2} height={ICON_R * 2}
                      clipPath={`url(#${ICON_CLIP})`}
                      preserveAspectRatio="xMidYMid slice"
                      style={{ pointerEvents: 'none' }}
                    />
                  </>
                )}
                <text
                  x={base.x} y={base.y + textDy}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={11}
                  fontWeight={isWinner ? 700 : 500}
                  fill={isWinner ? '#1a1205' : '#c9d6e8'}
                  style={{ pointerEvents: 'none' }}
                >
                  {label.length > 14 ? `${label.slice(0, 13)}…` : label}
                </text>
              </g>
            </g>
          );
        })}

        {/* Tick marks — the detail that makes it read as an instrument, not a pie chart. */}
        {Array.from({ length: count * 2 + 1 }).map((_, i) => {
          const deg = ARC_START + (ARC_SWEEP / (count * 2)) * i;
          const a = polar(CX, CY, R_OUTER + 4, deg);
          const b = polar(CX, CY, R_OUTER + (i % 2 === 0 ? 13 : 8), deg);
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={i % 2 === 0 ? '#5d7a9e' : '#3a4a63'} strokeWidth={i % 2 === 0 ? 2 : 1} />;
        })}

        {/* Needle */}
        <g style={{ transform: `rotate(${needleDeg}deg)`, transformOrigin: `${CX}px ${CY}px`, transition }}>
          <polygon
            points={`${CX - 6},${CY} ${CX},${CY - 7} ${CX + R_OUTER - 18},${CY - 2} ${CX + R_OUTER - 18},${CY + 2} ${CX},${CY + 7}`}
            fill="#e8412f"
          />
        </g>
        <circle cx={CX} cy={CY} r={17} fill="#12203a" stroke="#f5b32c" strokeWidth={2.5} />
        <circle cx={CX} cy={CY} r={6} fill="#f5b32c" />
      </svg>
    </div>
  );
}
