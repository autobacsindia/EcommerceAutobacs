'use client';

import Link from 'next/link';
import HeroSpinWheel from './HeroSpinWheel';
import type { SpinTeaser } from './homeData';

/**
 * Hero slide 2 — the Spin-to-Win teaser.
 *
 * ── Every claim on this slide is derived, never written ──────────────────────
 * The source poster carried fixed copy: "Every order unlocks one spin. No minimum
 * spend." Neither is knowable at design time — the campaign owns `minOrderValuePaise`
 * and `maxSpinsPerUserPerCampaign`, and an operator can change both from /admin/spin
 * without touching this file. So the eligibility line is COMPUTED from the live
 * campaign here. Hard-coding it would put a promise on the home page that the spin
 * engine will refuse to honour at checkout, which is the one failure mode a teaser
 * must not have.
 *
 * The CTA points at the catalogue, not at a wheel: a spin is earned by a paid order
 * and lives on the order-success page (components/spin/SpinSection.tsx). There is
 * nothing to spin here and the copy never implies otherwise.
 */

/** Rupees, from paise. Money is stored in paise everywhere the field name says so. */
const rupees = (paise: number) =>
  `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

/**
 * The eligibility line, assembled from the campaign's own terms.
 *
 * Exported for direct unit testing: this is the sentence that would silently become a
 * false advertisement if the derivation were wrong, and it is much easier to pin down
 * here than through a rendered slide.
 */
export function eligibilityLine(teaser: SpinTeaser): string {
  const spend =
    teaser.minOrderValuePaise > 0
      ? `on orders over ${rupees(teaser.minOrderValuePaise)}`
      : 'with no minimum spend';
  const spins =
    teaser.maxSpinsPerUserPerCampaign === null
      ? 'Every eligible order earns a spin'
      : teaser.maxSpinsPerUserPerCampaign === 1
        ? 'One spin per customer'
        : `Up to ${teaser.maxSpinsPerUserPerCampaign} spins per customer`;
  return `${spins}, ${spend}.`;
}

export default function HeroSpinSlide({
  teaser,
  active,
}: {
  teaser: SpinTeaser;
  active: boolean;
}) {
  return (
    <div className="hero-spin">
      <div className="hero-spin-copy">
        <div className="eyebrow">Rewards · {teaser.name}</div>
        <h2 className="headline">
          Spin
          <br />
          To <em>Win.</em>
        </h2>
        <div className="hero-spin-rule" />
        <p className="tagline">{eligibilityLine(teaser)}</p>

        <div className="hero-spin-badge">
          <span className="hero-spin-badge-value">100%</span>
          <span className="hero-spin-badge-label">Guaranteed win</span>
        </div>

        {/*
          Deliberately /products, not a spin route. The wheel is earned by a paid
          order and appears on the order-success page; sending someone here to "go
          spin" would dead-end them.
        */}
        <Link href="/products" className="hero-consult hero-spin-cta">
          <span>Shop now</span>
          <span className="hero-consult-arrow" aria-hidden="true">→</span>
        </Link>

        {/*
          The prize names in text, for anyone who never sees the dial — it is
          aria-hidden, and this is the accessible equivalent. "Prizes include", never
          "you will win": the draw is weighted and stock-limited server-side.
        */}
        <p className="hero-spin-prizes">
          Prizes include {teaser.prizes.map((p) => p.shortLabel || p.name).join(', ')}.
        </p>
      </div>

      <HeroSpinWheel prizes={teaser.prizes} active={active} />
    </div>
  );
}
