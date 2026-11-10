'use client';

import { useFestival } from './FestivalThemeContext';
import { festivalVars } from './festivalStyle';
import { useFestivalOfferPrice } from './FestivalOfferContext';
import type { FestivalOfferSetting } from '@/lib/festival/festivalOffer';

/**
 * "🪔 Diwali Deal" on products that are ALREADY discounted. Purely visual — the
 * caller decides "on sale" from the catalogue's own numbers; nothing here changes a
 * price. Renders nothing outside the festival.
 *
 * Given the product's `price` (and its Diwali `setting`), it also follows that
 * product's own Diwali offer: a product set to "No Diwali offer" — or with the price
 * offer switched off — shows no Diwali Deal tag, from the same calculation as its price.
 */
export default function FestivalDealBadge({
  className = '',
  price,
  setting,
}: {
  className?: string;
  price?: number | null;
  setting?: FestivalOfferSetting | null;
}) {
  const festival = useFestival();
  const offer = useFestivalOfferPrice(price ?? null, setting);
  if (!festival) return null;
  if (price !== undefined && !offer) return null;
  return (
    <span className={`fx-deal-badge ${className}`} style={festivalVars(festival.tokens)} data-testid="festival-deal-badge">
      <span aria-hidden="true">{festival.tokens.icons.lamp}</span>
      {festival.tokens.copy.dealBadge}
    </span>
  );
}
