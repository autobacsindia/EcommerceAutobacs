'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import Img from '../redesign/Img';
import ProductRow from './ProductRow';
import { useCurrency } from '@/context/CurrencyContext';
import { useFestival } from '@/components/festival/FestivalThemeContext';
import { festivalVars } from '@/components/festival/festivalStyle';
import { GIFT_BAND_LIMITS, type GiftTier } from './giftTiers';
import type { StoreProduct } from './storeData';

/**
 * The festive dress for the store home page, switched by the admin festival
 * theme (FestivalThemeProvider) — the same on/off + date window as the toran and
 * the countdown, so it turns itself off at the end date with no deploy.
 *
 * Everything here is presentation. Every number shown (discount, product count,
 * prices) is the catalogue's own, already fetched server-side for the normal
 * shelves; nothing here computes, rounds or promises a price. Words come from the
 * theme tokens (lib/festival/themes.ts), never hard-coded here.
 *
 * The first client render matches the server HTML because the provider's
 * `initialLive` is computed during the same server render — no flash, no shift.
 */

/** Renders `festive` while the festival is live on this route, `normal` otherwise. */
export function FestiveSwitch({ festive, normal }: { festive: ReactNode; normal: ReactNode }) {
  return <>{useFestival() ? festive : normal}</>;
}

export interface FestiveHeroPhoto {
  src: string;
  href: string;
  name: string;
  /** Real discount of that product, 0 when it is not on sale. */
  off: number;
}

export function FestiveHero({
  photos,
  maxOff,
  dealsTotal,
  categoryCount,
}: {
  photos: FestiveHeroPhoto[];
  maxOff: number;
  dealsTotal: number;
  categoryCount: number;
}) {
  const festival = useFestival();
  if (!festival) return null;
  const { tokens } = festival;
  const copy = tokens.home;
  const [before, accent, after] = copy.heroTitle;
  const stats = [
    maxOff > 0 && { value: `${maxOff}%`, label: 'top saving' },
    dealsTotal > 0 && { value: `${dealsTotal}`, label: dealsTotal === 1 ? 'product on sale' : 'products on sale' },
    categoryCount > 0 && { value: `${categoryCount}`, label: categoryCount === 1 ? 'category' : 'categories' },
  ].filter(Boolean) as { value: string; label: string }[];
  const art = photos.slice(0, 3);

  return (
    <section className="fxh" style={festivalVars(tokens)} aria-label={copy.heroEyebrow} data-testid="festive-hero">
      <div className="fxh-lanterns" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((n) => <span key={n} className="fxh-lantern" />)}
      </div>
      <div className="fxh-inner">
        <div className="fxh-copy">
          <p className="fxh-eyebrow">✦ {copy.heroEyebrow} ✦</p>
          <h2 className="fxh-title">
            {before}<em>{accent}</em>{after}
          </h2>
          <p className="fxh-sub">{copy.heroSubtitle}</p>
          {stats.length > 0 && (
            <dl className="fxh-stats">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt>{s.label}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="fxh-ctas">
            <Link href="/offers" className="fxh-btn fxh-btn-gold">
              <span aria-hidden="true">{tokens.icons.lamp}</span> {copy.heroCta}
            </Link>
            <Link href="/vehicles" className="fxh-btn fxh-btn-ghost">Find parts for my car</Link>
          </div>
        </div>
        {art.length > 0 && (
          <div className={`fxh-art fxh-art-${art.length}`}>
            {art.map((p, k) => (
              <Link key={`${p.href}-${k}`} href={p.href} className="fxh-arch">
                <span className="fxh-arch-media">
                  <Img src={p.src} alt={p.name} className="fxh-arch-img" sizes="(max-width: 768px) 30vw, 220px" priority={k === 0} />
                </span>
                {p.off > 0 && <span className="fxh-arch-tag">-{p.off}%</span>}
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="fxh-diyas" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((n) => <span key={n} className="fxh-diya" />)}
      </div>
    </section>
  );
}

/** "Today's Deals" shelf, retitled for the festival. Same products, same tiles. */
export function DealsShelf({ products }: { products: StoreProduct[] }) {
  const festival = useFestival();
  return (
    <ProductRow
      id="sh-deals"
      title={festival ? festival.tokens.home.dealsTitle : "Today's Deals"}
      subtitle={festival ? festival.tokens.home.dealsSubtitle : 'Real savings on genuine parts — M.R.P. shown on every deal'}
      href="/offers"
      products={products}
    />
  );
}

export function GiftSection({ tiers }: { tiers: GiftTier[] }) {
  const festival = useFestival();
  const { formatPrice } = useCurrency();
  if (!festival || !tiers.length) return null;
  const copy = festival.tokens.home;
  const bandLabel = (band: 0 | 1 | 2) =>
    band === 0
      ? `Under ${formatPrice(GIFT_BAND_LIMITS[0])}`
      : band === 1
        ? `Under ${formatPrice(GIFT_BAND_LIMITS[1])}`
        : `${formatPrice(GIFT_BAND_LIMITS[1])} and above`;

  return (
    <section className="fxg" style={festivalVars(festival.tokens)} aria-labelledby="fxg-title" data-testid="festive-gifts">
      <div className="fxg-head">
        <div>
          <h2 id="fxg-title" className="fxg-title"><span aria-hidden="true">🎁</span> {copy.giftTitle}</h2>
          <p className="fxg-sub">{copy.giftSubtitle}</p>
        </div>
        <Link href="/offers" className="fxg-link">Explore gifts →</Link>
      </div>
      <div className={`fxg-tiers fxg-tiers-${tiers.length}`}>
        {tiers.map((t) => (
          <div key={t.band} className="fxg-tier">
            <p className="fxg-tier-name">{copy.giftTiers[t.band]}</p>
            <p className="fxg-tier-amt">{bandLabel(t.band)}</p>
            <div className="fxg-items">
              {t.products.map((p) => (
                <Link key={p.id} href={p.href} className="fxg-item">
                  <span className="fxg-item-media">
                    <Img src={p.image} alt={p.name} className="fxg-item-img" sizes="(max-width: 768px) 40vw, 160px" />
                  </span>
                  <span className="fxg-item-name">{p.name}</span>
                  <span className="fxg-item-price">{formatPrice(p.price)}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function FestiveWish() {
  const festival = useFestival();
  if (!festival) return null;
  const { tokens } = festival;
  return (
    <section className="fxw" style={festivalVars(tokens)} data-testid="festive-wish">
      <p className="fxw-title">
        <span aria-hidden="true">{tokens.icons.lamp}</span> {tokens.home.wishTitle} <span aria-hidden="true">{tokens.icons.lamp}</span>
      </p>
      <p className="fxw-sub">{tokens.home.wishSubtitle}</p>
    </section>
  );
}
