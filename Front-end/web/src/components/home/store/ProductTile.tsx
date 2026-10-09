'use client';

import Link from 'next/link';
import Img from '../redesign/Img';
import { useCurrency } from '@/context/CurrencyContext';
import { discountPct, type StoreProduct } from './storeData';

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
export default function ProductTile({ p, badge }: { p: StoreProduct; badge?: string }) {
  const { formatPrice } = useCurrency();
  const off = discountPct(p);
  return (
    <Link href={p.href} className="st-tile">
      <div className="st-tile-media">
        <Img src={p.image} alt={p.name} className="st-tile-img" sizes="(max-width: 768px) 45vw, 220px" />
        {badge && <span className="st-badge">{badge}</span>}
      </div>
      <div className="st-tile-body">
        {off > 0 && (
          <div className="st-deal-line">
            <span className="st-off">-{off}%</span>
            <span className="st-deal-label">{p.offerEndDate ? 'Limited time deal' : 'Deal'}</span>
          </div>
        )}
        <div className="st-name">{p.name}</div>
        {p.reviews > 0 && (
          <div className="st-rating">
            <Stars rating={p.rating} /> <span className="st-rating-n">({p.reviews})</span>
          </div>
        )}
        <div className="st-price">
          <span className="st-now">{formatPrice(p.price)}</span>
          {off > 0 && p.originalPrice && (
            <span className="st-mrp">
              M.R.P.: <s>{formatPrice(p.originalPrice)}</s>
            </span>
          )}
        </div>
        {p.brand && <div className="st-brand">by {p.brand}</div>}
      </div>
    </Link>
  );
}
