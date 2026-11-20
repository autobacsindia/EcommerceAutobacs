'use client';

import Link from 'next/link';
import Img from '../redesign/Img';
import { useCurrency } from '@/context/CurrencyContext';
import { savingsLabel } from '@/lib/savings';
import { discountPct, type StoreProduct } from './storeData';
import FestivalDealBadge from '@/components/festival/FestivalDealBadge';
import { useFestivalOfferPrice } from '@/components/festival/FestivalOfferContext';
import FestivalOfferTag from '@/components/festival/FestivalOfferTag';
import type { CardFeeWaiver } from '@/hooks/queries/useCardFeeWaivers';
import ZeroDeliveryReceipt, { ZeroDeliveryRibbon, zeroDeliverySaveLabel } from '@/components/products/ZeroDeliveryReceipt';

/** Five stars, filled to the rating (rounded to the half). */
export function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  const r = Math.round(rating * 2) / 2;
  return (
    <span className="st-stars" role="img" aria-label={`${rating.toFixed(1)} out of 5 stars`} style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= r ? 'on' : i - 0.5 === r ? 'half' : 'off'} aria-hidden="true">★</span>
      ))}
    </span>
  );
}

/**
 * One product, Amazon-style: photo on white, name, rating (only when real reviews
 * exist), the price large, and — only for a genuine sale — the MRP struck through
 * with the saving in red. Nothing here computes or promises a price; it shows the
 * catalogue's own numbers through CurrencyContext like the rest of the store.
 */
export default function ProductTile({
  p, badge, feeWaiver = null, feeWaiverPending = false, feeOfferLive = false,
}: {
  p: StoreProduct;
  badge?: string;
  /** Black Friday: what the offer waives on this product (server figures, per shelf). */
  feeWaiver?: CardFeeWaiver | null;
  /** Offer live, figures loading: reserve the receipt's space (no CLS). */
  feeWaiverPending?: boolean;
  /** The ₹0-delivery offer is on for this shelf: sold-out/backorder tiles get a grey line. */
  feeOfferLive?: boolean;
}) {
  const { formatPrice } = useCurrency();
  const off = discountPct(p);
  // The chip reads "Save ₹250", not "-5%" — display only, from the tile's own prices.
  // Black Friday: the badge also counts the delivery fees the offer waives ("Save ₹X+").
  const saveLabel = zeroDeliverySaveLabel(p.stock === 'out' || p.stock === 'backorder' ? null : feeWaiver, (n) => formatPrice(n)) ?? savingsLabel(p.price, p.originalPrice, (n) => formatPrice(n));
  // Diwali offer (display mirror; the cart charges the server's figure) — an EXTRA %
  // on top of the price; the sale line and M.R.P. stay. Skipped for a variable product,
  // whose tile price is not one model's exact price.
  const offer = useFestivalOfferPrice(p.variable ? null : p.price, p.festivalOfferSetting);
  const exact = (n: number) => formatPrice(n, { exact: true });
  const unavailable = p.stock === 'out' || p.stock === 'backorder' ? p.stock : null;
  // A sold-out/backorder tile makes no ₹0 claim even if a waiver slipped through.
  const waiver = unavailable ? null : feeWaiver;
  const offerOn = feeOfferLive || feeWaiverPending || !!feeWaiver;
  return (
    <Link href={p.href} className="st-tile">
      <div className="st-tile-media">
        <Img src={p.image} alt={p.name} className="st-tile-img" sizes="(max-width: 768px) 45vw, 220px" />
        {badge && <span className="st-badge">{badge}</span>}
        {waiver && <ZeroDeliveryRibbon />}
      </div>
      <div className="st-tile-body">
        {(off > 0 || waiver) && (
          <div className="st-deal-line">
            {saveLabel && <span className="st-off">{saveLabel}</span>}
            <span className="st-deal-label">{p.offerEndDate ? 'Limited time deal' : 'Deal'}</span>
            <FestivalDealBadge price={p.variable ? null : p.price} setting={p.festivalOfferSetting} />
          </div>
        )}
        <div className="st-name">{p.name}</div>
        {p.reviews > 0 && (
          <div className="st-rating">
            <Stars rating={p.rating} /> <span className="st-rating-n">({p.reviews})</span>
          </div>
        )}
        <div className="st-price">
          <span className="st-now">{formatPrice(offer ? offer.finalPrice : p.price)}</span>
          {off > 0 && p.originalPrice && (
            <span className="st-mrp">
              M.R.P.: <s>{formatPrice(p.originalPrice)}</s>
            </span>
          )}
        </div>
        <FestivalOfferTag offer={offer} formatMoney={exact} className="mt-1" mrp={off > 0 ? p.originalPrice : null} />
        <ZeroDeliveryReceipt
          waiver={waiver}
          pending={!unavailable && feeWaiverPending}
          live={offerOn && !p.variable}
          unavailable={p.variable ? null : unavailable}
          price={offer ? offer.finalPrice : p.price}
          format={exact}
        />
        {/* Black Friday: no "by Brand" line — only some deals have a brand, so it made
            the tiles in a row uneven (owner, 2026-11-20). Back after the offer. */}
        {p.brand && !offerOn && <div className="st-brand">by {p.brand}</div>}
      </div>
    </Link>
  );
}
