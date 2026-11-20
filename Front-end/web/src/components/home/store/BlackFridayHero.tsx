'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Img from '../redesign/Img';
import type { FestivalThemeTokens } from '@/lib/festival/themes';
import type { PublicFestivalTheme } from '@/lib/festival/festivalTheme';
import { festivalVars } from '@/components/festival/festivalStyle';
import { countdownParts } from '@/components/festival/FestivalCountdown';
import type { FestiveHeroPhoto } from './FestiveHome';
import { useCardFeeWaivers } from '@/hooks/queries/useCardFeeWaivers';
import BlackFridayHeroCard from './BlackFridayHeroCard';

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
  productTotal = 0,
  categoryCount,
  showSeal = false,
}: {
  tokens: FestivalThemeTokens;
  theme: PublicFestivalTheme;
  photos: FestiveHeroPhoto[];
  maxOff: number;
  dealsTotal: number;
  /** Every active product in the catalogue (0 when unknown). */
  productTotal?: number;
  categoryCount: number;
  /** Only when checkout really waives shipping/packing/delivery (server flag). */
  showSeal?: boolean;
}) {
  const copy = tokens.home;
  const [line1, line2, line3] = copy.heroTitle;
  const art = photos.slice(0, 3);
  // Black Friday: "Save ₹X+" also counts the delivery fees waived (server figures).
  const fee = useCardFeeWaivers(art.map((p) => p.id ?? '').filter(Boolean));
  const seal = showSeal ? tokens.freeDeliverySeal : undefined;
  // While checkout really waives the fees (the same server check as the seal) the
  // offer covers the whole catalogue, so the stat says so with the real count.
  // Otherwise — or if the count is unknown — it stays "N products on sale".
  const wholeCatalogue = showSeal && productTotal > 0;
  const stats = [
    wholeCatalogue && { value: `${productTotal}`, label: `${productTotal === 1 ? 'product' : 'products'} · ₹0 delivery fees` },
    !wholeCatalogue && dealsTotal > 0 && { value: `${dealsTotal}`, label: dealsTotal === 1 ? 'product on sale' : 'products on sale' },
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

      {showSeal && tokens.perks?.length ? <PerksCarousel perks={tokens.perks} /> : null}

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
                <BlackFridayHeroCard
                  key={`${p.href}-${k}`}
                  p={p}
                  waiver={p.id ? fee.waivers?.products[p.id] ?? null : null}
                  pending={fee.pending}
                  priority={k === 0}
                />
              ))}
            </div>
          )}
          <span className="bfh-floor" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

/** Copies of the list per half: enough to overfill a 2560px-wide hero. */
const PERK_REPEAT = 2;

/**
 * The offer perks gliding along the top of the hero ("₹0 Shipping fee · ₹0
 * Packing fee · ₹0 Platform fee …"). Rendered only while checkout really waives
 * the fees. Two identical halves slide left by one half and loop seamlessly
 * (transform only, CSS — no JS timer). Readers get the list once; the copies
 * are hidden from them. Fixed height in CSS, so it never shifts the page; with
 * reduced motion it stands still and scrolls sideways by hand instead.
 * A fixed lead label ("Zero hidden fees") sits at the left; only the chips move.
 * Motion pauses on hover and while a keyboard user is inside the strip.
 */
function PerksCarousel({ perks }: { perks: { strong: string; text: string }[] }) {
  const half = Array.from({ length: PERK_REPEAT }, () => perks).flat();
  return (
    <div className="bfh-perks" data-testid="offer-perks">
      <p className="bfh-perks-lead">
        <ShieldIcon />
        <span>
          Zero <b>hidden fees</b>
        </span>
      </p>
      <div className="bfh-perks-track">
        <div className="bfh-perks-row">
          {[0, 1].map((copy) => (
            <ul key={copy} className="bfh-perks-half" aria-hidden={copy === 1 ? true : undefined} aria-label={copy === 0 ? 'Black Friday delivery offer' : undefined}>
              {half.map((p, i) => (
                <li key={i} className="bfh-perk" aria-hidden={copy === 0 && i >= perks.length ? true : undefined}>
                  <CheckIcon />
                  <strong>{p.strong}</strong> <span className="bfh-perk-text">{p.text}</span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="bfh-perk-icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <circle cx="10" cy="10" r="10" fill="currentColor" />
      <path d="M5.8 10.4l2.8 2.8 5.6-6" fill="none" stroke="#14070a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="bfh-perks-lead-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5l8-3z" fill="currentColor" />
      <path d="M8 8h8M8 11h8M13.5 8c0 3-2 3.5-5 3.5l5 5" fill="none" stroke="#c8102e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
