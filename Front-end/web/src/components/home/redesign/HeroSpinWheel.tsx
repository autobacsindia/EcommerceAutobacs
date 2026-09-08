'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import cloudinaryLoader from '@/lib/cloudinaryLoader';
import type { SpinTeaserPrize } from './homeData';

/**
 * The home hero's Spin-to-Win wheel — DECORATION ONLY.
 *
 * ⚠ This is NOT the reward wheel. `components/spin/SpinGauge.tsx` is: it takes a
 * `winningIndex` the server already committed to the database inside a transaction,
 * and its own doc-comment is "This component NEVER decides anything". Do not merge the
 * two and do not give this one a server call. Here the needle lands wherever a local
 * `Math.random()` puts it, nothing is awarded, and no prize stock is touched — the
 * point is to show a visitor that the promotion exists, not to run it.
 *
 * That distinction has to survive contact with the copy, too. Everything this slide
 * claims comes from the live campaign (prize names, minimum spend, spins per user) via
 * GET /spin/public/live, so it cannot drift into advertising terms the engine will not
 * honour. The result line says what a spin COULD land on, never what the visitor has
 * won.
 *
 * Geometry is the 180° dial from the Claude Design poster: a half-annulus of wedges
 * above a needle pivoting at the flat edge. Motion is a CSS transform on one SVG
 * group, so it composites and stays smooth on a mid-range phone.
 */

/** Viewbox + arc geometry, from the poster. The dial occupies the upper half only. */
const CX = 400;
const CY = 440;
const VW = 800;
const VH = 480;
const R_OUT = 300;
const R_IN = 168;
const R_ICON = 236;
const R_LABEL = 376;

/** Needle travel. 2.6s so the spin resolves inside the 6s slide dwell with time to read it. */
export const SPIN_DURATION_MS = 2600;

/** Whole extra turns before landing — enough to read as a spin, short enough to finish. */
const EXTRA_TURNS = 3;

/** Prize art is a raw Cloudinary secure_url (full-resolution original). Same trap
 *  SpinGauge documents: request it at icon size or the hero downloads megabytes to
 *  paint a 40px disc. DPR 3 keeps it crisp on a phone. */
const ICON_PX = 40 * 3;

/** Wheels below this read as a pie chart rather than a dial; above it labels collide. */
const MIN_SEGMENTS = 3;
const MAX_SEGMENTS = 6;

const pt = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
};

export interface HeroSpinWheelProps {
  prizes: SpinTeaserPrize[];
  /** True while this slide is the visible one. Each activation triggers one spin. */
  active: boolean;
}

