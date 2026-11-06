'use client';

import { useFestival } from './FestivalThemeContext';
import { festivalVars } from './festivalStyle';

/**
 * "🪔 Diwali Deal" on products that are ALREADY discounted. Purely visual — the
 * caller decides "on sale" from the catalogue's own numbers; nothing here reads
 * or changes a price. Renders nothing outside the festival.
 */
export default function FestivalDealBadge({ className = '' }: { className?: string }) {
  const festival = useFestival();
  if (!festival) return null;
  return (
    <span className={`fx-deal-badge ${className}`} style={festivalVars(festival.tokens)} data-testid="festival-deal-badge">
      <span aria-hidden="true">{festival.tokens.icons.lamp}</span>
      {festival.tokens.copy.dealBadge}
    </span>
  );
}
