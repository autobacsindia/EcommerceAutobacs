'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Img from '../redesign/Img';
import type { FestivalThemeTokens } from '@/lib/festival/themes';
import type { PublicFestivalTheme } from '@/lib/festival/festivalTheme';
import { festivalVars } from '@/components/festival/festivalStyle';
import { countdownParts } from '@/components/festival/FestivalCountdown';
import type { FestiveHeroPhoto } from './FestiveHome';

/**
 * The Black Friday hero ("neon" festival style): night stage, neon-red light
 * beams, chrome headline, a neon price tag with the REAL top saving, a big
 * countdown, the free-delivery seal and the live deal photos on a glowing floor.
 *
 * Built in layers so the page stays fast and honest:
 *  - the stage (beams, glow, floor) is CSS gradients — no artwork download;
 *  - every word is live text from the theme tokens (lib/festival/themes.ts);
 *  - every number is the catalogue's own: `maxOff` is the biggest real discount
 *    on the deals shelf and each photo's "-X%" is that product's real discount.
 *    No number is invented here, and a 0 hides its badge instead of showing "0%".
 *
 * Motion is CSS only (transform/opacity — composited), never delays the first
 * paint of the headline or the first photo (LCP), and stops completely under
 * prefers-reduced-motion. Sizes are fixed in CSS, so the countdown filling in
 * after mount moves nothing (CLS).
 */
export default function BlackFridayHero({
  tokens,
  theme,
  photos,
  maxOff,
  dealsTotal,
  categoryCount,
  showSeal = false,
}: {
  tokens: FestivalThemeTokens;
  theme: PublicFestivalTheme;
  photos: FestiveHeroPhoto[];
  maxOff: number;
  dealsTotal: number;
  categoryCount: number;
  /** Only when checkout really waives shipping/packing/delivery (server flag). */
  showSeal?: boolean;
}) {
  const copy = tokens.home;
  const [line1, line2, line3] = copy.heroTitle;
  const art = photos.slice(0, 3);
  const seal = showSeal ? tokens.freeDeliverySeal : undefined;
  const stats = [
    dealsTotal > 0 && { value: `${dealsTotal}`, label: dealsTotal === 1 ? 'product on sale' : 'products on sale' },
    categoryCount > 0 && { value: `${categoryCount}`, label: categoryCount === 1 ? 'category' : 'categories' },
  ].filter(Boolean) as { value: string; label: string }[];

  return (
    <section className="bfh" style={festivalVars(tokens)} aria-label={copy.heroEyebrow} data-testid="festive-hero" data-fx-style="neon">
      <div className="bfh-stage" aria-hidden="true">
        <span className="bfh-beam bfh-beam-1" />
        <span className="bfh-beam bfh-beam-2" />
        <span className="bfh-beam bfh-beam-3" />
        <span className="bfh-sweep" />
      </div>

      <div className="bfh-inner">
        <div className="bfh-copy">
          <p className="bfh-eyebrow">{copy.heroEyebrow}</p>
          <h2 className="bfh-title">
            <span className="bfh-t1">{line1}</span>
            <span className="bfh-t2">{line2}</span>
            {line3 && <span className="bfh-t3"><span>{line3}</span></span>}
          </h2>
          <p className="bfh-sub">{copy.heroSubtitle}</p>
          {stats.length > 0 && (
            <dl className="bfh-stats">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt>{s.label}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="bfh-ctas">
            <Link href="/offers" className="bfh-btn bfh-btn-red" data-festive-tap>
              {copy.heroCta} <span aria-hidden="true">→</span>
            </Link>
            <Link href="/vehicles" className="bfh-btn bfh-btn-ghost">Find parts for my car</Link>
          </div>
          <HeroCountdown endsAt={theme.endsAt} label={tokens.copy.countdownLabel} />
        </div>

        <div className="bfh-art">
          {maxOff > 0 && (
            <Link href="/offers" className="bfh-tag" aria-label={`Up to ${maxOff}% off — shop the deals`}>
              <span className="bfh-tag-glow" aria-hidden="true" />
              <span className="bfh-tag-up">Up to</span>
              <span className="bfh-tag-pct">{maxOff}<small>%</small></span>
              <span className="bfh-tag-off">Off</span>
            </Link>
          )}
          {seal && (
            <p className="bfh-seal" data-testid="free-delivery-seal">
              <span className="bfh-seal-top">{seal.top}</span>
              <span className="bfh-seal-mid">{seal.middle}</span>
              <span className="bfh-seal-bot">{seal.bottom}</span>
              <TruckIcon />
            </p>
          )}
          <span className="bfh-cube bfh-cube-1" aria-hidden="true">%</span>
          <span className="bfh-cube bfh-cube-2" aria-hidden="true">%</span>
          {art.length > 0 && (
            <div className={`bfh-cards bfh-cards-${art.length}`}>
              {art.map((p, k) => (
                <Link key={`${p.href}-${k}`} href={p.href} className="bfh-card">
                  <span className="bfh-card-media">
                    <Img src={p.src} alt={p.name} className="bfh-card-img" sizes="(max-width: 768px) 30vw, 200px" priority={k === 0} />
                  </span>
                  {p.off > 0 && <span className="bfh-card-tag">-{p.off}%</span>}
                </Link>
              ))}
            </div>
          )}
          <span className="bfh-floor" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

function TruckIcon() {
  return (
    <svg className="bfh-seal-truck" viewBox="0 0 40 20" width="40" height="20" aria-hidden="true">
      <path d="M2 6h6M0 10h7M3 14h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10 3h15v11H10zM25 7h6l4 4v3h-10z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="15" cy="16" r="2.2" fill="currentColor" />
      <circle cx="30" cy="16" r="2.2" fill="currentColor" />
    </svg>
  );
}

const UNITS = [
  ['d', 'Days'],
  ['h', 'Hours'],
  ['m', 'Min'],
  ['s', 'Sec'],
] as const;

/**
 * Big four-box countdown to the admin's end date. Blank boxes in the server HTML
 * (the server cannot know the visitor's clock); filled after mount into boxes of
 * fixed size, so nothing moves. No end date → no countdown.
 */
function HeroCountdown({ endsAt, label }: { endsAt: string | null; label: string }) {
  const end = endsAt ? Date.parse(endsAt) : NaN;
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (Number.isNaN(end)) return;
    const tick = () => setLeft(end - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [end]);

  if (Number.isNaN(end)) return null;
  const parts = left === null ? null : countdownParts(left);
  return (
    <div className="bfh-count" role="timer" aria-live="off" data-testid="hero-countdown">
      <p className="bfh-count-label">{label}</p>
      <ol className="bfh-count-boxes">
        {UNITS.map(([k, name]) => {
          const v = parts ? String(parts[k]).padStart(2, '0') : '--';
          return (
            <li key={k} className="bfh-count-box">
              {/* Re-keyed on change so the digit flips in (CSS, once per change). */}
              <span key={v} className="bfh-count-num">{v}</span>
              <span className="bfh-count-unit">{name}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