export default function HeroSpinWheel({ prizes, active }: HeroSpinWheelProps) {
  // A wheel is a fixed-size object; the campaign may hold more prizes than it has
  // room for. Take the first few in the admin's own sort order rather than sampling,
  // so the dial is stable across renders and matches what the operator arranged.
  const shown = useMemo(() => prizes.slice(0, MAX_SEGMENTS), [prizes]);
  const count = shown.length;

  const [angle, setAngle] = useState(0);
  const [landedOn, setLandedOn] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const settleTimer = useRef<number | undefined>(undefined);

  const reduced = useMemo(
    () =>
      typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const segments = useMemo(() => {
    if (count < MIN_SEGMENTS) return [];
    const span = 180 / count;
    const gap = 1.1; // hairline between wedges, so adjacent fills stay distinguishable
    return shown.map((p, i) => {
      const a0 = 180 + i * span + gap / 2;
      const a1 = 180 + (i + 1) * span - gap / 2;
      const mid = (a0 + a1) / 2;
      const [ox0, oy0] = pt(R_OUT, a0);
      const [ox1, oy1] = pt(R_OUT, a1);
      const [ix0, iy0] = pt(R_IN, a1);
      const [ix1, iy1] = pt(R_IN, a0);
      const [ix, iy] = pt(R_ICON, mid);
      const [lx, ly] = pt(R_LABEL, mid);
      // Keep labels upright: past vertical they would read upside-down.
      let rot = mid;
      if (rot > 90 && rot < 270) rot += 180;
      if (rot > 180) rot -= 360;
      rot = Math.max(-45, Math.min(45, rot));
      return {
        key: `${p.name}-${i}`,
        label: p.shortLabel || p.name,
        imageUrl: p.imageUrl,
        d: `M ${ox0} ${oy0} A ${R_OUT} ${R_OUT} 0 0 1 ${ox1} ${oy1} L ${ix0} ${iy0} A ${R_IN} ${R_IN} 0 0 0 ${ix1} ${iy1} Z`,
        fill: i % 2 ? '#121212' : '#191919',
        iLeft: `${(ix / VW) * 100}%`,
        iTop: `${(iy / VH) * 100}%`,
        lLeft: `${(lx / VW) * 100}%`,
        lTop: `${(ly / VH) * 100}%`,
        rot: `${rot}deg`,
      };
    });
  }, [shown, count]);

  /*
    One spin per activation.

    Keyed on `active` rather than on a click: the slide arrives on a timer, so the
    wheel has to start itself. Reduced motion skips the animation entirely — it does
    NOT just shorten it — and shows no result line, because a result that appears
    without a visible spin reads as a claim rather than a demonstration.
  */
  useEffect(() => {
    if (!active || segments.length === 0 || reduced) return;

    const winner = Math.floor(Math.random() * segments.length);
    const span = 180 / segments.length;
    // Wedges start at 180° (9 o'clock) and sweep over the top to 360°. The needle
    // rests at 180° at angle 0, so the offset to a wedge centre is measured from there.
    const target = (winner + 0.5) * span;

    setLandedOn(null);
    setSpinning(true);
    setAngle((prev) => {
      // Always move forwards: rewinding to an absolute angle would spin backwards
      // whenever the new target sits behind the old one.
      const base = prev + EXTRA_TURNS * 360;
      const remainder = ((target - (base % 360)) + 360) % 360;
      return base + remainder;
    });

    settleTimer.current = window.setTimeout(() => {
      setSpinning(false);
      setLandedOn(segments[winner].label);
    }, SPIN_DURATION_MS);

    return () => window.clearTimeout(settleTimer.current);
  }, [active, segments, reduced]);

  // Below three prizes there is no dial worth drawing; the slide's copy carries the
  // offer on its own.
  if (segments.length === 0) return null;

  return (
    <div className="hero-spin-wheel">
      <div className="hero-spin-glow" aria-hidden="true" />
      {/*
        The whole dial is decorative: it announces nothing a screen-reader user can
        act on, and a needle landing on a prize they have not won would be actively
        misleading. The slide's heading, prize list and CTA carry the real content.
      */}
      <div className="hero-spin-dial" aria-hidden="true">
        <svg viewBox={`0 0 ${VW} ${VH}`} className="hero-spin-svg">
          <path
            d={`M ${CX - (R_OUT + 16)} ${CY + 12} A ${R_OUT + 16} ${R_OUT + 16} 0 0 1 ${CX + (R_OUT + 16)} ${CY + 12} Z`}
            fill="#0b0b0b"
            stroke="rgba(201, 168, 112, 0.16)"
            strokeWidth="1.5"
          />
          {segments.map((s) => (
            <path
              key={s.key}
              d={s.d}
              fill={s.fill}
              stroke="rgba(201, 168, 112, 0.22)"
              strokeWidth="1"
            />
          ))}
          <g
            transform={`rotate(${angle} ${CX} ${CY})`}
            style={{
              transition: reduced
                ? 'none'
                : `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.16, 0.9, 0.16, 1)`,
            }}
          >
            <path d={`M ${CX} ${CY} L ${CX - 188} ${CY - 9} L ${CX - 188} ${CY + 9} Z`} fill="var(--gold)" />
          </g>
          <circle cx={CX} cy={CY} r="34" fill="#0b0b0b" stroke="var(--gold)" strokeWidth="4" />
          <circle cx={CX} cy={CY} r="12" fill="var(--gold)" />
        </svg>

        {segments.map((s) => (
          <div key={`icon-${s.key}`} className="hero-spin-icon" style={{ left: s.iLeft, top: s.iTop }}>
            {s.imageUrl ? (
              /* Plain <img>, not next/image: decorative, inside an aria-hidden dial, and
                 deliberately lazy. It must never become the hero's LCP element or
                 compete with the frame sequence for bandwidth, and the Cloudinary
                 transform is already applied by hand above. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cloudinaryLoader({ src: s.imageUrl, width: ICON_PX })}
                alt=""
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="hero-spin-icon-fallback">★</span>
            )}
          </div>
        ))}

        {segments.map((s) => (
          <div
            key={`label-${s.key}`}
            className="hero-spin-label"
            style={{ left: s.lLeft, top: s.lTop, transform: `translate(-50%, -50%) rotate(${s.rot})` }}
          >
            {s.label}
          </div>
        ))}
      </div>

      {/* Reserved height whether or not a result is showing, so settling can't shift
          the layout underneath it. */}
      <div className="hero-spin-status" aria-hidden="true">
        {spinning ? 'Spinning…' : landedOn ? `Could land on — ${landedOn}` : ' '}
      </div>
    </div>
  );
}
