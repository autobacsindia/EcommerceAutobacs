'use client';

import { useFestival } from './FestivalThemeContext';
import { festivalVars } from './festivalStyle';

const COUNT = 24;
/** Ticker copies per half: enough to overfill a 2560px screen. */
const TICKER_REPEAT = 4;

/**
 * The festive strip along the top of the page — a hanging toran for Diwali, a
 * neon ticker for Black Friday. Plain CSS (no JS animation), a fixed height so
 * it never shifts the layout, decorative only (aria-hidden, pointer-events:
 * none). Moves only when the visitor allows motion.
 */
export default function FestiveToran() {
  const festival = useFestival();
  if (!festival) return null;
  const { tokens } = festival;

  if (tokens.style === 'neon') {
    const words = tokens.ticker?.length ? tokens.ticker : [tokens.name];
    // Two identical halves: the row slides left by exactly one half and loops
    // seamlessly (transform only — composited, no layout or paint per frame).
    const half = Array.from({ length: TICKER_REPEAT }, () => words).flat();
    return (
      <div className="fx-ticker" style={festivalVars(tokens)} aria-hidden="true" data-testid="festive-toran">
        <div className="fx-ticker-row">
          {[0, 1].map((copy) => (
            <span key={copy} className="fx-ticker-half">
              {half.map((w, i) => (
                <span key={i} className="fx-ticker-item">{w}<i className="fx-ticker-dot" /></span>
              ))}
            </span>
          ))}
        </div>
      </div>
    );
  }

  const { garland } = tokens.icons;
  return (
    <div className="fx-toran" style={festivalVars(tokens)} aria-hidden="true" data-testid="festive-toran">
      <div className="fx-toran-row">
        {Array.from({ length: COUNT }, (_, i) => (
          <span key={i} className="fx-toran-item">{garland[i % garland.length]}</span>
        ))}
      </div>
    </div>
  );
}
