'use client';

import { useFestival } from './FestivalThemeContext';
import { festivalVars } from './festivalStyle';

const COUNT = 24;

/**
 * The hanging toran along the top of the page. Plain CSS (no JS animation), a
 * fixed height so it never shifts the layout, decorative only (aria-hidden,
 * pointer-events: none). Sways only when the visitor allows motion.
 */
export default function FestiveToran() {
  const festival = useFestival();
  if (!festival) return null;
  const { garland } = festival.tokens.icons;
  return (
    <div className="fx-toran" style={festivalVars(festival.tokens)} aria-hidden="true" data-testid="festive-toran">
      <div className="fx-toran-row">
        {Array.from({ length: COUNT }, (_, i) => (
          <span key={i} className="fx-toran-item">{garland[i % garland.length]}</span>
        ))}
      </div>
    </div>
  );
}
